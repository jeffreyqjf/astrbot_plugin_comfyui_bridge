import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from bridge.lora_settings import LoraSettings
from bridge.workflows.workflow import WorkflowError


class LoraPreviewTests(unittest.TestCase):
    def test_previews_survive_settings_and_fast_catalog_in_each_family(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            service = SimpleNamespace(config={"anima_workspace": str(root)}, data_dir=root)
            for family in ("anima", "illustrious", "custom"):
                with self.subTest(family=family):
                    path = root / "models/loras" / family / "style.safetensors"
                    path.parent.mkdir(parents=True)
                    header = json.dumps({"__metadata__": {"modelspec.architecture": "sdxl" if family == "illustrious" else family},
                                         "lora_test": {}}).encode()
                    path.write_bytes(len(header).to_bytes(8, "little") + header)
                    settings = LoraSettings(service, family, family)
                    snapshot = settings._get_lora_order()
                    identity = snapshot["entries"][0]["id"]
                    preview = "manual:pass:abc:12:example.png"
                    updated = settings._update_lora_order({"id": identity, "preview": preview, "revision": snapshot["revision"]})
                    self.assertEqual(updated["entries"][0]["preview"], preview)
                    self.assertNotEqual(updated["revision"], snapshot["revision"])
                    self.assertIsNone(settings._update_lora_order({"id": identity, "preview": "", "revision": snapshot["revision"]}))
                    before = settings.lora_order_path.read_bytes()
                    for invalid in ("../secret.png", "https://example.com/a.png", {"path": "file"}):
                        with self.assertRaises(WorkflowError):
                            settings._update_lora_order({"id": identity, "preview": invalid, "revision": updated["revision"]})
                        self.assertEqual(before, settings.lora_order_path.read_bytes())
                    updated = settings._update_lora_order({"order": [identity], "revision": updated["revision"]})
                    updated = settings._update_lora_order({"id": identity, "category": "O", "default_strength": 0.35,
                                                          "tag": "trigger", "revision": updated["revision"]})
                    settings = LoraSettings(service, family, family)
                    with patch.object(settings, "_lora_sha256", side_effect=AssertionError("fast list must not hash weights")):
                        entry = settings.task_catalog()[identity]
                        self.assertEqual(entry["preview"], preview)
                        self.assertEqual(entry["default_strength"], 0.35)
                    updated = settings._update_lora_order({"id": identity, "preview": None, "revision": updated["revision"]})
                    self.assertEqual(updated["entries"][0]["preview"], "")
                    self.assertEqual(updated["entries"][0]["tag"], "trigger")
