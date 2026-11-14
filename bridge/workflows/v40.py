"""Resolve the optional stages of the V40 API profiles before submission."""

from copy import copy, deepcopy

from .workflow import (
    ADVANCED_V40_WORKFLOW,
    DETAILER_WORKFLOW,
    Workflow,
    WorkflowError,
    is_link,
    profile_parts,
)

V40_WORKFLOWS = {ADVANCED_V40_WORKFLOW, DETAILER_WORKFLOW}
REPAIR_OPTIONS = {"hands", "face", "eyes", "feet", "nsfw_repair"}
V40_FBCNN_SCHEMA = {
    "input": {"required": {
        "auto_detect": [["enable", "disable"]],
        "compression_level": ["INT", {"min": 0, "max": 100}],
    }},
}


def v40_branches(config, changes=None):
    branches = {key: row["enabled"] for key, row in config["branches"].items()}
    if changes is not None:
        if not isinstance(changes, dict) or changes.keys() - branches.keys():
            raise WorkflowError("V40 的分支设置无效。")
        branches.update(changes)
    if any(type(value) is not bool for value in branches.values()):
        raise WorkflowError("V40 的分支开关必须是布尔值。")
    return branches


def v40_workflow(name, graph, settings, mapping=None, options=None):
    config = settings["v40"]
    enabled = v40_branches(config, options)
    disabled = {node for key, row in config["branches"].items() if not enabled[key] for node in row["nodes"]}
    output = config["output"]
    upscale = enabled.get("upscale_post", False)
    rendered = {}
    visiting = set()

    def resolve(value):
        if not is_link(value):
            return value
        key, slot = value
        key = str(key)
        node = graph[key]
        inputs = node["inputs"]
        if key in disabled:
            source = config["bypass"].get(key, {}).get(str(slot))
            return resolve(inputs.get(source))
        if key in config["switches"]:
            return resolve(inputs["on_true" if enabled[config["switches"][key]] else "on_false"])
        kind = node["class_type"]
        if kind == "Any Switch (rgthree)":
            for field in sorted(inputs):
                if field.startswith("any_"):
                    selected = resolve(inputs[field])
                    if selected is not None:
                        return selected
            return None
        if kind == "easy anythingIndexSwitch":
            return resolve(inputs.get(f"value{inputs['index']}"))
        if kind == "easy imageSwitch":
            return resolve(inputs["image_a" if inputs["boolean"] else "image_b"])
        if kind == "WidgetToString":
            target = str(inputs["id"])
            if title := inputs.get("node_title"):
                target = next((key for key, row in graph.items() if row.get("_meta", {}).get("title") == title), "")
            if target not in graph:
                raise WorkflowError(f"V40 找不到节点 #{key} 指定的来源。")
            values = graph[target]["inputs"]
            names = list(values) if inputs["return_all"] else [
                name.strip() for name in inputs["widget_name"].split(",") if name.strip()
            ]
            if not names or any(name not in values for name in names):
                raise WorkflowError(f"V40 节点 #{key} 找不到指定的参数。")
            decimals = inputs.get("allowed_float_decimals", 2)
            items = {name: f"{values[name]:.{decimals}f}" if isinstance(values[name], float) else str(values[name])
                     for name in names}
            return next(iter(items.values())) if len(items) == 1 and not inputs["return_all"] else ", ".join(
                f"{name}: {value}" for name, value in items.items()
            )
        emit(key)
        return [key, slot]

    def emit(key):
        if key in rendered:
            return
        if key in visiting:
            raise WorkflowError("V40 工作流存在循环连接。")
        visiting.add(key)
        node = graph[key]
        inputs = node["inputs"]
        if key == output and upscale:
            inputs = {**inputs, "images": config["upscale_image"]}
        resolved = {}
        for field, value in inputs.items():
            source = resolve(value)
            if source is not None:
                resolved[field] = source
        for field, choices in config.get("dynamic_inputs", {}).get(node["class_type"], {}).items():
            selected = choices[resolved[field]]
            for name in tuple(resolved):
                if name.startswith(f"{field}.") and name not in selected:
                    del resolved[name]
            for name, default in selected.items():
                resolved.setdefault(name, default)
        if node["class_type"] == "CustomCombo":
            choices = [value for field, value in inputs.items() if field.startswith("option") and value]
            if inputs["choice"] in choices:
                resolved["index"] = choices.index(inputs["choice"])
        rendered[key] = {**node, "inputs": resolved}
        visiting.remove(key)

    emit(output)
    for branch, outputs in config.get("extra_output", {}).items():
        if enabled[branch]:
            for key in outputs if upscale else outputs[:1]:
                emit(key)
    reference = "0" if name == ADVANCED_V40_WORKFLOW else "2"
    if reference in rendered:
        image = rendered[reference]["inputs"]["image"]
        reference_field = f"{reference}.image"
        if image == "load_image.png" and name == ADVANCED_V40_WORKFLOW:
            settings = {**settings, "reference_source": "qq"}
        elif name == DETAILER_WORKFLOW and image != "load_image.png":
            node_mapping = settings.get("node_mapping", {})
            if node_mapping.get("image") == [reference_field]:
                settings = {**settings, "reference_source": "auto", "node_mapping": {
                    **node_mapping, "image": [], "optional_image": [reference_field],
                }}
    source_mapping = {**(mapping or {}), **settings.get("node_mapping", {})}
    execution_mapping = source_mapping.copy()
    if name == DETAILER_WORKFLOW:
        for role in ("positive", "negative", "seed"):
            if role in source_mapping:
                execution_mapping[role] = [
                    field for field in source_mapping[role] if field.split(".", 1)[0] in rendered
                ]
    workflow = Workflow(
        name, {"prompt": rendered, "astrbot": {**settings, "node_mapping": execution_mapping}},
        require_prompt=name != DETAILER_WORKFLOW,
    )
    workflow.mapping = source_mapping
    workflow.active.update(rendered)
    return workflow


