"""Load an installation ZIP under a temporary AstrBot data root."""

import asyncio
import base64
import importlib
import io
import json
import os
import sys
from argparse import ArgumentParser
from pathlib import Path
from subprocess import CompletedProcess
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch
from zipfile import ZipFile

PLUGIN = "astrbot_plugin_comfyui_bridge"


class PluginContext:
    def __init__(self):
        self.routes = set()

    def register_web_api(self, path, handler, methods, description):
        self.routes.update((method, path) for method in methods)


async def check_input_picker(instance, root):
    if sys.platform != "win32":
        return
    from astrbot.api.web import PluginRequest, bind_request_context
    from PIL import Image
    from starlette.requests import Request

    library = instance.studio.input_library
    folder = root / "input"
    image = folder / "pose" / "参考图.png"
    image.parent.mkdir(parents=True)
    Image.new("RGB", (2, 2)).save(image)
    request = Request({
        "type": "http", "method": "POST", "path": "/studio/input/pick",
        "headers": [], "query_string": b"",
    })
    with patch.object(library, "root", return_value=folder), patch.object(
        library, "_configured_root", return_value=folder
    ), patch("subprocess.run") as dialog:
        with bind_request_context(PluginRequest(request)):
            assert (await instance.studio.pick_input_file()).status_code == 401
            dialog.assert_not_called()
        with bind_request_context(PluginRequest(request, username="remote")):
            dialog.return_value = CompletedProcess([], 0, stdout=f"{image}\n")
            response = await instance.studio.pick_input_file()
            assert response.status_code == 200, response.body
            assert json.loads(response.body) == {"id": "pose/参考图.png"}
            assert dialog.call_args.args[0][-1] == str(folder)
            dialog.return_value = CompletedProcess([], 0, stdout=f"{root / 'other.png'}\n")
            assert (await instance.studio.pick_input_file()).status_code == 400
            dialog.return_value = CompletedProcess([], 0, stdout="\n")
            assert json.loads((await instance.studio.pick_input_file()).body) == {"cancelled": True}


async def check_queue_loras(instance, root, name):
    from astrbot.api.web import PluginRequest, bind_request_context
    from starlette.requests import Request

    service = instance.service
    studio = instance.studio
    folder = root / "models" / "loras" / "illustrious"
    folder.mkdir(parents=True)
    entries = {
        key: {"id": key, "title": key, "number": number, "category": number[0],
              "filename": f"illustrious/{key}.safetensors", "default_strength": 0.7, "tag": ""}
        for key, number in (("alpha", "C1"), ("beta", "C2"), ("style", "S1"))
    }

    async def call(method, route, query=b"", data=None):
        async def receive():
            return {"type": "http.request", "body": json.dumps(data).encode()}

        incoming = Request({
            "type": "http", "method": method, "path": f"/api/{route}",
            "headers": [], "query_string": query,
        }, receive)
        with bind_request_context(PluginRequest(incoming, username="remote")):
            return await instance.remote_studio.routes[method, route]()

    options = {"input": {"required": {"lora_name": [[row["filename"] for row in entries.values()]]}}}
    with patch.object(studio.lora_families["illustrious"], "lora_catalog", return_value=entries), patch.object(
        service.client, "request", return_value={"LoraLoader": options}
    ), patch.object(service, "_run") as run:
        catalog = await call("GET", "studio/queue/loras", f"workflow={name}".encode())
        assert catalog.status_code == 200, catalog.body
        assert [row["id"] for row in json.loads(catalog.body)["entries"]] == list(entries)
        stacked = [{"id": "alpha", "strength": 0.4}, {"id": "style", "strength": -0.25}]
        response = await call("POST", "studio/queue", data={"workflow": name, "positive": "fixture", "loras": stacked})
        assert response.status_code == 200, response.body
        assert len(json.loads(response.body)["jobs"]) == 1
        graph = run.call_args.args[1]
        assert graph["astrbot_v40_lora"]["inputs"]["strength_model"] == 0.4
        assert graph["astrbot_v40_lora_2"]["inputs"]["strength_model"] == -0.25
        assert graph["astrbot_v40_lora_2"]["inputs"]["model"] == ["astrbot_v40_lora", 0]
        run.reset_mock()
        response = await call("POST", "studio/queue", data={
            "workflow": name, "positive": "fixture", "lora_sweep": True, "count": 2,
        })
        assert response.status_code == 200, response.body
        jobs = json.loads(response.body)["jobs"]
        assert len(jobs) == 4
        assert jobs[0]["seed"] == jobs[1]["seed"] and jobs[2]["seed"] == jobs[3]["seed"]
        assert [
            row.args[1]["astrbot_v40_lora"]["inputs"]["lora_name"] for row in run.call_args_list
        ] == [entries[key]["filename"] for key in ("alpha", "beta", "alpha", "beta")]
        run.reset_mock()
        response = await call("POST", "studio/queue", data={
            "workflow": name, "positive": "fixture", "lora_sweep": True, "loras": [stacked[1]],
        })
        assert response.status_code == 200, response.body
        assert run.call_args.args[1]["astrbot_v40_lora"]["inputs"]["lora_name"] == entries["style"]["filename"]
        run.reset_mock()
        invalid = await call("POST", "studio/queue", data={
            "workflow": name, "positive": "fixture", "loras": [{"id": "alpha", "strength": 101}],
        })
        assert invalid.status_code == 400
        run.assert_not_called()
        await check_command_controls(instance, root, name, call, run)


