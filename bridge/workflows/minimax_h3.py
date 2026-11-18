"""MiniMax H3 reference images and Seed Hunter v3 workbench settings."""

import json
from sys import float_info

from .workflow import H3_SEED_FULL, Workflow, WorkflowError, is_link
from .workflow_fields import combo_options, editable_fields, widget_specs

H3_V3_DEFAULT = "三路搜种"
H3_V3_CATEGORY = "生成模式与候选"
H3_CANDIDATES = {"18": "候选 1", "134": "候选 2", "144": "候选 3"}
H3_SWITCH_LABELS = {
    "593": {"1": "主提示词", "2": "备用提示词"},
    "600": {str(index): title for index, title in enumerate(H3_CANDIDATES.values(), 1)},
}


def h3_v3_graphs(graph, settings):
    return {H3_V3_DEFAULT: graph, **settings["h3_v3"]["variants"]}


def h3_v3_workflow(graph, settings, mapping=None):
    config = settings["h3_v3"]
    mode = config["mode"]
    graphs = h3_v3_graphs(graph, settings)
    if mode not in graphs:
        raise WorkflowError("请选择有效的 Seed Hunter v3 生成模式。")
    graph = graphs[mode]
    outputs = H3_CANDIDATES.keys() & graph.keys()
    enabled = outputs - set(config.get("disabled_candidates", ())) if mode == H3_V3_DEFAULT else outputs
    if outputs and not enabled:
        raise WorkflowError("搜种至少保留一个候选输出。")
    selected = {key: node for key, node in graph.items() if key not in outputs - enabled}
    switch = selected.get("593", {}).get("inputs", {})
    prompt = str(switch.get("input_" + switch.get("SwitchState", "1"), ["365"])[0])
    positive = "571.text" if "518" in selected else f"{prompt}.prompt"
    return Workflow(H3_SEED_FULL, {"prompt": selected, "astrbot": {
        **settings,
        "node_mapping": {"positive": [positive], "seed": ["16.seed"]},
    }}, mapping)