def advanced_v40_loras(workflow, rows, catalog, files):
    loader = workflow.graph.get("61")
    if not loader or loader["class_type"] != "Lora Loader (LoraManager)" or "61" not in workflow.active:
        raise WorkflowError("Advanced Gemma V40 缺少正在使用的 LoRA 加载节点 #61。")
    graph = deepcopy(workflow.graph)
    inputs = graph["61"]["inputs"]
    tags = [workflow.positive_prefix]
    for index, row in enumerate(rows):
        entry = catalog[row["id"]]
        filename = files.get(entry["filename"])
        if filename is None:
            raise WorkflowError(f"ComfyUI 未找到 LoRA「{entry['title']}」。")
        strength = row["strength"]
        clip_strength = row.get("clip_strength", strength)
        key = "astrbot_v40_lora" if index == 0 else f"astrbot_v40_lora_{index + 1}"
        if key in graph:
            raise WorkflowError(f"Advanced Gemma V40 已使用 LoRA 保留节点 {key}。")
        graph[key] = {"class_type": "LoraLoader", "inputs": {
            "model": inputs["model"], "clip": inputs["clip"], "lora_name": filename,
            "strength_model": strength, "strength_clip": clip_strength,
        }}
        inputs.update(model=[key, 0], clip=[key, 1])
        if strength or clip_strength:
            tags.append(entry["tag"])
    inputs.update(text="", loras={"__value__": []})
    inputs.pop("lora_stack", None)
    toggle = graph.get("100")
    if toggle and toggle["class_type"] == "TriggerWord Toggle (LoraManager)":
        toggle["inputs"]["toggle_trigger_words"] = {"__value__": []}
        toggle["inputs"].pop("orinalMessage", None)
    candidate = copy(workflow)
    candidate.graph = graph
    candidate.active = workflow.active | (graph.keys() - workflow.graph.keys())
    candidate.positive_prefix = ", ".join(dict.fromkeys(filter(None, tags)))
    return candidate


def advanced_v40_lora_sweep(workflow, characters, files):
    return [
        advanced_v40_loras(
            workflow, [{"id": entry["id"], "strength": entry["default_strength"]}],
            {entry["id"]: entry}, files,
        )
        for entry in characters
    ]


def upgrade_detailer(profile, bundled):
    """Restore the original branches while carrying forward settings of the legacy export."""
    graph, settings = profile_parts(profile)
    new_graph, _ = profile_parts(bundled)
    if "v40" in settings or not {"1", "2", "32", "57", "79", "91"} <= graph.keys():
        return None
    if any(key not in new_graph or node["class_type"] != new_graph[key]["class_type"] for key, node in graph.items()):
        return None
    baseline = v40_workflow(DETAILER_WORKFLOW, new_graph, bundled["astrbot"]).graph
    legacy_links = {
        "37.image": ["106", 0], "88.any_01": ["57", 0], "88.any_02": ["57", 0],
        "99.any_01": ["112", 0], "99.any_02": ["112", 0], "106.any_01": ["99", 0],
        "112.any_01": ["2", 0], "499.image": ["88", 0],
    }
    for key, node in graph.items():
        if key in ("32", "500"):
            continue
        for field, value in node["inputs"].items():
            if is_link(value) and value not in (
                new_graph[key]["inputs"].get(field), baseline.get(key, {}).get("inputs", {}).get(field),
                legacy_links.get(f"{key}.{field}"),
            ):
                return None
    replacement = deepcopy(bundled)
    upgraded, updated_settings = profile_parts(replacement)
    updated_settings.update(settings)
    branches = updated_settings["v40"]["branches"]
    if "500" in graph:
        branches["feet"]["enabled"] = graph["500"]["inputs"]["switch"]
    for key, node in graph.items():
        for field, value in node["inputs"].items():
            if field in upgraded[key]["inputs"] and not is_link(value) and not is_link(upgraded[key]["inputs"][field]):
                upgraded[key]["inputs"][field] = value
    v40_workflow(DETAILER_WORKFLOW, upgraded, updated_settings)
    return replacement
