"""Load an installation ZIP under a temporary AstrBot data root."""

import asyncio
import base64
import importlib
import io
import json
import os
import sys
from argparse import ArgumentParser
from itertools import product
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


async def check_queue_details_auth(instance):
    from astrbot.api.web import PluginRequest, bind_request_context
    from starlette.requests import Request

    async def get(identity, username):
        incoming = Request({"type": "http", "method": "GET", "path": "/studio/queue/details", "headers": [],
                            "query_string": f"id={identity}".encode()})
        with bind_request_context(PluginRequest(incoming, username=username)):
            return await instance.studio.queue_details()
    assert (await get("0" * 32, None)).status_code == 401
    assert (await get("../other", "test")).status_code == 400
    assert (await get("0" * 32, "test")).status_code == 404


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
        with bind_request_context(PluginRequest(request, username="test", plugin_name=PLUGIN)):
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
    ), patch.object(studio.lora_families["illustrious"], "task_catalog", return_value=entries), patch.object(service, "_run") as run:
        catalog = await call("GET", "studio/queue/loras", f"workflow={name}".encode())
        assert catalog.status_code == 200, catalog.body
        assert [row["id"] for row in json.loads(catalog.body)["entries"]] == list(entries)
        stacked = [{"id": "alpha", "strength": 0.4}, {"id": "style", "strength": -0.25}]
        response = await call("POST", "studio/queue", data={"workflow": name, "positive": "fixture", "loras": stacked})
        assert response.status_code == 200, response.body
        assert len(json.loads(response.body)["jobs"]) == 1
        identity = json.loads(response.body)["jobs"][0]["id"]
        details = await call("GET", "studio/queue/details", f"id={identity}".encode())
        assert details.status_code == 200, details.body
        config = json.loads(details.body)["configuration"]
        strengths = {(row["model"], row["clip"]) for rows in config["loras"].values() for row in rows}
        assert strengths == {(0.4, 0.4), (-0.25, -0.25)}, strengths
        assert any(row["text"] == "fixture" for row in config["positive"])
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


async def check(root, archive, core, *, anima_workspace=None, anima_schemas=None):
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
        assert ("POST", "studio/input/pick") not in instance.remote_studio.routes
        await check_input_picker(instance, root)
        await check_queue_details_auth(instance)
        assert ("GET", f"/{PLUGIN}/studio/queue/loras") in context.routes
        await check_queue_loras(instance, root, module.ADVANCED_V40_WORKFLOW)
        assert ("GET", f"/{PLUGIN}/studio/images/export") in context.routes
        await check_gallery_export(instance, root)
        assert ("GET", f"/{PLUGIN}/studio/controlnet/profiles") in context.routes
        assert ("POST", f"/{PLUGIN}/studio/controlnet/profiles") in context.routes
        await check_controlnet_profiles(instance, root, module.ADVANCED_V40_WORKFLOW)
        await check_h3_media(instance, root)
        await check_detailer_features(instance)
        await check_anima_detailer(instance)
        if anima_workspace and anima_schemas:
            await check_anima_features(instance, anima_workspace, anima_schemas)
        assert (plugin / "user docs" / "MINIMAX_H3_SEED_HUNTER.md").is_file()
        with patch.object(service, "_run") as run:
            result = await instance.run_remote_command("/comfy gen --wf h3 --seed 1000 A fox --raw", "", None)
            assert result["queued"]
            assert run.call_args.args[2] == ["15", "35", "55"]
            assert run.call_args.args[1]["16"]["inputs"]["value"] == 1000
            response = await instance.run_remote_command("/comfy gen --wf h3-final --seed 2000 A fox --raw", "", None)
            assert response["queued"] and run.call_args.args[2] == ["67"]
            assert run.call_args.args[1]["16"]["inputs"]["value"] == 2000
            response = await instance.run_remote_command("/comfy gen --wf h3-v3 --seed 3000 A fox --raw", "", None)
            assert response["queued"] and run.call_args.args[2] == ["18", "134", "144"]
            graph = run.call_args.args[1]
            assert graph["16"]["inputs"]["seed"] == 3000
            assert graph["365"]["inputs"]["prompt"] == "A fox"
        print(f"Loaded {len(service.workflows)} workflows and {len(context.routes)} web routes.")
    finally:
        await instance.terminate()


