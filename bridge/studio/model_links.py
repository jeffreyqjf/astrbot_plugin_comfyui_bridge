"""User-maintained, ordered browser links; never executable download destinations."""

import asyncio
import hashlib
import json
import os
from urllib.parse import urlsplit

from astrbot.api.web import error_response, json_response, request

from ..workflows.workflow_store import atomic_write, profile_bytes


def validate_links(links):
    if not isinstance(links, list) or len(links) > 10:
        raise ValueError("每个模型最多保存 10 个链接。")
    result = []
    for value in links:
        if not isinstance(value, str) or len(value) > 4096 or any(ord(char) < 32 for char in value) or "\\" in value:
            raise ValueError("链接格式无效。")
        value = value.strip()
        parsed = urlsplit(value)
        if parsed.scheme not in {"https", "http"} or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("请填写不含账号密码的 http 或 https 网页链接。")
        _ = parsed.port
        if value not in result:
            result.append(value)
    return result


def model_key(name, folder):
    if not all(isinstance(value, str) and 0 < len(value) <= 1024 for value in (name, folder)):
        raise ValueError("模型名称或目录无效。")
    return hashlib.sha256(json.dumps([name, folder], ensure_ascii=False).encode()).hexdigest()


class ModelLinks:
    def __init__(self, service, anima):
        self.service = service
        self.anima = anima
        self.path = service.data_dir / "model_links.json"

    def read(self):
        if self.path.resolve() != self.path.absolute():
            raise ValueError("模型链接配置不能使用链接文件。")
        try:
            raw = self.path.read_bytes()
        except FileNotFoundError:
            raw = b"{}"
        if len(raw) > 8 * 1024**2:
            raise ValueError("模型链接配置过大。")
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("模型链接配置无效。")
        if any(not isinstance(entries, dict) or any(not isinstance(row, dict) for row in entries.values()) for entries in data.values()):
            raise ValueError("模型链接记录格式无效。")
        return data, hashlib.sha256(raw).hexdigest()

    def apply(self, workflows):
        saved, revision = self.read()
        for workflow in workflows:
            for row in workflow["models"]:
                entry = saved.get(workflow["name"], {}).get(model_key(row["name"], row["folder"]))
                row["links"] = validate_links(entry["links"]) if entry else ([row["url"]] if row["url"] else [])
                row["custom_links"] = entry is not None
                if entry is not None:
                    row["source"] = "自定义链接"
                row["url"] = next(iter(row["links"]), None)
        return revision

    async def api(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            from .model_catalog import catalog_data
            if request.method == "GET":
                name = request.query.get("workflow")
                catalog = await catalog_data(self.service, self.anima)
                workflow = next((wf for wf in catalog["workflows"] if wf["name"] == name), None)
                if workflow is None:
                    raise ValueError("请选择工作流。")
                return json_response({"format": "comfy-model-links", "version": 1, "workflow": name,
                                      "models": [{key: row[key] for key in ("name", "folder", "links")} for row in workflow["models"]],
                                      "revision": catalog["links_revision"]})
            body = await request.body()
            if len(body) > 2 * 1024**2:
                raise ValueError("模型链接导入数据超过 2 MiB。")
            payload = json.loads(body)
            name = payload.get("workflow")
            if name not in self.service.workflows:
                raise ValueError("工作流不存在，请先导入该工作流。")
            if payload.get("action") == "import":
                document = payload.get("document", {})
                if document.get("format") != "comfy-model-links" or document.get("version") != 1 or document.get("workflow") != name:
                    raise ValueError("请选择对应工作流导出的模型链接配置。")
                entries = document.get("models")
            elif payload.get("action") == "save":
                entries = [payload]
            else:
                raise ValueError("请选择模型链接操作。")
            if not isinstance(entries, list) or len(entries) > 2000:
                raise ValueError("模型链接清单无效或超过 2000 项。")
            updates = {}
            for row in entries:
                key = model_key(row["name"], row["folder"])
                updates[key] = {"name": row["name"], "folder": row["folder"], "links": validate_links(row["links"])}
            async with self.service.state_lock:
                saved, revision = await asyncio.to_thread(self.read)
                if payload.get("revision") != revision:
                    return error_response("模型链接已变化，请刷新后重试。", status_code=409)
                saved.setdefault(name, {}).update(updates)
                raw = profile_bytes(saved)
                if len(raw) > 8 * 1024**2:
                    raise ValueError("模型链接配置超过容量上限。")
                await asyncio.to_thread(atomic_write, self.path, raw)
            return json_response({"workflow": name, "imported": len(updates), "revision": hashlib.sha256(raw).hexdigest()})
        except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
            return error_response(str(exc), status_code=400)

    async def open_page(self):
        # Embedded AstrBot pages cannot open popups. This local-only route opens the host browser.
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            body = await request.body()
            if len(body) > 8192:
                raise ValueError("链接请求过大。")
            url = validate_links([json.loads(body).get("url")])[0]
            if os.name != "nt":
                raise ValueError("当前插件电脑不支持此打开方式，请复制链接到浏览器。")
            await asyncio.to_thread(os.startfile, url)
            return json_response({"opened": True})
        except (OSError, ValueError, TypeError, AttributeError) as exc:
            return error_response(str(exc), status_code=400)