def h3_v3_fields(graph, settings, workflow, schemas):
    config = settings["h3_v3"]
    fields = {
        "h3_v3.mode": {
            "node": "h3_v3", "name": "mode", "title": "生成模式", "label": "生成模式",
            "category": H3_V3_CATEGORY, "active": True, "kind": "select",
            "value": config["mode"], "choices": list(h3_v3_graphs(graph, settings)),
        }
    }
    selected = h3_v3_graphs(graph, settings)[config["mode"]]
    if config["mode"] == H3_V3_DEFAULT:
        for key, label in H3_CANDIDATES.items():
            if key in selected:
                fields[f"h3_v3.{key}"] = {
                    "node": "h3_v3", "name": key, "title": "返回候选", "label": label,
                    "category": H3_V3_CATEGORY, "active": True, "kind": "BOOLEAN",
                    "value": key not in config.get("disabled_candidates", ()),
                }
    fields.update(editable_fields(selected, schemas, anima=False))
    for key, node in selected.items():
        values = node["inputs"]
        schema = schemas.get(node["class_type"], {})
        required, optional = widget_specs(schema, values)
        dynamic = {
            name for name, spec in schema.get("input", {}).get("required", {}).items()
            if spec[0] == "COMFY_DYNAMICCOMBO_V3"
        }
        for name, value in values.items():
            if is_link(value) or (
                name.partition(".")[0] in dynamic and name not in required and name not in optional
            ):
                continue
            field_id = f"{key}.{name}"
            if node["class_type"] == "PixaromaSliders" and name == "SlidersState":
                for index, row in enumerate(json.loads(value)["sliders"]):
                    kind = {"combo": "select", "int": "INT", "float": "FLOAT"}[row["type"]]
                    fields[f"{key}.slider_{index}"] = {
                        "node": key, "name": f"slider_{index}", "title": node["_meta"]["title"],
                        "label": row["name"], "kind": kind,
                        "value": str(row["value"]) if kind == "INT" else row["value"],
                        "choices": row.get("allowed") or row.get("options"),
                        "min": row.get("min"), "max": row.get("max"),
                    }
                continue
            choices = combo_options(required.get(name) or optional.get(name))
            if name == "SwitchState" and node["class_type"] == "PixaromaSwitch":
                choices = [slot.removeprefix("input_") for slot, link in values.items()
                           if slot.startswith("input_") and is_link(link)]
            if field_id not in fields:
                kind = {str: "STRING", bool: "BOOLEAN", int: "INT", float: "FLOAT"}.get(type(value))
                if kind is None:
                    continue
                fields[field_id] = {
                    "node": key, "name": name, "title": node["_meta"]["title"], "kind": kind,
                    "value": str(value) if kind == "INT" else value, "min": None, "max": None,
                }
            field = fields[field_id]
            if choices is not None:
                field.update(kind="select", value=value, choices=choices)
            if name == "LoraLoaderState" and node["class_type"] == "PixaromaLoraLoader":
                field.update(
                    kind="json", editor="h3-loras", label="LoRA 列表与强度",
                    choices=h3_lora_files(schemas),
                    value=[{
                        "name": row["name"], "enabled": row.get("on", True),
                        "model": row.get("sm", 1), "clip": row.get("sc", 1),
                    } for row in json.loads(value)["loras"]],
                )
            if name == "SwitchState" and key in H3_SWITCH_LABELS:
                field.update(
                    label="提示词编辑器" if key == "593" else "定稿使用的候选",
                    choice_labels=H3_SWITCH_LABELS[key],
                )
            if name == "media_state":
                field.update(label="参考图、视频与音频（JSON）", multiline=True)
            if name == "prompt" or name == "text" and node["class_type"] == "PixaromaText":
                field["multiline"] = True
    for field in fields.values():
        key = field["node"]
        if key == "h3_v3":
            continue
        kind = selected[key]["class_type"]
        field["active"] = key in workflow.active
        field["category"] = (
            "模型与 LoRA" if "Loader" in kind and kind != "MiniMaxH3MediaLoader"
            else "参考素材与提示词" if kind in {"H3PromptIDE", "MiniMaxH3MediaLoader", "MiniMaxH3ReferenceToVideo"}
            else "视频输出" if kind in {"VHS_VideoCombine", "PrimitiveBoolean", "SaveText"}
            else "放大定稿" if key.startswith("135:") or key in {"103", "600", "604", "607", "612"}
            else "采样与节点参数"
        )
    return fields


def h3_lora_files(schemas):
    spec = schemas.get("LoraLoaderModelOnly", {}).get("input", {}).get("required", {}).get("lora_name")
    return combo_options(spec) or []


def h3_with_media(workflow, items):
    if workflow.name != H3_SEED_FULL or workflow.graph.get("416", {}).get("class_type") != "MiniMaxH3MediaLoader":
        raise WorkflowError("当前工作流没有 Fantastic H3 媒体加载器。")
    if not isinstance(items, list) or len(items) > 32 or any(
        not isinstance(row, dict) or row.get("kind") not in {"picture", "video", "audio"}
        or not isinstance(row.get("file"), str) or not row["file"] for row in items
    ):
        raise WorkflowError("H3 素材列表无效。")
    state = json.dumps(items, ensure_ascii=False, allow_nan=False)
    if len(state.encode("utf-8")) > 512 * 1024:
        raise WorkflowError("H3 素材设置过大。")
    node = workflow.graph["416"]
    graph = {**workflow.graph, "416": {**node, "inputs": {**node["inputs"], "media_state": state}}}
    return Workflow(workflow.name, {"prompt": graph, "astrbot": {
        "positive_prefix": workflow.positive_prefix,
        "use_canvas_seed": workflow.default_seed != -1,
        "node_mapping": workflow.mapping,
    }})


