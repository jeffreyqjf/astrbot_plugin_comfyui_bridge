"""Prepare the WAI-Illustrious graph shared by the workbench and QQ."""

import asyncio
from copy import copy, deepcopy

from .workflow import WAI_WORKFLOW, Workflow, WorkflowError, is_link
from .workflow_fields import combo_options

WAI_CANNY = "astrbot_wai_canny"
PIXEL_LORA = "pixel-illustrious.safetensors"

# Branches bypass the associated node or group without discarding its settings.
WAI_BRANCHES = {
    "external_vae": ("使用外部 VAE", False),
    "upscale": ("模型放大", True),
    "face": ("人脸修复", False),
    "refine": ("放大后重采样", True),
    "control": ("重采样 ControlNet", True),
    "detail_daemon": ("重采样 Detail Daemon", False),
    "eyes": ("眼部修复", True),
}


def wai_branches(settings, changes=None):
    branches = {key: enabled for key, (_, enabled) in WAI_BRANCHES.items()}
    for values in (settings.get("branches", {}), {} if changes is None else changes):
        if not isinstance(values, dict) or any(
            key not in branches or type(value) is not bool for key, value in values.items()
        ):
            raise WorkflowError("Illustrious 分支设置无效。")
        branches.update(values)
    return branches


def wai_workflow(graph, settings, mapping, changes=None, *, controlnet_type=None):
    graph = deepcopy(graph)
    branches = wai_branches(settings, changes)
    if branches["external_vae"]:
        for node in graph.values():
            for name, value in node["inputs"].items():
                if value == ["88", 2]:
                    node["inputs"][name] = ["91", 0]
    image = ["24" if branches["upscale"] else "118", 0]
    graph["211"]["inputs"]["image"] = image
    if branches["face"]:
        image = ["211", 0]
    graph["185"]["inputs"]["pixels"] = image
    if controlnet_type is not None:
        graph["129"]["inputs"]["type"] = controlnet_type
    if branches["refine"] and branches["control"] and "canny" in graph["129"]["inputs"]["type"].split("/"):
        graph[WAI_CANNY] = {"class_type": "Canny", "inputs": {
            "image": image, "low_threshold": 0.4, "high_threshold": 0.8,
        }}
        graph["146"]["inputs"]["image"] = [WAI_CANNY, 0]
    else:
        graph["146"]["inputs"]["image"] = image
    graph["138"]["inputs"]["positive"] = ["146" if branches["control"] else "218", 0]
    graph["230"]["inputs"]["sampler"] = ["231" if branches["detail_daemon"] else "228", 0]
    if branches["refine"]:
        image = ["13", 0]
    graph["174"]["inputs"]["image"] = image
    graph["37"]["inputs"]["images"] = ["174", 0] if branches["eyes"] else image
    workflow = Workflow(WAI_WORKFLOW, {"prompt": graph, "astrbot": settings}, mapping)
    workflow.graph = {key: node for key, node in workflow.graph.items() if key in workflow.active}
    return workflow


def wai_prompt_modes(graph, schemas):
    schema = schemas.get("smZ CLIPTextEncode", {}).get("input", {}).get("required", {}).get("mode")
    if not schema or schema[0] != "COMFY_DYNAMICCOMBO_V3":
        return
    for key in ("218", "219"):
        inputs = graph[key]["inputs"]
        option = next(item for item in schema[1]["options"] if item["key"] == inputs["mode"])
        required = option["inputs"]["required"]
        for name in list(inputs):
            if name.startswith("mode.") and name[5:] not in required:
                del inputs[name]
        for name, spec in required.items():
            if key == "218" and name in {"text", "text_g", "text_l"}:
                inputs[f"mode.{name}"] = ["98", 0]
            else:
                inputs.setdefault(f"mode.{name}", spec[1]["default"])


async def _controlnet_choice(client, value):
    if not isinstance(value, str) or not value.strip():
        raise WorkflowError("--controlnet-type 请填写类型，例如 auto、depth 或 canny。")
    schema = await client.request("GET", "/object_info/SetUnionControlNetType")
    spec = schema.get("SetUnionControlNetType", {}).get("input", {}).get("required", {}).get("type")
    choices = combo_options(spec)
    if not choices:
        raise WorkflowError("ComfyUI 未提供 Set Union ControlNet Type 节点的类型选项。")
    requested = value.strip().casefold()
    matches = [choice for choice in choices if choice.casefold() == requested]
    if not matches:
        matches = [choice for choice in choices if requested in choice.casefold().split("/")]
    if len(matches) != 1:
        raise WorkflowError(f"ControlNet 类型「{value}」不可用。可选：{'、'.join(choices)}。")
    return matches[0]


async def lora_loader_files(client):
    schemas = await client.request("GET", "/object_info/LoraLoader")
    spec = schemas.get("LoraLoader", {}).get("input", {}).get("required", {})
    return {name.replace("\\", "/"): name for name in (combo_options(spec.get("lora_name")) or [])}


