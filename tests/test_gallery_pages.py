import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from astrbot.api.web import PluginRequest, bind_request_context
from starlette.requests import Request

from bridge.studio.studio_settings import StudioSettings


class GalleryPageTests(unittest.IsolatedAsyncioTestCase):
    async def test_persistent_pages_account_isolation_validation_and_authentication(self):
        with tempfile.TemporaryDirectory() as folder:
            studio = StudioSettings.__new__(StudioSettings)
            studio.service = SimpleNamespace(data_dir=Path(folder), state_lock=asyncio.Lock())
            async def call(data=None, owner="admin", method="GET"):
                async def receive():
                    return {"type":"http.request", "body":json.dumps(data).encode()}
                incoming = Request({"type":"http", "method":method, "path":"/pages", "headers":[], "query_string":b""}, receive)
                with bind_request_context(PluginRequest(incoming, username=owner)):
                    return await studio.gallery_pages()
            key = 'comfy-gallery-page:["images",[["state","favourite"]]]'
            self.assertEqual((await call(owner=None)).status_code, 401)
            self.assertEqual((await call({"key":key,"page":3}, method="POST")).status_code, 200)
            self.assertEqual(json.loads((await call()).body)["pages"][key], 3)
            selection = {"key": "comfy-gallery-selection:reference", "selection": "controls/pass"}
            self.assertEqual((await call(selection, method="POST")).status_code, 200)
            other = {"key": "comfy-gallery-selection:lora-preview", "selection": "images/hd"}
            self.assertEqual((await call(other, method="POST")).status_code, 200)
            self.assertEqual((await call({**other, "selection": "controls/pass"}, method="POST")).status_code, 400)
            self.assertEqual((await call({**selection, "key": "comfy-gallery-selection:unknown"}, method="POST")).status_code, 400)
            self.assertEqual(json.loads((await call(owner="other")).body)["pages"], {})
            self.assertEqual(json.loads((await call(owner="other")).body)["selections"], {})
            self.assertEqual(len(list((Path(folder) / "gallery_pages").glob("*.json"))), 1)
            for data in ({"key":"../escape", "page":2}, {"key":key, "page":0}, {"key":key,"page":True}, {"key":key,"page":1.5}):
                self.assertEqual((await call(data, method="POST")).status_code, 400)
            studio.service = SimpleNamespace(data_dir=Path(folder), state_lock=asyncio.Lock())
            saved = json.loads((await call()).body)
            self.assertEqual(saved["pages"], {key: 3})
            self.assertEqual(saved["selections"], {item["key"]: item["selection"] for item in (selection, other)})
