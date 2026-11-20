import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import aiohttp
from astrbot.api.web import PluginRequest, bind_request_context
from starlette.requests import Request

from bridge.studio.model_downloads import (
    ModelDownloads,
    PublicResolver,
    allowed_url,
    destination,
    local_status,
)


class ModelDownloadTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.studio = SimpleNamespace(service=None, anima=SimpleNamespace(workspace=self.root))
        self.manager = ModelDownloads(self.studio)
        self.addAsyncCleanup(self.manager.close)

    def test_recursive_alias_and_extra_model_paths_prevent_duplicate(self):
        folder = self.root / "models/unet/deep/characters"
        folder.mkdir(parents=True)
        (folder / "MODEL.safetensors").write_bytes(b"existing")
        row = {"name": "model.safetensors", "folder": "models/diffusion_models/"}
        status = local_status(self.root, row, {})
        self.assertTrue(status["installed"])
        self.assertIn("deep", status["locations"][0])
        extra = self.root / "external/pack"
        extra.mkdir(parents=True)
        (extra / "another.safetensors").write_bytes(b"existing")
        (self.root / "extra_model_paths.yaml").write_text("shared:\n  base_path: external\n  diffusion_models: pack\n", encoding="utf-8")
        self.assertTrue(local_status(self.root, {**row, "name": "another.safetensors"}, {})["installed"])

    def test_destination_and_download_origin_are_not_user_paths(self):
        for folder in ("../private/", "models/../../private/", "models/C:/", "custom_nodes/anything/"):
            with self.assertRaises(ValueError):
                destination(self.root, folder, "model.safetensors")
        for url in ("http://huggingface.co/a", "https://huggingface.co.evil.test/a", "https://127.0.0.1/a", "https://user:pass@github.com/a"):
            with self.assertRaises(ValueError):
                allowed_url(url)

    async def test_download_dns_rejects_private_addresses(self):
        resolver = PublicResolver()
        try:
            with patch("aiohttp.resolver.DefaultResolver.resolve", new=AsyncMock(return_value=[{"host": "10.0.0.1"}])):
                with self.assertRaises(ValueError):
                    await resolver.resolve("huggingface.co")
        finally:
            await resolver.close()

    async def call(self, data=None, username="admin", method="POST"):
        async def receive():
            return {"type": "http.request", "body": json.dumps(data).encode()}
        incoming = Request({"type": "http", "method": method, "path": "/studio/model-downloads", "headers": [], "query_string": b""}, receive)
        with bind_request_context(PluginRequest(incoming, username=username)):
            return await self.manager.api()

    async def test_confirmation_duplicate_and_ownership_guards(self):
        (self.root / "folder_paths.py").touch()
        (self.root / "models").mkdir()
        row = {"name": "model.safetensors", "folder": "models/diffusion_models/", "installed": False, "local_checked": True,
               "download_url": "https://huggingface.co/author/repo/resolve/main/model.safetensors"}
        data = {"workflow": "test", "name": row["name"], "folder": row["folder"], "confirmed": True}
        catalog = {"workflows": [{"name": "test", "models": [row]}]}
        self.assertEqual((await self.call(data, username=None)).status_code, 401)
        self.assertEqual((await self.call({**data, "confirmed": False})).status_code, 400)
        self.assertFalse(self.manager.jobs)
        with patch("bridge.studio.model_catalog.catalog_data", new=AsyncMock(return_value=catalog)), patch.object(self.manager, "run", new=AsyncMock()) as run:
            row["installed"] = True
            self.assertEqual((await self.call(data)).status_code, 400)
            row["installed"] = False
            response = await self.call(data)
            self.assertEqual(response.status_code, 200, response.body)
            await asyncio.sleep(0)
            run.assert_awaited_once()
            job = json.loads(response.body)
            self.assertEqual((await self.call({"action": "cancel", "id": job["id"]}, username="other")).status_code, 400)
            self.assertEqual(json.loads((await self.call(username="other", method="GET")).body)["jobs"], [])

    async def exercise_transfer(self, mode):
        started = asyncio.Event()
        class Response:
            status = 200
            content_length = 8
            headers = {"Content-Type": "application/octet-stream"}
            def raise_for_status(self):
                if mode == "http_error":
                    raise aiohttp.ClientResponseError(None, (), status=403)
            async def __aenter__(self):
                return self
            async def __aexit__(self, *args):
                pass
            @property
            def content(self):
                return self
            async def iter_chunked(self, size):
                yield b"abcd"
                started.set()
                if mode == "cancel":
                    await asyncio.Event().wait()
                if mode != "truncated":
                    yield b"efgh"
        class Session(Response):
            def get(self, *args, **kwargs):
                return Response()
        target = self.root / "models/diffusion_models/model.safetensors"
        job = {"id": "a" * 32, "received": 0}
        with patch("bridge.studio.model_downloads.aiohttp.ClientSession", return_value=Session()):
            task = asyncio.create_task(self.manager.run(job, target, "https://huggingface.co/test/file"))
            if mode == "cancel":
                await started.wait()
                self.assertEqual(job["received"], 4)
                task.cancel()
            await task
        self.assertFalse(list(target.parent.glob("*.part")))
        return job, target

    async def test_download_progress_completion_and_no_overwrite(self):
        job, target = await self.exercise_transfer("complete")
        self.assertEqual(job["state"], "completed")
        self.assertEqual(job["received"], job["total"])
        self.assertEqual(target.read_bytes(), b"abcdefgh")
        job, _ = await self.exercise_transfer("complete")
        self.assertEqual(job["state"], "failed")
        self.assertEqual(target.read_bytes(), b"abcdefgh")

    async def test_cancel_and_truncation_never_publish_partial_model(self):
        for mode, state in (("cancel", "cancelled"), ("truncated", "failed"), ("http_error", "failed")):
            job, target = await self.exercise_transfer(mode)
            self.assertEqual(job["state"], state)
            self.assertFalse(target.exists())