async def check_h3_media(instance, root):
    from astrbot.api.web import PluginRequest, bind_request_context
    from starlette.requests import Request

    async def call(route, payload=None, method="POST", username="test"):
        async def receive():
            return {"type": "http.request", "body": json.dumps(payload).encode()}
        incoming = Request({
            "type": "http", "method": method, "path": "/api/" + route,
            "headers": [(b"authorization", b"Bearer test-session")], "query_string": b"",
        }, receive)
        with bind_request_context(PluginRequest(incoming, username=username)):
            return await instance.remote_studio.routes[(method, route)]()

    service = instance.service
    source = service.workflows["MiniMax_H3_Seed_Hunter_V3_AstrBot"].graph["416"]["inputs"]["media_state"]
    response = await call("studio/regional/presets", method="GET")
    assert response.status_code == 200, response.body
    preset_catalog = json.loads(response.body)
    regional = {"base_strength": 1, "regions": [{"text": text, "strength": 1} for text in ("Red fox", "Green tree", "Blue bird")]}
    response = await call("studio/regional/presets", {"name": "RGB subjects", "preset": regional, "revision": preset_catalog["revision"]})
    assert response.status_code == 200 and json.loads(response.body)["presets"]["RGB subjects"] == regional, response.body
    response = await call("studio/regional/presets", {"name": "RGB subjects", "preset": None, "revision": preset_catalog["revision"]})
    assert response.status_code == 409
    assert (await call("studio/regional/presets", method="GET", username=None)).status_code == 401
    preset_path = service.data_dir / "regional_prompt_presets.json"
    saved_presets = preset_path.read_bytes()
    invalid_presets = json.dumps({"version": 1, "presets": {"": regional}}).encode()
    preset_path.write_bytes(invalid_presets)
    assert (await call("studio/regional/presets", method="GET")).status_code == 400
    assert preset_path.read_bytes() == invalid_presets
    preset_path.write_bytes(saved_presets)
    from PIL import Image

    rgb = io.BytesIO()
    Image.new("RGB", (12, 8), "white").save(rgb, "PNG")
    regional = {**regional, "mask": base64.b64encode(rgb.getvalue()).decode()}
    with patch.object(service, "_run") as regional_run:
        for pre, post, second in ((False, False, False), (True, False, False), (False, True, False), (False, False, True), (True, True, True)):
            sampling = {"hires_pre": pre, "hires_post": post, "second_sampler": second}
            response = await call("studio/queue", {"workflow": "Advanced_Gemma_V40_AstrBot", "positive": "Scene", "sampling": sampling})
            assert response.status_code == 200, response.body
            graph = regional_run.call_args.args[1]
            assert ("109" in graph) == pre and ("110" in graph) == post and ("81" in graph) == second
        response = await call("studio/queue/command", {"command": "/comfy gen --wf v40 Scene --raw", "sampling": sampling})
        assert response.status_code == 200 and "81" in regional_run.call_args.args[1], response.body
        for pre, post in ((False, False), (True, False), (False, True), (True, True)):
            response = await call("studio/queue", {"workflow": "Advanced_Gemma_V40_AstrBot", "positive": "Scene", "upscale": {"pre": pre, "post": post}})
            assert response.status_code == 200, response.body
            graph = regional_run.call_args.args[1]
            assert ("126" in graph) == pre and ("130" in graph) == post
        response = await call("studio/queue/command", {"command": "/comfy gen --wf v40 Scene --raw", "upscale": {"pre": True, "post": True}})
        assert response.status_code == 200 and "130" in regional_run.call_args.args[1], response.body
        for route, data in (
            ("studio/queue", {"workflow": "Advanced_Gemma_V40_AstrBot", "positive": "Three subjects", "count": 2}),
            ("studio/queue/command", {"command": "/comfy gen --wf v40 --seed 42 Three subjects --raw", "account": ""}),
        ):
            response = await call(route, {**data, "regional": regional})
            assert response.status_code == 200, response.body
            assert "51" in regional_run.call_args.args[1]
            assert regional_run.call_args.args[1]["5"]["inputs"]["populated_text"] == "Green tree"
            assert set(regional_run.call_args.kwargs["input_images"]) == {"1", "2", "3"}
        response = await call("studio/queue", {"workflow": "Advanced_Gemma_V40_AstrBot", "positive": "No regions", "regional": None})
        assert response.status_code == 200 and "51" not in regional_run.call_args.args[1], response.body
        before = regional_run.call_count
        response = await call("studio/queue", {"workflow": "SDXL_Turbo_T2I_AstrBot", "positive": "Test", "regional": regional})
        assert response.status_code == 400 and regional_run.call_count == before
    family = type(instance.studio.lora_families["illustrious"])(
        SimpleNamespace(config={"anima_workspace": str(root / "fast-lora")}, data_dir=root), "illustrious", "Test")
    model = family.workspace / "models/loras/illustrious/C/test.safetensors"
    model.parent.mkdir(parents=True)
    header = json.dumps({"__metadata__": {"modelspec.architecture": "sdxl"}, "lora_up.weight": {}}).encode()
    model.write_bytes(len(header).to_bytes(8, "little") + header + b"weights")
    with patch.object(family, "_lora_sha256", side_effect=AssertionError("task list must not hash weights")):
        fast = family.task_catalog()
    full = family.lora_catalog()
    assert [(x["id"], x["number"], x["default_strength"]) for x in fast.values()] == [
        (x["id"], x["number"], x["default_strength"]) for x in full.values()]
    from PIL import Image

    png = io.BytesIO()
    Image.new("RGB", (2, 2)).save(png, "PNG")
    archive = instance.studio._control_archive()
    asset = archive.record("d" * 32, "openpose", 1, png.getvalue(), control_type="openpose")
    response = await call("studio/control-assets", {"id": asset["asset_id"], "name": "Renamed pose"})
    assert response.status_code == 200 and json.loads(response.body)["asset"]["name"] == "Renamed pose.png", response.body
    response = await call("studio/control-assets", {"id": asset["asset_id"], "delete": True}, username=None)
    assert response.status_code == 401
    response = await call("studio/control-assets", {"id": asset["asset_id"], "delete": True})
    assert response.status_code == 200, response.body
    response = await call("studio", method="GET")
    descriptions = json.loads(response.body)["workflows"]
    for row in descriptions:
        workflow = service.workflows[row["name"]]
        inputs = row["task_inputs"]
        assert inputs["positive"] == bool(workflow.positive)
        assert inputs["negative"] == bool(workflow.negative)
        if inputs["reference"]:
            assert workflow.image_inputs or workflow.name == "Anima_I2I_AIO_AstrBot" or (
                workflow.name.startswith("MiniMax_H3") and "5" in workflow.active)
        print("Task inputs:", row["name"], json.dumps(inputs, ensure_ascii=False))
    template_route = "studio/h3/prompt-templates"
    assert (await call(template_route, method="GET", username=None)).status_code == 401
    assert (await call(template_route, {}, username=None)).status_code == 401
    response = await call(template_route, method="GET")
    assert response.status_code == 200, response.body
    catalog = json.loads(response.body)
    assert catalog["templates"] == {}
    template = {"prompt": '  summary:\n<Picture 1> says "--seed 42"\n', "mode": "ref2va"}
    payload = {"name": " 多图模板 ", "template": template, "revision": catalog["revision"]}
    response = await call(template_route, payload)
    assert response.status_code == 200, response.body
    saved = json.loads(response.body)
    assert saved["templates"] == {"多图模板": template}
    assert json.loads((service.data_dir / "h3_prompt_templates.json").read_text("utf-8"))["templates"] == saved["templates"]
    response = await call(template_route, method="GET")
    assert json.loads(response.body) == saved
    incoming = {"version": 1, "templates": {"多图模板": {"prompt": "Changed", "mode": "auto"}, "导入模板": template},
                "replace": False, "revision": saved["revision"]}
    response = await call(template_route, incoming)
    assert response.status_code == 200, response.body
    merged = json.loads(response.body)
    assert merged["imported"] == 1 and merged["skipped"] == 1 and merged["templates"]["多图模板"] == template
    response = await call(template_route, {**incoming, "replace": True, "revision": merged["revision"]})
    merged = json.loads(response.body)
    assert merged["imported"] == 2 and merged["templates"]["多图模板"]["prompt"] == "Changed"
    corrupt_import = {**incoming, "templates": {"有效": template, "无效": {"prompt": ""}}, "revision": merged["revision"]}
    response = await call(template_route, corrupt_import)
    assert response.status_code == 400
    assert json.loads((await call(template_route, method="GET")).body)["templates"] == merged["templates"]
    response = await call(template_route, {"name": "导入模板", "template": None, "revision": merged["revision"]})
    saved = json.loads(response.body)
    response = await call(template_route, {**payload, "revision": saved["revision"]})
    saved = json.loads(response.body)
    response = await call(template_route, {**payload, "template": None})
    assert response.status_code == 409
    for invalid in ({**template, "prompt": " "}, {**template, "prompt": "x" * 8001}, {**template, "mode": []}):
        response = await call(template_route, {**payload, "template": invalid, "revision": saved["revision"]})
        assert response.status_code == 400, response.body
    response = await call(template_route, {**payload, "name": "bad\nname", "revision": saved["revision"]})
    assert response.status_code == 400
    updated = {"prompt": "summary:\nUpdated", "mode": "auto"}
    response = await call(template_route, {**payload, "template": updated, "revision": saved["revision"]})
    assert response.status_code == 200, response.body
    saved = json.loads(response.body)
    assert saved["templates"] == {"多图模板": updated}
    response = await call(template_route, {"name": "多图模板", "template": None, "revision": saved["revision"]})
    assert response.status_code == 200 and json.loads(response.body)["templates"] == {}
    path = service.data_dir / "h3_prompt_templates.json"
    original = path.read_bytes()
    damaged = b'{"version": 1, "templates": {"broken": {}}}'
    path.write_bytes(damaged)
    assert (await call(template_route, method="GET")).status_code == 400
    assert (await call(template_route, payload)).status_code == 400
    assert path.read_bytes() == damaged
    path.write_bytes(original)
    response = await call("studio/h3/media", method="GET")
    assert response.status_code == 200 and json.loads(response.body)["available"]
    items = [{"kind": "picture", "file": "minimax_h3/portrait.png [input]", "mirror": True, "rotate": 90},
             {"kind": "video", "file": "minimax_h3/clip.mp4 [input]", "trim": {"start": 1, "end": 4},
              "has_audio": True, "audio_mode": "paired"}]
    with patch.object(service, "_run") as run:
        for invalid in ({"negative": "unsupported"}, {"preset": "1"}, {"reference_id": "not-an-image"}):
            response = await call("studio/queue", {"workflow": "MiniMax_H3_Seed_Hunter_V3_AstrBot", "positive": "A fox", **invalid})
            assert response.status_code == 400 and run.call_count == 0, response.body
        for route, payload in (
            ("studio/queue", {"workflow": "MiniMax_H3_Seed_Hunter_V3_AstrBot", "positive": "A fox", "count": 1}),
            ("studio/queue/command", {"command": "/comfy gen --wf h3-v3 --seed 42 A fox --raw", "account": ""}),
        ):
            response = await call(route, {**payload, "h3_media": items})
            assert response.status_code == 200, response.body
            assert json.loads(run.call_args.args[1]["416"]["inputs"]["media_state"]) == items
        rich_prompt = 'summary:\n<Picture 1> says <d>[English] "Look --seed 999"</d>\n\noverall_soundscape:\nWind.'
        response = await call("studio/queue/command", {
            "command": "/comfy gen --wf h3-v3 --seed 42 --raw", "account": "",
            "h3_media": items, "h3_prompt": rich_prompt,
        })
        assert response.status_code == 200, response.body
        graph = run.call_args.args[1]
        assert graph["365"]["inputs"]["prompt"] == rich_prompt
        assert graph["16"]["inputs"]["seed"] == 42
        response = await call("studio/queue/command/workflow", {
            "command": "/comfy gen --wf h3-v3 Literal words --raw", "has_reference": False,
        })
        assert json.loads(response.body)["positive"] == "Literal words"
        before = run.call_count
        response = await call("studio/queue/command", {
            "command": "/comfy gen --wf sdxl --raw", "account": "", "h3_prompt": rich_prompt,
        })
        assert response.status_code == 400 and run.call_count == before
        from PIL import Image

        buffer = io.BytesIO()
        Image.new("RGB", (2, 2)).save(buffer, "PNG")
        encoded = base64.b64encode(buffer.getvalue()).decode()
        for name in ("WAN22_I2V_AstrBot", "WAN22_SVI_I2V_AstrBot", "WAN22_Lightning_Long_I2V_AstrBot", "Anima_I2I_AIO_AstrBot"):
            response = await call("studio/queue/command/workflow", {
                "command": f'/comfy gen --wf "{name}" --raw', "has_reference": False,
            })
            resolved = json.loads(response.body)
            assert resolved["workflow"] == name and resolved["task_inputs"]["reference"], response.body
            response = await call("studio/queue", {"workflow": name, "positive": "A fox", "image": encoded, "count": 1})
            assert response.status_code == 200, (name, response.body)
            args = run.call_args.args
            assert args[3] == buffer.getvalue() and args[4], name
        with patch.object(instance.studio, "get_preset", return_value={
            "id": "test", "name": "Preset", "positive": "A fox", "negative": "Avoid blur",
        }):
            response = await call("studio/queue", {
                "workflow": "MiniMax_H3_Seed_Final_AstrBot", "preset": "1", "preset_account": "test", "count": 1,
            })
            assert response.status_code == 200, response.body
    assert service.workflows["MiniMax_H3_Seed_Hunter_V3_AstrBot"].graph["416"]["inputs"]["media_state"] == source
    calls = []

    async def native(method, path, **kwargs):
        calls.append((method, path, kwargs))
        if path == "/minimax_h3/token":
            return {"token": "native-private-token"}
        if path == "/view":
            kwargs["output_path"].write_bytes(b"preview")
            return kwargs["output_path"]
        if path == "/minimax_h3/upload":
            assert kwargs["headers"] == {"X-MiniMaxH3-Token": "native-private-token"}
            assert kwargs["form"].is_multipart
            return {"file": "minimax_h3/picture.png [input]", "kind": "picture", "name": "picture.png"}
        return {"presets": []}

    with patch.object(service.client, "request", side_effect=native):
        response = await call("studio/h3/media/rpc", {
            "method": "POST", "path": "/minimax_h3/presets/save", "body": {"name": "fixture", "items": items},
        })
        assert response.status_code == 200, response.body
        assert calls[-1][2]["headers"] == {"X-MiniMaxH3-Token": "native-private-token"}
        assert b"native-private-token" not in response.body
        response = await call("studio/h3/media/preview", {"file": items[0]["file"]})
        assert response.status_code == 200, response.body
        url = json.loads(response.body)["src"]
        assert url.startswith("/h3-media/")
        preview, owner, mime = instance.studio.h3_media.remote_file(url.rsplit("/", 1)[-1])
        assert preview.is_relative_to(root) and preview.read_bytes() == b"preview"
        assert owner == "Bearer test-session" and mime == "image/png"
        before = len(calls)
        assert (await call("studio/h3/media/preview", {"file": items[0]["file"]})).status_code == 200
        assert len(calls) == before
        response = await call("studio/h3/media/rpc", {"method": "POST", "path": "/interrupt", "body": {}})
        assert response.status_code == 400 and len(calls) == before
        upload_body = (
            b'--fixture\r\nContent-Disposition: form-data; name="file"; filename="picture.png"\r\n'
            b'Content-Type: image/png\r\n\r\nimage-fixture\r\n--fixture--\r\n'
        )

        async def receive_upload():
            return {"type": "http.request", "body": upload_body}

        upload = Request({
            "type": "http", "method": "POST", "path": "/api/studio/h3/media/upload",
            "headers": [(b"content-type", b"multipart/form-data; boundary=fixture")], "query_string": b"",
        }, receive_upload)
        try:
            with bind_request_context(PluginRequest(upload, username="test")):
                response = await instance.studio.h3_media.upload()
                assert response.status_code == 200, response.body
                assert json.loads(response.body)["kind"] == "picture"
        finally:
            await upload.close()


