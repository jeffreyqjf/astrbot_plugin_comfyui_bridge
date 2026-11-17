"""Load an installation ZIP under a temporary AstrBot data root."""

import asyncio
import importlib
import json
import os
import sys
from argparse import ArgumentParser
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile

PLUGIN = "astrbot_plugin_comfyui_bridge"


class PluginContext:
    def __init__(self):
        self.routes = set()

    def register_web_api(self, path, handler, methods, description):
        self.routes.update((method, path) for method in methods)


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
