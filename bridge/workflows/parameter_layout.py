"""Store the Workbench's field order independently of workflow graph values."""

from graphlib import CycleError, TopologicalSorter

from .workflow import WorkflowError, is_link, profile_parts
from .workflow_fields import JSON_WIDGETS

PARAMETER_LAYOUT = "parameter_layout"


def default_parameter_layout(graph):
    """Order potential widgets without depending on a live ComfyUI instance."""
    dependencies = {
        key: {str(value[0]) for value in node["inputs"].values() if is_link(value) and str(value[0]) in graph}
        for key, node in graph.items()
    }
    topology = TopologicalSorter(dependencies)
    try:
        topology.prepare()
    except CycleError:
        # An inactive branch can contain a cycle even when the outputs are valid.
        pass

    def node_order(key):
        digits = key.lstrip("0")
        return (0, len(digits), digits, key) if key.isascii() and key.isdecimal() else (1, 0, key, key)

    ordered = []
    while topology.is_active():
        ready = sorted(topology.get_ready(), key=node_order)
        ordered.extend(ready)
        topology.done(*ready)
    ordered.extend(sorted(graph.keys() - set(ordered), key=node_order))
    fields = [
        f"{key}.{name}"
        for key in ordered
        for name, value in sorted(graph[key]["inputs"].items())
        if not is_link(value) and not name.startswith(("Select to add ", "__lm_"))
        and (isinstance(value, (str, int, float)) or (name in JSON_WIDGETS and isinstance(value, (list, dict))))
    ]
    return {"version": 1, "categories": [], "fields": fields}


def validate_parameter_layout(layout):
    if not isinstance(layout, dict) or type(layout.get("version")) is not int or layout["version"] != 1:
        raise WorkflowError("参数布局版本无效。")
    for name in ("categories", "fields"):
        items = layout.get(name)
        if not isinstance(items, list) or any(not isinstance(item, str) or not item.strip() for item in items):
            raise WorkflowError("参数布局须由分类和字段名称列表组成。")
        if len(set(items)) != len(items):
            raise WorkflowError("参数布局包含重复项。")
    if any(not key.partition(".")[0] or not key.partition(".")[2] for key in layout["fields"]):
        raise WorkflowError("参数布局须使用节点 ID 和输入字段名称。")
    return {name: layout[name] for name in ("version", "categories", "fields")}


def read_parameter_layout(settings):
    if not isinstance(settings, dict):
        return None
    try:
        return validate_parameter_layout(settings.get(PARAMETER_LAYOUT))
    except WorkflowError:
        return None


def preserve_parameter_layout(incoming, current, *, create=False):
    """Copy prior layout metadata on replacement, or seed a new custom profile."""
    graph, settings = profile_parts(incoming)
    _, previous = profile_parts(current)
    if isinstance(previous, dict) and PARAMETER_LAYOUT in previous:
        if PARAMETER_LAYOUT in settings and settings[PARAMETER_LAYOUT] == previous[PARAMETER_LAYOUT]:
            return incoming
        settings = {**settings, PARAMETER_LAYOUT: previous[PARAMETER_LAYOUT]}
    elif current is not None:
        if PARAMETER_LAYOUT not in settings:
            return incoming
        settings = {key: value for key, value in settings.items() if key != PARAMETER_LAYOUT}
    elif PARAMETER_LAYOUT in settings:
        validate_parameter_layout(settings[PARAMETER_LAYOUT])
        return incoming
    elif create:
        settings = {**settings, PARAMETER_LAYOUT: default_parameter_layout(graph)}
    else:
        return incoming

    profile = {} if graph is incoming else incoming
    return {**profile, "prompt": graph, "astrbot": settings}
