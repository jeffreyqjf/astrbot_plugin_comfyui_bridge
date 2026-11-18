"""Export the Anima Detailer AstrBot canvas using ComfyUI's installed converter."""

import json
import sys
from argparse import ArgumentParser
from copy import deepcopy
from pathlib import Path

from comfy_cli.workflow_to_api import (
    _collect_subgraph_defs,
    _expand_subgraphs,
    _is_valid_connection,
    convert_ui_to_api,
)

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bridge.workflows.detailer import ANIMA_DETAILER_FEATURES
from bridge.workflows.v40 import v40_workflow
from bridge.workflows.workflow import ANIMA_DETAILER_WORKFLOW
from bridge.workflows.workflow_fields import combo_options, validate_graph


def build(source, schemas):
    canvas = deepcopy(source)
    original = {str(node["id"]): node for node in canvas["nodes"]}
    original["2"]["widgets_values"] = ["load_image.png", "image"]
    original["2"].setdefault("widgets_values_named", {})["image"] = "load_image.png"
    output = original["15"]
    output.update(
        type="SaveImage",
        title="Save Image · AstrBot",
        widgets_values=["AstrBot/AnimaDetailer"],
        widgets_values_named={"filename_prefix": "AstrBot/AnimaDetailer"},
        outputs=[],
        properties={"Node name for S&R": "SaveImage"},
    )
    output["inputs"] = [item for item in output["inputs"] if item["name"] == "images"]
    canvas["links"] = [row for row in canvas["links"] if str(row[3]) != "15" or row[4] == 0]
    remaining_links = {row[0] for row in canvas["links"]}
    for node in canvas["nodes"]:
        for port in node.get("outputs", []):
            if port.get("links") is not None:
                port["links"] = [key for key in port["links"] if key in remaining_links]
    canvas.setdefault("extra", {})["astrbot_task_features"] = {
        "version": 1,
        "features": ANIMA_DETAILER_FEATURES,
    }
    full = deepcopy(canvas)
    for node in full["nodes"]:
        if node["mode"] in (0, 4):
            node["mode"] = 0
    graph = convert_ui_to_api(full, schemas)
    flat, _, _ = _expand_subgraphs(
        deepcopy(full["nodes"]), list(full["links"]), _collect_subgraph_defs(full)
    )
    flat = {str(node["id"]): node for node in flat}
    bypass = {}
    for key, row in graph.items():
        node = flat[key]
        inputs = node.get("inputs", [])
        for slot, port in enumerate(node.get("outputs", [])):
            linked = [
                item
                for item in inputs
                if item.get("link") is not None and item["name"] in row["inputs"]
            ]
            same = inputs[slot] if slot < len(inputs) else None
            selected = (
                same
                if same in linked and _is_valid_connection(same.get("type"), port.get("type"))
                else next(
                    (item for item in linked if item.get("type") == port.get("type")),
                    next(
                        (
                            item
                            for item in linked
                            if _is_valid_connection(item.get("type"), port.get("type"))
                        ),
                        linked[0] if linked else None,
                    ),
                )
            )
            if selected:
                bypass.setdefault(key, {})[str(slot)] = selected["name"]
        if row["class_type"] == "Lora Loader (LoraManager)":
            values = row["inputs"]
            values.setdefault("text", "")
            if not isinstance(values.get("loras"), dict):
                values["loras"] = {"__value__": values.get("loras", [])}
        if row["class_type"] == "TriggerWord Toggle (LoraManager)":
            values = row["inputs"]
            if not isinstance(values.get("toggle_trigger_words"), dict):
                values["toggle_trigger_words"] = {
                    "__value__": values.get("toggle_trigger_words", [])
                }
            if type(values.get("allow_strength_adjustment")) is not bool:
                values["allow_strength_adjustment"] = False
        for name, spec in (
            schemas.get(row["class_type"], {}).get("input", {}).get("required", {}).items()
        ):
            if name.startswith("Select to add "):
                choices = combo_options(spec)
                if choices and row["inputs"].get(name) not in choices:
                    row["inputs"][name] = choices[0]
    branches = {}
    aliases = {
        5: "hands",
        7: "nsfw_repair",
        8: "face",
        9: "eyes",
        12: "full_detailer",
        100: "mask",
        118: "sam_detailer",
    }
    ignored = {1, 4, 11, 18, 101}
    for group in canvas["groups"]:
        if group["id"] in ignored:
            continue
        x, y, width, height = group["bounding"]
        parents = {
            str(node["id"])
            for node in canvas["nodes"]
            if node["mode"] in (0, 4)
            and node["type"] != "Image Comparer (rgthree)"
            and x <= node["pos"][0] < x + width
            and y <= node["pos"][1] < y + height
        }
        members = [key for key in graph if key.split(":", 1)[0] in parents]
        if not members:
            continue
        key = str(aliases.get(group["id"], group["id"]))
        category = "局部修复" if group["id"] in {5, 7, 8, 9, 10, 12, 100, 118} else group["title"]
        branches[key] = {
            "title": group["title"],
            "category": category,
            "enabled": all(original[parent]["mode"] == 0 for parent in parents),
            "nodes": members,
        }
        for member in members:
            graph[member].setdefault("_meta", {})["branch"] = key
    # Saver-only metadata widgets are not consumed by the plugin's SaveImage output.
    graph.pop("65", None)
    graph.pop("66", None)
    config = {
        "branches": branches,
        "bypass": bypass,
        "switches": {},
        "output": "15",
        "extra_output": {},
        "dynamic_inputs": {},
    }
    for kind in {node["class_type"] for node in graph.values()}:
        for name, spec in schemas.get(kind, {}).get("input", {}).get("required", {}).items():
            if spec[0] == "COMFY_DYNAMICCOMBO_V3":
                config["dynamic_inputs"].setdefault(kind, {})[name] = {
                    item["key"]: {
                        field: (combo_options(value) or [value[1].get("default")])[0]
                        if isinstance(value[0], list)
                        else value[1].get("default")
                        for field, value in item["inputs"].get("required", {}).items()
                    }
                    for item in spec[1]["options"]
                }
    settings = {
        "node_mapping": {
            "positive": ["3.text"],
            "negative": ["41.text"],
            "seed": ["49.seed"],
            "image": ["2.image"],
        },
        "reference_source": "qq",
        "sweep_lora_family": "anima",
        "task_feature_version": 1,
        "task_features": ANIMA_DETAILER_FEATURES,
        "v40": config,
    }
    profile = {"prompt": graph, "astrbot": settings}
    selected = v40_workflow(ANIMA_DETAILER_WORKFLOW, graph, settings)
    return canvas, profile, selected


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--object-info", type=Path, required=True)
    parser.add_argument("--workspace", type=Path, required=True)
    args = parser.parse_args()
    source_raw = args.source.read_bytes()
    schemas = json.loads(args.object_info.read_bytes())
    canvas, profile, selected = build(json.loads(source_raw), schemas)
    try:
        validate_graph(selected.graph, schemas, {("2", "image")})
    except ValueError as exc:
        print("Local prerequisite:", exc)
    root = Path(__file__).resolve().parents[1]
    name = ANIMA_DETAILER_WORKFLOW
    api = deepcopy(selected.graph)
    api["15"].setdefault("_meta", {}).update(
        task_feature_version=1, task_features=ANIMA_DETAILER_FEATURES
    )
    for path, value in (
        (args.workspace / "user/default/workflows/AstrBot" / (name + ".json"), canvas),
        (root / "templates" / (name + ".json"), canvas),
        (args.workspace / "user/default/workflows/api" / (name + "_API.json"), api),
        (root / "workflows" / (name + ".json"), profile),
    ):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
            encoding="utf-8",
        )
    assert args.source.read_bytes() == source_raw
    print(
        "Exported:",
        len(profile["prompt"]),
        "stored nodes;",
        len(selected.graph),
        "default execution nodes;",
        len(profile["astrbot"]["v40"]["branches"]),
        "branches",
    )


if __name__ == "__main__":
    main()
