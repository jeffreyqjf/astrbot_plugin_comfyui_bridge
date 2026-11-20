"""Apply the optional feet pass in legacy Detailer V40 API graphs."""

from copy import copy, deepcopy

from .workflow import DETAILER_WORKFLOW, Workflow, WorkflowError, is_link
from .workflow_fields import combo_options, validate_graph


def prepare_detailer_models(graph, schemas):
    """Resolve uniquely relocated weights without substituting another model."""
    loaders = {}
    for key, node in graph.items():
        field = {"ControlNetLoader": "control_net_name", "ModelPatchLoader": "name"}.get(node["class_type"])
        if not field:
            continue
        loaders[key] = node
        spec = schemas.get(node["class_type"], {}).get("input", {}).get("required", {}).get(field)
        choices = combo_options(spec)
        value = node["inputs"].get(field)
        if choices is not None and isinstance(value, str) and value not in choices:
            normalized = value.replace("\\", "/")
            matches = [item for item in choices if isinstance(item, str) and item.replace("\\", "/") == normalized]
            if not matches:
                matches = [item for item in choices if isinstance(item, str)
                           and item.replace("\\", "/").rsplit("/", 1)[-1] == normalized.rsplit("/", 1)[-1]]
            if len(matches) == 1:
                node["inputs"][field] = matches[0]
    validate_graph(loaders, schemas)

DETAILER_TASK_BRANCHES = {"hires": "15", "inpaint": "27", "outpaint": "28", "mask": "mask", "upscale": "30"}


def detailer_options(value):
    if (not isinstance(value, dict) or value.keys() != DETAILER_TASK_BRANCHES.keys()
            or any(type(enabled) is not bool for enabled in value.values())):
        raise WorkflowError("Detailer 任务功能须包含 hires、inpaint、outpaint、mask、upscale 五个布尔开关。")
    return {branch: value[key] for key, branch in DETAILER_TASK_BRANCHES.items()}


ANIMA_DETAILER_TASK_BRANCHES = {"hires_pre": "13", "hires_post": "14", "inoutpaint": "126", "mask": "mask", "upscale": "19"}
ANIMA_DETAILER_FEATURES = [
    {"id": f"anima_detailer.{key}", "kind": "branch", "branch": key, "title": title}
    for key, title in (("hires_pre", "Hires PreDetailer"), ("hires_post", "Hires PostDetailer"),
                       ("inoutpaint", "In/Outpaint"), ("mask", "Mask Detailer"), ("upscale", "Ultimate SD Upscaler"))
]


def anima_detailer_options(value):
    if (not isinstance(value, dict) or value.keys() != ANIMA_DETAILER_TASK_BRANCHES.keys()
            or any(type(enabled) is not bool for enabled in value.values())):
        raise WorkflowError("Anima Detailer 任务功能须包含 hires_pre、hires_post、inoutpaint、mask、upscale 五个布尔开关。")
    return {branch: value[key] for key, branch in ANIMA_DETAILER_TASK_BRANCHES.items()}


def anima_detailer_loras(workflow, rows, catalog, files):
    loader = workflow.graph.get("5")
    if not loader or "5" not in workflow.active or loader["class_type"] != "Lora Loader (LoraManager)":
        if rows:
            raise WorkflowError("当前 Anima Detailer 分支没有使用 LoRA 模型，请先启用细化或采样分支。")
        return workflow
    candidate = copy(workflow)
    candidate.graph = graph = deepcopy(workflow.graph)
    inputs = graph["5"]["inputs"]
    inputs.update(text="", loras={"__value__": []})
    tags = [workflow.positive_prefix]
    for index, row in enumerate(rows, 1):
        entry = catalog[row["id"]]
        filename = files.get(entry["filename"])
        if filename is None:
            raise WorkflowError(f"ComfyUI 未找到 LoRA「{entry['title']}」。")
        key = f"astrbot_anima_detailer_lora_{index}"
        if key in graph:
            raise WorkflowError("Anima Detailer 已使用 LoRA 保留节点。")
        graph[key] = {"class_type": "LoraLoaderModelOnly", "inputs": {
            "model": inputs["model"], "lora_name": filename, "strength_model": row["strength"],
        }}
        inputs["model"] = [key, 0]
        if row["strength"]:
            tags.append(entry["tag"])
    if "57" in graph:
        graph["57"]["inputs"]["toggle_trigger_words"] = {"__value__": []}
    candidate.active = workflow.active | (graph.keys() - workflow.graph.keys())
    candidate.positive_prefix = ", ".join(dict.fromkeys(filter(None, tags)))
    return candidate


