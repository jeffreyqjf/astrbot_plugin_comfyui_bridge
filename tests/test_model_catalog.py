import json
import unittest
from pathlib import Path
from types import SimpleNamespace

from bridge.service import AIO_MAPPING, ANIMA_MAPPING, WAI_MAPPING
from bridge.studio.model_catalog import inventory
from bridge.workflows.workflow_store import profile_parts, workflow_from_profile

ROOT = Path(__file__).resolve().parents[1]
SOURCES = json.loads((ROOT / "templates/model_sources.json").read_text(encoding="utf-8"))["sources"]
MAPPINGS = {"Anima_T2I_AstrBot": ANIMA_MAPPING, "Anima_I2I_AIO_AstrBot": AIO_MAPPING, "WAI-Illustrious_T2I_AstrBot": WAI_MAPPING}


class ModelCatalogTests(unittest.TestCase):
    def test_every_bundled_workflow_has_models_without_scanning_images(self):
        for path in (ROOT / "workflows").glob("*.json"):
            data = json.loads(path.read_bytes())
            workflow = workflow_from_profile(path.stem, data, MAPPINGS.get(path.stem))
            rows = inventory(workflow, SOURCES, saved_graph=profile_parts(data)[0])
            self.assertTrue(rows, path.name)
            self.assertTrue(all(row["folder"].startswith(("models/", "custom_nodes/")) for row in rows))
            self.assertFalse(any(row["name"].endswith(".png") for row in rows))
            if "Hunter_V3" in path.stem:
                self.assertTrue(any("silver" in row["name"] and row["url"] for row in rows))

    def test_requirements_aliases_deduplication_and_safe_unknown_source(self):
        workflow = SimpleNamespace(name="test", active={"1", "2", "3"}, graph={
            "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "anima-aesthetic-v1.1.safetensors"}},
            "2": {"class_type": "ControlNetLoader", "inputs": {"control_net_name": "SDXL\\control-lora-canny-rank256.safetensors"}},
            "3": {"class_type": "ControlNetLoader", "inputs": {"control_net_name": "SDXL/control-lora-canny-rank256.safetensors"}},
            "4": {"class_type": "VAELoader", "inputs": {"vae_name": "custom.safetensors"}},
        })
        rows = inventory(workflow, SOURCES)
        self.assertTrue(rows[0]["required"])
        control = next(row for row in rows if "canny" in row["name"])
        self.assertFalse(control["required"])
        self.assertEqual(control["folder"], "models/controlnet/SDXL/")
        self.assertEqual(len(control["nodes"]), 2)
        custom = next(row for row in rows if row["name"] == "custom.safetensors")
        self.assertIsNone(custom["url"])
        self.assertFalse(custom["connected"])

    def test_anima_canvas_exposes_dormant_loaders_without_replacing_live_values(self):
        path = ROOT / "workflows/Anima_T2I_AstrBot.json"
        workflow = workflow_from_profile(path.stem, json.loads(path.read_bytes()), ANIMA_MAPPING)
        canvas = json.loads((ROOT / "templates/Anima_T2I_AstrBot.json").read_bytes())
        rows = inventory(workflow, SOURCES, canvas)
        self.assertTrue(any("lllite" in row["name"].lower() for row in rows))
        self.assertEqual(sum(row["name"] == "anima-aesthetic-v1.1.safetensors" for row in rows), 1)

    def test_sources_are_secure_reviewed_pages_and_lllite_is_not_main_model(self):
        self.assertTrue(all(row["url"].startswith("https://") for row in SOURCES))
        workflow = SimpleNamespace(name="test", active={"1"}, graph={
            "1": {"class_type": "ModelPatchLoader", "inputs": {"name": "anima-lllite-inpainting-v2.safetensors"}},
        })
        row = inventory(workflow, SOURCES)[0]
        self.assertIn("kohya-ss", row["url"])
        self.assertEqual(row["folder"], "models/model_patches/")
        self.assertFalse(row["required"])
