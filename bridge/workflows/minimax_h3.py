"""Attach one AstrBot-selected reference image to the MiniMax H3 video graph."""

from .workflow import Workflow, WorkflowError


def h3_with_reference(workflow):
    node = workflow.graph.get("5")
    if not node or node["class_type"] != "MiniMaxH3ReferenceToVideo" or "5" not in workflow.active:
        raise WorkflowError("MiniMax H3 工作流缺少连接到视频输出的参考图节点 #5。")
    if "astrbot_h3_reference" in workflow.graph:
        raise WorkflowError("MiniMax H3 工作流已使用保留的参考图节点 ID。")
    graph = {
        **workflow.graph,
        "5": {**node, "inputs": {**node["inputs"], "ref_images.ref_image_0": ["astrbot_h3_reference", 0]}},
        "astrbot_h3_reference": {
            "class_type": "LoadImage",
            "inputs": {"image": "__astrbot_upload_pending__.png"},
        },
    }
    return Workflow(workflow.name, {"prompt": graph, "astrbot": {
        "positive_prefix": workflow.positive_prefix,
        "use_canvas_seed": workflow.default_seed != -1,
        "node_mapping": {**workflow.mapping, "image": ["astrbot_h3_reference.image"]},
    }})