async def check_command_controls(instance, root, name, call, run):
    from PIL import Image

    studio = instance.studio
    (root / "input").mkdir(exist_ok=True)
    with io.BytesIO() as buffer:
        Image.new("RGB", (2, 2)).save(buffer, "PNG")
        image = buffer.getvalue()
    supplied = {"any": {"type": "canny", "mode": "preprocess", "image": base64.b64encode(image).decode()}}
    schemas = {
        "LoadImage": {}, "ControlNetApplyAdvanced": {}, "PreviewImage": {},
        "ControlNetLoader": {"input": {"required": {"control_net_name": [["control-lora-canny-rank256.safetensors"]]}}},
        "AIO_Preprocessor": {"input": {"optional": {"preprocessor": [["none", "CannyEdgePreprocessor"]]}}},
    }
    presets = [{"name": "fixture", "positive": "fixture", "negative": ""}]
    resolution = "studio/queue/command/workflow"
    with patch.dict(instance.service.selections, {"studio:remote": name}):
        for command, wanted in (
            ("/comfy gen subject", name),
            ('/comfy gen --wf="v40" subject', name),
            ("/comfy lora sweep-loras --wf v40 subject", name),
            ("/comfy sweep presets --wf v40 --lora C1", name),
            ("/comfy gen --wf t2i fixture", instance.service.resolve("studio:remote", "t2i").name),
            ("/comfy gen --wf v40 --help", None),
            ("/comfy lora --wf v40 list", None),
        ):
            response = await call("POST", resolution, data={"command": command, "has_reference": False})
            assert response.status_code == 200, response.body
            assert json.loads(response.body)["workflow"] == wanted
    with patch.object(instance.service.client, "node_schemas", return_value=schemas), patch.object(
        studio, "preset_rows", return_value=presets
    ):
        for command, count in (
            ("/comfy gen --wf v40 fixture", 1),
            ("/comfy sweep lora --wf v40 fixture", 2),
            ("/comfy sweep presets --wf v40 --lora C1", 1),
        ):
            run.reset_mock()
            response = await call("POST", "studio/queue/command", data={
                "command": command, "account": "fixture", "controlnets": supplied,
            })
            assert response.status_code == 200, response.body
            assert json.loads(response.body)["queued"]
            assert run.call_count == count
            for submitted in run.call_args_list:
                graph = submitted.args[1]
                assert graph["165"]["inputs"]["image"] == ["172", 0]
                assert submitted.kwargs["control_sources"]["any"]["data"] == image
                assert submitted.kwargs["control_outputs"] == {"any": "astrbot_controlnet_any"}
        run.reset_mock()
        rejected = await call("POST", "studio/queue/command", data={
            "command": "/comfy gen --wf sdxl fixture", "controlnets": supplied,
        })
        assert rejected.status_code == 400
        run.assert_not_called()


