import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from astrbot.api.web import PluginRequest, bind_request_context
from starlette.requests import Request

from bridge.studio.studio_settings import StudioSettings


class SimpleReverseTests(unittest.IsolatedAsyncioTestCase):
    async def test_reverse_uses_selected_workflow_and_returns_saved_caption(self):
        workflow = SimpleNamespace(name="my-reverse", kind="image_to_text", image_inputs=[SimpleNamespace(node="1")],
                                   outputs=["2"], prepare_caption=lambda: {"1": {}, "2": {}})
        studio = StudioSettings.__new__(StudioSettings)
        studio.service = SimpleNamespace(config={}, client=SimpleNamespace(max_image_bytes=1000000),
                                         initialize=AsyncMock(), workflows={workflow.name: workflow},
                                         run_caption=AsyncMock(return_value="a landscape"))
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
        self.assertEqual(json.loads(response.body)["caption"], "a landscape")
        studio.service.run_caption.assert_awaited_once_with({"1": {}, "2": {}}, b"image", "1", "2", source=workflow.name)
