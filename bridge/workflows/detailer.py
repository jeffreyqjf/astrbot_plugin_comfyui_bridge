"""Select the optional final feet pass before submitting Detailer V40."""

from copy import deepcopy

from .workflow import DETAILER_WORKFLOW, Workflow, WorkflowError, is_link

FEET_NODES = ("497", "498", "499")
FEET_DETAILER = FEET_NODES[-1]
FEET_SWITCH = "500"


def feet_switch(graph):
    node = graph.get(FEET_SWITCH) if isinstance(graph, dict) else None
    if not isinstance(node, dict) or node.get("class_type") != "ComfySwitchNode":
        return None
    inputs = node.get("inputs")
    output = graph.get("32")
    output_inputs = output.get("inputs") if isinstance(output, dict) else None
    if (
        isinstance(inputs, dict) and inputs.get("on_true") == [FEET_DETAILER, 0]
        and is_link(inputs.get("on_false")) and isinstance(output_inputs, dict)
        and output_inputs.get("images") == [FEET_SWITCH, 0]
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
        or any(key in graph for key in new_nodes) or not feet_switch(bundled_graph)
    ):
        return False
    for key in new_nodes:
        graph[key] = deepcopy(bundled_graph[key])
    graph[FEET_DETAILER]["inputs"]["image"] = image
    graph[FEET_SWITCH]["inputs"]["on_false"] = image
    source["inputs"]["images"] = [FEET_SWITCH, 0]
    detailer_workflow(graph, profile.get("astrbot", {}), None, {"feet": True})
    return True
