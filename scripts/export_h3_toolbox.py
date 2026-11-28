"""Export the two H3 Toolbox canvases using the installed comfy-cli converter."""

import json
from argparse import ArgumentParser
from copy import deepcopy
from pathlib import Path
from urllib.parse import quote
from urllib.request import urlopen

from comfy_cli.workflow_to_api import convert_ui_to_api

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    "MiniMax_H3_Dual_Continuation_AstrBot": "H3双采接续工作流.json",
    "PH3_Image_Edit_AstrBot": "ph3图像编辑与生成工作流.json",
}


def widgets(node, **changes):
    names = [field["name"] for field in node["inputs"] if "widget" in field]
    for name, value in changes.items():
        if isinstance(node["widgets_values"], dict):
            node["widgets_values"][name] = value
        else:
            node["widgets_values"][names.index(name)] = value
        if "widgets_values_named" in node:
            node["widgets_values_named"][name] = value


def materialize_variables(canvas):
    nodes = {node["id"]: node for node in canvas["nodes"]}
    links = {link[0]: link for link in canvas["links"]}
    setters = {
        node["widgets_values"][0]: node for node in nodes.values() if node["type"] == "SetNode"
    }
    virtual = {key for key, node in nodes.items() if node["type"] in {"SetNode", "GetNode"}}
    result = []
    for link in links.values():
        _, origin, _, target, _, _ = link
        if target in virtual:
            continue
        visited = set()
        while origin in virtual:
            if origin in visited:
                raise ValueError("Set/Get variable cycle")
            visited.add(origin)
            variable = nodes[origin]
            setter = setters[variable["widgets_values"][0]]
            source = links[setter["inputs"][0]["link"]]
            origin = source[1]
            link[1:3] = source[1:3]
        result.append(link)
    canvas["nodes"] = [node for node in canvas["nodes"] if node["id"] not in virtual]
    canvas["links"] = result
    for node in canvas["nodes"]:
        for slot, port in enumerate(node.get("outputs", [])):
            port["links"] = [link[0] for link in result if link[1:3] == [node["id"], slot]] or None


def export(source, name, schemas):
    canvas = deepcopy(source)
    canvas.pop("id", None)
    canvas["extra"]["astrbot"] = {"name": name}
    nodes = {node["id"]: node for node in canvas["nodes"]}
    dual = name.startswith("MiniMax")
    if dual:
        widgets(nodes[27], text="")
        widgets(nodes[5994], references='{"version":1,"images":[],"audios":[],"videos":[]}')
        widgets(nodes[31], guides="[]")
        widgets(nodes[45], filename_prefix="vedio/H3_一采", save_output=True)
        widgets(nodes[46], filename_prefix="vedio/H3_二采", save_output=True)
        for key in (45, 46, 47):
            values = nodes[key]["widgets_values"]
            if isinstance(values, dict):
                values.pop("videopreview", None)
        widgets(nodes[6103], custom_path="", video="", project_name="default")
        widgets(nodes[6104], exclude_clips="", clip_order="", output_name="")
        nodes[6103]["mode"] = nodes[6104]["mode"] = 4
        widgets(nodes[6108], mode="全新段落", clip_selection="latest", refine_clip="", refine_revision="", stage_plan="")
        positive, seed = "27.text", "38.seed"
    else:
        widgets(nodes[24], value="")
        widgets(nodes[65], media_files="[]")
        widgets(nodes[62], filename_prefix="PH3")
        positive, seed = "24.value", "12.noise_seed"
    executable = deepcopy(canvas)
    materialize_variables(executable)
    # Export the standalone tools and the dormant PH3 prompt rewriter as well.
    for node in executable["nodes"]:
        if node["id"] in ((6103, 6104) if dual else (32,)):
            node["mode"] = 0
    graph = convert_ui_to_api(executable, schemas)
    settings = {"node_mapping": {"positive": [positive], "negative": [], "seed": [seed]}}
    if dual:
        outputs = ["45", "46", "50", "6103", "6104"]
    else:
        outputs = ["62"]
    keep = set()
    pending = outputs[:]
    while pending:
        key = pending.pop()
        if key in keep:
            continue
        keep.add(key)
        node = graph[key]
        if node["class_type"] == "Power Lora Loader (rgthree)":
            for field in ("PowerLoraLoaderHeaderWidget", "➕ Add Lora"):
                node["inputs"].pop(field, None)
        pending.extend(str(value[0]) for value in node["inputs"].values()
                       if isinstance(value, list) and len(value) == 2
                       and str(value[0]) in graph and type(value[1]) is int)
    graph = {key: node for key, node in graph.items() if key in keep}
    return canvas, {"prompt": graph, "astrbot": settings}


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--comfy-url", default="http://127.0.0.1:8188")
    parser.add_argument("--canvas-output", type=Path, default=ROOT / "templates")
    parser.add_argument("--api-output", type=Path)
    args = parser.parse_args()
    schemas = {}
    visited = set()
    for name, filename in SOURCES.items():
        source = json.loads((args.source / filename).read_bytes())
        for group in [source, *source.get("definitions", {}).get("subgraphs", [])]:
            for node in group["nodes"]:
                kind = node["type"]
                if kind not in visited:
                    with urlopen(args.comfy_url + "/object_info/" + quote(kind, safe=""), timeout=15) as response:
                        schemas.update(json.load(response))
                    visited.add(kind)
        canvas, profile = export(source, name, schemas)
        destinations = [(args.canvas_output / f"{name}.json", canvas),
                        (ROOT / "workflows" / f"{name}.json", profile)]
        if args.api_output:
            graph = {key: node for key, node in profile["prompt"].items() if key not in {"6103", "6104"}}
            destinations.append((args.api_output / f"{name}_API.json", graph))
        for path, data in destinations:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        print(name, len(profile["prompt"]))


if __name__ == "__main__":
    main()
