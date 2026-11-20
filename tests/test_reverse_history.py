import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from PIL import Image

from bridge.service import ComfyService
from bridge.studio.reverse_history import ReverseHistory
from bridge.workflows.workflow import WorkflowError


def pixels():
    output = io.BytesIO()
    Image.new("RGB", (640, 800), "green").save(output, "PNG")
    return output.getvalue()


class ReverseHistoryTests(unittest.TestCase):
    def test_unlimited_retention_restart_pagination_images_and_delete(self):
        with tempfile.TemporaryDirectory() as directory:
            history = ReverseHistory(directory)
            image = pixels()
            identities = {history.save(f"prompt {number}", image, "WD14") for number in range(17)}
            history = ReverseHistory(directory)
            first, second = history.list(), history.list(2)
            self.assertEqual(first["total"], 17)
            self.assertEqual(len(first["records"]), 12)
            self.assertEqual(len(second["records"]), 5)
            self.assertEqual({row["id"] for row in first["records"] + second["records"]}, identities)
            identity = first["records"][0]["id"]
            self.assertEqual(history.image(identity, True), ("image/png", image))
            mime, thumbnail = history.image(identity)
            self.assertEqual(mime, "image/jpeg")
            with Image.open(io.BytesIO(thumbnail)) as opened:
                self.assertLessEqual(max(opened.size), 480)
            outside = Path(directory) / "source.png"
            outside.write_bytes(image)
            for invalid in ("../source", None, "0" * 32 + "/../source"):
                with self.assertRaises(WorkflowError):
                    history.delete(invalid)
            history.delete(identity)
            self.assertEqual(history.list()["total"], 16)
            self.assertEqual(list(history.root.glob(identity + ".*")), [])
            self.assertEqual(outside.read_bytes(), image)
            self.assertEqual(history.list(999)["page"], 2)

    def test_failed_save_leaves_no_visible_or_partial_record(self):
        with tempfile.TemporaryDirectory() as directory:
            history = ReverseHistory(directory)
            with patch("bridge.studio.reverse_history.atomic_write", side_effect=OSError("disk full")):
                with self.assertRaises(OSError):
                    history.save("result", pixels(), "fixture")
            self.assertEqual(history.list()["total"], 0)
            self.assertEqual(list(history.root.iterdir()), [])


class ReverseCaptureTests(unittest.IsolatedAsyncioTestCase):
    async def test_success_is_recorded_failure_is_not_and_storage_error_keeps_prompt(self):
        with tempfile.TemporaryDirectory() as directory:
            service = ComfyService({"comfyui_url": "http://localhost:18188"}, Path(directory), Path(directory) / "workflows")
            graph = {"1": {"inputs": {"image": "pending"}}}
            try:
                with patch.object(service.client, "upload_image", new=AsyncMock(return_value="input.png")), patch.object(
                    service.client, "submit", new=AsyncMock(return_value="id")
                ), patch.object(service.client, "wait", new=AsyncMock(return_value={"outputs": {"3": {"text": [" result "]}}})) as wait:
                    result = await service.run_caption(graph, pixels(), "1", "3", source="WD14")
                    self.assertEqual(result, "result")
                    self.assertEqual(service.reverse_history.list()["records"][0]["source"], "WD14")
                    with patch.object(service.reverse_history, "save", side_effect=OSError("disk full")):
                        self.assertEqual(await service.run_caption(graph, pixels(), "1", "3"), "result")
                    with patch.object(service.reverse_history, "save", side_effect=Image.DecompressionBombError("large image")):
                        self.assertEqual(await service.run_caption(graph, pixels(), "1", "3"), "result")
                    wait.return_value = {"outputs": {"3": {"text": []}}}
                    with self.assertRaises(WorkflowError):
                        await service.run_caption(graph, pixels(), "1", "3")
                    self.assertEqual(service.reverse_history.list()["total"], 1)
            finally:
                await service.close()