def save_h3_v3_field(graph, settings, field, value, schemas):
    key, name = field["node"], field["name"]
    config = settings["h3_v3"]
    if key == "h3_v3":
        if name == "mode":
            config["mode"] = value
        else:
            disabled = set(config.get("disabled_candidates", ()))
            (disabled.discard if value else disabled.add)(name)
            config["disabled_candidates"] = sorted(disabled)
        return
    if name == "media_state":
        state = json.loads(value)
        if not isinstance(state, list) or len(state) > 32 or any(
            not isinstance(row, dict) or row.get("kind") not in {"picture", "video", "audio"}
            or not isinstance(row.get("file"), str) or not row["file"] for row in state
        ):
            raise WorkflowError("参考素材应为包含 kind 和 file 的 JSON 数组。")
    if name == "LoraLoaderState":
        rows = value["__value__"]
        files = set(h3_lora_files(schemas)) | {row["name"] for row in field["value"]}
        if len(rows) > 16 or any(
            not isinstance(row, dict) or not isinstance(row.get("name"), str) or row["name"] not in files
            or type(row.get("enabled")) is not bool
            or any(type(row.get(weight)) not in (int, float) or not -float_info.max <= row[weight] <= float_info.max
                   for weight in ("model", "clip"))
            for row in rows
        ):
            raise WorkflowError("请选择有效的 H3 LoRA 文件并输入有限的模型和 CLIP 强度。")
    for variant in h3_v3_graphs(graph, settings).values():
        node = variant.get(key, {})
        values = node.get("inputs", {})
        if name.startswith("slider_") and "SlidersState" in values:
            state = json.loads(values["SlidersState"])
            state["sliders"][int(name.removeprefix("slider_"))]["value"] = value
            values["SlidersState"] = json.dumps(state, ensure_ascii=False)
        elif name == "LoraLoaderState" and name in values:
            state = json.loads(values[name])
            prior = {row["name"]: row for row in state["loras"]}
            state["loras"] = [{
                **prior.get(row["name"], {}), "name": row["name"], "on": row["enabled"],
                "sm": row["model"], "sc": row["clip"],
            } for row in rows]
            values[name] = json.dumps(state, ensure_ascii=False)
        elif name in values and not is_link(values[name]):
            values[name] = value
            spec = schemas.get(node["class_type"], {}).get("input", {}).get("required", {}).get(name)
            if spec and spec[0] == "COMFY_DYNAMICCOMBO_V3":
                required, optional = widget_specs(schemas[node["class_type"]], values)
                for child, child_spec in {**required, **optional}.items():
                    if child.startswith(name + ".") and child not in values:
                        options = child_spec[1] if len(child_spec) > 1 else {}
                        if "default" in options:
                            values[child] = options["default"]


def h3_with_reference(workflow):
    node = workflow.graph.get("5")
    if not node or node["class_type"] != "MiniMaxH3ReferenceToVideo" or "5" not in workflow.active:
        if workflow.name == H3_SEED_FULL:
            raise WorkflowError("当前模式使用音频参考，请在工作台设置参考素材。")
        raise WorkflowError("MiniMax H3 工作流缺少连接到视频输出的参考图节点 #5。")
    if "astrbot_h3_reference" in workflow.graph:
        raise WorkflowError("MiniMax H3 工作流已使用保留的参考图节点 ID。")
    graph = {
        **workflow.graph,
        "5": {**node, "inputs": {**node["inputs"], "ref_images.ref_image_0": ["astrbot_h3_reference", 0]}},
        "astrbot_h3_reference": {
            "class_type": "LoadImage",
            "inputs": {"image": "__astrbot_upload_pending__.png"},
        },
    }
    if workflow.name == H3_SEED_FULL:
        graph = {
            key: {**item, "inputs": {
                name: ["astrbot_h3_reference", 0] if value == ["417", 0] else value
                for name, value in item["inputs"].items()
            }}
            for key, item in graph.items()
        }
    return Workflow(workflow.name, {"prompt": graph, "astrbot": {
        "positive_prefix": workflow.positive_prefix,
        "use_canvas_seed": workflow.default_seed != -1,
        "node_mapping": {**workflow.mapping, "image": ["astrbot_h3_reference.image"]},
    }})
