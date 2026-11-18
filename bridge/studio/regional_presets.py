"""Shared three-region prompt presets; masks remain task drafts."""

import asyncio
import json
import re

from ..workflows.regional import regional_text
from ..workflows.workflow import WorkflowError
from ..workflows.workflow_store import (
    atomic_write,
    profile_bytes,
    read_profile,
    workflow_path,
    workflow_revision,
)


class RegionalPresets:
    def __init__(self, service):
        self.service = service

    def read(self):
        path = workflow_path(self.service.data_dir, "regional_prompt_presets")
        raw = read_profile(path) if path.exists() else b""
        data = json.loads(raw) if raw else {"version": 1, "presets": {}}
        if not isinstance(data, dict) or data.get("version") != 1 or not isinstance(data.get("presets"), dict):
            raise WorkflowError("区域提示词预设文件格式无效。")
        if len(raw) > 2 * 1024 * 1024 or len(data["presets"]) > 64:
            raise WorkflowError("区域预设超过 64 套或 2 MB。")
        for name, value in data["presets"].items():
            if not re.fullmatch(r"[^\x00-\x1f]{1,64}", name) or name != name.strip():
                raise WorkflowError("区域预设文件包含无效名称。")
            regional_text(value)
        return path, data, workflow_revision(raw)

    async def get(self):
        return await self.handle(False)

    async def save(self):
        return await self.handle(True)

    async def handle(self, write):
        from astrbot.api.web import error_response, json_response, request

        if not request.username:
            return error_response("请登录工作台。", status_code=401)
        try:
            async with self.service.state_lock:
                path, data, revision = await asyncio.to_thread(self.read)
                if write:
                    raw = await request.body()
                    if len(raw) > 128 * 1024:
                        raise WorkflowError("预设数据过大。")
                    payload = json.loads(raw)
                    if not isinstance(payload, dict) or payload.keys() != {"name", "preset", "revision"}:
                        raise WorkflowError("预设参数无效。")
                    name = payload["name"]
                    if not isinstance(name, str) or not re.fullmatch(r"[^\x00-\x1f]{1,64}", name.strip()):
                        raise WorkflowError("预设名称须为 1 到 64 个字符。")
                    if payload["revision"] != revision:
                        return error_response("预设已有更新，请刷新后重试。", status_code=409)
                    name = name.strip()
                    if payload["preset"] is None:
                        data["presets"].pop(name, None)
                    else:
                        data["presets"][name] = regional_text(payload["preset"])
                    if len(data["presets"]) > 64:
                        raise WorkflowError("最多保存 64 套区域提示词预设。")
                    saved = profile_bytes(data)
                    if len(saved) > 2 * 1024 * 1024:
                        raise WorkflowError("预设总大小不能超过 2 MB。")
                    path.parent.mkdir(parents=True, exist_ok=True)
                    await asyncio.to_thread(atomic_write, path, saved)
                    revision = workflow_revision(saved)
            return json_response({**data, "revision": revision})
        except (OSError, ValueError, TypeError) as exc:
            return error_response(str(exc), status_code=400)
