"""Bind independent ControlNet images to the supported API graph branches."""

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
            "openpose": ("IL-controlnet/openpose_noob.safetensors", "openpose_noob.safetensors"),
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


def controlnet_capabilities(name):
    return {
        key: {"types": list(branch.types), "modes": list(MODES)}
        for key, branch in CONTROL_BRANCHES.get(name, {}).items()
    }


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
            not isinstance(binding, dict) or binding.keys() != {"type", "mode", "image"}
            or not isinstance(binding["type"], str) or binding["type"] not in branch.types
            or binding["mode"] not in MODES
            or not isinstance(binding["image"], str) or not binding["image"].strip()
        ):
            raise WorkflowError(f"ControlNet 分支「{key}」的图片、类型或处理方式无效。")
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


def configure_controlnets(name, graph, bindings, schemas):
    """Apply bindings to an owned graph before constructing the final Workflow."""
    if not bindings:
        return set()
    replaced = set()
    branches = CONTROL_BRANCHES[name]
    anima = name == ANIMA_WORKFLOW
    loader_kind, model_field = ("ModelPatchLoader", "name") if anima else ("ControlNetLoader", "control_net_name")
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

        available = {value.replace("\\", "/"): value for value in _choices(schemas, loader_kind, model_field)}
        model = next((available[path] for path in branch.types[binding["type"]] if path in available), None)
        if model is None:
            raise WorkflowError(f"ComfyUI 未提供 ControlNet 分支「{key}」所需的 {binding['type']} 模型。")

        preprocess = binding["mode"] == "preprocess"
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
                field, value = "preprocessor", AIO_PREPROCESSORS[binding["type"]]
            if value not in _choices(schemas, preprocessor_kind, field):
                raise WorkflowError(f"ComfyUI 未提供 ControlNet 预处理选项 {value}。")
            processor[field] = value

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
