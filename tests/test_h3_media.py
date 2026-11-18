import json
import unittest
from pathlib import Path
from types import SimpleNamespace

from bridge.studio.h3_media import H3Media, media_view
from bridge.workflows.minimax_h3 import h3_with_media
from bridge.workflows.workflow import H3_SEED_FULL, WorkflowError
from bridge.workflows.workflow_store import workflow_from_profile


class H3MediaTests(unittest.TestCase):
    def test_media_paths_are_contained(self):
        self.assertEqual(media_view("folder/参考图.png [input]"), {
            "filename": "参考图.png", "subfolder": "folder", "type": "input",
        })
        self.assertEqual(media_view("masks/preview.webp [temp]")["type"], "temp")
        for value in ("../secrets.png", "/root.png", "C:\\secret.png", "folder//image.png",
                      "folder/file.txt", "image.png [anything]", "", None):
            with self.subTest(value=value), self.assertRaises(WorkflowError):
                media_view(value)

    def test_gateway_limits_routes_and_mask_prompts(self):
        gateway = H3Media(SimpleNamespace())
        gateway.check_route("GET", "/minimax_h3/capabilities", None)
        gateway.check_route("POST", "/minimax_h3/presets/save", {"name": "test", "items": []})
        for method, path, body in (
            ("POST", "/interrupt", {}),
            ("GET", "/history/someone-else", None),
            ("GET", "http://other-host/view", None),
            ("POST", "/prompt", {"prompt": {"1": {"class_type": "SaveImage"}}}),
        ):
            with self.subTest(path=path), self.assertRaises(WorkflowError):
                gateway.check_route(method, path, body)
        gateway.mask_jobs.add("own-mask")
        gateway.check_route("GET", "/history/own-mask", None)
        gateway.check_route("POST", "/prompt", {"prompt": {
            "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "sam.safetensors"}},
            "2": {"class_type": "MiniMaxH3FantasticObjectMask", "inputs": {
                "model": ["1", 0], "clip": ["1", 1], "video": "clip.mp4 [input]",
            }},
        }})

    def test_task_media_keeps_every_edit_and_saved_workflow(self):
        profile = json.loads((Path(__file__).resolve().parents[1] / "workflows" / f"{H3_SEED_FULL}.json").read_bytes())
        original = workflow_from_profile(H3_SEED_FULL, profile)
        old = original.graph["416"]["inputs"]["media_state"]
        items = [
            {"kind": "picture", "file": "one.png [input]", "crop": {"x": 0.1, "y": 0, "w": 0.7, "h": 1},
             "rotate": 90, "mirror": True, "resize": 1280, "name": "character"},
            {"kind": "picture", "file": "two.png [input]", "enabled": False},
            {"kind": "video", "file": "clip.mp4 [input]", "audio_mode": "standalone", "has_audio": True,
             "trim": {"start": 2, "end": 5}, "mask": "minimax_h3/mask.npz [input]", "mask_grow": 16},
            {"kind": "audio", "file": "voice.wav [input]", "trim": {"start": 1, "end": 4}},
        ]
        selected = h3_with_media(original, items)
        graph, seed = selected.prepare("A fox", seed=1000)
        self.assertEqual(json.loads(graph["416"]["inputs"]["media_state"]), items)
        self.assertEqual(original.graph["416"]["inputs"]["media_state"], old)
        self.assertEqual(seed, 1000)
        self.assertEqual(graph["5"]["inputs"]["ref_images.ref_image_0"], ["417", 0])
        self.assertEqual(selected.outputs, original.outputs)
        self.assertEqual(json.loads(h3_with_media(original, []).graph["416"]["inputs"]["media_state"]), [])
        for invalid in (None, {}, [None], [{"kind": "file", "file": "one.png"}]):
            with self.assertRaises(WorkflowError):
                h3_with_media(original, invalid)