async def check_anima_detailer(instance):
    from astrbot.api.web import PluginRequest, bind_request_context
    from PIL import Image
    from starlette.requests import Request

    async def call(route, payload=None, *, method="POST", query=b""):
        async def receive():
            return {"type": "http.request", "body": json.dumps(payload).encode()}
        incoming = Request({"type": "http", "method": method, "path": "/api/" + route,
                            "headers": [], "query_string": query}, receive)
        with bind_request_context(PluginRequest(incoming, username="anima-detailer-check")):
            return await instance.remote_studio.routes[method, route]()

    name = "Anima_Detailer_AstrBot"
    service, studio = instance.service, instance.studio
    assert service.resolve("test", "anima-detailer").name == name
    assert service.resolve("test", "animadetailer").name == name
    assert service.workflows[name].sweep_lora_family == "anima"
    path = service.workflow_dir / (name + ".json")
    defaults = path.read_bytes()
    family = studio.anima
    (family.workspace / "models/loras/anima").mkdir(parents=True, exist_ok=True)
    catalog = {key: {"id": key, "title": key, "filename": f"anima/{key}.safetensors", "tag": key,
                     "category": "C", "number": f"C{index}", "default_strength": 0.7}
               for index, key in enumerate(("alpha", "beta"), 1)}
    schemas = {"ModelPatchLoader": {"input": {"required": {"name": [["anima-lllite-inpainting-v2.safetensors"]]}}},
               "LoraLoader": {"input": {"required": {"lora_name": [[row["filename"] for row in catalog.values()]]}}}}
    pixels, painted = io.BytesIO(), io.BytesIO()
    Image.new("RGB", (16, 12), "white").save(pixels, "PNG")
    Image.new("RGBA", (16, 12), (255, 255, 255, 200)).save(painted, "PNG")
    images = {"image": base64.b64encode(pixels.getvalue()).decode(), "mask": base64.b64encode(painted.getvalue()).decode()}
    keys = ("hires_pre", "hires_post", "inoutpaint", "mask", "upscale")
    with patch.object(service, "_run") as run, patch.object(service.client, "node_schemas", return_value=schemas) as node_schemas, patch.object(
        service.client, "request", return_value=schemas
    ), patch.object(family, "lora_catalog", return_value=catalog):
        response = await call("studio/workflow", method="GET", query=f"name={name}".encode())
        assert response.status_code == 200, response.body
        description = json.loads(response.body)
        assert len(description["branches"]) == 32
        assert any(row["node"] == "103" and row["kind"] == "select" for row in description["fields"])
        assert description["requires_image"]
        for flags in product([False, True], repeat=5):
            choices = dict(zip(keys, flags, strict=True))
            response = await call("studio/queue", {"workflow": name, "positive": "Scene", "anima_detailer": choices, **images})
            assert response.status_code == 200, response.body
            graph = run.call_args.args[1]
            for node, enabled in zip(("79", "80", "87", "36", "48"), flags, strict=True):
                assert (node in graph) == enabled, (node, choices)
            assert run.call_args.args[2] == ["15"]
        response = await call("studio/queue/command", {
            "command": "/comfy gen --wf anima-detailer --face off --lora C1:0.4 Scene --raw", **images,
        })
        assert response.status_code == 200, response.body
        assert "45" not in run.call_args.args[1]
        assert "astrbot_anima_detailer_lora_1" in run.call_args.args[1]
        response = await call("studio/queue", {"workflow": name, "positive": "Scene", **images,
                                              "loras": [{"id": "alpha"}, {"id": "beta"}]})
        assert response.status_code == 200 and "astrbot_anima_detailer_lora_2" in run.call_args.args[1], response.body
        response = await call("studio/queue", {"workflow": name, "positive": "Scene", "lora_sweep": True, **images})
        assert response.status_code == 200 and len(json.loads(response.body)["jobs"]) == 2, response.body
        pending_key = ("studio:anima-detailer-check", name)
        family.pending_loras[pending_key] = [{"id": "alpha", "strength": 0.5}]
        response = await call("studio/queue", {"workflow": name, "positive": "Scene", **images})
        assert response.status_code == 200 and pending_key not in family.pending_loras, response.body
        assert "astrbot_anima_detailer_lora_1" in run.call_args.args[1]
        response = await call("studio/queue/command", {"command": "/comfy sweep lora --wf anima-detailer Scene --raw", **images})
        assert response.status_code == 200, response.body
        before = run.call_count
        node_schemas.return_value = {"ModelPatchLoader": {"input": {"required": {"name": [["other.safetensors"]]}}}}
        response = await call("studio/queue", {"workflow": name, "positive": "Scene", **images,
                                              "anima_detailer": {**dict.fromkeys(keys, False), "inoutpaint": True}})
        assert response.status_code == 400 and b"103" in response.body and run.call_count == before
        response = await call("studio/queue", {"workflow": name, "positive": "Scene", "anima_detailer": {}})
        assert response.status_code == 400 and run.call_count == before
        response = await call("studio/queue", {"workflow": name, "positive": "Scene"})
        assert response.status_code == 400 and run.call_count == before
    assert defaults == path.read_bytes()
    print("PASS: Anima Detailer 32 combinations, parameter panel, command, LoRA stack/sweep/reservation, masks and missing model")


