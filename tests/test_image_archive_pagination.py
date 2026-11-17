import json
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from PIL import Image

from bridge.image_archive import ImageReviews


class ImageReviewPaginationTests(unittest.TestCase):
    new_id = "a" * 32
    legacy_id = "b" * 32
    lora_a = {"name": "anima/A.safetensors", "model": 0.8, "clip": 0.6}
    lora_b = {"name": "anima/B.safetensors", "model": 0.4, "clip": 0.3}

    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        self.review = ImageReviews(root / "data", root / "output", None)
        self.review.initialize()
        source = root / "original.png"
        Image.new("RGB", (1, 1)).save(source)
        manual = self.review.root / "unevaluate" / "SFW" / "manual.png"
        manual.write_bytes(source.read_bytes())
        os.utime(manual, (300, 300))

        with patch("bridge.image_archive.time.time", return_value=100):
            self.review.remember(
                self.new_id, "owner", "current", "SFW", [source, source], [None, None],
                metadata={"loras": [[self.lora_a, self.lora_b], [self.lora_a]]},
            )
        with patch("bridge.image_archive.time.time", return_value=200):
            self.review.remember(self.legacy_id, "owner", "legacy", "SFW", [source, source], [None, None])
        trace = {
            "prompt": {
                "1": self.loader(self.lora_a),
                "2": self.loader(self.lora_b, model=["1", 0]),
                "3": {"class_type": "SaveImage", "inputs": {"images": ["2", 0]}},
                "4": {"class_type": "SaveImage", "inputs": {"images": ["1", 0]}},
            },
            "comfyui_history": {"outputs": {
                "3": {"images": [{"filename": "first.png"}]},
                "4": {"images": [{"filename": "second.png"}]},
            }},
        }
        self.review.metadata_dir.mkdir()
        (self.review.metadata_dir / f"{self.legacy_id}.json").write_text(json.dumps(trace), encoding="utf-8")
        self.filters = {"lora": {self.lora_a["name"], self.lora_b["name"]}}

    @staticmethod
    def loader(lora, **links):
        return {"class_type": "LoraLoader", "inputs": {
            "lora_name": lora["name"], "strength_model": lora["model"], "strength_clip": lora["clip"], **links,
        }}

    def test_pending_pages_count_tasks_and_match_loras_per_image(self):
        old_result = self.review.pending(1, filters=self.filters)
        self.assertEqual(set(old_result), {"jobs", "limit"})
        self.assertEqual([image["index"] for image in old_result["jobs"][0]["images"]], [1, 2])

        new_page = self.review.pending(1, page=1, filters=self.filters, lora_match="all")
        legacy_page = self.review.pending(1, page=2, filters=self.filters, lora_match="all")
        for job_id, page, result in ((self.new_id, 1, new_page), (self.legacy_id, 2, legacy_page)):
            self.assertEqual((result["total"], result["page"], result["page_size"], result["has_more"]),
                             (2, page, 1, page == 1))
            images = result["jobs"][0]["images"]
            self.assertEqual([image["id"] for image in images], [f"{job_id}:1"])
            self.assertEqual(images[0]["generation"]["loras"], [self.lora_a, self.lora_b])
        self.assertEqual(self.review.pending(1, page=3, filters=self.filters, lora_match="all")["jobs"], [])
        manual = self.review.pending(1, page=3)
        self.assertEqual(manual["total"], 3)
        self.assertEqual(manual["jobs"][0]["images"][0]["name"], "manual.png")

    def test_gallery_pages_count_filtered_images_and_preserve_manual_matches(self):
        pending = self.review.pending(10)
        for job in pending["jobs"]:
            for image in job["images"]:
                self.review.rate(image["id"], "favourite")

        state = "favourite"
        result = self.review.gallery("", 1, 1, state=state, filters=self.filters)
        self.assertEqual((result["total"], result["page"], result["page_size"], result["has_more"]), (4, 1, 1, True))
        result = self.review.gallery("", 2, 1, state=state, filters=self.filters, lora_match="all")
        self.assertEqual((result["total"], result["page"], result["has_more"]), (2, 2, False))
        self.assertEqual([image["id"] for image in result["images"]], [f"{self.new_id}:1"])
        filters = {**self.filters, "workflow": {"legacy", "unrelated"}}
        result = self.review.gallery("SFW", 1, 1, state=state, filters=filters, lora_match="all")
        self.assertEqual((result["total"], result["has_more"]), (1, False))
        self.assertEqual([image["id"] for image in result["images"]], [f"{self.legacy_id}:1"])
        result = self.review.gallery("SFW", 1, state=state, filters={"lora": {""}}, lora_match="all")
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["images"][0]["name"], "manual.png")