FEET_NODES = ("497", "498", "499")
FEET_DETAILER = FEET_NODES[-1]
FEET_SWITCH = "500"
LEGACY_FEET_LINKS = {
    ("32", "images"): ["500", 0],
    ("73", "image_a"): ["500", 0],
    ("499", "image"): ["88", 0],
    ("500", "on_false"): ["88", 0],
    ("33", "image"): ["58", 0],
    ("51", "image"): ["58", 0],
    ("38", "a"): ["58", 0],
    ("39", "a"): ["58", 0],
}


def feet_switch(graph, *, require_output=True):
    node = graph.get(FEET_SWITCH) if isinstance(graph, dict) else None
    if not isinstance(node, dict) or node.get("class_type") != "ComfySwitchNode":
        return None
    inputs = node.get("inputs")
    output = graph.get("32")
    output_inputs = output.get("inputs") if isinstance(output, dict) else None
    if (
        isinstance(inputs, dict) and inputs.get("on_true") == [FEET_DETAILER, 0]
        and is_link(inputs.get("on_false"))
        and (
            not require_output or
            (isinstance(output_inputs, dict) and output_inputs.get("images") == [FEET_SWITCH, 0])
        )
    ):
        return inputs
    return None


def detailer_workflow(graph, settings, mapping, options=None):
    options = options or {}
    if set(options) - {"feet"} or "feet" in options and type(options["feet"]) is not bool:
        raise WorkflowError("Detailer V40 支持 --feet on 或 --feet off。")
    switch = feet_switch(graph)
    if switch is None:
        if options.get("feet"):
            raise WorkflowError("当前 Detailer V40 工作流缺少修脚模块，请更新工作流。")
        return Workflow(DETAILER_WORKFLOW, {"prompt": graph, "astrbot": settings}, mapping)
    enabled = options.get("feet", switch.get("switch"))
    if type(enabled) is not bool:
        raise WorkflowError("Detailer V40 的修脚开关必须是布尔值。")
    selected = switch["on_true" if enabled else "on_false"]
    graph = deepcopy(graph)
    del graph[FEET_SWITCH]
    graph["32"]["inputs"]["images"] = selected
    workflow = Workflow(DETAILER_WORKFLOW, {"prompt": graph, "astrbot": settings}, mapping)
    workflow.graph = {key: node for key, node in workflow.graph.items() if key in workflow.active}
    return workflow


def add_feet_to_profile(profile, bundled_graph):
    graph = profile.get("prompt", profile)
    source = graph.get("32", {})
    image = source.get("inputs", {}).get("images")
    new_nodes = (*FEET_NODES, FEET_SWITCH)
    if (
        source.get("class_type") != "SaveImage" or not is_link(image)
        or any(key in graph for key in new_nodes) or not feet_switch(bundled_graph, require_output=False)
    ):
        return False
    for key in new_nodes:
        graph[key] = deepcopy(bundled_graph[key])
    graph[FEET_DETAILER]["inputs"]["image"] = image
    graph[FEET_SWITCH]["inputs"]["on_false"] = image
    source["inputs"]["images"] = [FEET_SWITCH, 0]
    detailer_workflow(graph, profile.get("astrbot", {}), None, {"feet": True})
    return True
