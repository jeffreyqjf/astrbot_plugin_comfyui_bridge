import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from astrbot.api.web import PluginRequest, bind_request_context
from starlette.requests import Request

from bridge.studio.studio_settings import StudioSettings


class GalleryFilterLabelsTests(unittest.IsolatedAsyncioTestCase):
    async def test_same_name_presets_hide_accounts_without_merging_filter_ids(self):
        studio = StudioSettings.__new__(StudioSettings)
        presets = {"id:qq-long-account-111:abcdef001": "人物预设", "id:qq-long-account-222:fedcba002": "人物预设", "legacy": "普通预设"}
        studio.service = SimpleNamespace(initialize=AsyncMock(), image_reviews=SimpleNamespace(
            filter_options=lambda state, rating, **kwargs: {"preset": dict(presets), "workflow": {}, "lora": {}},
        ))
        studio._gallery_preset_labels = AsyncMock(return_value=(dict(presets), set(presets)))
        for state in ("favourite", "pass", "hd", "unevaluate"):
            incoming = Request({"type":"http", "method":"GET", "path":"/images", "headers":[],
                                "query_string":f"state={state}&facets=1".encode()})
            with bind_request_context(PluginRequest(incoming, username="test")):
                response = await studio.images()
            self.assertEqual(response.status_code, 200, response.body)
            rows = json.loads(response.body)["facets"]["preset"]
            labels = {row["id"]: row["label"] for row in rows}
            self.assertTrue(set(presets) <= set(labels))
            self.assertEqual(labels["legacy"], "普通预设")
            self.assertEqual(labels["id:qq-long-account-111:abcdef001"], "人物预设 · abcdef")
            self.assertFalse(any("qq-long-account" in label for label in labels.values()))
