"""Transfer API workflow profiles and ZIP bundles with the Anima canvas."""

import io
import json
import re
import zipfile
from copy import deepcopy

from .anima_aio import aio_workflow
from .illustrious import wai_workflow
from .parameter_layout import preserve_parameter_layout
from .workflow import (
    AIO_WORKFLOW,
    ANIMA_WORKFLOW,
    WAI_WORKFLOW,
    WorkflowError,
    is_link,
    profile_parts,
)
from .workflow_store import (
    RENAMED_WORKFLOWS,
    RETIRED_WORKFLOWS,
    WORKFLOW_LIMIT,
    WORKFLOW_SHORT_NAMES,
    atomic_write,
    profile_bytes,
    read_profile,
    workflow_from_profile,
    workflow_path,
)

ARCHIVE_LIMIT = 16 * 1024 * 1024
EXPANDED_LIMIT = 32 * 1024 * 1024
ENTRY_LIMIT = 128
CANVAS_ENTRY = f"templates/{ANIMA_WORKFLOW}.json"
OLD_CANVAS_ENTRY = "templates/AnimaAdvancedV10_AstrBot.json"
SAFE_NAME = re.compile(r'[^\x00-\x1f<>:"/\\|?*]{1,128}')
RESERVED_NAMES = re.compile(r"(?i)(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?")


def workflow_file_stem(filename):
    name = filename[:-5]
    if (not filename.lower().endswith(".json") or not SAFE_NAME.fullmatch(name) or name != name.strip()
            or name.endswith(".") or RESERVED_NAMES.fullmatch(name)):
        raise WorkflowError(f"工作流文件名无效：{filename[:120]}")
    return name


def export_profile(directory, workflow):
    workflow_file_stem(f"{workflow.name}.json")
    raw = read_profile(workflow_path(directory, workflow.name))
    if workflow.mapping:
        graph, settings = profile_parts(json.loads(raw))
        raw = profile_bytes({"prompt": graph, "astrbot": {**settings, "node_mapping": workflow.mapping}})
    if len(raw) > WORKFLOW_LIMIT:
        raise WorkflowError(f"工作流 {workflow.name} 超过 4 MB。")
    return raw


