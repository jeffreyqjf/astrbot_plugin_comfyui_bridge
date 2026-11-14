"""Store API workflow profiles and move old built-in names to their current paths."""

import hashlib
import json
from pathlib import Path
from tempfile import NamedTemporaryFile

from .detailer import add_feet_to_profile, detailer_workflow
from .lightning import lightning_workflow
from .svi import svi_workflow
from .v40 import V40_WORKFLOWS, upgrade_detailer, v40_workflow
from .workflow import (
    ADVANCED_V40_WORKFLOW,
    AIO_WORKFLOW,
    ANIMA_WORKFLOW,
    DETAILER_WORKFLOW,
    LIGHTNING_WORKFLOW,
    REVERSE_WORKFLOW,
    SDXL_WORKFLOW,
    SVI_WORKFLOW,
    WAI_WORKFLOW,
    Workflow,
    WorkflowError,
    profile_parts,
)

WORKFLOW_LIMIT = 4 * 1024 * 1024
RENAMED_WORKFLOWS = {
    "AnimaAdvancedV10_AstrBot": ANIMA_WORKFLOW,
    "Anima_反推流_AstrBot": REVERSE_WORKFLOW,
    "sdxlturbo": SDXL_WORKFLOW,
}
RETIRED_WORKFLOWS = {"Anima_I2I_QQ", "AnimaAdvancedV10_Image_AstrBot"}
WORKFLOW_SHORT_NAMES = {
    ANIMA_WORKFLOW: "t2i",
    AIO_WORKFLOW: "i2i",
    DETAILER_WORKFLOW: "detailer",
    ADVANCED_V40_WORKFLOW: "v40",
    WAI_WORKFLOW: "wai",
    SDXL_WORKFLOW: "sdxl",
    "WAN22_T2V_AstrBot": "wan-t2v",
    "WAN22_I2V_AstrBot": "wan-i2v",
    SVI_WORKFLOW: "svi",
    LIGHTNING_WORKFLOW: "lightning",
    REVERSE_WORKFLOW: "reverse",
}
WORKFLOW_ALIASES = {
    **{old.casefold(): new for old, new in RENAMED_WORKFLOWS.items()},
    **{old.casefold(): AIO_WORKFLOW for old in RETIRED_WORKFLOWS},
    **{short: name for name, short in WORKFLOW_SHORT_NAMES.items()},
    "advanced-v40": ADVANCED_V40_WORKFLOW,
    "illustrious": WAI_WORKFLOW,
    "wai-illustrious t2i": WAI_WORKFLOW,
}


def renamed_keys(values):
    migrated = {}
    for old, new in RENAMED_WORKFLOWS.items():
        if old in values:
            migrated[new] = values[old]
    migrated.update((key, value) for key, value in values.items() if key not in RENAMED_WORKFLOWS)
    return migrated


def profile_bytes(data):
    return (json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode()


def workflow_revision(raw, canvas=None):
    return hashlib.sha256(raw if canvas is None else raw + b"\0" + canvas).hexdigest()


def workflow_path(directory, name):
    root = directory.resolve()
    path = root / f"{name}.json"
    if path.parent != root or path.is_symlink() or path.resolve() != path:
        raise WorkflowError("工作流文件必须位于插件工作流目录内。")
    return path


def read_profile(path):
    with path.open("rb") as stream:
        raw = stream.read(WORKFLOW_LIMIT + 1)
    if len(raw) > WORKFLOW_LIMIT:
        raise WorkflowError("工作流文件超过 4 MB。")
    return raw


def workflow_from_profile(name, data, mapping=None):
    if name in V40_WORKFLOWS:
        graph, settings = profile_parts(data)
        if isinstance(settings, dict) and "v40" in settings:
            return v40_workflow(name, graph, settings, mapping)
    builder = {
        DETAILER_WORKFLOW: detailer_workflow, SVI_WORKFLOW: svi_workflow, LIGHTNING_WORKFLOW: lightning_workflow,
    }.get(name)
    if builder:
        graph, settings = profile_parts(data)
        return builder(graph, settings, mapping)
    return Workflow(name, data, mapping)


def atomic_write(path, raw):
    temp = None
    try:
        with NamedTemporaryFile(dir=path.parent, delete=False) as stream:
            temp = Path(stream.name)
            stream.write(raw)
        temp.replace(path)
    finally:
        if temp is not None:
            temp.unlink(missing_ok=True)


def initialize_workflows(directory, bundled):
    directory.mkdir(parents=True, exist_ok=True)
    backup = directory.parent / "workflow_backup"
    for old, new in RENAMED_WORKFLOWS.items():
        source, target = (workflow_path(directory, name) for name in (old, new))
        if source.is_file() and not target.exists():
            source.rename(target)
    obsolete = set(RENAMED_WORKFLOWS)
    if (bundled / f"{AIO_WORKFLOW}.json").is_file() or (directory / f"{AIO_WORKFLOW}.json").is_file():
        obsolete.update(RETIRED_WORKFLOWS)
    for name in sorted(obsolete):
        source = workflow_path(directory, name)
        if not source.is_file():
            continue
        if backup.is_symlink():
            raise WorkflowError("旧工作流备份目录无效。")
        backup.mkdir(exist_ok=True)
        target = workflow_path(backup, name)
        suffix = 1
        while target.exists():
            target = workflow_path(backup, f"{name}.{suffix}")
            suffix += 1
        source.rename(target)
    for source in sorted(bundled.glob("*.json")):
        if source.stem in RETIRED_WORKFLOWS or source.stem in RENAMED_WORKFLOWS:
            continue
        target = workflow_path(directory, source.stem)
        if not target.exists():
            atomic_write(target, read_profile(source))
        elif source.stem == DETAILER_WORKFLOW:
            try:
                profile = json.loads(read_profile(target))
                bundled_profile = json.loads(read_profile(source))
                bundled_graph, bundled_settings = profile_parts(bundled_profile)
                upgraded = upgrade_detailer(profile, bundled_profile) if "v40" in bundled_settings else None
                _, settings = profile_parts(profile)
                updated = upgraded is not None or (
                    "v40" not in settings and add_feet_to_profile(profile, bundled_graph)
                )
            except (ValueError, OSError, TypeError, KeyError, AttributeError, RecursionError):
                # Keep independently edited profiles for the usual loader to validate.
                continue
            if upgraded is not None:
                if backup.is_symlink():
                    raise WorkflowError("旧工作流备份目录无效。")
                backup.mkdir(exist_ok=True)
                legacy = workflow_path(backup, f"{source.stem}.before-branches")
                if not legacy.exists():
                    atomic_write(legacy, read_profile(target))
                atomic_write(target, profile_bytes(upgraded))
            elif updated:
                atomic_write(target, profile_bytes(profile))


def load_workflows(directory, mappings):
    workflows, errors = {}, {}
    for source in sorted(directory.glob("*.json")):
        if source.stem in RETIRED_WORKFLOWS or source.stem in RENAMED_WORKFLOWS:
            continue
        try:
            path = workflow_path(directory, source.stem)
            data = json.loads(read_profile(path))
            workflows[path.stem] = workflow_from_profile(path.stem, data, mappings.get(path.stem))
        except (ValueError, OSError, KeyError, TypeError, RecursionError) as exc:
            errors[source.stem] = str(exc)[:400]
    return workflows, errors
