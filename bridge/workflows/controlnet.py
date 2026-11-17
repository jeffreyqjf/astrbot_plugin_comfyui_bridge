"""Bind independent ControlNet images to the supported API graph branches."""

import re
from dataclasses import dataclass

from .workflow import ADVANCED_V40_WORKFLOW, ANIMA_WORKFLOW, WorkflowError
from .workflow_fields import combo_options


@dataclass(frozen=True)
class ControlBranch:
    branch: str
    image: str
    preprocessor: str
    apply: str
    loader: str
    types: dict
    switch: str | None = None


CONTROL_BRANCHES = {
    ADVANCED_V40_WORKFLOW: {
        "openpose": ControlBranch("17", "121", "177", "163", "171", {
            "openpose": (
                "IL-controlnet/openpose_noob.safetensors", "openpose_noob.safetensors",
                "Illustrious_ControlNet/openpose_noob.safetensors",
            ),
        }, "164"),
        "any": ControlBranch("23", "123", "172", "165", "178", {
            "canny": ("control-lora-canny-rank256.safetensors", "SDXL/control-lora-canny-rank256.safetensors"),
            "depth": ("control-lora-depth-rank256.safetensors", "SDXL/control-lora-depth-rank256.safetensors"),
        }, "166"),
    },
    ANIMA_WORKFLOW: {
        "lllite": ControlBranch("120", "129", "130", "131", "138", {
            "depth": ("anima/anima-lllite-depth-1.safetensors", "anima-lllite-depth-1.safetensors"),
        }),
    },
}
AIO_PREPROCESSORS = {"canny": "CannyEdgePreprocessor", "depth": "DepthAnythingV2Preprocessor"}
MODES = ("direct", "preprocess")
PROFILE_FIELDS = {
    "id", "workflow", "branch", "type", "label", "model", "preprocessor", "resolution",
    "strength", "start_percent", "end_percent",
}
PROFILE_TOKEN = re.compile(r"[a-z0-9][a-z0-9_-]{0,63}")


def controlnet_capabilities(name, profiles=()):
    result = {}
    for key, branch in CONTROL_BRANCHES.get(name, {}).items():
        saved = [
            {**{field: row[field] for field in ("id", "type", "label", "model")},
             "modes": list(MODES) if row["preprocessor"] else ["direct"]}
            for row in profiles if row["workflow"] == name and row["branch"] == key
        ]
        result[key] = {
            "types": list(dict.fromkeys(row["type"] for row in saved)) if saved else list(branch.types),
            "modes": list(MODES),
            "profiles": saved,
        }
    return result


def controlnet_branch(name, key):
    if isinstance(name, str) and isinstance(key, str):
        branch = CONTROL_BRANCHES.get(name, {}).get(key)
        if branch is not None:
            return branch
    raise WorkflowError("请选择支持 ControlNet 配置的工作流和分支。")


def normalize_controlnet_profiles(data):
    if (not isinstance(data, dict) or data.keys() != {"version", "profiles"}
            or type(data["version"]) is not int or data["version"] != 1
            or not isinstance(data["profiles"], list) or len(data["profiles"]) > 128):
        raise WorkflowError("ControlNet 配置须为版本 1，最多保存 128 条预设。")
    rows = []
    seen = set()
    for row in data["profiles"]:
        if not isinstance(row, dict) or row.keys() != PROFILE_FIELDS:
            raise WorkflowError("ControlNet 预设字段不完整或包含未知字段。")
        name, key = row["workflow"], row["branch"]
        controlnet_branch(name, key)
        if not all(isinstance(row[field], str) and PROFILE_TOKEN.fullmatch(row[field]) for field in ("id", "type")):
            raise WorkflowError("ControlNet 预设 ID 和类型代码只支持小写字母、数字、下划线与连字符。")
        if row["id"] in seen:
            raise WorkflowError("ControlNet 预设 ID 重复。")
        seen.add(row["id"])
        label, model, processor = row["label"], row["model"], row["preprocessor"]
        if not isinstance(label, str) or not 1 <= len(label.strip()) <= 64 or not label.isprintable():
            raise WorkflowError("ControlNet 预设名称须为 1 到 64 个可见字符。")
        if (not isinstance(model, str) or not 1 <= len(model) <= 512 or not model.isprintable()
                or ":" in model or any(part in {"", ".", ".."} for part in model.replace("\\", "/").split("/"))):
            raise WorkflowError("ControlNet 模型须使用模型下拉列表中的相对名称。")
        if (not isinstance(processor, str) or len(processor) > 128 or (processor and not processor.isprintable())
                or processor == "none" or (key == "openpose" and processor not in {"", "OpenposePreprocessor"})):
            raise WorkflowError("ControlNet 预处理选择无效。留空可设为仅直用。")
        strength, start, end, resolution = (row[field] for field in ("strength", "start_percent", "end_percent", "resolution"))
        if not all(type(value) in (int, float) for value in (strength, start, end)) or not (
            (-10 if name == ANIMA_WORKFLOW else 0) <= strength <= 10 and 0 <= start <= end <= 1
        ):
            raise WorkflowError("ControlNet 强度或生效区间无效，开始与结束比例须按顺序填写 0 到 1。")
        if type(resolution) is not int or not 64 <= resolution <= 16384:
            raise WorkflowError("ControlNet 预处理分辨率须为 64 到 16384 的整数。")
        rows.append({**row, "label": label.strip(), "model": model.replace("\\", "/")})
    return rows


