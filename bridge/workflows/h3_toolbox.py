"""Map workbench controls to the fixed nodes in the H3 Toolbox workflows."""

import json
import re
from copy import copy, deepcopy
from pathlib import Path

from .workflow import H3_DUAL, PH3_IMAGE, TOOLBOX_OUTPUT_PREFIXES, Workflow, WorkflowError, is_link

PANEL_NODES = {
    H3_DUAL: {
        "references": ("5994", "AmiaomiaoH3_ReferenceHub"),
        "settings": ("21", "AmiaomiaoH3_GenerationSettings"),
        "picker": ("6108", "AmiaomiaoH3_MiniMaxClipStagePicker"),
        "cut": ("6103", "AmiaomiaoH3_H3VideoCutterV3"),
        "join": ("6104", "AmiaomiaoH3_H3LongBuilderV3"),
    },
    PH3_IMAGE: {"images": ("65", "AmiaomiaoH3_H3 Image Reference Loader")},
}
OPERATIONS = {"cut", "join"}
DOCUMENT_FIELDS = {"references", "media_files"}
DECIMAL_FIELDS = {"seconds", "megapixels", "target_megapixels", "upscale", "segment_duration",
                  "scale_percent", "fps", "playback_speed_custom"}
TOOLBOX_CUT = "AmiaomiaoH3_H3VideoCutterV3"
TOOLBOX_OUTPUTS = {"50": "h3_clip_v2", "6103": "h3v3_cut", "6104": "h3v3_film"}
PREVIOUS_PREFIXES = {H3_DUAL: {"45": "vedio/H3_一采", "46": "vedio/H3_二采"}, PH3_IMAGE: {"62": "PH3"}}


def toolbox_workflow(name, graph, settings, mapping=None):
    operations = {PANEL_NODES[name][role][0] for role in OPERATIONS & PANEL_NODES[name].keys()}
    selected = {key: node for key, node in graph.items() if key not in operations}
    for key, old in PREVIOUS_PREFIXES[name].items():
        node = selected.get(key, {})
        inputs = node.get("inputs", {})
        if inputs.get("filename_prefix") == old:
            selected[key] = {**node, "inputs": {**inputs, "filename_prefix": TOOLBOX_OUTPUT_PREFIXES[name][key]}}
    if name == PH3_IMAGE and "32" in selected and selected["44"]["inputs"]["boolean"] is False:
        # Keep the optional rewriter editable in the saved profile, but detach it from
        # the active output to avoid validating its model when rewriting is disabled.
        switch = deepcopy(selected["44"])
        switch["inputs"]["on_true"] = switch["inputs"]["on_false"]
        selected["44"] = switch
    workflow = Workflow(name, {"prompt": selected, "astrbot": settings}, mapping)
    workflow.toolbox_operations = {key: deepcopy(graph[key]) for key in operations if key in graph}
    if name == H3_DUAL:
        workflow._visit("50", set())
        if not {"45", "46"} <= set(workflow.outputs):
            raise WorkflowError("H3 双采需要一采视频 #45、二采视频 #46 和片段保存 #50。")
        select_delivery(workflow)
    return workflow


def select_delivery(workflow):
    picker = workflow.graph["6108"]["inputs"]
    draft = picker["passes"] in ("单采", "一采") or (picker.get("draft_only") and not picker.get("refine_clip"))
    output = "45" if draft else "46"
    workflow.outputs = [output]
    workflow.execution_outputs = [output, "50"]
    workflow.graph[output]["inputs"]["save_output"] = True


def toolbox_panels(workflow):
    panels = {}
    for role, (key, expected) in PANEL_NODES.get(workflow.name, {}).items():
        nodes = workflow.toolbox_operations if role in OPERATIONS else workflow.graph
        node = nodes.get(key, {})
        if node.get("class_type") == expected and (role in OPERATIONS or key in workflow.active):
            panels[role] = {
                "node": key, "class_type": expected,
                "values": {name: value for name, value in node["inputs"].items()
                           if name != "stage_plan" and type(value) in (str, int, float, bool)},
            }
    return panels


def valid_file(filename, subfolder="", kind="input"):
    from ..studio.h3_media import media_view

    if not isinstance(filename, str) or not isinstance(subfolder, str) or "/" in filename or "\\" in filename:
        raise WorkflowError("H3 素材文件名无效。")
    if kind not in ("input", "output", "temp"):
        raise WorkflowError("H3 素材目录无效。")
    return media_view(f"{subfolder + '/' if subfolder else ''}{filename} [{kind}]")


