import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import AsyncMock, patch

from PIL import Image

from bridge.client import ComfyClient, ComfyError
from bridge.service import ComfyService
from bridge.workflows.detailer import prepare_detailer_models
from bridge.workflows.minimax_h3 import h3_final_defaults, h3_final_inputs, h3_with_reference
from bridge.workflows.workflow import H3_SEED_FINAL, Workflow, WorkflowError

ROOT = Path(__file__).resolve().parents[1]


class FinalInputsTests(unittest.TestCase):
    def test_final_inputs_keep_both_seeds_and_do_not_change_saved_graph(self):
        workflow = Workflow(H3_SEED_FINAL, json.loads((ROOT / "workflows" / f"{H3_SEED_FINAL}.json").read_bytes()))
        original = deepcopy(workflow.graph)
        values = {**h3_final_defaults(workflow), "base_seed": "9007199254740999", "second_seed": "9007199254740997",
                  "width": 960, "height": 1632, "steps": 3, "denoise": 0.4}
        candidate = h3_final_inputs(workflow, values)
        graph, seed = h3_with_reference(candidate).prepare("final prompt", image_filename="chosen.png")
        self.assertEqual(seed, 9007199254740999)
        self.assertEqual(graph["16"]["inputs"]["value"], seed)
        self.assertEqual(graph["63"]["inputs"]["noise_seed"], 9007199254740997)
        self.assertEqual(graph["61"]["inputs"]["width"], 960)
        self.assertEqual(graph["62"]["inputs"]["denoise"], 0.4)
        self.assertEqual(graph["astrbot_h3_reference"]["inputs"]["image"], "chosen.png")
        self.assertEqual(workflow.graph, original)
        for key, invalid in (("base_seed", "-1"), ("base_seed", str(2**63)), ("width", 999), ("denoise", False), ("steps", 0)):
            with self.assertRaises(WorkflowError):
                h3_final_inputs(workflow, {**values, key: invalid})

    def test_detailer_relocated_model_must_match_uniquely(self):
        graph = {"18": {"class_type": "ControlNetLoader", "inputs": {"control_net_name": "SDXL\\canny.safetensors"}}}
        def schema(choices):
            return {"ControlNetLoader": {"input": {"required": {"control_net_name": [choices]}}}}
        prepare_detailer_models(graph, schema(["canny.safetensors"]))
        self.assertEqual(graph["18"]["inputs"]["control_net_name"], "canny.safetensors")
        for choices in (["a/canny.safetensors", "b/canny.safetensors"], ["different.safetensors"]):
            graph["18"]["inputs"]["control_net_name"] = "SDXL\\canny.safetensors"
            with self.assertRaises(WorkflowError):
                prepare_detailer_models(graph, schema(choices))


class OutputContractTests(unittest.IsolatedAsyncioTestCase):
    async def test_partial_validation_error_is_not_accepted_as_a_completed_task(self):
        client = ComfyClient("http://localhost:18188")
        errors = {"18": {"errors": [{"message": "missing model", "details": "canny.safetensors"}]}}
        with patch.object(client, "request", new=AsyncMock(return_value={"prompt_id": "fixture", "node_errors": errors})) as request, patch.object(
            client, "delete_queued", new=AsyncMock()
        ) as delete:
            with self.assertRaisesRegex(ComfyError, "18.*missing model"):
                await client.submit({}, outputs=["32"])
            self.assertEqual(request.call_args.kwargs["payload"]["partial_execution_targets"], ["32"])
            delete.assert_awaited_once_with("fixture")
        await client.close()

    async def test_both_detailers_final_images_reach_pending_review(self):
        for name, output in (("Detailer_V40_AstrBot", "32"), ("Anima_Detailer_AstrBot", "15")):
            with self.subTest(workflow=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                service = ComfyService({"comfyui_url": "http://localhost:18188", "anima_workspace": directory}, root / "data", ROOT / "workflows")
                try:
                    await service.initialize()
                    workflow = service.workflows[name]
                    schemas = {}
                    for kind, field in (("ControlNetLoader", "control_net_name"), ("ModelPatchLoader", "name")):
                        choices = [node["inputs"][field].replace("\\", "/").rsplit("/", 1)[-1]
                                   for node in workflow.graph.values() if node["class_type"] == kind]
                        schemas[kind] = {"input": {"required": {field: [choices]}}}
                    cache = root / "result.png"
                    Image.new("RGB", (16, 12), "green").save(cache)
                    original = cache.read_bytes()
                    input_path = root / "input.png"
                    Image.new("RGB", (8, 6), "red").save(input_path)
                    input_image = input_path.read_bytes()
                    history = {"outputs": {output: {"images": [{"filename": "result.png", "type": "output"}]}}}
                    with patch.object(service.client, "node_schemas", new=AsyncMock(return_value=schemas)), patch.object(
                        service.client, "upload_image", new=AsyncMock(return_value="reference.png")
                    ), patch.object(service.client, "submit", new=AsyncMock(return_value="fixture")) as submit, patch.object(
                        service.client, "wait", new=AsyncMock(return_value=history)
                    ), patch.object(service.client, "download_outputs", new=AsyncMock(return_value=([cache], 1))):
                        job = await service.start("owner", "refined", workflow, image_data=input_image)
                        await job.task
                    self.assertEqual(job.state, "completed", job.error)
                    self.assertIn(output, submit.call_args.kwargs["outputs"])
                    items = service.image_reviews.pending(10)["jobs"]
                    self.assertEqual(items[0]["images"][0]["id"], f"{job.id}:1")
                    self.assertEqual(service.image_reviews.read(f"{job.id}:1", True, 1024 * 1024)[1], original)
                    self.assertEqual(service.image_reviews.refinement_input(f"{job.id}:1", True, 1024 * 1024)[1], input_image)
                    self.assertIn("refinement", items[0]["images"][0]["generation"])
                    with patch.object(service.client, "node_schemas", new=AsyncMock(return_value=schemas)), patch.object(
                        service.client, "upload_image", new=AsyncMock(return_value="reference.png")
                    ), patch.object(service.client, "submit", new=AsyncMock(return_value="fixture")), patch.object(
                        service.client, "wait", new=AsyncMock(return_value=history)
                    ), patch.object(service.client, "download_outputs", new=AsyncMock(return_value=([cache], 1))), patch.object(
                        service.image_reviews, "remember", side_effect=OSError("disk full")
                    ):
                        failed_archive = await service.start("owner", "refined", workflow, image_data=original)
                        await failed_archive.task
                        self.assertEqual(failed_archive.state, "completed")
                        self.assertIn("待评价", failed_archive.error)
                        self.assertEqual(failed_archive.paths, [cache])
                finally:
                    await service.close()
