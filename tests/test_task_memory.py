import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from astrbot.api.web import PluginRequest, bind_request_context
from starlette.requests import Request

from bridge.studio.studio_settings import StudioSettings


class TaskMemoryTests(unittest.IsolatedAsyncioTestCase):
    async def test_account_isolation_persistence_validation_and_merge(self):
        with tempfile.TemporaryDirectory() as folder:
            studio = StudioSettings.__new__(StudioSettings)
            studio.service = SimpleNamespace(data_dir=Path(folder), state_lock=asyncio.Lock())
            async def call(value=None, owner="user"):
                async def receive():
                    return {"type": "http.request", "body": json.dumps(value).encode()}
                incoming = Request({"type": "http", "method": "POST" if value is not None else "GET", "path": "/memory", "headers": [], "query_string": b""}, receive)
                with bind_request_context(PluginRequest(incoming, username=owner)):
                    return await studio.task_memory()
            self.assertEqual((await call(owner=None)).status_code, 401)
            data = {"key": "workflow:test", "value": {"config": "portrait", "lora:style": 0.8, "feature:hires": True, "field:queue-positive": "landscape"}}
            self.assertEqual((await call(data)).status_code, 200)
            self.assertEqual((await call({"key": "global", "value": {"workflow": "test", "mode": "simple"}})).status_code, 200)
            saved = json.loads((await call()).body)["memory"]
            self.assertEqual(saved[data["key"]], data["value"])
            self.assertIn("global", saved)
            self.assertEqual(json.loads((await call(owner="other")).body)["memory"], {})
            studio.service.state_lock = asyncio.Lock()
            self.assertEqual(json.loads((await call()).body)["memory"], saved)
            for invalid in ({"key": "../escape", "value": {}}, {"key": "global", "value": {"image": "encoded"}},
                            {"key": "global", "value": {"workflow": []}}, {"key": "global", "value": {"field:text": "x" * 8001}}):
                self.assertEqual((await call(invalid)).status_code, 400)
