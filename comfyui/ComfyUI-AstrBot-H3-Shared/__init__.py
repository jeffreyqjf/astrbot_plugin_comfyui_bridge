"""Shared prompt libraries for the ComfyUI and AstrBot H3 editors."""

import asyncio
import hashlib
import json
import re
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.parse import urlsplit

from aiohttp import web
from server import PromptServer

NODE_CLASS_MAPPINGS = {}
WEB_DIRECTORY = "./web"

FAMILIES = {"h3-dual", "ph3"}
LIBRARY_LIMIT = 1024 * 1024
REQUEST_LIMIT = 256 * 1024
LOCK = asyncio.Lock()
ROUTE = "/astrbot_h3_shared/prompts/{family}"


def _snapshot(path):
    try:
        with path.open("rb") as stream:
            raw = stream.read(LIBRARY_LIMIT + 1)
    except FileNotFoundError:
        raw = b"[]"
    if len(raw) > LIBRARY_LIMIT:
        raise ValueError("提示词库超过大小上限。")
    entries = json.loads(raw)
    if not isinstance(entries, list) or any(
        not isinstance(entry, dict) or not isinstance(entry.get("name"), str)
        or not isinstance(entry.get("text"), str) for entry in entries
    ):
        raise ValueError("提示词库文件格式无效。")
    return {"entries": entries, "revision": hashlib.sha256(raw).hexdigest()}


def _replace(path, entries):
    raw = (json.dumps(entries, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    if len(entries) > 200 or len(raw) > LIBRARY_LIMIT:
        raise ValueError("提示词库已满，最多保存 200 条和 1 MiB。")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with NamedTemporaryFile(dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(raw)
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return {"entries": entries, "revision": hashlib.sha256(raw).hexdigest()}


def _library_path(request):
    family = request.match_info["family"]
    if family not in FAMILIES:
        raise web.HTTPNotFound()
    manager = PromptServer.instance.user_manager
    root = Path(manager.get_request_user_filepath(request, None, create_dir=False)).absolute()
    path = root / "astrbot_h3_shared" / f"{family}.json"
    if root.resolve() != root or path.resolve() != path:
        raise ValueError("提示词库目录不能使用链接。")
    return path


@PromptServer.instance.routes.get(ROUTE)
@PromptServer.instance.routes.post(ROUTE)
async def shared_prompts(request):
    try:
        path = _library_path(request)
        if request.method == "GET":
            return web.json_response(await asyncio.to_thread(_snapshot, path), headers={"Cache-Control": "no-store"})
        origin = request.headers.get("Origin")
        if origin is not None and (
            urlsplit(origin).scheme not in {"http", "https"} or urlsplit(origin).netloc.casefold() != request.host.casefold()
        ):
            raise web.HTTPForbidden()
        if request.content_type != "application/json":
            raise ValueError("请提交 JSON。")
        raw = bytearray()
        async for chunk in request.content.iter_chunked(65536):
            raw.extend(chunk)
            if len(raw) > REQUEST_LIMIT:
                raise ValueError("请求内容过大。")
        body = json.loads(raw)
        if not isinstance(body, dict) or body.keys() != {"name", "text", "revision"}:
            raise ValueError("提示词请求格式无效。")
        name = body.get("name")
        text = body.get("text")
        if not isinstance(name, str) or not re.fullmatch(r"[^\x00-\x1f]{1,80}", name.strip()):
            raise ValueError("提示词名称须为 1 至 80 个字符。")
        if text is not None and (not isinstance(text, str) or not text.strip() or len(text) > 32000):
            raise ValueError("请输入 1 至 32000 字符的提示词。")
        name = name.strip()
        async with LOCK:
            current = await asyncio.to_thread(_snapshot, path)
            if body.get("revision") != current["revision"]:
                return web.json_response({"error": "提示词库已更新，请刷新后重试。"}, status=409)
            entries = [entry for entry in current["entries"] if entry["name"] != name]
            if text is not None:
                entries.append({"name": name, "text": text})
            entries.sort(key=lambda entry: entry["name"].casefold())
            return web.json_response(await asyncio.to_thread(_replace, path, entries))
    except KeyError:
        raise web.HTTPForbidden() from None
    except (OSError, TypeError, ValueError) as exc:
        return web.json_response({"error": str(exc)}, status=400)