async def check_detailer_features(instance):
    from astrbot.api.web import PluginRequest, bind_request_context
    from PIL import Image
    from starlette.requests import Request

    async def call(route, payload):
        async def receive():
            return {"type": "http.request", "body": json.dumps(payload).encode()}
        incoming = Request({"type": "http", "method": "POST", "path": "/api/" + route,
                            "headers": [], "query_string": b""}, receive)
        with bind_request_context(PluginRequest(incoming, username="detailer-check")):
            return await instance.remote_studio.routes["POST", route]()

    studio, service = instance.studio, instance.service
    name = "Detailer_V40_AstrBot"
    path = service.workflow_dir / (name + ".json")
    defaults = path.read_bytes()
    keys = ("hires", "inpaint", "outpaint", "mask", "upscale")
    image, mask = io.BytesIO(), io.BytesIO()
    Image.new("RGB", (16, 12), "white").save(image, "PNG")
    Image.new("RGBA", (16, 12), (255, 255, 255, 180)).save(mask, "PNG")
    images = {"image": base64.b64encode(image.getvalue()).decode(), "mask": base64.b64encode(mask.getvalue()).decode()}
    loader_schema = {"ControlNetLoader": {"input": {"required": {"control_net_name": [["noobaiInpainting_v10.safetensors"]]}}}}
    with patch.object(service, "_run") as run, patch.object(service.client, "node_schemas", return_value=loader_schema) as schemas:
        for flags in product([False, True], repeat=5):
            choices = dict(zip(keys, flags, strict=True))
            response = await call("studio/queue", {"workflow": name, "positive": "Scene", "detailer": choices, **images})
            assert response.status_code == 200, response.body
            graph = run.call_args.args[1]
            for node, enabled in zip(("7", "77", "96", "37", "33"), flags, strict=True):
                assert (node in graph) == enabled, (node, choices)
            with Image.open(io.BytesIO(run.call_args.args[3])) as uploaded:
                assert uploaded.getchannel("A").getpixel((0, 0)) == 75
        for enabled in (False, True):
            response = await call("studio/queue/command", {
                "command": "/comfy gen --wf detailer Scene --raw", "detailer": dict.fromkeys(keys, enabled), **images,
            })
            assert response.status_code == 200, response.body
            graph = run.call_args.args[1]
            assert all((node in graph) == enabled for node in ("7", "77", "96", "37", "33"))
        before = run.call_count
        for value in (None, {}, {**dict.fromkeys(keys, False), "hires": 1}):
            for route, data in (("studio/queue", {"workflow": name, "positive": "Scene"}),
                                ("studio/queue/command", {"command": "/comfy gen --wf detailer Scene --raw"})):
                response = await call(route, {**data, **images, "detailer": value})
                assert response.status_code == 400 and run.call_count == before, response.body
        response = await call("studio/queue", {"workflow": "SDXL_Turbo_T2I_AstrBot", "positive": "Scene", "detailer": dict.fromkeys(keys, False)})
        assert response.status_code == 400 and run.call_count == before
        schemas.return_value = {"ControlNetLoader": {"input": {"required": {"control_net_name": [["installed.safetensors"]]}}}}
        for key, node in (("inpaint", "35"), ("outpaint", "36")):
            response = await call("studio/queue", {"workflow": name, "positive": "Scene", **images,
                                                   "detailer": {**dict.fromkeys(keys, False), key: True}})
            assert response.status_code == 400 and run.call_count == before and node.encode() in response.body, response.body
        schemas.return_value = loader_schema
        saved = service.workflows[name]
        modified = json.loads(defaults)
        for branch in ("15", "27", "28", "mask", "30", "face"):
            modified["astrbot"]["v40"]["branches"][branch]["enabled"] = False
        store = importlib.import_module(f"data.plugins.{PLUGIN}.bridge.workflows.workflow_store")
        try:
            path.write_text(json.dumps(modified), encoding="utf-8")
            service.workflows[name] = store.workflow_from_profile(name, modified)
            inputs = studio.task_inputs(service.workflows[name])
            assert inputs["positive"] and inputs["negative"] and inputs["mask"]
            response = await call("studio/queue", {"workflow": name, "positive": "Scene", "detailer": dict.fromkeys(keys, True), **images})
            assert response.status_code == 200 and "77" in run.call_args.args[1], response.body
        finally:
            path.write_bytes(defaults)
            service.workflows[name] = saved
    assert defaults == path.read_bytes()
    print("PASS: Detailer 32 combinations, commands, masks, invalid options and dormant input capabilities")


