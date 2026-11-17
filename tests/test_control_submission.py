import io
import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from bridge.client import ComfyError
from bridge.controlnet_archive import ControlNetArchive
from bridge.service import ComfyService
from bridge.workflows.workflow import ADVANCED_V40_WORKFLOW, Workflow


def png(color):
    with io.BytesIO() as output:
        Image.new("RGB", (4, 4), color).save(output, "PNG")
        return output.getvalue()


class TestClient:
    max_image_bytes = 1024 * 1024
    prompt = None

    def __init__(self, missing_preview):
        self.upload_calls = []
        self.missing_preview = missing_preview

    async def upload_image(self, data):
        self.upload_calls.append(data)
        return f"astrbot_bridge/fixture_{len(self.upload_calls)}.png"

    async def submit(self, graph, *, metadata):
        self.prompt = graph
        return "isolated-prompt"

    async def wait(self, prompt_id, timeout):
        return {"outputs": {
            "501": {"images": [{"filename": "generated.png", "type": "output"}]},
            "astrbot_controlnet_any": {"images": [{"filename": "canny.png", "type": "temp"}]},
        }}

    async def download_outputs(self, record, outputs, directory, limit, **kwargs):
        assert outputs == ["501"]
        path = directory / "ordinary.png"
        path.write_bytes(png("green"))
        return [path], 1

    async def image_bytes(self, ref):
        assert ref["filename"] == "canny.png"
        if self.missing_preview:
            raise ComfyError("test preview missing")
        return png("white")

    async def close(self):
        pass


class ControlSubmissionTests(unittest.IsolatedAsyncioTestCase):
    async def test_new_custom_workflow_after_restart_preserves_upgrade_baseline(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            data = root / "data"
            directory = data / "workflows"
            directory.mkdir(parents=True)
            bundled = Path(__file__).resolve().parents[1] / "workflows"
            raw = (bundled / "SDXL_Turbo_T2I_AstrBot.json").read_bytes()
            original = directory / "Existing_Custom.json"
            original.write_bytes(raw)
            config = {"comfyui_url": "http://localhost:18188", "anima_workspace": str(root)}
            service = ComfyService(config, data, bundled)
            await service.initialize()
            await service.close()
            self.assertEqual(original.read_bytes(), raw)
            added = directory / "Offline_New.json"
            added.write_bytes(raw)
            service = ComfyService(config, data, bundled)
            try:
                await service.initialize()
                self.assertIn("Offline_New", service.workflows)
                self.assertEqual(original.read_bytes(), raw)
                self.assertIn("parameter_layout", json.loads(added.read_bytes())["astrbot"])
            finally:
                await service.close()

    async def run_fixture(self, missing_preview):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            data = root / "data"
            service = ComfyService(
                {"comfyui_url": "http://localhost:18188", "anima_workspace": str(root)}, data,
                Path(__file__).resolve().parents[1] / "workflows",
            )
            await service.initialize()
            await service.client.close()
            client = TestClient(missing_preview)
            service.client = client
            (root / "input").mkdir()
            archive = ControlNetArchive(root / "input", data)
            reused = archive.record("a" * 32, "openpose", 0, png("blue"), control_type="openpose")
            graph = {
                "0": {"class_type": "LoadImage", "inputs": {"image": "ordinary.png"}},
                "33": {"class_type": "CLIPTextEncode", "inputs": {"text": "init"}},
                "44": {"class_type": "KSampler", "inputs": {"positive": ["33", 0], "seed": 0, "latent_image": ["0", 0]}},
                "501": {"class_type": "SaveImage", "inputs": {"images": ["44", 0]}},
                "121": {"class_type": "LoadImage", "inputs": {"image": "pose.png"}},
                "123": {"class_type": "LoadImage", "inputs": {"image": "raw.png"}},
                "172": {"class_type": "AIO_Preprocessor", "inputs": {"image": ["123", 0], "preprocessor": "CannyEdgePreprocessor"}},
            }
            workflow = Workflow(ADVANCED_V40_WORKFLOW, graph, {"image": ["0.image"]})
            workflow.graph["astrbot_controlnet_any"] = {"class_type": "PreviewImage", "inputs": {"images": ["172", 0]}}
            workflow.controlnet_outputs["any"] = "astrbot_controlnet_any"
            ordinary, pose, raw = png("red"), png("blue"), png("black")
            sources = {
                "openpose": {"asset_id": reused["asset_id"], "type": "openpose", "data": pose, "kind": "asset_id", "label": ""},
                "any": {"asset_id": None, "type": "canny", "data": raw, "kind": "id", "label": "raw.png"},
            }
            try:
                job = await service.start(
                    "studio:fixture", "fixture", workflow, image_data=ordinary,
                    control_sources=sources, control_archive=archive,
                )
                await job.task
                self.assertEqual(client.upload_calls, [ordinary, pose, raw])
                self.assertEqual(
                    [client.prompt[k]["inputs"]["image"] for k in ("0", "121", "123")],
                    [f"astrbot_bridge/fixture_{i}.png" for i in (1, 2, 3)],
                )
                self.assertEqual((job.state, job.image_count), ("completed", 1))
                item = service.image_reviews.pending(5)["jobs"][0]["images"][0]
                result = item["generation"]["controlnets"]
                self.assertEqual((result[0]["asset_id"], result[0]["new"]), (reused["asset_id"], False))
                if missing_preview:
                    self.assertIn("控制图未能归档", job.error)
                    self.assertEqual(len(result), 1)
                else:
                    self.assertEqual([(row["branch"], row["new"]) for row in result], [("openpose", False), ("any", True)])
                    self.assertEqual(archive.lookup(result[1]["asset_id"])["state"], "unevaluated")
            finally:
                await service.close()

    async def test_ordinary_outputs_and_control_assets_stay_separate(self):
        await self.run_fixture(False)

    async def test_control_preview_failure_keeps_ordinary_results(self):
        await self.run_fixture(True)
