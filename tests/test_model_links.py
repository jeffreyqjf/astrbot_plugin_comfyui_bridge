import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from astrbot.api.web import PluginRequest, bind_request_context
from starlette.requests import Request

from bridge.studio.model_links import ModelLinks, validate_links


class ModelLinksTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.service = SimpleNamespace(data_dir=self.root, state_lock=asyncio.Lock(), workflows={"first": {}, "second": {}})
        self.links = ModelLinks(self.service, None)
        self.row = {"name": "model.safetensors", "folder": "models/loras/", "url": "https://example.com/original", "download_url": "https://huggingface.co/exact/file"}

    async def call(self, data=None, method="POST", user="admin", query=b"", opener=False):
        async def receive():
            return {"type": "http.request", "body": json.dumps(data).encode()}
        incoming = Request({"type": "http", "method": method, "path": "/model-links", "query_string": query, "headers": []}, receive)
        with bind_request_context(PluginRequest(incoming, username=user)):
            return await (self.links.open_page() if opener else self.links.api())

    async def catalog(self, *args):
        workflows = [{"name": name, "models": [dict(self.row)]} for name in self.service.workflows]
        revision = self.links.apply(workflows)
        return {"workflows": workflows, "links_revision": revision}

    def test_link_validation_rejects_executable_schemes_and_credentials(self):
        for url in ("javascript:alert(1)", "file:///C:/app.exe", "data:text/html,abc", "https://user:pass@example.com/", "https://example.com/\nignored"):
            with self.assertRaises(ValueError):
                validate_links([url])
        self.assertEqual(validate_links(["https://example.com/a", "https://example.com/b", "https://example.com/a"]),
                         ["https://example.com/a", "https://example.com/b"])

    async def test_save_reorder_reload_and_workflow_isolation(self):
        _, revision = self.links.read()
        values = ["https://example.com/new", "https://example.com/backup", "http://example.com/third"]
        response = await self.call({**self.row, "workflow": "first", "action": "save", "revision": revision, "links": values})
        self.assertEqual(response.status_code, 200, response.body)
        reloaded = ModelLinks(self.service, None)
        workflows = [{"name": "first", "models": [dict(self.row)]}, {"name": "second", "models": [dict(self.row)]}]
        reloaded.apply(workflows)
        self.assertEqual(workflows[0]["models"][0]["links"], values)
        self.assertEqual(workflows[0]["models"][0]["url"], values[0])
        self.assertEqual(workflows[1]["models"][0]["url"], self.row["url"])
        self.assertEqual(workflows[0]["models"][0]["download_url"], self.row["download_url"])
        stale = await self.call({**self.row, "workflow": "first", "action": "save", "revision": revision, "links": []})
        self.assertEqual(stale.status_code, 409)
        response = await self.call({**self.row, "workflow": "first", "action": "save", "revision": self.links.read()[1], "links": []})
        self.assertEqual(response.status_code, 200)
        reloaded.apply(workflows)
        self.assertEqual(workflows[0]["models"][0]["links"], [])
        self.assertIsNone(workflows[0]["models"][0]["url"])

    async def test_import_export_round_trip_and_mismatched_workflow(self):
        with patch("bridge.studio.model_catalog.catalog_data", new=AsyncMock(side_effect=self.catalog)):
            response = await self.call(method="GET", query=b"workflow=first")
        document = json.loads(response.body)
        self.assertEqual(document["models"][0]["links"], [self.row["url"]])
        document["models"][0]["links"].append("https://example.com/backup")
        bad = await self.call({"action": "import", "workflow": "second", "document": document, "revision": document["revision"]})
        self.assertEqual(bad.status_code, 400)
        response = await self.call({"action": "import", "workflow": "first", "document": document, "revision": document["revision"]})
        self.assertEqual(response.status_code, 200, response.body)
        with patch("bridge.studio.model_catalog.catalog_data", new=AsyncMock(side_effect=self.catalog)):
            response = await self.call(method="GET", query=b"workflow=first")
        self.assertEqual(json.loads(response.body)["models"], document["models"])

    async def test_embedded_open_uses_default_browser_and_requires_login(self):
        with patch("bridge.studio.model_links.os.startfile") as open_file:
            response = await self.call({"url": "https://example.com/first"}, opener=True)
            self.assertEqual(response.status_code, 200, response.body)
            open_file.assert_called_once_with("https://example.com/first")
            self.assertEqual((await self.call({"url": "file:///C:/app.exe"}, opener=True)).status_code, 400)
            self.assertEqual((await self.call({"url": "https://example.com"}, user=None, opener=True)).status_code, 401)
            self.assertEqual((await self.call(user=None)).status_code, 401)
            self.assertEqual(open_file.call_count, 1)

    async def test_description_persists_exports_and_legacy_import_preserves_it(self):
        text = "模型用途与注意事项\n<img src=x onerror=alert(1)>"
        payload = {**self.row, "workflow": "first", "action": "save", "links": [self.row["url"]],
                   "note": text, "revision": self.links.read()[1]}
        self.assertEqual((await self.call(payload)).status_code, 200)
        with patch("bridge.studio.model_catalog.catalog_data", new=AsyncMock(side_effect=self.catalog)):
            exported = json.loads((await self.call(method="GET", query=b"workflow=first")).body)
        self.assertEqual(exported["models"][0]["note"], text)
        old = {**exported, "models": [{key: value for key, value in row.items() if key != "note"} for row in exported["models"]]}
        self.assertEqual((await self.call({"workflow":"first", "action":"import", "document":old, "revision":exported["revision"]})).status_code, 200)
        result = await self.catalog()
        self.assertEqual(result["workflows"][0]["models"][0]["note"], text)
        self.assertNotIn("note", result["workflows"][1]["models"][0])
        for invalid in (None, 42, "x" * 4001):
            self.assertEqual((await self.call({**payload, "note": invalid, "revision":self.links.read()[1]})).status_code, 400)
        self.assertEqual((await self.call({**payload, "note":"", "revision":self.links.read()[1]})).status_code, 200)
        self.assertEqual((await self.catalog())["workflows"][0]["models"][0]["note"], "")