async def check_anima_features(instance, workspace, schemas_path):
    """Use local node schemas and the installed converter; never submit a ComfyUI prompt."""
    from astrbot.api.web import PluginRequest, bind_request_context
    from PIL import Image
    from starlette.requests import Request

    async def call(route, payload):
        async def receive():
            return {"type": "http.request", "body": json.dumps(payload).encode()}
        incoming = Request({"type": "http", "method": "POST", "path": "/api/" + route,
                            "headers": [], "query_string": b""}, receive)
        with bind_request_context(PluginRequest(incoming, username="anima-check")):
            return await instance.remote_studio.routes["POST", route]()

    studio, service = instance.studio, instance.service
    schemas = json.loads(schemas_path.read_bytes())
    files = schemas["LoraLoaderModelOnly"]["input"]["required"]["lora_name"][0]
    filenames = [name for name in files if name.replace("\\", "/").startswith("anima/")][:2]
    assert len(filenames) == 2, "Choose two installed Anima LoRAs for the integration check"
    catalog = {key: {"id": key, "title": key, "number": f"C{index}", "category": "C", "tag": "",
                     "filename": name.replace("\\", "/"), "default_strength": 0.7}
               for index, (key, name) in enumerate(zip(("alpha", "beta"), filenames, strict=True), 1)}
    rgb = io.BytesIO()
    Image.new("RGB", (12, 8), "white").save(rgb, "PNG")
    feature_data = {
        "regional": {"mask": base64.b64encode(rgb.getvalue()).decode(), "base_strength": 0.7,
                     "regions": [{"text": text, "strength": 1} for text in ("Red fox", "Green tree", "Blue bird")]},
        "sampling": {"hires_pre": True, "hires_post": True, "second_sampler": True}, "anima_upscale": True,
    }
    defaults = studio.anima.path.read_bytes()
    with patch.object(studio.anima, "workspace", workspace), patch.object(service.client, "request", return_value=schemas), patch.object(
        studio.anima, "lora_catalog", return_value=catalog
    ), patch.object(service, "_run") as run:
        base = service.workflows["Anima_T2I_AstrBot"]
        for pre, post, second, ultimate, regional in product([False, True], repeat=5):
            workflow = await studio.anima.for_generation(base, {
                "sampling": {"hires_pre": pre, "hires_post": post, "second_sampler": second},
                "anima_upscale": ultimate, "regional": feature_data["regional"] if regional else None, "loras": [],
            }, False, {})
            for node, enabled in (("93", pre), ("94", post), ("51", second), ("91", ultimate), ("20", regional)):
                assert (node in workflow.active) == enabled, (node, enabled)
            assert set(workflow.input_images) == ({"0", "1", "2"} if regional else set())
            for key, row in workflow.graph.items():
                for value in row["inputs"].values():
                    if isinstance(value, list) and len(value) == 2 and isinstance(value[0], str):
                        assert value[0] in workflow.graph, (key, value)
        for route, payload in (
            ("studio/queue", {"workflow": "Anima_T2I_AstrBot", "positive": "Scene"}),
            ("studio/queue/command", {"command": "/comfy gen --wf t2i Scene --raw"}),
            ("studio/queue", {"workflow": "Anima_T2I_AstrBot", "positive": "Scene", "loras": [{"id": "alpha"}, {"id": "beta"}]}),
            ("studio/queue", {"workflow": "Anima_T2I_AstrBot", "positive": "Scene", "lora_sweep": True, "count": 2}),
        ):
            run.reset_mock()
            response = await call(route, {**payload, **feature_data})
            assert response.status_code == 200, response.body
            expected = 4 if payload.get("lora_sweep") else 1
            assert run.call_count == expected, run.call_count
            for item in run.call_args_list:
                graph = item.args[1]
                assert {"20", "93", "94", "51", "91"}.issubset(graph)
                assert graph["4"]["inputs"]["populated_text"] == "Green tree"
                assert set(item.kwargs["input_images"]) == {"0", "1", "2"}
        response = await call("studio/queue", {"workflow": "Anima_T2I_AstrBot", "positive": "Scene", "regional": None,
                                             "sampling": {key: False for key in feature_data["sampling"]}, "anima_upscale": False})
        assert response.status_code == 200, response.body
        assert not {"20", "93", "94", "51", "91"}.intersection(run.call_args.args[1])
        before = run.call_count
        for value in ("yes", 1, None):
            for route, data in (("studio/queue", {"workflow": "Anima_T2I_AstrBot", "positive": "Scene"}),
                                ("studio/queue/command", {"command": "/comfy gen --wf t2i Scene --raw"})):
                response = await call(route, {**data, "anima_upscale": value})
                assert response.status_code == 400 and run.call_count == before, response.body
    assert defaults == studio.anima.path.read_bytes()
    print("PASS: Anima 32 feature combinations, queue, command, stacked LoRAs, sweep, explicit off and invalid switches")


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--astrbot-core", required=True, type=Path)
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--anima-workspace", type=Path)
    parser.add_argument("--anima-schemas", type=Path)
    args = parser.parse_args()
    with TemporaryDirectory(prefix="astrbot-comfy-bridge-") as directory:
        asyncio.run(check(Path(directory).resolve(), args.archive.resolve(), args.astrbot_core.resolve(),
                          anima_workspace=args.anima_workspace, anima_schemas=args.anima_schemas))
