import io
import json
import os
import stat
import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from PIL import Image

from bridge import controlnet_archive
from bridge.controlnet_archive import ControlNetArchive
from bridge.image_archive import ImageReviews
from bridge.workflows.workflow import WorkflowError


def raster(color="red", format="PNG"):
    with io.BytesIO() as buffer:
        Image.new("RGB", (12, 8), color).save(buffer, format)
        return buffer.getvalue()


class ControlNetArchiveTests(unittest.TestCase):
    job_id = "a" * 32

    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.input_root = self.root / "input"
        self.input_root.mkdir()
        self.data_root = self.root / "plugin_data"
        self.archive = ControlNetArchive(self.input_root, self.data_root)
        self.data = raster()

    def record(self, branch="any", slot=1):
        return self.archive.record(
            self.job_id, branch, slot, self.data, control_type="depth",
            source_kind="input", source_label=r"C:\secret\reference.png?token=secret",
            source_sha256="b" * 64, preprocessor={"name": "DepthAnything", "resolution": 640},
        )

    def test_rename_rate_delete_keep_id_and_protect_files(self):
        asset = self.record()
        key = asset["asset_id"]
        renamed = self.archive.rename(key, "我的姿势")
        self.assertEqual(renamed["asset_id"], key)
        self.assertEqual(renamed["name"], "我的姿势.png")
        self.assertEqual(self.archive.read(key, original=True)[1], self.data)
        self.archive.rate(key, "favourite")
        self.assertTrue((self.input_root / "my_input/favourite/我的姿势.png").is_file())
        self.assertFalse((self.input_root / "my_input/unevaluated/我的姿势.png").exists())
        other = self.record(slot=2)
        self.archive.rename(other["asset_id"], "我的姿势.png")
        with self.assertRaises(WorkflowError):
            self.archive.rate(other["asset_id"], "favourite")
        self.archive.rename(other["asset_id"], "其他姿势.png")
        self.archive.rate(other["asset_id"], "favourite")
        with self.assertRaises(WorkflowError):
            self.archive.rename(other["asset_id"], "我的姿势.png")
        for invalid in ("../bad.png", "CON.png", "bad.jpg"):
            with self.assertRaises(WorkflowError):
                self.archive.rename(key, invalid)
        self.archive.delete(key)
        self.archive.delete(key)
        self.assertFalse((self.input_root / "my_input/favourite/我的姿势.png").exists())
        with self.assertRaises(WorkflowError):
            self.archive.read(key)
        self.assertEqual(self.archive.list("favourite")["total"], 1)

    def media(self, asset_id, state):
        return self.input_root / "my_input" / state / f"{asset_id}.png"

    def test_stable_asset_media_and_rating(self):
        asset = self.record()
        asset_id = asset["asset_id"]
        self.assertEqual(asset["source_label"], "reference.png")
        self.assertEqual(asset["preprocessor"], "DepthAnything")
        self.assertNotIn("source_sha256", asset)
        indexed = json.loads((self.archive.index / f"{asset_id}.json").read_bytes())
        self.assertEqual(indexed["source_sha256"], "b" * 64)
        self.assertEqual(indexed["preprocessor"]["resolution"], 640)
        self.assertEqual(asset, self.record())
        self.assertEqual(self.archive.read(asset_id, original=True), ("image/png", self.data))
        mime, preview = self.archive.read(asset_id)
        self.assertEqual(mime, "image/webp")
        with Image.open(io.BytesIO(preview)) as image:
            image.load()
            self.assertEqual(image.size, (12, 8))

        self.assertEqual(self.archive.rate(asset_id, "favourite")["state"], "favourite")
        self.assertFalse(self.media(asset_id, "unevaluated").exists())
        restarted = ControlNetArchive(self.input_root, self.data_root)
        self.assertEqual(restarted.lookup(asset_id)["state"], "favourite")
        self.assertEqual(self.record()["state"], "favourite")
        self.assertEqual(restarted.rate(asset_id, "favourite")["state"], "favourite")
        self.assertEqual(restarted.rate(asset_id, "pass")["state"], "pass")
        self.assertEqual(restarted.rate(asset_id, "unevaluated")["state"], "unevaluated")

    def test_paging_and_limits_leave_unmanaged_input_alone(self):
        unmanaged = self.input_root / "manual.png"
        unmanaged.write_bytes(self.data)
        first = self.record()
        second = self.record("openpose")
        third = self.record(slot=2)
        self.assertEqual(len({first["asset_id"], second["asset_id"], third["asset_id"]}), 3)
        result = self.archive.list("unevaluated", 2, 2)
        self.assertEqual((result["total"], result["page"], result["page_size"], result["has_more"]), (3, 2, 2, False))
        self.assertEqual(len(result["assets"]), 1)
        self.assertEqual(self.archive.list("favourite")["total"], 0)

        with self.assertRaises(WorkflowError):
            self.archive.record(self.job_id, "any", 1, raster("blue"), control_type="depth")
        with self.assertRaises(WorkflowError):
            self.archive.record(self.job_id, "any", 4, b"<svg/>", control_type="depth")
        with self.assertRaises(WorkflowError):
            self.archive.read("../manual.png")
        with self.assertRaises(WorkflowError):
            ControlNetArchive(self.input_root, self.data_root, 10).record(
                self.job_id, "any", 4, self.data, control_type="depth",
            )
        with patch.object(controlnet_archive, "MAX_PIXELS", 20):
            with self.assertRaises(WorkflowError):
                self.archive.record(self.job_id, "any", 4, self.data, control_type="depth")
        self.assertEqual(unmanaged.read_bytes(), self.data)

    def test_record_recovers_an_orphan_left_before_index_write(self):
        publish = controlnet_archive._publish

        def fail_index(path, data, **kwargs):
            if path.suffix == ".json":
                raise OSError("failed index write")
            publish(path, data, **kwargs)

        with patch.object(controlnet_archive, "_publish", side_effect=fail_index):
            with self.assertRaises(OSError):
                self.record()
        self.assertEqual(self.archive.list("unevaluated")["total"], 0)
        with self.assertRaises(WorkflowError):
            self.archive.record(self.job_id, "any", 1, raster(format="JPEG"), control_type="depth")
        asset = self.record()
        self.assertEqual(asset, self.archive.lookup(asset["asset_id"]))
        self.assertEqual(self.archive.list("unevaluated")["total"], 1)

    def test_rate_recovers_before_index_write_and_before_cleanup(self):
        asset_id = self.record()["asset_id"]
        source = self.media(asset_id, "unevaluated")
        destination = self.media(asset_id, "favourite")
        with patch.object(self.archive, "_write_record", side_effect=OSError("failed index write")):
            with self.assertRaises(OSError):
                self.archive.rate(asset_id, "favourite")
        self.assertTrue(source.is_file())
        self.assertTrue(destination.is_file())
        self.assertEqual(self.archive.lookup(asset_id)["state"], "unevaluated")
        self.assertEqual(self.archive.rate(asset_id, "favourite")["state"], "favourite")
        self.assertFalse(source.exists())

        complete = self.archive._complete_move

        def fail_cleanup(row):
            if "previous" in row:
                raise OSError("could not remove previous copy")
            return complete(row)

        with patch.object(self.archive, "_complete_move", side_effect=fail_cleanup):
            with self.assertRaises(OSError):
                self.archive.rate(asset_id, "pass")
        self.assertTrue(destination.is_file())
        self.assertEqual(self.archive.lookup(asset_id)["state"], "pass")
        self.assertEqual(self.archive.rate(asset_id, "pass")["state"], "pass")
        self.assertFalse(destination.exists())

    def test_rate_does_not_overwrite_a_different_destination_or_unlink_replaced_source(self):
        asset_id = self.record()["asset_id"]
        source = self.media(asset_id, "unevaluated")
        destination = self.media(asset_id, "favourite")
        destination.parent.mkdir()
        manual = raster("blue")
        destination.write_bytes(manual)
        with self.assertRaises(WorkflowError):
            self.archive.rate(asset_id, "favourite")
        self.assertEqual(destination.read_bytes(), manual)
        self.assertEqual(source.read_bytes(), self.data)
        destination.unlink()

        complete = self.archive._complete_move

        def replace_source(row):
            if "previous" in row:
                source.unlink()
                source.write_bytes(manual)
            return complete(row)

        with patch.object(self.archive, "_complete_move", side_effect=replace_source):
            self.archive.rate(asset_id, "favourite")
        self.assertEqual(source.read_bytes(), manual)
        self.assertEqual(destination.read_bytes(), self.data)

    def test_reparse_directory_is_rejected(self):
        target = self.root / "unmanaged"
        target.mkdir()
        redirect = self.input_root / "my_input"
        if os.name == "nt":
            result = subprocess.run(["cmd.exe", "/c", "mklink", "/J", str(redirect), str(target)],
                                    capture_output=True, check=False)
            if result.returncode:
                self.skipTest("junction creation unavailable")
        else:
            redirect.symlink_to(target, target_is_directory=True)
        try:
            with self.assertRaises(WorkflowError):
                self.record()
            self.assertEqual(list(target.iterdir()), [])
        finally:
            if os.name == "nt":
                redirect.rmdir()
            else:
                redirect.unlink()

    def test_hard_link_to_unmanaged_file_is_rejected(self):
        asset_id = self.record()["asset_id"]
        managed = self.media(asset_id, "unevaluated")
        unmanaged = self.input_root / "manual.png"
        try:
            unmanaged.hardlink_to(managed)
        except OSError:
            self.skipTest("hard-link creation unavailable")
        with self.assertRaises(WorkflowError):
            self.archive.read(asset_id, original=True)
        with self.assertRaises(WorkflowError):
            self.archive.rate(asset_id, "favourite")
        self.assertEqual(unmanaged.read_bytes(), self.data)

    def test_stat_flags_reject_reparse_points_and_hardlinks(self):
        asset_id = self.record()["asset_id"]
        managed = self.media(asset_id, "unevaluated")
        real_stat = Path.lstat

        def pretend_reparse(path):
            if path == managed.parent.parent:
                return SimpleNamespace(st_mode=stat.S_IFDIR, st_file_attributes=stat.FILE_ATTRIBUTE_REPARSE_POINT)
            return real_stat(path)

        with patch.object(Path, "lstat", pretend_reparse):
            with self.assertRaises(WorkflowError):
                self.archive.read(asset_id)
            with self.assertRaises(WorkflowError):
                self.archive.rate(asset_id, "pass")

        def pretend_linked(path):
            if path == managed:
                return SimpleNamespace(st_mode=stat.S_IFREG, st_nlink=2)
            return real_stat(path)

        with patch.object(Path, "lstat", pretend_linked):
            with self.assertRaises(WorkflowError):
                self.archive.read(asset_id)

    def test_changed_or_missing_media_is_rejected_separately(self):
        asset_id = self.record()["asset_id"]
        path = self.media(asset_id, "unevaluated")
        path.write_bytes(raster("blue"))
        with self.assertRaises(WorkflowError):
            self.archive.read(asset_id, original=True)
        with self.assertRaises(WorkflowError):
            self.archive.rate(asset_id, "pass")
        path.unlink()
        with self.assertRaises(WorkflowError):
            self.archive.lookup(asset_id)
        self.assertEqual(self.archive.list("unevaluated")["total"], 0)

    def test_generated_review_links_are_per_slot_and_ratings_are_independent(self):
        asset_id = self.record()["asset_id"]
        reviews = ImageReviews(self.data_root, self.root / "output", None)
        reviews.initialize()
        source = self.root / "original.png"
        source.write_bytes(self.data)
        new = {"asset_id": asset_id, "branch": "any", "type": "depth", "new": True}
        reuse = {**new, "new": False}
        reviews.remember(self.job_id, "owner", "workflow", "SFW", [source] * 3, [None] * 3, metadata={
            "loras": [[{"name": "test.safetensors", "model": 0.8, "clip": 0.6}], [], []],
            "controlnets": [[{**new, "source_path": "secret"}], [reuse, {"asset_id": "../bad"}], []],
        })
        images = reviews.pending(1)["jobs"][0]["images"]
        self.assertEqual(images[0]["generation"]["controlnets"], [new])
        self.assertEqual(images[0]["generation"]["loras"][0]["name"], "test.safetensors")
        self.assertEqual(images[1]["generation"]["controlnets"], [reuse])
        self.assertNotIn("controlnets", images[2]["generation"])
        reviews.rate(images[0]["id"], "favourite")
        self.assertEqual(self.archive.lookup(asset_id)["state"], "unevaluated")
        self.archive.rate(asset_id, "pass")
        self.assertEqual(reviews.gallery("", 1)["images"][0]["generation"]["controlnets"], [new])
