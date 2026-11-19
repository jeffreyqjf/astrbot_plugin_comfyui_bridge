import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from bridge.service import ComfyService
from bridge.studio.job_details import describe_configuration
from bridge.workflows.workflow import SDXL_WORKFLOW


class TaskConfigurationTests(unittest.TestCase):
    def test_actual_lora_strengths_prompt_seed_and_private_values(self):
        graph = {
            "base": {"class_type": "UNETLoader", "inputs": {"unet_name": "model.safetensors"}},
            "first": {"class_type": "LoraLoader", "inputs": {"model": ["base", 0], "lora_name": "anima/first.safetensors", "strength_model": 0.65, "strength_clip": -0.15}},
            "second": {"class_type": "LoraLoaderModelOnly", "inputs": {"model": ["first", 0], "lora_name": "anima/second.safetensors", "strength_model": -0.7}},
            "positive": {"class_type": "PrimitiveString", "inputs": {"value": "<script>example</script>"}},
            "negative": {"class_type": "PrimitiveString", "inputs": {"value": "blurry"}},
            "sampler": {"class_type": "KSampler", "inputs": {"model": ["second", 0], "seed": 2**60 + 37, "steps": 25}},
            "output": {"class_type": "SaveImage", "inputs": {"images": ["sampler", 0]}},
            "private": {"class_type": "Test", "inputs": {"api_key": "key-private", "nested": {"authorization": "bearer-private", "strength": 0},
                       "json": json.dumps({"refresh_token": "refresh-private", "value": 0.5})}},
        }
        original = deepcopy(graph)
        snapshot = {"graph": graph, "outputs": ["output"], "positive": [("positive", "value")], "negative": [("negative", "value")]}
        detail = describe_configuration(snapshot)
        self.assertEqual(detail["positive"][0]["text"], "<script>example</script>")
        self.assertEqual(detail["loras"]["output"], [
            {"name": "anima/first.safetensors", "model": 0.65, "clip": -0.15},
            {"name": "anima/second.safetensors", "model": -0.7, "clip": 0},
        ])
        node = next(row for row in detail["nodes"] if row["id"] == "sampler")
        self.assertEqual(node["parameters"]["seed"], str(2**60 + 37))
        encoded = json.dumps(detail)
        for secret in ("key-private", "bearer-private", "refresh-private"):
            self.assertNotIn(secret, encoded)
        self.assertEqual(graph, original)
        self.assertIsNone(describe_configuration(None))


class AcceptedTaskSnapshotTests(unittest.IsolatedAsyncioTestCase):
    async def test_later_workflow_edits_do_not_change_accepted_job(self):
        with tempfile.TemporaryDirectory() as directory:
            service = ComfyService({"comfyui_url": "http://localhost:18188", "anima_workspace": directory},
                                   Path(directory) / "data", Path(__file__).resolve().parents[1] / "workflows")
            try:
                await service.initialize()
                workflow = service.workflows[SDXL_WORKFLOW]
                with patch.object(service, "_run"):
                    job = await service.start("test", "accepted prompt", workflow, "accepted negative", 2**60 + 5)
                    field = workflow.positive[0]
                    workflow.graph[field.node]["inputs"][field.name] = "changed later"
                    detail = describe_configuration(job.configuration)
                    self.assertEqual(detail["positive"][0]["text"], "accepted prompt")
                    self.assertEqual(detail["negative"][0]["text"], "accepted negative")
                    self.assertEqual(job.seed, 2**60 + 5)
                    self.assertEqual(job.configuration["graph"][field.node]["inputs"][field.name], "accepted prompt")
            finally:
                await service.close()