async def check_gallery_export(instance, root):
    from astrbot.api.web import PluginRequest, bind_request_context
    from PIL import Image
    from starlette.requests import Request

    result = io.BytesIO()
    Image.new("RGB", (2, 2)).save(result, "PNG")
    pixels = result.getvalue()
    reviews = instance.service.image_reviews
    for state in ("favourite", "pass", "unevaluate"):
        file = reviews.root / state / "NSFW" / "自定义" / "原图.png"
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(pixels)
    source = root / "original.png"
    source.write_bytes(pixels)
    job = "a" * 32
    reviews.remember(job, "test", "test", "SFW", [source], [None])
    reviews.rate(f"{job}:1", "favourite")
    control_archive = instance.studio._control_archive()
    control_files = {}
    for index, state in enumerate(("favourite", "pass", "unevaluated")):
        control = control_archive.record(job, "any", index, pixels, control_type="canny")
        asset_id = control["asset_id"]
        if state != "unevaluated":
            control_archive.rate(asset_id, state)
        control_files[state] = f"{asset_id}.png"

    async def export(kind, state, username="test"):
        route = "studio/images/export"
        incoming = Request({
            "type": "http", "method": "GET", "path": f"/api/{route}", "headers": [],
            "query_string": f"kind={kind}&state={state}".encode(),
        })
        with bind_request_context(PluginRequest(incoming, username=username)):
            return await instance.remote_studio.routes["GET", route]()

    for kind, states in (("images", ("favourite", "pass", "unevaluate")), ("controls", control_files)):
        for state in states:
            response = await export(kind, state)
            assert response.status_code == 200, getattr(response, "body", "")
            payload = b"".join([chunk async for chunk in response.body_iterator])
            assert len(payload) == int(response.headers["content-length"])
            assert response.headers["content-disposition"] == f'attachment; filename="astrbot-{kind}-{state}.zip"'
            expected = {control_files[state]} if kind == "controls" else {"NSFW/自定义/原图.png"}
            if kind == "images" and state == "favourite":
                expected.add(f"SFW/{job}/0001.png")
            with ZipFile(io.BytesIO(payload)) as archive:
                assert set(archive.namelist()) == expected
                assert all(archive.read(name) == pixels for name in expected)
    assert (await export("images", "favourite", username=None)).status_code == 401
    assert (await export("images", "..")).status_code == 400
    assert (await export("invalid", "favourite")).status_code == 400
    workflow = instance.service.resolve("test", "v40").name
    for state in ("favourite", "pass", "unevaluate"):
        manual = reviews.root / state / "NSFW" / "自定义" / "原图.png"
        identity = reviews._manual_item(state, manual.relative_to(reviews.root / state), manual.stat())["id"]
        for mode in ("direct", "preprocess"):
            binding = {"type": "canny", "mode": mode, "gallery": {"id": identity, "state": state}}
            bindings, sources, archive = instance.studio.prepare_controls(workflow, {"any": binding})
            assert bindings["any"]["mode"] == mode
            assert sources["any"]["data"] == pixels and sources["any"]["label"] == "原图.png"
            assert sources["any"]["kind"] == "gallery" and (archive is not None) == (mode == "preprocess")
    binding["gallery"]["state"] = "pass"
    try:
        instance.studio.prepare_controls(workflow, {"any": binding})
    except ValueError:
        pass
    else:
        raise AssertionError("ControlNet accepted an image from a different gallery")
    control_archive.record(job, "lllite", 0, pixels, control_type="depth")
    for control_type in ("canny", "depth"):
        page = control_archive.list("unevaluated", 1, 1, control_type=control_type)
        assert page["total"] == 1 and page["assets"][0]["type"] == control_type
    (reviews.root / "pass" / "NSFW" / "自定义" / "原图.png").unlink()
    assert (await export("images", "pass")).status_code == 400


