import importlib.util
import json
import sys
import tempfile
import unittest
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from PIL import Image

from bridge.image_archive import ImageReviews
from bridge.video_library import VideoLibrary
from bridge.workflows.workflow_store import workflow_from_profile

ROOT = Path(__file__).resolve().parents[1]


@asynccontextmanager
async def shared_prompt_clients():
    with tempfile.TemporaryDirectory() as folder:
        root = Path(folder).resolve()
        routes = web.RouteTableDef()
        manager = SimpleNamespace(get_request_user_filepath=lambda request, *_args, **_kwargs:
                                  str(root / request.headers.get("Comfy-User", "default")))
        server = SimpleNamespace(routes=routes, user_manager=manager)
        path = ROOT / "comfyui/ComfyUI-AstrBot-H3-Shared/__init__.py"
        spec = importlib.util.spec_from_file_location("shared_h3_test", path)
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {"server": SimpleNamespace(PromptServer=SimpleNamespace(instance=server))}):
            spec.loader.exec_module(module)
        app = web.Application()
        app.add_routes(routes)
        async with TestClient(TestServer(app)) as workbench, TestClient(workbench.server) as comfyui:
            yield workbench, comfyui


class SharedH3Tests(unittest.IsolatedAsyncioTestCase):
    async def test_same_comfy_user_shares_prompts_and_keeps_library_scopes(self):
        async with shared_prompt_clients() as (workbench, comfyui):
            route = "/astrbot_h3_shared/prompts/h3-dual"
            first = await (await workbench.get(route)).json()
            prompt = {"name": "分镜", "text": "镜头一\n镜头二", "revision": first["revision"]}
            saved = await workbench.post(route, json=prompt)
            self.assertEqual(saved.status, 200)
            visible = await (await comfyui.get(route)).json()
            self.assertEqual(visible["entries"], [{"name": prompt["name"], "text": prompt["text"]}])
            self.assertEqual((await comfyui.post(route, json=prompt)).status, 409)
            for target, headers in (
                ("/astrbot_h3_shared/prompts/ph3", {}),
                (route, {"Comfy-User": "another"}),
            ):
                isolated = await (await comfyui.get(target, headers=headers)).json()
                self.assertEqual(isolated["entries"], [])
            removed = await comfyui.post(route, json={**prompt, "text": None, "revision": visible["revision"]})
            self.assertEqual(removed.status, 200)
            self.assertEqual((await (await workbench.get(route)).json())["entries"], [])

    def test_existing_installs_convert_only_the_old_defaults(self):
        cases = {
            "MiniMax_H3_Dual_Continuation_AstrBot": ("46", "vedio/H3_二采", "最终版万物皆可接续/2采/2采"),
            "PH3_Image_Edit_AstrBot": ("62", "PH3", "鸣潮画风测试/wuwa_style"),
        }
        for name, (node, previous, current) in cases.items():
            profile = json.loads((ROOT / "workflows" / f"{name}.json").read_bytes())
            for prefix, expected in ((previous, current), ("custom/prefix", "custom/prefix")):
                profile["prompt"][node]["inputs"]["filename_prefix"] = prefix
                workflow = workflow_from_profile(name, profile)
                graph, _ = workflow.prepare("A test prompt", image_folder="unevaluate/SFW/test")
                self.assertEqual(graph[node]["inputs"]["filename_prefix"], expected)
                self.assertEqual(profile["prompt"][node]["inputs"]["filename_prefix"], prefix)

    def test_video_library_reuses_the_comfyui_original(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            path = root / "output" / "最终版万物皆可接续" / "2采" / "test.mp4"
            path.parent.mkdir(parents=True)
            path.write_bytes(b"\x00\x00\x00\x18ftypisom")
            library = VideoLibrary(root / "cache", root / "output")
            ref = {"filename": path.name, "subfolder": "最终版万物皆可接续/2采", "type": "output"}
            self.assertEqual(library.original(ref), path)
            self.assertEqual(library.list(1)["videos"][0]["name"], path.name)

    def test_ph3_review_preserves_shared_source(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            path = root / "output" / "鸣潮画风测试" / "test.png"
            path.parent.mkdir(parents=True)
            Image.new("RGB", (4, 4), "blue").save(path)
            reviews = ImageReviews(root / "data", root / "cache", root / "output")
            reviews.initialize()
            ref = {"filename": path.name, "subfolder": path.parent.name, "type": "output"}
            job = "a" * 32
            self.assertEqual(reviews.shared_original(ref), path)
            originals = reviews.originals("SFW", job, [ref])
            self.assertEqual(originals, [None])
            reviews.remember(job, "owner", "PH3_Image_Edit_AstrBot", "SFW", [path], originals)
            review_copy = root / "output" / "unevaluate" / "SFW" / job / "0001.png"
            self.assertEqual(path.read_bytes(), review_copy.read_bytes())