def export_archive(directory, workflows, canvas_path):
    result = io.BytesIO()
    if not workflows:
        raise WorkflowError("没有可导出的工作流。")
    if len(workflows) + (ANIMA_WORKFLOW in workflows) > ENTRY_LIMIT:
        raise WorkflowError("工作流数量超过 ZIP 上限。")
    total = 0
    with zipfile.ZipFile(result, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, workflow in workflows.items():
            entry = f"workflows/{name}.json"
            raw = export_profile(directory, workflow)
            total += len(raw)
            if total > EXPANDED_LIMIT:
                raise WorkflowError("工作流 ZIP 解压后超过 32 MB。")
            archive.writestr(entry, raw)
        if ANIMA_WORKFLOW in workflows and canvas_path.is_file():
            raw = read_profile(canvas_path)
            archive.writestr(CANVAS_ENTRY, raw)
            total += len(raw)
    if total > EXPANDED_LIMIT or result.tell() > ARCHIVE_LIMIT:
        raise WorkflowError("工作流 ZIP 超过大小上限。")
    return result.getvalue()


def read_archive(data):
    if not data or len(data) > ARCHIVE_LIMIT:
        raise WorkflowError("请选择不超过 16 MB 的工作流 ZIP。")
    profiles, canvas, skipped = {}, None, []
    seen = set()
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = archive.infolist()
            if len(entries) > ENTRY_LIMIT or sum(row.file_size for row in entries) > EXPANDED_LIMIT:
                raise WorkflowError("工作流 ZIP 包含过多文件或解压后超过 32 MB。")
            for entry in entries:
                path = entry.filename
                if entry.is_dir() and path in {"workflows/", "templates/"}:
                    continue
                if entry.file_size > WORKFLOW_LIMIT:
                    raise WorkflowError(f"ZIP 内文件超过 4 MB：{path[:120]}")
                if path in {CANVAS_ENTRY, OLD_CANVAS_ENTRY}:
                    if canvas is not None:
                        raise WorkflowError("ZIP 内包含重复的 Anima 画布。")
                    canvas = archive.read(entry)
                    continue
                name = workflow_file_stem(path.removeprefix("workflows/"))
                if name in RETIRED_WORKFLOWS:
                    skipped.append(name)
                    continue
                name = RENAMED_WORKFLOWS.get(name, name)
                folded = name.casefold()
                if folded in seen:
                    raise WorkflowError(f"ZIP 内包含同名工作流：{name}")
                seen.add(folded)
                profiles[name] = archive.read(entry)
    except (zipfile.BadZipFile, NotImplementedError, RuntimeError, OSError) as exc:
        raise WorkflowError("无法读取工作流 ZIP，请检查压缩包是否完整。") from exc
    if not profiles:
        raise WorkflowError("ZIP 内没有可导入的 API 工作流。")
    return profiles, canvas, skipped


def validate_anima_canvas(canvas):
    if not isinstance(canvas, dict) or not isinstance(canvas.get("nodes"), list) or not isinstance(canvas.get("groups"), list):
        raise WorkflowError("Anima 画布格式无效。")
    if any(
        not isinstance(node, dict) or not {"id", "type", "mode", "pos"} <= node.keys()
        or not isinstance(node["pos"], list) or len(node["pos"]) < 2
        or any(type(value) not in (int, float) for value in node["pos"][:2])
        for node in canvas["nodes"]
    ) or any(
        not isinstance(group, dict) or not {"id", "title", "bounding"} <= group.keys()
        or not isinstance(group["bounding"], list) or len(group["bounding"]) != 4
        or any(type(value) not in (int, float) for value in group["bounding"])
        for group in canvas["groups"]
    ):
        raise WorkflowError("Anima 画布节点或分组格式无效。")
    if not any(node["id"] == 510 for node in canvas["nodes"]):
        raise WorkflowError("Anima 画布缺少输出节点 #510。")


def graph_topology(graph):
    return {
        key: (
            node["class_type"],
            {
                name: (str(value[0]), value[1]) for name, value in node["inputs"].items() if is_link(value)
            },
        )
        for key, node in graph.items()
    }


def validate_anima_canvas_profile(canvas, profile):
    validate_anima_canvas(canvas)
    nodes = {str(node["id"]): node["type"] for node in canvas["nodes"]}
    graph, _ = profile_parts(profile)
    for key, node in graph.items():
        node_id, nested, _ = key.partition(":")
        class_type = node["class_type"]
        if node_id not in nodes or (
            not nested and nodes[node_id] != class_type
            and not (node_id == "510" and nodes[node_id] == "SaveImage" and class_type == "PreviewImage")
        ):
            raise WorkflowError(f"Anima API 图的节点 #{key} 与画布不匹配。")


def preserve_anima_layout(incoming_canvas, current_canvas):
    """Apply config widgets and bypass modes to the current canvas geometry."""
    validate_anima_canvas(incoming_canvas)
    validate_anima_canvas(current_canvas)
    result = deepcopy(current_canvas)

    def subgraphs(canvas):
        return {graph["id"]: graph for graph in canvas.get("definitions", {}).get("subgraphs", [])}

    def layout_membership(canvas):
        groups = {}
        for group in canvas.get("groups", []):
            x, y, w, h = group["bounding"]
            groups[group["id"]] = {
                node["id"] for node in canvas["nodes"]
                if node["type"] != "Image Comparer (rgthree)"
                and x <= node["pos"][0] < x + w and y <= node["pos"][1] < y + h
            }
        return groups

    def nodes_by_id(canvas):
        return {node["id"]: node for node in canvas["nodes"]}

    def update(incoming, target):
        nodes = nodes_by_id(incoming)
        previous = nodes_by_id(target)
        if (
            nodes.keys() != previous.keys()
            or incoming.get("links") != target.get("links")
            or layout_membership(incoming) != layout_membership(target)
            or any(
                nodes[key].get(field) != previous[key].get(field)
                for key in nodes for field in ("type", "inputs", "outputs")
            )
        ):
            raise WorkflowError("Anima 画布的节点、连线或分组成员已变化，无法保留当前布局。")
        for key, node in nodes.items():
            for field in ("mode", "widgets_values", "widgets_values_named"):
                if field in node:
                    previous[key][field] = deepcopy(node[field])
        children = subgraphs(incoming)
        target_children = subgraphs(target)
        if children.keys() != target_children.keys():
            raise WorkflowError("Anima 画布的子图已变化，无法保留当前布局。")
        for key, child in children.items():
            update(child, target_children[key])

    try:
        update(incoming_canvas, result)
    except (AttributeError, KeyError, TypeError) as exc:
        raise WorkflowError("Anima 画布的子图格式无效。") from exc
    return result


def install_workflows(directory, template_dir, data, mappings, *, filename="", replace=False, canvas_path=None):
    if filename.lower().endswith(".json"):
        if not data or len(data) > WORKFLOW_LIMIT:
            raise WorkflowError("请选择不超过 4 MB 的工作流 JSON。")
        name = workflow_file_stem(filename)
        if name in RETIRED_WORKFLOWS:
            return {}, [name]
        profiles, canvas, skipped = {RENAMED_WORKFLOWS.get(name, name): data}, None, []
    else:
        profiles, canvas, skipped = read_archive(data)
    existing = {path.stem.casefold(): path.stem for path in directory.glob("*.json")}
    builtin_names = {name.casefold() for name in WORKFLOW_SHORT_NAMES}
    canonical = {name.casefold(): name for name in mappings.keys() | WORKFLOW_SHORT_NAMES.keys()}
    current_canvas = canvas_path if canvas_path is not None else template_dir / f"{ANIMA_WORKFLOW}.json"
    files, workflows = {}, {}
    for name, raw in profiles.items():
        folded = name.casefold()
        if folded in existing and not replace:
            skipped.append(existing[folded])
            continue
        name = existing.get(folded, canonical.get(folded, name))
        path = workflow_path(directory, name)
        try:
            incoming = json.loads(raw)
            workflow = validate_workflow_profile(name, incoming, mappings.get(name))
            previous = None
            if folded in existing:
                try:
                    previous = json.loads(read_profile(path))
                except (ValueError, RecursionError):
                    previous = {}
                if previous is None:
                    previous = {}
            profile = preserve_parameter_layout(incoming, previous, create=folded not in builtin_names)
            if profile is not incoming:
                raw = profile_bytes(profile)
                if len(raw) > WORKFLOW_LIMIT:
                    raise WorkflowError("工作流与参数布局合计超过 4 MB。")
            if name == ANIMA_WORKFLOW:
                if current_canvas.is_file():
                    old_graph, _ = profile_parts(previous)
                    try:
                        old_topology = graph_topology(old_graph) if old_graph else None
                    except (AttributeError, KeyError, TypeError):
                        old_topology = None
                    if old_topology and old_topology != graph_topology(workflow.graph):
                        raise WorkflowError("Anima API 图的节点或连线已变化，普通导入须保留当前画布。")
                    validate_anima_canvas_profile(json.loads(read_profile(current_canvas)), profile)
                elif canvas is not None:
                    validate_anima_canvas_profile(json.loads(canvas), profile)
                    if template_dir.is_symlink():
                        raise WorkflowError("Anima 画布目录无效。")
                    template_dir.mkdir(exist_ok=True)
                    files[workflow_path(template_dir, ANIMA_WORKFLOW)] = canvas
                else:
                    raise WorkflowError("导入 Anima 工作流需要配套画布。")
        except (ValueError, TypeError, KeyError, RecursionError) as exc:
            raise WorkflowError(f"工作流 {name} 无法导入：{str(exc)[:300]}") from exc
        files[path] = raw
        workflows[name] = workflow

    replace_workflow_files(files)
    return workflows, skipped


def replace_workflow_files(files):
    originals, total = {}, 0
    for path in files:
        previous = read_profile(path) if path.exists() else None
        originals[path] = previous
        total += len(previous) if previous is not None else 0
        if total > EXPANDED_LIMIT:
            raise WorkflowError("待覆盖文件超过 32 MB，请分批导入。")
    installed = []
    try:
        for path, raw in files.items():
            atomic_write(path, raw)
            installed.append(path)
    except OSError:
        for path in reversed(installed):
            previous = originals[path]
            if previous is None:
                path.unlink()
            else:
                atomic_write(path, previous)
        raise


def validate_workflow_profile(name, data, mapping):
    workflow = workflow_from_profile(name, data, mapping)
    if name not in {AIO_WORKFLOW, WAI_WORKFLOW}:
        return workflow
    graph, settings = profile_parts(data)
    if name == AIO_WORKFLOW:
        for has_image in (False, True):
            aio_workflow(graph, settings, has_image, mapping=workflow.mapping)
    else:
        wai_workflow(graph, settings, workflow.mapping)
    return workflow
