"""Asynchronous ComfyUI local API client. Never interrupts the global GPU queue."""

import asyncio
import json
import uuid
from copy import deepcopy
from pathlib import Path
from time import monotonic
from urllib.parse import quote, urlsplit

import aiohttp


class ComfyError(RuntimeError):
    pass


class ComfyCancelled(ComfyError):
    pass


VIDEO_MIME = {
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".mov": "video/quicktime",
    ".gif": "image/gif",
}


class ComfyClient:
    def __init__(self, url, token="", request_timeout=20, max_image_mb=20, max_video_mb=100):
        parts = urlsplit(url)
        if parts.scheme not in {"http", "https"} or not parts.hostname:
            raise ComfyError("ComfyUI 地址必须是 http:// 或 https:// 开头的完整地址。")
        if parts.query or parts.fragment or parts.username or parts.password:
            raise ComfyError("地址中不能包含账号密码、查询参数或片段，请使用面板的认证令牌。")
        self.url = url.rstrip("/")
        self.token = token.strip()
        self.timeout = request_timeout
        self.max_image_bytes = max_image_mb * 1024 * 1024
        self.max_video_bytes = max_video_mb * 1024 * 1024
        self.client_id = uuid.uuid4().hex
        self.session = None
        self.schema_cache = {}

    async def close(self):
        if self.session is not None:
            await self.session.close()

    async def request(
        self,
        method,
        route,
        *,
        payload=None,
        params=None,
        binary=False,
        form=None,
        output_path=None,
        max_bytes=None,
    ):
        if self.session is None or self.session.closed:
            headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}
            self.session = aiohttp.ClientSession(
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=self.timeout),
                trust_env=False,
            )
        limit = max_bytes or (self.max_image_bytes if binary else 16 * 1024 * 1024)
        handle = None
        try:
            async with self.session.request(
                method,
                self.url + route,
                json=payload,
                data=form,
                params=params,
                allow_redirects=False,
            ) as response:
                if response.content_length is not None and response.content_length > limit:
                    raise ComfyError("ComfyUI 返回的内容超过大小限制。")
                if output_path and response.status < 300:
                    handle = await asyncio.to_thread(output_path.open, "wb")
                chunks, size = [], 0
                async for chunk in response.content.iter_chunked(1024 * 1024):
                    size += len(chunk)
                    if size > limit:
                        raise ComfyError("ComfyUI 返回的内容超过大小限制。")
                    if handle:
                        await asyncio.to_thread(handle.write, chunk)
                    else:
                        chunks.append(chunk)
                if handle:
                    return output_path
                body = b"".join(chunks)
                if response.status >= 300:
                    detail = self._api_error(body)
                    raise ComfyError(f"ComfyUI HTTP {response.status}：{detail}")
                if binary:
                    return body
                if not body and method == "POST" and route == "/queue":
                    return {}
                try:
                    result = json.loads(body)
                except (ValueError, UnicodeError) as exc:
                    raise ComfyError(
                        "接口没有返回 JSON，请确认配置的是 ComfyUI 服务地址。"
                    ) from exc
                if not isinstance(result, dict):
                    raise ComfyError("ComfyUI 返回了非预期的接口数据。")
                return result
        except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
            raise ComfyError(
                "无法连接 ComfyUI 或请求超时，请确认服务已启动、地址和端口正确。"
                "提交请求超时时可能已入队，请先检查 ComfyUI 队列再重试。"
            ) from exc
        finally:
            if handle:
                await asyncio.to_thread(handle.close)

    async def node_schemas(self, node_types, *, cached=False):
        names = sorted(set(node_types))
        schemas = {}
        now = monotonic()
        if cached:
            remaining = []
            for name in names:
                entry = self.schema_cache.get(name)
                if entry and entry[0] > now:
                    schemas[name] = deepcopy(entry[1])
                else:
                    remaining.append(name)
            names = remaining
        self.schema_cache = {name: entry for name, entry in self.schema_cache.items() if entry[0] > now}
        for offset in range(0, len(names), 8):
            batch = await asyncio.gather(*(
                self.request("GET", f"/object_info/{quote(name, safe='')}")
                for name in names[offset:offset + 8]
            ))
            for response in batch:
                schemas.update(response)
                for name, schema in response.items():
                    self.schema_cache[name] = (now + 60, deepcopy(schema))
        return schemas

    async def upload_image(self, data):
        if not data or len(data) > self.max_image_bytes:
            raise ComfyError("参考图为空或超过单张图片大小上限。")
        suffix = image_suffix(data)
        form = aiohttp.FormData()
        form.add_field(
            "image",
            data,
            filename="astrbot_" + uuid.uuid4().hex + suffix,
            content_type={
                ".png": "image/png",
                ".jpg": "image/jpeg",
                ".webp": "image/webp",
                ".gif": "image/gif",
            }[suffix],
        )
        form.add_field("type", "input")
        form.add_field("subfolder", "astrbot_bridge")
        form.add_field("overwrite", "false")
        result = await self.request("POST", "/upload/image", form=form)
        name, folder = result.get("name"), result.get("subfolder", "")
        if not isinstance(name, str) or not name or not isinstance(folder, str):
            raise ComfyError("ComfyUI 未返回有效的上传文件名。")
        return f"{folder}/{name}" if folder else name

    @staticmethod
    def _api_error(body):
        try:
            data = json.loads(body)
            error = data.get("error", "")
            if isinstance(error, dict):
                error = error.get("message", error.get("type", "请求被拒绝"))
            details = []
            for key, node in data.get("node_errors", {}).items():
                for entry in node.get("errors", []):
                    details.append(
                        f"节点 {key}：{entry.get('message', '')} {entry.get('details', '')}"
                    )
            return (str(error) + "；" + "；".join(details))[:1000]
        except (ValueError, AttributeError, TypeError):
            return "请求被拒绝，请检查服务认证、模型文件和工作流节点。"

    async def submit(self, graph, *, metadata=None):
        # A submission is deliberately never retried: duplicate POSTs generate duplicate images.
        result = await self.request(
            "POST",
            "/prompt",
            payload={
                "prompt": graph,
                "client_id": self.client_id,
                **({"extra_data": {"extra_pnginfo": {"astrbot": metadata}}} if metadata is not None else {}),
            },
        )
        prompt_id = result.get("prompt_id")
        if not isinstance(prompt_id, str) or not prompt_id:
            raise ComfyError("ComfyUI 未接受任务：" + self._api_error(json.dumps(result).encode()))
        return prompt_id

    async def delete_queued(self, prompt_id):
        # /queue delete only removes this prompt if still queued; never use global /interrupt.
        try:
            await asyncio.wait_for(
                self.request("POST", "/queue", payload={"delete": [prompt_id]}),
                3,
            )
        except (ComfyError, asyncio.TimeoutError):
            pass

    async def cancel_prompt(self, prompt_id):
        result = await self.request("POST", f"/api/jobs/{quote(prompt_id, safe='')}/cancel")
        return result.get("cancelled") is True

    async def wait(self, prompt_id, timeout, poll_interval=1.0):
        deadline = monotonic() + timeout
        transient_errors = 0
        while monotonic() < deadline:
            try:
                history = await asyncio.wait_for(
                    self.request("GET", "/history/" + quote(prompt_id, safe="")),
                    max(0.01, deadline - monotonic()),
                )
                transient_errors = 0
            except ComfyError:
                transient_errors += 1
                if transient_errors >= 3:
                    raise
                history = {}
            except asyncio.TimeoutError:
                break
            record = history.get(prompt_id)
            if isinstance(record, dict):
                status = record.get("status", {})
                for kind, detail in status.get("messages", []):
                    if kind == "execution_interrupted":
                        raise ComfyCancelled("ComfyUI 已停止此任务。")
                    if kind == "execution_error":
                        raise ComfyError(
                            f"执行失败（{detail.get('node_type', '未知节点')}）："
                            + str(detail.get("exception_message", kind))[:800]
                        )
                if status.get("status_str") == "error":
                    raise ComfyError("ComfyUI 执行失败，请查看 ComfyUI 控制台。")
                if status.get("completed") is True:
                    return record
            await asyncio.sleep(min(poll_interval, max(0, deadline - monotonic())))
        raise ComfyError(
            "等待生成超时。已尝试移除本插件尚未运行的任务；"
            "已经开始的 GPU 任务可能仍会在 ComfyUI 中完成。"
        )

    async def download_outputs(
        self, record, output_nodes, directory: Path, max_images=4, video=False, *, existing_video=None,
    ):
        refs = output_refs(record, output_nodes, video=video)
        if not refs:
            raise ComfyError("任务已结束，但未找到可回传的图片或视频，请检查输出节点。")
        paths = []
        for ref in refs[:max_images]:
            if video:
                local = await asyncio.to_thread(existing_video, ref) if existing_video else None
                if local is None:
                    local = await self.download_video(ref, directory)
                elif local.stat().st_size > self.max_video_bytes:
                    raise ComfyError("视频超过回传大小限制，原片已保存。")
                paths.append(local)
                continue
            paths.append(await self.download_image(ref, directory))
        return paths, len(refs)

    async def download_video(self, ref, directory):
        suffix = Path(ref["filename"]).suffix.lower()
        path = directory / ("comfy_" + uuid.uuid4().hex + suffix)
        partial = path.with_suffix(".part")
        try:
            await self.request(
                "GET", "/view", params={
                    "filename": ref["filename"], "subfolder": ref.get("subfolder", ""),
                    "type": ref.get("type", "output"),
                },
                output_path=partial, max_bytes=self.max_video_bytes,
            )
            header = await asyncio.to_thread(_read_header, partial)
            if video_suffix(header, suffix) != suffix:
                raise ComfyError("视频接口返回的内容与视频文件格式不符。")
            partial.replace(path)
        finally:
            partial.unlink(missing_ok=True)
        return path

    async def download_image(self, ref, directory):
        data = await self.request(
            "GET", "/view",
            params={"filename": ref["filename"], "subfolder": ref.get("subfolder", ""), "type": ref.get("type", "output")},
            binary=True,
        )
        path = directory / ("comfy_" + uuid.uuid4().hex + image_suffix(data))
        await asyncio.to_thread(path.write_bytes, data)
        return path

    async def download_images(self, record, output_nodes, directory: Path, max_images=4):
        return await self.download_outputs(record, output_nodes, directory, max_images)


