import base64
import io
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from zipfile import ZipFile

from PIL import Image

from bridge.image_archive import ImageReviews, _place_file
from bridge.studio.studio_settings import StudioSettings
from bridge.workflows.workflow import WorkflowError


class RefinementPairsTests(unittest.TestCase):
    source_id = "a" * 32
    output_id = "b" * 32

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.review = ImageReviews(self.root / "data", self.root / "output", None)
        self.review.initialize()
        self.source = self.root / "source.png"
        Image.new("RGB", (20, 30), "red").save(self.source)
        self.result = self.root / "result.png"
        Image.new("RGB", (40, 60), "blue").save(self.result)
        self.review.remember(self.source_id, "owner", "generator", "SFW", [self.source], [None],
                             metadata={"loras": [[{"name": "anima/test.safetensors", "model": 0.8, "clip": 0.6}]]})
        self.review.rate(f"{self.source_id}:1", "favourite")

    def remember_result(self, origin=None, identity=None):
        origin = origin or self.review.verify_reference_origin(
            self.source.read_bytes(), {"id": f"{self.source_id}:1", "state": "favourite"},
        )
        identity = identity or self.output_id
        self.review.remember(identity, "owner", "Anima_Detailer_AstrBot", "SFW", [self.result], [None],
                             metadata={"loras": [[]]}, refinement=origin)
        return f"{identity}:1"

    def test_hd_groups_original_and_result_preserves_bytes_metadata_and_zip(self):
        output = self.remember_result()
        before = self.review._record(self.source_id)
        self.assertEqual(self.review.gallery("", 1)["total"], 1)
        self.assertEqual(self.review.refinement_input(output, True, 1000000)[1], self.source.read_bytes())
        self.review.rate(output, "hd")
        self.assertEqual(self.review.gallery("", 1)["total"], 0)
        gallery = self.review.gallery("", 1, state="hd")
        self.assertEqual(gallery["total"], 1)
        self.assertEqual(gallery["images"][0]["id"], output)
        self.assertEqual(gallery["images"][0]["generation"]["refinement"], {"input_id": self.output_id, "linked": True})
        self.assertEqual(self.review.read(f"{self.source_id}:1", True, 1000000, state="hd")[1], self.source.read_bytes())
        self.assertEqual(self.review.read(output, True, 1000000, state="hd")[1], self.result.read_bytes())
        self.assertEqual(self.review._record(self.source_id), before)
        self.assertNotIn("generator", self.review.filter_options("hd", "")["workflow"])
        with ZipFile(self.root / "hd.zip", "w") as archive:
            self.review.write_gallery_zip("hd", archive)
        with ZipFile(self.root / "hd.zip") as archive:
            self.assertEqual(set(archive.namelist()), {f"SFW/{self.output_id}/0001.png", f"SFW/{self.output_id}/input/original.png"})
            self.assertEqual(archive.read(f"SFW/{self.output_id}/input/original.png"), self.source.read_bytes())
        mime, thumbnail = self.review.refinement_input(output, False, 1000000)
        self.assertEqual(mime, "image/webp")
        self.assertEqual(Image.open(io.BytesIO(thumbnail)).format, "WEBP")
        restarted = ImageReviews(self.root / "data", self.root / "output", None)
        self.assertEqual(restarted.gallery("", 1, state="hd")["total"], 1)
        self.assertEqual(restarted.refinement_input(output, True, 1000000)[1], self.source.read_bytes())
        self.review.rate(output, "favourite", source="hd")
        self.assertEqual(self.review.gallery("", 1, state="hd")["images"][0]["id"], f"{self.source_id}:1")

    def test_manual_original_and_multiple_refinements_share_original(self):
        manual = self.review.root / "pass" / "SFW" / "pose.png"
        manual.write_bytes(self.source.read_bytes())
        identity = self.review.gallery("", 1, state="pass")["images"][0]["id"]
        origin = self.review.verify_reference_origin(manual.read_bytes(), {"id": identity, "state": "pass"})
        first = self.remember_result(origin)
        second = self.remember_result(origin, "c" * 32)
        self.review.rate(first, "hd")
        self.review.rate(second, "hd")
        self.assertFalse(manual.exists())
        self.assertEqual(self.review.gallery("", 1, state="pass")["total"], 0)
        self.assertEqual(self.review.gallery("", 1, state="hd")["total"], 2)
        for output in (first, second):
            self.assertEqual(self.review.refinement_input(output, True, 1000000)[1], self.source.read_bytes())

    def test_auto_match_is_unique_and_owner_scoped_but_explicit_pick_disambiguates(self):
        image = self.source.read_bytes()
        self.assertEqual(self.review.capture_refinement(image, "owner")["source"]["id"], f"{self.source_id}:1")
        self.assertIsNone(self.review.capture_refinement(image, "other")["source"])
        self.review.remember("c" * 32, "owner", "duplicate", "SFW", [self.source], [None])
        self.assertIsNone(self.review.capture_refinement(image, "owner")["source"])
        output = self.remember_result()
        self.review.rate(output, "hd")
        self.assertEqual(self.review.pending(10)["jobs"][0]["images"][0]["id"], f"{'c' * 32}:1")

    def test_external_or_missing_original_still_keeps_snapshot(self):
        output = self.remember_result({"image": self.source.read_bytes(), "source": None})
        self.review.rate(output, "hd")
        self.assertEqual(self.review.gallery("", 1)["total"], 1)
        second = self.remember_result(identity="c" * 32)
        (self.review.root / "favourite" / "SFW" / self.source_id / "0001.png").unlink()
        self.review.rate(second, "hd")
        self.assertEqual(self.review.refinement_input(second, True, 1000000)[1], self.source.read_bytes())

    def test_changed_source_or_collision_never_moves_either_file(self):
        output = self.remember_result()
        original = self.review.root / "favourite" / "SFW" / self.source_id / "0001.png"
        # Replace rather than mutate the source hardlink shared with the fixture.
        original.unlink()
        original.write_bytes(self.result.read_bytes())
        with self.assertRaisesRegex(WorkflowError, "已变更"):
            self.review.rate(output, "hd")
        original.write_bytes(self.source.read_bytes())
        target = self.review.root / "hd" / "SFW" / self.source_id / "0001.png"
        target.parent.mkdir(parents=True)
        target.write_bytes(self.result.read_bytes())
        with self.assertRaisesRegex(WorkflowError, "同名"):
            self.review.rate(output, "hd")
        self.assertTrue(original.is_file())
        self.assertEqual(len(self.review.pending(10)["jobs"]), 1)

    def test_copy_failure_and_unlink_failure_roll_back_pair(self):
        output = self.remember_result()
        original = self.review.root / "favourite" / "SFW" / self.source_id / "0001.png"
        def fail_second(source, target, digest):
            if self.source_id in str(target):
                raise WorkflowError("copy failed")
            return _place_file(source, target, digest)
        with patch("bridge.image_archive._place_file", side_effect=fail_second), self.assertRaises(WorkflowError):
            self.review.rate(output, "hd")
        self.assertEqual(self.review.gallery("", 1, state="hd")["total"], 0)
        unlink = Path.unlink
        def fail_unlink(path, *args, **kwargs):
            if path == original:
                raise OSError("source busy")
            return unlink(path, *args, **kwargs)
        with patch.object(Path, "unlink", fail_unlink), self.assertRaisesRegex(OSError, "source busy"):
            self.review.rate(output, "hd")
        self.assertEqual(self.review.gallery("", 1, state="hd")["total"], 0)
        self.assertTrue(original.is_file())
        self.assertEqual(self.review.read(output, True, 1000000)[1], self.result.read_bytes())

    def test_origin_verification_precedes_mask_and_rejects_forged_metadata(self):
        service = SimpleNamespace(image_reviews=self.review, client=SimpleNamespace(max_image_bytes=1000000))
        studio = StudioSettings.__new__(StudioSettings)
        studio.service = service
        mask = io.BytesIO()
        Image.new("RGB", (20, 30), "white").save(mask, "PNG")
        data = {"image": base64.b64encode(self.source.read_bytes()).decode(), "mask": base64.b64encode(mask.getvalue()).decode(),
                "reference_origin": {"id": f"{self.source_id}:1", "state": "favourite"}}
        masked = studio.read_queue_reference(data)
        self.assertNotEqual(masked, self.source.read_bytes())
        self.assertEqual(data["_reference_origin"]["image"], self.source.read_bytes())
        for invalid in ({"id": "../secret", "state": "favourite"}, {"id": f"{self.source_id}:1", "state": "pass"}):
            with self.assertRaises(ValueError):
                self.review.verify_reference_origin(self.source.read_bytes(), invalid)
        data = {"image": base64.b64encode(self.result.read_bytes()).decode(), "_reference_origin": {"source": "forged"}}
        studio.read_queue_reference(data)
        self.assertNotIn("_reference_origin", data)