async def check_controlnet_profiles(instance, root, name):
    from astrbot.api.web import PluginRequest, bind_request_context
    from PIL import Image
    from starlette.requests import Request

    route = "studio/controlnet/profiles"
    query = f"workflow={name}&branch=any".encode()

    async def call(method, data=None, user="test", endpoint=route):
        async def receive():
            return {"type": "http.request", "body": json.dumps(data).encode()}

        incoming = Request({
            "type": "http", "method": method, "path": f"/api/{endpoint}", "headers": [], "query_string": query,
        }, receive)
        with bind_request_context(PluginRequest(incoming, username=user)):
            return await instance.remote_studio.routes[method, endpoint]()

    schemas = {
        "LoadImage": {}, "ControlNetApplyAdvanced": {}, "PreviewImage": {},
        "ControlNetLoader": {
            "input": {"required": {"control_net_name": [["test\\tile.safetensors", "test\\tile-alt.safetensors"]]}},
        },
        "AIO_Preprocessor": {"input": {"optional": {"preprocessor": [["none", "TilePreprocessor"]]}}},
    }
    with patch.object(instance.service.client, "node_schemas", return_value=schemas):
        assert (await call("GET", user=None)).status_code == 401
        initial = json.loads((await call("GET")).body)
        assert initial["models"] == ["test/tile.safetensors", "test/tile-alt.safetensors"]
        assert initial["preprocessors"] == ["TilePreprocessor"] and not initial["profiles"]
        row = {
            "label": "Tile", "type": "tile", "model": "test/tile.safetensors", "preprocessor": "TilePreprocessor",
            "resolution": 768, "strength": 1.25, "start_percent": 0, "end_percent": 0.55,
        }
        filtered = {"workflow": name, "branch": "any", "profile": row, "revision": initial["revision"]}
        bad = await call("POST", {**filtered, "profile": {**row, "model": "missing.safetensors"}})
        assert bad.status_code == 400
        created = await call("POST", filtered)
        assert created.status_code == 200, created.body
        first = json.loads(created.body)
        assert (await call("POST", filtered)).status_code == 409
        request = {**filtered, "profile": {
            **row, "label": "Tile Direct", "preprocessor": "", "model": "test/tile-alt.safetensors",
        }, "revision": first["revision"]}
        second = json.loads((await call("POST", request)).body)
        assert second["capabilities"]["any"]["types"] == ["tile"]
        path = instance.studio.controlnet_profiles_path
        assert path.is_relative_to(root) and len(json.loads(path.read_bytes())["profiles"]) == 2
        png = io.BytesIO()
        Image.new("RGB", (2, 2)).save(png, "PNG")
        binding = {"type": "tile", "mode": "direct", "image": base64.b64encode(png.getvalue()).decode()}
        resolved, _, _ = instance.studio.prepare_controls(name, {"any": binding})
        assert resolved["any"]["profile"]["id"] == first["id"]
        with patch.object(instance.service, "_run") as run:
            queued = await call("POST", {
                "workflow": name, "positive": "fixture",
                "controlnets": {"any": {**binding, "profile": first["id"], "mode": "preprocess"}},
            }, endpoint="studio/queue")
            assert queued.status_code == 200, queued.body
            graph = run.call_args.args[1]
            assert graph["178"]["inputs"]["control_net_name"] == "test\\tile.safetensors"
            assert graph["165"]["inputs"]["strength"] == 1.25
            assert graph["172"]["inputs"]["resolution"] == 768
            assert run.call_args.kwargs["control_outputs"] == {"any": "astrbot_controlnet_any"}
        binding["profile"] = second["id"]
        resolved, _, _ = instance.studio.prepare_controls(name, {"any": binding})
        assert resolved["any"]["profile"]["model"] == "test/tile-alt.safetensors"
        try:
            instance.studio.prepare_controls(name, {"any": {**binding, "mode": "preprocess"}})
        except ValueError:
            pass
        else:
            raise AssertionError("A direct-only ControlNet profile accepted preprocess")
        for saved in (second, first):
            removed = await call("POST", {
                **filtered, "id": saved["id"], "profile": None, "revision": second["revision"],
            })
            assert removed.status_code == 200, removed.body
            second = json.loads(removed.body)
        assert second["capabilities"]["any"]["types"] == ["canny", "depth"]


