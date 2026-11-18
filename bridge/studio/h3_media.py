"""Authenticated access to the installed Fantastic H3 media editor API."""

import asyncio
import json
import mimetypes
import re
import secrets
from pathlib import Path
from tempfile import TemporaryDirectory
from time import monotonic
from urllib.parse import quote

import aiohttp

from ..client import ComfyError
from ..workflows.workflow import H3_SEED_FULL, WorkflowError
from ..workflows.workflow_store import (
    WORKFLOW_LIMIT,
    atomic_write,
    profile_bytes,
    read_profile,
    workflow_path,
    workflow_revision,
)

H3_JSON_LIMIT = 1024 * 1024
MEDIA_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff",
    ".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".mpg", ".mpeg",
    ".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac", ".opus",
}
READ_ROUTES = {
    "/minimax_h3/capabilities", "/minimax_h3/presets", "/minimax_h3/edit_files",
    "/object_info/CheckpointLoaderSimple",
}
WRITE_ROUTES = {
    "/minimax_h3/extract_audio", "/minimax_h3/bake", "/minimax_h3/mask_compose",
    "/minimax_h3/edit_files/delete",
    *{"/minimax_h3/presets/" + action for action in ("save", "load", "delete", "meta", "category", "match")},
}


def valid_prompt_template(template):
    return (
        isinstance(template, dict) and set(template) == {"prompt", "mode"}
        and isinstance(template.get("prompt"), str) and bool(template["prompt"].strip())
        and len(template["prompt"]) <= 8000
        and isinstance(template.get("mode"), str)
        and template["mode"] in {"auto", "t2va", "i2va", "fl2va", "l2va", "ref2va"}
    )


def media_view(file):
    if not isinstance(file, str) or not 0 < len(file) <= 2048:
        raise WorkflowError("媒体文件标识无效。")
    match = re.fullmatch(r"(.+?)(?: \[(input|output|temp)\])?", file)
    if not match:
        raise WorkflowError("媒体文件标识无效。")
    name, kind = match.groups()
    parts = name.replace("\\", "/").split("/")
    if any(part in ("", ".", "..") or re.search(r'[<>:"|?*\x00-\x1f]', part) for part in parts):
        raise WorkflowError("媒体文件必须位于 ComfyUI 的素材目录。")
    if Path(parts[-1]).suffix.lower() not in MEDIA_EXTENSIONS:
        raise WorkflowError("请选择图片、视频或音频。")
    return {"filename": parts[-1], "subfolder": "/".join(parts[:-1]), "type": kind or "input"}