def validate_document(name, raw):
    if len(raw.encode("utf-8")) > 512 * 1024:
        raise WorkflowError("H3 参考素材列表过大。")
    data = json.loads(raw)
    if name == "references":
        if not isinstance(data, dict) or data.get("version") != 1:
            raise WorkflowError("H3 参考素材格式无效。")
        groups = [data.get(key) for key in ("images", "audios", "videos")]
    else:
        groups = [data]
    for rows in groups:
        if not isinstance(rows, list) or len(rows) > 256:
            raise WorkflowError("H3 参考素材列表无效。")
        for row in rows:
            if not isinstance(row, dict):
                raise WorkflowError("H3 素材卡片无效。")
            if row.get("filename"):
                valid_file(row["filename"], row.get("subfolder", ""), row.get("type", "input"))
            elif not (
                name == "references" and type(row.get("segment_id")) is int
                and isinstance(row.get("project"), str)
            ):
                raise WorkflowError("H3 素材卡片缺少文件或片段。")


def cutter_source(fields, workspace):
    from ..client import VIDEO_MIME
    from ..studio.h3_media import media_view

    source, video = fields.get("custom_path", ""), fields.get("video", "")
    if not isinstance(source, str) or not isinstance(video, str):
        raise WorkflowError("裁切视频路径必须为文本。")
    source = source.strip()
    if source:
        path = Path(source)
        if not path.is_absolute():
            path = workspace / "input" / path
        path = path.resolve()
        if not any(path.is_relative_to(workspace / folder) for folder in ("input", "output")):
            raise WorkflowError("裁切源视频必须位于 ComfyUI input 或 output。")
        if not path.is_file() or path.suffix.lower() not in VIDEO_MIME:
            raise WorkflowError("裁切源视频文件不存在。")
        return {"custom_path": str(path), "video": ""}
    if video:
        file = media_view(video.strip())
        if file["type"] != "input" or Path(file["filename"]).suffix.lower() not in VIDEO_MIME:
            raise WorkflowError("裁切视频下拉框只支持 ComfyUI input 中的视频。")
        relative = f"{file['subfolder']}/{file['filename']}".lstrip("/")
        if not (workspace / "input" / relative).resolve().is_relative_to(workspace / "input"):
            raise WorkflowError("裁切输入路径超出 ComfyUI input。")
        if any(char in relative for char in "%$~"):
            raise WorkflowError("裁切输入使用实际文件名。")
        return {"custom_path": "", "video": relative}
    raise WorkflowError("请先选择要裁切的视频。")


def apply_panels(workflow, values, action=None, *, workspace):
    if not isinstance(values, dict) or (action is not None and action not in OPERATIONS):
        raise WorkflowError("H3 工具箱任务格式无效。")
    panels = toolbox_panels(workflow)
    allowed = {action} if action else panels.keys() - OPERATIONS
    if not values.keys() <= allowed or (action and action not in panels):
        raise WorkflowError("当前工作流缺少对应的 H3 工具箱节点。")
    selected = copy(workflow)
    selected.graph = deepcopy(workflow.graph if not action else workflow.toolbox_operations)
    for role, changes in values.items():
        spec = panels[role]
        if not isinstance(changes, dict) or not changes.keys() <= spec["values"].keys():
            raise WorkflowError("H3 工具箱参数不存在或已连线。")
        for key, value in changes.items():
            default = spec["values"][key]
            if type(value) is not type(default) and not (
                key in DECIMAL_FIELDS and type(value) in (int, float)
            ):
                raise WorkflowError(f"H3 工具箱参数 {key} 类型无效。")
            if isinstance(value, str):
                if key in DOCUMENT_FIELDS:
                    validate_document(key, value)
                elif len(value) > 16384 or "\0" in value:
                    raise WorkflowError(f"H3 工具箱参数 {key} 过长或格式无效。")
            elif type(value) in (int, float) and not -1e8 <= value <= 1e8:
                raise WorkflowError(f"H3 工具箱参数 {key} 超出范围。")
        selected.graph[spec["node"]]["inputs"].update(changes)
    if action:
        key = panels[action]["node"]
        node = selected.graph[key]
        if any(is_link(value) for value in node["inputs"].values()):
            raise WorkflowError("裁切和拼接需要独立的工具箱节点。")
        if action == "cut":
            node["inputs"].update(cutter_source(node["inputs"], workspace))
        else:
            name = node["inputs"].get("output_name", "")
            if name and (not re.fullmatch(r'[^<>:"/\\|?*\x00-\x1f]{1,100}', name) or name in {".", ".."}):
                raise WorkflowError("拼接文件名只能填写文件名。")
        selected.graph = {key: node}
        selected.active = {key}
        selected.outputs = [key]
        selected.execution_outputs = None
        selected.positive = selected.negative = selected.seeds = selected.image_inputs = []
        selected.image_required = False
        selected.default_seed = -1
    elif selected.name == H3_DUAL:
        select_delivery(selected)
        if selected.graph["6108"]["inputs"].get("refine_clip"):
            # Toolbox restores the saved draft's prompt and conditions at submission.
            selected.positive = []
    return selected