async def check(root, archive, core):
    os.environ["ASTRBOT_ROOT"] = str(root)
    plugins = root / "data" / "plugins"
    with ZipFile(archive) as bundle:
        assert bundle.testzip() is None
        bundle.extractall(plugins)
    sys.path[:0] = [str(root), str(core)]
    module = importlib.import_module(f"data.plugins.{PLUGIN}.main")
    plugin = plugins / PLUGIN
    assert Path(module.__file__).is_relative_to(plugin)
    from astrbot.dashboard.services.plugin_page_service import PluginPageService

    page_service = PluginPageService(SimpleNamespace(plugin_store_path=plugins))
    pages = await page_service.discover_plugin_pages(SimpleNamespace(root_dir_name=PLUGIN, reserved=False))
    assert [page.name for page in pages] == ["workbench"]
    remote_studio = importlib.import_module(f"data.plugins.{PLUGIN}.bridge.studio.remote_studio")
    assert remote_studio.VIEW == plugin / "views" / "workbench"
    assert all((remote_studio.VIEW / asset).is_file() for asset in remote_studio.ASSETS)
    schema = json.loads((plugin / "_conf_schema.json").read_text(encoding="utf-8"))
    config = module.AstrBotConfig(config_path=str(root / "plugin-config.json"), schema=schema)
    for key, value in {"anima_workspace": str(root), "remote_studio_enabled": False}.items():
        config[key] = value
        for group, section in schema.items():
            if section["type"] == "object" and key in section["items"]:
                config[group][key] = value
    context = PluginContext()
    instance = module.ComfyUIBridge(context, config)
    try:
        await instance.initialize()
        service = instance.service
        assert service.data_dir.is_relative_to(root)
        assert not service.errors, service.errors
        assert len(service.workflows) == len(list((plugin / "workflows").glob("*.json")))
        assert ("GET", f"/{PLUGIN}/studio/images") in context.routes
        assert ("GET", "studio/images") in instance.remote_studio.routes
        assert ("POST", f"/{PLUGIN}/studio/input/pick") in context.routes
        assert ("POST", "studio/input/pick") in instance.remote_studio.routes
        await check_input_picker(instance, root)
        assert ("GET", f"/{PLUGIN}/studio/queue/loras") in context.routes
        await check_queue_loras(instance, root, module.ADVANCED_V40_WORKFLOW)
        assert ("GET", f"/{PLUGIN}/studio/images/export") in context.routes
        await check_gallery_export(instance, root)
        assert ("GET", f"/{PLUGIN}/studio/controlnet/profiles") in context.routes
        assert ("POST", f"/{PLUGIN}/studio/controlnet/profiles") in context.routes
        await check_controlnet_profiles(instance, root, module.ADVANCED_V40_WORKFLOW)
        print(f"Loaded {len(service.workflows)} workflows and {len(context.routes)} web routes.")
    finally:
        await instance.terminate()


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--astrbot-core", required=True, type=Path)
    parser.add_argument("--archive", required=True, type=Path)
    args = parser.parse_args()
    with TemporaryDirectory(prefix="astrbot-comfy-bridge-") as directory:
        asyncio.run(check(Path(directory).resolve(), args.archive.resolve(), args.astrbot_core.resolve()))