def workflow_loras(workflow, rows, catalog, files):
    if not rows:
        return workflow
    graph = deepcopy(workflow.graph)
    consumers = [graph[key]["inputs"] for key in workflow.lora_model_nodes()]
    if not consumers:
        raise WorkflowError("未找到可接入 LoRA 的采样模型。")
    clips = [
        node["inputs"] for key, node in graph.items()
        if key in workflow.active and is_link(node["inputs"].get("clip"))
        and "TextEncode" in node["class_type"]
    ]
    tags = [workflow.positive_prefix]
    for index, row in enumerate(rows, 1):
        entry = catalog[row["id"]]
        filename = files.get(entry["filename"])
        if filename is None:
            raise WorkflowError(f"ComfyUI 未找到 LoRA「{entry['title']}」。")
        strength = row["strength"]
        clip_strength = row.get("clip_strength", strength)
        clip_sources = {tuple(inputs["clip"]) for inputs in clips}
        clip = list(next(iter(clip_sources))) if len(clip_sources) == 1 else None
        if not strength and not (clip and clip_strength):
            continue
        tags.append(entry["tag"])
        model_sources = dict.fromkeys(tuple(inputs["model"]) for inputs in consumers)
        for position, model in enumerate(model_sources, 1):
            key = f"astrbot_lora_{index}_{position}"
            if key in graph:
                raise WorkflowError(f"工作流已使用保留节点 {key}。")
            inputs = {"model": list(model), "lora_name": filename, "strength_model": strength}
            if position == 1 and clip is not None:
                graph[key] = {"class_type": "LoraLoader", "inputs": {
                    **inputs, "clip": clip, "strength_clip": clip_strength,
                }}
                for target in clips:
                    target["clip"] = [key, 1]
            else:
                graph[key] = {"class_type": "LoraLoaderModelOnly", "inputs": inputs}
            model_sources[model] = [key, 0]
        for target in consumers:
            target["model"] = model_sources[tuple(target["model"])]
    candidate = copy(workflow)
    candidate.graph = graph
    candidate.active = workflow.active | (graph.keys() - workflow.graph.keys())
    candidate.positive_prefix = ", ".join(dict.fromkeys(filter(None, tags)))
    return candidate


async def wai_generation(workflow, settings, mapping, loras, options, *, catalog=None, files=None):
    if set(options) - {"loras", "face", "eyes", "controlnet_type"}:
        raise WorkflowError("WAI 支持单次 --lora、--face、--eyes 和 --controlnet-type。其他参数请在工作台修改。")
    selected = options.get("loras", [])
    if selected and catalog is None:
        catalog = await asyncio.to_thread(loras.lora_catalog)
    rows = loras.parse_loras(selected, catalog) if selected != [] else []
    pixel_style = any(
        row["strength"] and catalog[row["id"]]["filename"].rsplit("/", 1)[-1].casefold() == PIXEL_LORA
        for row in rows
    )
    changes = {}
    if pixel_style:
        changes.update(upscale=False, refine="controlnet_type" in options, face=False, eyes=False)
    changes.update({key: options[key] for key in ("face", "eyes") if key in options})
    controlnet_type = None
    if "controlnet_type" in options:
        branches = wai_branches(settings, changes)
        if not (branches["refine"] and branches["control"]):
            raise WorkflowError("请先在工作台启用放大后重采样和重采样 ControlNet。")
        controlnet_type = await _controlnet_choice(loras.service.client, options["controlnet_type"])
    candidate = wai_workflow(workflow.graph, settings, mapping, changes, controlnet_type=controlnet_type)
    if not rows:
        return candidate
    if files is None:
        files = await lora_loader_files(loras.service.client)
    graph = candidate.graph
    model, clip = ["88", 0], ["88", 1]
    tags = [candidate.positive_prefix]
    for index, row in enumerate(rows, 1):
        entry = catalog[row["id"]]
        filename = files.get(entry["filename"])
        if filename is None:
            raise WorkflowError(f"ComfyUI 未找到 LoRA「{entry['title']}」。")
        strength_model = row["strength"]
        strength_clip = row.get("clip_strength", strength_model)
        if not (strength_model or strength_clip):
            continue
        key = f"astrbot_illustrious_lora_{index}"
        if key in graph:
            raise WorkflowError(f"Illustrious 工作流已使用 LoRA 保留节点 {key}。")
        graph[key] = {"class_type": "LoraLoader", "inputs": {
            "model": model, "clip": clip, "lora_name": filename,
            "strength_model": strength_model, "strength_clip": strength_clip,
        }}
        model, clip = [key, 0], [key, 1]
        tags.append(entry["tag"] or ("pixel" if entry["filename"].rsplit("/", 1)[-1].casefold() == PIXEL_LORA else ""))
    graph["126"]["inputs"]["model"] = model
    for key, node in graph.items():
        if key.startswith("astrbot_illustrious_lora_"):
            continue
        for name, value in node["inputs"].items():
            if value == ["88", 1]:
                node["inputs"][name] = clip
    return Workflow(WAI_WORKFLOW, {
        "prompt": graph,
        "astrbot": {**settings, "positive_prefix": ", ".join(dict.fromkeys(filter(None, tags)))},
    }, mapping)
