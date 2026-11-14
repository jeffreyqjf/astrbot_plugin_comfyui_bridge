"""Transfer API workflow profiles and ZIP bundles with the Anima canvas."""

import io
import json
import re
import zipfile

from .anima_aio import aio_workflow
from .illustrious import wai_workflow
from .v40 import V40_WORKFLOWS
from .workflow import (
    AIO_WORKFLOW,
    ANIMA_WORKFLOW,
    REVERSE_WORKFLOW,
    SDXL_WORKFLOW,
    SEGMENTED_VIDEO_WORKFLOWS,
    WAI_WORKFLOW,
    WorkflowError,
    profile_parts,
)
from .workflow_store import (
    RENAMED_WORKFLOWS,
    RETIRED_WORKFLOWS,
    WORKFLOW_LIMIT,
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


def install_workflows(directory, template_dir, data, mappings, *, filename="", replace=False):
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
    builtin_names = {ANIMA_WORKFLOW, AIO_WORKFLOW, REVERSE_WORKFLOW, SDXL_WORKFLOW, WAI_WORKFLOW} | SEGMENTED_VIDEO_WORKFLOWS | V40_WORKFLOWS
    canonical = {name.casefold(): name for name in mappings.keys() | builtin_names}
    files, workflows = {}, {}
    for name, raw in profiles.items():
        folded = name.casefold()
        if folded in existing and not replace:
            skipped.append(existing[folded])
            continue
        name = existing.get(folded, canonical.get(folded, name))
        path = workflow_path(directory, name)
        try:
            workflow = validate_workflow_profile(name, json.loads(raw), mappings.get(name))
        except (ValueError, TypeError, KeyError, RecursionError) as exc:
            raise WorkflowError(f"工作流 {name} 无法导入：{str(exc)[:300]}") from exc
        files[path] = raw
        workflows[name] = workflow

    if canvas is not None and ANIMA_WORKFLOW in workflows:
        validate_anima_canvas(json.loads(canvas))
        if template_dir.is_symlink():
            raise WorkflowError("Anima 画布目录无效。")
        template_dir.mkdir(exist_ok=True)
        files[workflow_path(template_dir, ANIMA_WORKFLOW)] = canvas

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