def controlnet_node_types(name):
    if name == ADVANCED_V40_WORKFLOW:
        return {"LoadImage", "ControlNetLoader", "ControlNetApplyAdvanced",
                "AIO_Preprocessor", "OpenposePreprocessor", "PreviewImage"}
    if name == ANIMA_WORKFLOW:
        return {"LoadImage", "ModelPatchLoader", "AnimaLLLiteApply", "AIO_Preprocessor", "PreviewImage"}
    return set()


def controlnet_switches(name, bindings):
    if bindings is None:
        return {}
    branches = CONTROL_BRANCHES.get(name, {})
    if not isinstance(bindings, dict) or bindings.keys() - branches.keys():
        raise WorkflowError("此工作流不支持所选 ControlNet 分支。")
    switches = {}
    for key, binding in bindings.items():
        branch = branches[key]
        if binding is not None and (
            not isinstance(binding, dict) or binding.keys() - {"type", "mode", "image", "profile"}
            or not isinstance(binding.get("type"), str)
            or binding.get("mode") not in MODES
            or not isinstance(binding.get("image"), str) or not binding["image"].strip()
        ):
            raise WorkflowError(f"ControlNet 分支「{key}」的图片、类型或处理方式无效。")
        if binding is not None:
            profile = binding.get("profile")
            if profile is None and binding["type"] not in branch.types:
                raise WorkflowError(f"ControlNet 分支「{key}」不支持此类型。")
            if profile is not None and not (
                isinstance(profile, dict) and profile.get("workflow") == name and profile.get("branch") == key
                and profile.get("type") == binding["type"] and (binding["mode"] == "direct" or profile.get("preprocessor"))
            ):
                raise WorkflowError(f"ControlNet 分支「{key}」的预设不适用于所选类型或处理方式。")
        switches[branch.branch] = binding is not None
    return switches


def _node_inputs(graph, node_id, kind):
    node = graph.get(node_id)
    if not node or node["class_type"] != kind:
        raise WorkflowError(f"ControlNet 缺少节点 #{node_id}（{kind}），请更新工作流。")
    return node["inputs"]


def _choices(schemas, kind, field):
    groups = schemas.get(kind, {}).get("input", {})
    spec = groups.get("required", {}).get(field) or groups.get("optional", {}).get(field)
    return combo_options(spec) or []


def _loader_fields(name):
    return ("ModelPatchLoader", "name") if name == ANIMA_WORKFLOW else ("ControlNetLoader", "control_net_name")


def controlnet_profile_choices(name, key, schemas):
    loader, field = _loader_fields(name)
    models = [value.replace("\\", "/") for value in _choices(schemas, loader, field)]
    processors = (
        ["OpenposePreprocessor"] if "OpenposePreprocessor" in schemas else []
    ) if key == "openpose" else [
        value for value in _choices(schemas, "AIO_Preprocessor", "preprocessor") if value != "none"
    ]
    return {"models": models, "preprocessors": processors, "strength_min": -10 if name == ANIMA_WORKFLOW else 0}


def validate_controlnet_profile_choices(profile, choices, *, preprocess=True):
    if profile["model"] not in choices["models"]:
        raise WorkflowError(f"ComfyUI 未提供预设「{profile['label']}」的模型：{profile['model']}")
    if preprocess and profile["preprocessor"] and profile["preprocessor"] not in choices["preprocessors"]:
        raise WorkflowError(f"ComfyUI 未提供预设「{profile['label']}」的预处理器：{profile['preprocessor']}")