class H3Media:
    def __init__(self, service):
        self.service = service
        self.preview_links = {}
        self.mask_jobs = set()
        self.lock = asyncio.Lock()
        self.preview_directory = None

    def close(self):
        self.preview_links.clear()
        self.mask_jobs.clear()
        if self.preview_directory is not None:
            self.preview_directory.cleanup()
            self.preview_directory = None

    def read_prompt_templates(self):
        path = workflow_path(self.service.data_dir.resolve(), "h3_prompt_templates")
        raw = read_profile(path) if path.exists() else b""
        data = json.loads(raw) if raw else {"version": 1, "templates": {}}
        if not isinstance(data, dict) or data.get("version") != 1 or not isinstance(data.get("templates"), dict):
            raise WorkflowError("H3 提示词模板文件格式无效。")
        if any(not re.fullmatch(r"[^\x00-\x1f]{1,64}", name) or not valid_prompt_template(template)
               for name, template in data["templates"].items()):
            raise WorkflowError("H3 提示词模板内容无效。")
        return path, workflow_revision(raw), data

    async def prompt_templates(self):
        from astrbot.api.web import error_response, json_response, request

        if not request.username:
            return error_response("请登录工作台。", status_code=401)
        try:
            _, revision, data = await asyncio.to_thread(self.read_prompt_templates)
            return json_response({"revision": revision, "templates": data["templates"]})
        except (OSError, ValueError) as exc:
            return error_response(str(exc), status_code=400)

    async def save_prompt_template(self):
        from astrbot.api.web import error_response, json_response, request

        if not request.username:
            return error_response("请登录工作台。", status_code=401)
        try:
            raw = await request.body()
            if len(raw) > WORKFLOW_LIMIT + 128 * 1024:
                raise WorkflowError("H3 提示词模板数据过大。")
            payload = json.loads(raw)
            if not isinstance(payload, dict) or not ({"template", "templates"} & payload.keys()):
                raise WorkflowError("请指定 H3 提示词模板。")
            bulk = "templates" in payload
            if bulk:
                if payload.get("version") != 1 or type(payload.get("replace")) is not bool or not isinstance(payload["templates"], dict):
                    raise WorkflowError("请选择版本 1 的 H3 提示词模板 JSON。")
                incoming = payload["templates"]
            else:
                if len(raw) > 128 * 1024 or not isinstance(payload.get("name"), str):
                    raise WorkflowError("模板名称或数据大小无效。")
                incoming = {payload["name"].strip(): payload["template"]}
            for name, template in incoming.items():
                if not re.fullmatch(r"[^\x00-\x1f]{1,64}", name) or name != name.strip():
                    raise WorkflowError("模板名称须为 1 到 64 个字符，首尾不能为空格。")
                if not (template is None and not bulk) and not valid_prompt_template(template):
                    raise WorkflowError("请填写有效的 H3 提示词和编辑模式，提示词最多 8000 字符。")
            async with self.service.state_lock:
                path, revision, data = await asyncio.to_thread(self.read_prompt_templates)
                if payload.get("revision") != revision:
                    return error_response("模板列表已更新，请刷新模板后重试。", status_code=409)
                imported = 0
                for name, template in incoming.items():
                    if bulk and name in data["templates"] and not payload["replace"]:
                        continue
                    if template is None:
                        data["templates"].pop(name, None)
                    else:
                        data["templates"][name] = template
                    imported += 1
                saved = profile_bytes(data)
                if len(saved) > WORKFLOW_LIMIT:
                    raise WorkflowError("H3 提示词模板文件超过 4 MB。")
                path.parent.mkdir(parents=True, exist_ok=True)
                await asyncio.to_thread(atomic_write, path, saved)
            return json_response({"revision": workflow_revision(saved), "templates": data["templates"],
                                  **({"imported": imported, "skipped": len(incoming) - imported} if bulk else {})})
        except (OSError, ValueError, TypeError, RecursionError) as exc:
            return error_response(str(exc), status_code=400)

    async def state(self):
        from astrbot.api.web import error_response, json_response, request

        if not request.username:
            return error_response("请登录工作台。", status_code=401)
        try:
            await self.service.initialize()
            workflow = self.service.workflows.get(H3_SEED_FULL)
            node = workflow.graph.get("416") if workflow else None
            positive = workflow.positive[0] if workflow and workflow.positive else None
            return json_response({
                "available": bool(node and node.get("class_type") == "MiniMaxH3MediaLoader"),
                "items": json.loads(node["inputs"]["media_state"]) if node else [],
                "prompt": workflow.graph[positive.node]["inputs"][positive.name] if positive else "",
                "prompt_mode": "auto" if positive and positive.node == "571" else "ref2va",
            })
        except (OSError, ValueError, ComfyError) as exc:
            return error_response(str(exc), status_code=400)

    async def native_post(self, path, *, payload=None, form=None):
        client = self.service.client
        token = await client.request("GET", "/minimax_h3/token")
        return await client.request(
            "POST", path, payload=payload, form=form,
            headers={"X-MiniMaxH3-Token": token["token"]},
        )

    def check_route(self, method, path, body):
        if method == "GET" and path in READ_ROUTES:
            return
        if method == "POST" and path in WRITE_ROUTES:
            return
        if method == "GET" and path.startswith("/history/") and path[9:] in self.mask_jobs:
            return
        if method == "POST" and path == "/prompt" and isinstance(body, dict):
            graph = body.get("prompt")
            if isinstance(graph, dict) and set(graph) == {"1", "2"} and (
                graph["1"].get("class_type") == "CheckpointLoaderSimple"
                and graph["2"].get("class_type") == "MiniMaxH3FantasticObjectMask"
                and graph["2"].get("inputs", {}).get("model") == ["1", 0]
                and graph["2"].get("inputs", {}).get("clip") == ["1", 1]
            ):
                media_view(graph["2"]["inputs"].get("video"))
                return
        raise WorkflowError("媒体编辑接口不支持此操作。")

    async def rpc(self):
        from astrbot.api.web import error_response, json_response, request

        if not request.username:
            return error_response("请登录工作台。", status_code=401)
        try:
            raw = await request.body()
            if len(raw) > H3_JSON_LIMIT:
                raise WorkflowError("媒体编辑数据过大。")
            data = json.loads(raw)
            method, path, body = data.get("method", "GET"), data.get("path"), data.get("body")
            if method == "GET" and path == "/minimax_h3/token":
                return json_response({"token": "astrbot"})
            self.check_route(method, path, body)
            if method == "POST":
                if path == "/prompt":
                    body = {"prompt": body["prompt"], "client_id": self.service.client.client_id}
                    result = await self.service.client.request(method, path, payload=body)
                    self.mask_jobs.add(result["prompt_id"])
                else:
                    result = await self.native_post(path, payload=body)
            else:
                result = await self.service.client.request(method, path)
            return json_response(result)
        except (OSError, ValueError, TypeError, KeyError, AttributeError, ComfyError) as exc:
            return json_response({"error": str(exc)}, status_code=400)

    async def upload(self):
        from astrbot.api.web import error_response, json_response, request

        if not request.username:
            return error_response("请登录工作台。", status_code=401)
        try:
            upload = (await request.files()).get("file")
            if upload is None or not upload.filename:
                raise WorkflowError("请选择媒体文件。")
            suffix = Path(upload.filename).suffix.lower()
            if suffix not in MEDIA_EXTENSIONS:
                raise WorkflowError("请选择图片、视频或音频。")
            limit = self.service.client.max_image_bytes if suffix in {
                ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff",
            } else self.service.client.max_video_bytes
            content = await upload.read(limit + 1)
            if not content or len(content) > limit:
                raise WorkflowError("文件为空或超过插件配置的上传大小。")
            form = aiohttp.FormData()
            form.add_field("file", content, filename=Path(upload.filename).name,
                           content_type=upload.content_type or "application/octet-stream")
            return json_response(await self.native_post("/minimax_h3/upload", form=form))
        except (OSError, ValueError, KeyError, ComfyError) as exc:
            return json_response({"error": str(exc)}, status_code=400)

    async def preview(self):
        from astrbot.api.web import error_response, json_response, request

        if not request.username:
            return error_response("请登录工作台。", status_code=401)
        try:
            raw = await request.body()
            if len(raw) > 4096:
                raise WorkflowError("媒体预览请求过大。")
            params = media_view(json.loads(raw).get("file"))
            async with self.lock:
                now = monotonic()
                for token, link in list(self.preview_links.items()):
                    if link[0] < now:
                        link[1].unlink(missing_ok=True)
                        del self.preview_links[token]
                owner = request.headers.get("authorization", "") if not request.plugin_name else request.username
                for token, link in self.preview_links.items():
                    if link[2:] == (owner, params):
                        self.preview_links[token] = (now + 6 * 60 * 60, *link[1:])
                        return json_response({"src": await self.preview_url(token, link[1])})
                if len(self.preview_links) >= 128:
                    raise WorkflowError("媒体预览数量已达上限，请稍后重试。")
                if self.preview_directory is None:
                    self.preview_directory = TemporaryDirectory(prefix="h3-media-", dir=self.service.data_dir)
                directory = Path(self.preview_directory.name)
                token = secrets.token_urlsafe(32)
                path = directory / (token + Path(params["filename"]).suffix.lower())
                try:
                    await self.service.client.request(
                        "GET", "/view", params=params, output_path=path,
                        max_bytes=max(self.service.client.max_video_bytes, self.service.client.max_image_bytes),
                    )
                    src = await self.preview_url(token, path)
                except BaseException:
                    path.unlink(missing_ok=True)
                    raise
                self.preview_links[token] = (now + 6 * 60 * 60, path, owner, params)
                return json_response({"src": src})
        except (OSError, ValueError, KeyError, AttributeError, ComfyError) as exc:
            return error_response(str(exc), status_code=400)

    @staticmethod
    async def preview_url(token, path):
        from astrbot.api.web import request

        if request.plugin_name:
            from astrbot.core import file_token_service

            token = await file_token_service.register_file(str(path), 6 * 60 * 60, single_use=False)
            return f"/api/v1/files/tokens/{quote(token, safe='')}"
        return f"/h3-media/{token}"

    def remote_file(self, token):
        link = self.preview_links.get(token)
        if not link or link[0] < monotonic():
            raise WorkflowError("媒体预览已过期，请重新打开。")
        return link[1], link[2], mimetypes.guess_type(link[1].name)[0] or "application/octet-stream"