def output_refs(record, output_nodes, *, video=False, include_node=False):
    refs, seen = [], set()
    outputs = record.get("outputs", {})
    for key in output_nodes:
        node_output = outputs.get(key, {})
        candidates = [
            ref
            for category in ("images", "videos", "gifs")
            for ref in node_output.get(category, [])
        ]
        for ref in candidates:
            if not isinstance(ref, dict) or not isinstance(ref.get("filename"), str):
                continue
            suffix = Path(ref["filename"]).suffix.lower()
            if video and suffix not in VIDEO_MIME:
                continue
            identity = (
                ref["filename"],
                ref.get("subfolder", ""),
                ref.get("type", "output"),
            )
            if identity not in seen:
                seen.add(identity)
                refs.append({**ref, "output_node": key} if include_node else ref)
    return refs


def _read_header(path):
    with path.open("rb") as handle:
        return handle.read(64)


def video_suffix(header, hint=""):
    if header[4:8] == b"ftyp":
        return ".mov" if hint == ".mov" else ".mp4"
    if header.startswith(b"\x1aE\xdf\xa3"):
        return ".mkv" if hint == ".mkv" else ".webm"
    if header[:6] in {b"GIF87a", b"GIF89a"}:
        return ".gif"
    return None


def image_suffix(data):
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data[:6] in {b"GIF87a", b"GIF89a"}:
        return ".gif"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return ".webp"
    raise ComfyError("图片必须是 PNG/JPEG/WebP/GIF 格式。")