def configure_controlnets(name, graph, bindings, schemas):
    """Apply bindings to an owned graph before constructing the final Workflow."""
    if not bindings:
        return set()
    replaced = set()
    branches = CONTROL_BRANCHES[name]
    anima = name == ANIMA_WORKFLOW
    loader_kind, model_field = _loader_fields(name)
    apply_kind, apply_model = ("AnimaLLLiteApply", "model_patch") if anima else ("ControlNetApplyAdvanced", "control_net")
    for key, binding in bindings.items():
        if binding is None:
            continue
        branch = branches[key]
        source = _node_inputs(graph, branch.image, "LoadImage")
        loader = _node_inputs(graph, branch.loader, loader_kind)
        apply = _node_inputs(graph, branch.apply, apply_kind)
        if apply.get(apply_model) != [branch.loader, 0] or apply.get("image") != [branch.switch or branch.preprocessor, 0]:
            raise WorkflowError(f"ControlNet 分支「{key}」的节点连接已更改。")

        preprocess = binding["mode"] == "preprocess"
        profile = binding.get("profile")
        available = {value.replace("\\", "/"): value for value in _choices(schemas, loader_kind, model_field)}
        if profile:
            validate_controlnet_profile_choices(profile, controlnet_profile_choices(name, key, schemas), preprocess=preprocess)
            model = available[profile["model"]]
            for field in ("strength", "start_percent", "end_percent"):
                apply[field] = profile[field]
        else:
            model = next((available[path] for path in branch.types[binding["type"]] if path in available), None)
        if model is None:
            raise WorkflowError(f"ComfyUI 未提供 ControlNet 分支「{key}」所需的 {binding['type']} 模型。")

        preprocessor_kind = "OpenposePreprocessor" if key == "openpose" else "AIO_Preprocessor"
        if branch.switch:
            switch = _node_inputs(graph, branch.switch, "easy imageSwitch")
            if switch.get("image_a") != [branch.preprocessor, 0] or switch.get("image_b") != [branch.image, 0]:
                raise WorkflowError(f"ControlNet 分支「{key}」的图片选择器连接已更改。")
            switch["boolean"] = preprocess
        if not preprocess and anima:
            apply["image"] = [branch.image, 0]
            if not any([branch.preprocessor, 0] in n["inputs"].values() for n in graph.values()):
                graph.pop(branch.preprocessor, None)
        if preprocess:
            processor = _node_inputs(graph, branch.preprocessor, preprocessor_kind)
            if processor.get("image") != [branch.image, 0]:
                raise WorkflowError(f"ControlNet 分支「{key}」的预处理图片连接已更改。")
            if key == "openpose":
                field, value = "scale_stick_for_xinsr_cn", "disable"
            else:
                field, value = "preprocessor", profile["preprocessor"] if profile else AIO_PREPROCESSORS[binding["type"]]
            if value not in _choices(schemas, preprocessor_kind, field):
                raise WorkflowError(f"ComfyUI 未提供 ControlNet 预处理选项 {value}。")
            processor[field] = value
            if profile:
                processor["resolution"] = profile["resolution"]

        required = ["LoadImage", apply_kind]
        if preprocess:
            required.append("PreviewImage")
        for kind in required:
            if kind not in schemas:
                raise WorkflowError(f"ComfyUI 未提供 ControlNet 所需的节点 {kind}。")
        source["image"], loader[model_field] = binding["image"], model
        replaced.add((branch.image, "image"))
    return replaced


def without_controlnet_images(mapping, replaced):
    if not replaced:
        return mapping
    return {
        role: [field for field in fields if tuple(field.split(".", 1)) not in replaced]
        if role in ("image", "optional_image") else fields
        for role, fields in mapping.items()
    }


def add_controlnet_previews(workflow, bindings):
    for key, binding in (bindings or {}).items():
        if binding is None:
            continue
        branch = CONTROL_BRANCHES[workflow.name][key]
        preprocess = binding["mode"] == "preprocess"
        expected = branch.preprocessor if preprocess else branch.image
        if (
            branch.apply not in workflow.active
            or workflow.graph[branch.apply]["inputs"]["image"] != [expected, 0]
        ):
            raise WorkflowError(f"ControlNet 分支「{key}」未连接到生成结果。")
        if not preprocess:
            continue
        output = f"astrbot_controlnet_{key}"
        if output in workflow.graph:
            raise WorkflowError(f"工作流已使用 ControlNet 预览节点 {output}。")
        workflow.graph[output] = {"class_type": "PreviewImage", "inputs": {"images": [expected, 0]}}
        workflow.controlnet_outputs[key] = output
        workflow.active.add(output)
