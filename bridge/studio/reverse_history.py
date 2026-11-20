"""Persistent reverse prompts and their source images; retained until deleted."""

import asyncio
import base64
import io
import json
import re
import time
import uuid
from pathlib import Path
from threading import Lock

from astrbot.api.web import error_response, json_response, request
from PIL import Image, ImageOps

from ..client import image_suffix
from ..workflows.workflow import WorkflowError
from ..workflows.workflow_store import atomic_write


class ReverseHistory:
    def __init__(self, data_dir):
        self.root = Path(data_dir).resolve() / "reverse_history"
        self.lock = Lock()

    def _path(self, identity, suffix):
        if not isinstance(identity, str) or not re.fullmatch(r"[0-9a-f]{32}", identity):
            raise WorkflowError("反推记录 ID 无效。")
        path = self.root / (identity + suffix)
        if path.resolve() != path:
            raise WorkflowError("反推记录不支持链接文件。")
        return path

    def save(self, prompt, image, source):
        suffix = image_suffix(image)
        thumbnail = io.BytesIO()
        with Image.open(io.BytesIO(image)) as opened:
            preview = ImageOps.exif_transpose(opened)
            preview.thumbnail((480, 480))
            preview.convert("RGB").save(thumbnail, format="JPEG", quality=85)
        identity = uuid.uuid4().hex
        record = {"id": identity, "prompt": prompt, "source": source, "created_at": time.time(), "suffix": suffix}
        with self.lock:
            original = self._path(identity, suffix)
            thumb = self._path(identity, ".thumb.jpg")
            metadata = self._path(identity, ".json")
            self.root.mkdir(parents=True, exist_ok=True)
            try:
                atomic_write(original, image)
                atomic_write(thumb, thumbnail.getvalue())
                atomic_write(metadata, json.dumps(record, ensure_ascii=False).encode("utf-8"))
            except OSError:
                original.unlink(missing_ok=True)
                thumb.unlink(missing_ok=True)
                raise
        return identity

    def list(self, page=1):
        with self.lock:
            if self.root.resolve() != self.root:
                raise WorkflowError("反推记录目录无效。")
            paths = sorted((path for path in self.root.glob("*.json")
                            if re.fullmatch(r"[0-9a-f]{32}", path.stem) and not path.is_symlink()),
                           key=lambda path: (path.stat().st_mtime_ns, path.stem), reverse=True)
            total = len(paths)
            page = min(max(1, page), max(1, (total + 11) // 12))
            records = []
            for path in paths[(page - 1) * 12:page * 12]:
                row = json.loads(path.read_bytes())
                records.append({key: row[key] for key in ("id", "prompt", "source", "created_at")})
            return {"records": records, "total": total, "page": page, "page_size": 12}

    def image(self, identity, original=False):
        with self.lock:
            metadata = self._path(identity, ".json")
            row = json.loads(metadata.read_bytes())
            suffix = row["suffix"] if original else ".thumb.jpg"
            types = {".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".thumb.jpg": "image/jpeg"}
            if suffix not in types:
                raise WorkflowError("反推记录图片格式无效。")
            return types[suffix], self._path(identity, suffix).read_bytes()

    def delete(self, identity):
        with self.lock:
            paths = [self._path(identity, suffix) for suffix in (".png", ".jpg", ".webp", ".gif", ".thumb.jpg", ".json")]
            if not paths[-1].is_file():
                raise WorkflowError("反推记录已删除，请刷新列表。")
            for path in paths:
                path.unlink(missing_ok=True)

    async def records_api(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            return json_response(await asyncio.to_thread(self.list, int(request.query.get("page", "1"))))
        except (OSError, ValueError, KeyError) as exc:
            return error_response(str(exc), status_code=400)

    async def image_api(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            mime, data = await asyncio.to_thread(self.image, request.query.get("id"), request.query.get("original") == "1")
            return json_response({"src": f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"})
        except (OSError, ValueError, KeyError) as exc:
            return error_response(str(exc), status_code=400)

    async def delete_api(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            body = await request.body()
            if len(body) > 4096:
                raise WorkflowError("反推记录请求过大。")
            data = json.loads(body)
            if not isinstance(data, dict):
                raise WorkflowError("反推记录请求格式无效。")
            await asyncio.to_thread(self.delete, data.get("id"))
            return json_response({})
        except (OSError, ValueError, KeyError) as exc:
            return error_response(str(exc), status_code=400)
