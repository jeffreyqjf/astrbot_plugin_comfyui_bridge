import asyncio
import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from astrbot.api.web import PluginRequest, bind_request_context
from starlette.requests import Request

from bridge.service import ComfyService, Job
from bridge.studio.studio_settings import StudioSettings


class SimpleReverseTests(unittest.IsolatedAsyncioTestCase):
    async def test_reverse_uses_selected_workflow_and_returns_saved_caption(self):
        workflow = SimpleNamespace(name="my-reverse", kind="image_to_text", image_inputs=[SimpleNamespace(node="1")],
                                   outputs=["2"], prepare_caption=lambda: {"1": {}, "2": {}})
        studio = StudioSettings.__new__(StudioSettings)
        studio.service = SimpleNamespace(config={}, client=SimpleNamespace(max_image_bytes=1000000),
                                         initialize=AsyncMock(), workflows={workflow.name: workflow},
                                         start_caption_job=Mock(return_value=Job("a" * 32, "studio:tester", "my-reverse", None)))
        studio.task_inputs = lambda wf: {"simple": True, "reference": True}
        studio.read_queue_reference = lambda data: b"image" if data.get("image") else None
        studio._node_schemas = AsyncMock(return_value={})

        async def call(payload, username="tester"):
            async def receive():
                return {"type": "http.request", "body": json.dumps(payload).encode()}
            request = Request({"type": "http", "method": "POST", "path": "/queue", "headers": [], "query_string": b""}, receive)
            with bind_request_context(PluginRequest(request, username=username)):
                return await studio.add_jobs()

        with patch("bridge.studio.studio_settings.validate_graph"):
            data = {"workflow": workflow.name, "image": "encoded", "count": 1}
            self.assertEqual((await call(data, None)).status_code, 401)
            self.assertEqual((await call({"workflow": workflow.name})).status_code, 400)
            self.assertEqual((await call({**data, "count": 2})).status_code, 400)
            response = await call(data)
        self.assertEqual(response.status_code, 200, response.body)
        self.assertTrue(json.loads(response.body)["queued"])
        self.assertNotIn("caption", json.loads(response.body))
        studio._node_schemas.assert_not_awaited()
        studio.service.start_caption_job.assert_called_once()

    async def test_caption_job_returns_before_validation_then_completes_or_cancels(self):
        service = ComfyService.__new__(ComfyService)
        service.jobs = {}
        service.check_queue_capacity = Mock()
        service.generation_timeout = lambda: 120
        service.run_caption = AsyncMock(return_value="landscape")
        workflow = SimpleNamespace(name="reverse", outputs=["2"], image_inputs=[SimpleNamespace(node="1")],
                                   prepare_caption=lambda: {"1": {"class_type": "LoadImage", "inputs": {}}, "2": {"class_type": "Caption", "inputs": {}}})
        gate = asyncio.Event()
        async def validate(graph):
            await gate.wait()
        job = service.start_caption_job("owner", workflow, b"image", validate)
        self.assertEqual(job.state, "queued")
        await asyncio.sleep(0)
        service.run_caption.assert_not_awaited()
        gate.set()
        await job.task
        self.assertEqual((job.state, job.caption), ("completed", "landscape"))
        gate.clear()
        second = service.start_caption_job("owner", workflow, b"image", validate)
        await asyncio.sleep(0)
        second.task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await second.task
        self.assertEqual(second.state, "cancelled")
        self.assertTrue(second.submission_done.is_set())
        async def fail(graph):
            raise ValueError("missing model")
        failed = service.start_caption_job("owner", workflow, b"image", fail)
        await failed.task
        self.assertEqual((failed.state, failed.caption), ("failed", ""))
        self.assertIn("missing model", failed.error)
