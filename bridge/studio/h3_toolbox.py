"""Authenticated transport for the installed H3 Toolbox panels."""

import base64
import json
import re
import uuid
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

import aiohttp
from astrbot.api.web import json_response, request

from ..client import VIDEO_MIME, ComfyError
from ..workflows.h3_toolbox import cutter_source, valid_file
from ..workflows.workflow import TOOLBOX_WORKFLOWS, WorkflowError
from .h3_media import H3_JSON_LIMIT, MEDIA_EXTENSIONS

LVM = "/amiaomiao_h3/lvm/"
CLIPS = "/amiaomiao_h3/clip_bin/"
READ = {LVM + path for path in (
    "projects", "ref_presets", "image_metadata", "uploads", "segments", "video_files",
    "video_file_info", "ref_plan",
)} | {CLIPS + path for path in ("list", "projects")} | {"/object_info/AmiaomiaoH3_H3VideoCutterV3"}
WRITE = {LVM + path for path in (
    "project", "project/rename", "project/delete", "project/open", "ref_presets", "uploads/delete",
    "uploads/reorder", "uploads/preview", "source_preview", "source_preview_proxy", "delete", "merge",
)} | {CLIPS + path for path in (
    "project", "project/rename", "project/delete", "project/open", "rename", "delete", "delete_many", "lock",
)}
THUMBNAIL = LVM + "image_thumbnail"
SOURCE_PREVIEW = LVM + "source_preview"
PREVIEW = {"/view", THUMBNAIL, SOURCE_PREVIEW}


def split_path(path):
    if not isinstance(path, str) or not 0 < len(path) <= 4096:
        raise WorkflowError("H3 接口地址无效。")
    parts = urlsplit(path)
    if parts.scheme or parts.netloc or parts.fragment:
        raise WorkflowError("H3 接口仅支持本机 Toolbox 路由。")
    return parts.path, dict(parse_qsl(parts.query, keep_blank_values=True, max_num_fields=20))


def file_query(params):
    return valid_file(params.get("filename"), params.get("subfolder", ""), params.get("type") or "input")


class ToolboxStudio:
    def __init__(self, studio):
        self.studio = studio
        self.service = studio.service

    async def rpc(self):
        if not request.username:
            return json_response({"error": "请登录工作台。"}, status_code=401)
        try:
            raw = await request.body()
            if len(raw) > H3_JSON_LIMIT:
                raise WorkflowError("H3 接口数据过大。")
            data = json.loads(raw)
            route, params = split_path(data.get("path"))
            method, body = data.get("method"), data.get("body")
            if method == "GET" and route in READ:
                if route == LVM + "image_metadata":
                    params = file_query(params)
                return json_response(await self.service.client.request("GET", route, params=params))
            if method == "GET" and route in PREVIEW:
                if route == SOURCE_PREVIEW:
                    if not re.fullmatch(r"[A-Za-z0-9_-]{16,96}", params.get("ticket", "")):
                        raise WorkflowError("视频预览地址无效。")
                    params = {name: value for name, value in params.items() if name in {"ticket", "proxy"}}
                    suffix = ".mp4"
                else:
                    params = file_query(params)
                    suffix = Path(params["filename"]).suffix.lower()
                if route == THUMBNAIL:
                    data = await self.service.client.request("GET", route, params=params, binary=True, max_bytes=512 * 1024)
                    return json_response({"src": "data:image/jpeg;base64," + base64.b64encode(data).decode("ascii")})
                src = await self.studio.h3_media.register_preview(route, params, suffix)
                return json_response({"src": src})
            if method != "POST" or route not in WRITE or not isinstance(body, dict):
                raise WorkflowError("H3 工具箱接口不支持此操作。")
            if route.endswith("/project/open") and not request.plugin_name:
                raise WorkflowError("请从本机 AstrBot 面板打开项目目录。")
            if route == SOURCE_PREVIEW:
                body = cutter_source(body, self.studio.anima.workspace.resolve())
            if route == LVM + "ref_presets":
                entries = body.get("entries")
                if not isinstance(entries, list) or len(entries) > 256:
                    raise WorkflowError("H3 素材项目内容过大或无效。")
                for entry in entries:
                    file_query(entry)
            result = await self.service.client.request("POST", route, params=params, payload=body)
            return json_response(result)
        except (OSError, ValueError, TypeError, KeyError, AttributeError, ComfyError) as exc:
            return json_response({"error": str(exc)}, status_code=400)

    async def upload(self):
        if not request.username:
            return json_response({"error": "请登录工作台。"}, status_code=401)
        try:
            query = request.query
            pool = query.get("pool") == "1"
            upload = (await request.files()).get("file")
            if upload is None or not upload.filename:
                raise WorkflowError("请选择 H3 素材文件。")
            suffix = Path(upload.filename).suffix.lower()
            if suffix not in (VIDEO_MIME if pool else MEDIA_EXTENSIONS):
                raise WorkflowError("不支持的 H3 素材格式。")
            client = self.service.client
            limit = client.max_video_bytes if suffix in VIDEO_MIME or suffix in {
                ".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac", ".opus",
            } else client.max_image_bytes
            content = await upload.read(limit + 1)
            if not content or len(content) > limit:
                raise WorkflowError("H3 文件为空或超过上传大小。")
            form = aiohttp.FormData()
            if pool:
                project = query.get("project", "")
                if not project.strip() or len(project) > 128:
                    raise WorkflowError("请选择有效的视频池项目。")
                form.add_field("project", project)
                form.add_field("file", content, filename=Path(upload.filename).name)
                route = LVM + "uploads/import"
            else:
                name = Path(upload.filename.replace("\\", "/")).name
                subfolder = "astrbot_bridge/h3_toolbox"
                form.add_field("image", content, filename=f"{uuid.uuid4().hex[:8]}_{name}")
                form.add_field("subfolder", subfolder)
                form.add_field("type", "input")
                route = "/upload/image"
            return json_response(await client.request("POST", route, form=form))
        except (OSError, ValueError, TypeError, ComfyError) as exc:
            return json_response({"error": str(exc)}, status_code=400)

    async def result(self):
        if not request.username:
            return json_response({"error": "请登录工作台。"}, status_code=401)
        try:
            job = self.service.get_job(f"studio:{request.username}", request.query.get("id", ""))
            if job.workflow not in TOOLBOX_WORKFLOWS:
                raise WorkflowError("该任务没有 H3 工具箱结果。")
            return json_response({"state": job.state, "message": job.error, "outputs": job.toolbox_result or {}})
        except (ValueError, ComfyError) as exc:
            return json_response({"error": str(exc)}, status_code=400)
