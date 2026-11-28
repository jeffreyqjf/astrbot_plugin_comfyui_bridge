"""Convert a workbench duration into inputs for the selected video graph."""

import json
from copy import copy, deepcopy
from dataclasses import dataclass
from math import ceil, floor

from .svi import MAX_VIDEO_FRAMES
from .workflow import (
    H3_SEED_FULL,
    H3_WORKFLOWS,
    LIGHTNING_WORKFLOW,
    SEGMENTED_VIDEO_WORKFLOWS,
    SVI_WORKFLOW,
    VIDEO_OUTPUT_NODES,
    WorkflowError,
    is_link,
)

WAN_CONDITIONERS = {"EmptyHunyuanLatentVideo", "WanImageToVideo"}
LIGHTNING_LIMITS = {"PainterI2VAdvanced": 4096, "PainterLongVideo": 1000}
H3_MAX_FRAMES = 3600
H3_FPS = 24


@dataclass(frozen=True)
class FrameTiming:
    nodes: tuple[str, ...]
    fps: float
    offset: float
    default_frames: int
    first: int
    step: int
    minimum: int
    maximum: int

    def seconds(self, frames):
        return (frames * len(self.nodes) - self.offset) / self.fps

    def describe(self):
        return {
            "default": (self.default_frames - self.offset) / self.fps,
            "min": self.seconds(self.minimum), "max": self.seconds(self.maximum),
        }

    def frames(self, seconds):
        validate_seconds(seconds, self.describe())
        frames = (seconds * self.fps + self.offset) / len(self.nodes)
        rounded = self.first + self.step * floor((frames - self.first) / self.step + 0.5)
        return max(self.minimum, min(self.maximum, rounded))


@dataclass(frozen=True)
class SliderTiming:
    node: str
    index: int
    state: dict
    continuation: bool

    def describe(self):
        row = self.state["sliders"][self.index]
        return {"default": row["value"], "min": row["min"], "max": row["max"], "continuation": self.continuation}


def validate_seconds(seconds, limits):
    if type(seconds) not in (int, float) or not limits["min"] <= seconds <= limits["max"]:
        raise WorkflowError(f'视频时长须在 {limits["min"]:.3g} 到 {limits["max"]:.3g} 秒之间。')


def linked_inputs(graph, value, *kinds):
    if is_link(value):
        node = graph.get(str(value[0]), {})
        if node.get("class_type") in kinds:
            return node["inputs"]
    return {}


def h3_slider_timing(workflow):
    graph = workflow.graph
    # The dialogue mode and the other H3 v3 modes use different seconds sliders.
    condition = next((graph[key]["inputs"] for key in ("518", "5") if key in workflow.active
                      and graph[key]["class_type"] == "MiniMaxH3ReferenceToVideo"), {})
    math = linked_inputs(graph, condition.get("length"), "ComfyMathExpression")
    primitive = linked_inputs(graph, math.get("values.a"), "PrimitiveFloat")
    link = primitive.get("value")
    sliders = linked_inputs(graph, link, "PixaromaSliders")
    if not sliders:
        return None
    try:
        state = json.loads(sliders["SlidersState"])
        index = link[1]
        row = state["sliders"][index]
        name = "seconds" if "518" in workflow.active else "video length (seconds)"
        if index >= 0 and row["name"].lower() == name and row["type"] == "float" and all(
            type(row[key]) in (int, float) and 0 < row[key] <= H3_MAX_FRAMES / H3_FPS
            for key in ("min", "value", "max")
        ) and row["min"] <= row["value"] <= row["max"]:
            return SliderTiming(str(link[0]), index, state, "368" in workflow.active)
    except (ValueError, TypeError, LookupError, AttributeError):
        return None
    return None


def frame_rate(workflow):
    rates = set()
    for key in workflow.outputs:
        node = workflow.graph[key]
        kind, inputs = node["class_type"], node["inputs"]
        if kind not in VIDEO_OUTPUT_NODES:
            continue
        if kind == "SaveVideo":
            rate = linked_inputs(workflow.graph, inputs.get("video"), "CreateVideo").get("fps")
        else:
            if inputs.get("pingpong") or inputs.get("trim_to_audio") or inputs.get("loop_count"):
                return None
            rate = inputs.get("frame_rate", inputs.get("fps"))
        if type(rate) not in (int, float) or not 0 < rate <= 1000:
            return None
        rates.add(rate)
    return rates.pop() if len(rates) == 1 else None


def wan_length_node(workflow):
    graph = workflow.graph
    outputs = [graph[key] for key in workflow.outputs if graph[key]["class_type"] in VIDEO_OUTPUT_NODES]
    if len(outputs) != 1:
        return None
    output = outputs[0]
    inputs = output["inputs"]
    if output["class_type"] == "SaveVideo":
        inputs = linked_inputs(graph, inputs.get("video"), "CreateVideo")
    decode = linked_inputs(graph, inputs.get("images"), "VAEDecode", "VAEDecodeTiled")
    link = decode.get("samples")
    while is_link(link):
        key = str(link[0])
        node = graph[key]
        if node["class_type"] in WAN_CONDITIONERS:
            return key
        if node["class_type"] not in ("KSampler", "KSamplerAdvanced"):
            return None
        link = node["inputs"].get("latent_image")
    return None


def video_timing(workflow):
    if not workflow.is_video:
        return None
    if workflow.name == H3_SEED_FULL:
        return h3_slider_timing(workflow)
    fps = frame_rate(workflow)
    if fps is None:
        return None

    active = {key: workflow.graph[key] for key in workflow.active}
    offset = 0
    first, step, minimum, maximum = 1, 4, 1, MAX_VIDEO_FRAMES
    if workflow.name in H3_WORKFLOWS:
        nodes = tuple(key for key, node in active.items() if node["class_type"] == "MiniMaxH3ReferenceToVideo")
        first, step, minimum, maximum = 5, 17, 5, H3_MAX_FRAMES
    elif workflow.name == LIGHTNING_WORKFLOW:
        nodes = tuple(key for key, node in active.items() if node["class_type"] in LIGHTNING_LIMITS)
    elif workflow.name == SVI_WORKFLOW:
        nodes = tuple(key for key, node in active.items() if node["class_type"] == "WanImageToVideoSVIPro")
        overlaps = [node["inputs"]["overlap"] for node in active.values()
                    if node["class_type"] == "ImageBatchExtendWithOverlap"]
        offset = sum(overlaps)
        for key in nodes:
            inputs = active[key]["inputs"]
            if "prev_samples" in inputs:
                minimum = max(minimum, 4 * inputs["motion_latent_count"] + 1)
        minimum = max(minimum, *overlaps) if overlaps else minimum
    else:
        key = wan_length_node(workflow)
        nodes = (key,) if key else ()
    if len(nodes) != len(getattr(workflow, "video_stages", (1,))):
        return None
    lengths = [active[key]["inputs"].get("length") for key in nodes]
    if any(type(length) is not int or length < first for length in lengths):
        return None
    if workflow.name == LIGHTNING_WORKFLOW:
        maximum = min(LIGHTNING_LIMITS[active[key]["class_type"]] for key in nodes)
    if workflow.name in SEGMENTED_VIDEO_WORKFLOWS:
        output = workflow.graph[workflow.outputs[0]]["inputs"]
        multiplier = linked_inputs(workflow.graph, output.get("images"), "FL_RIFE").get("multiplier", 1)
        if type(multiplier) is not int or not 1 <= multiplier <= 1000:
            return None
        # RIFE inserts frames between originals. The last original is emitted once.
        fps /= multiplier
        offset += 1 - 1 / multiplier

    operation = ceil if workflow.name in H3_WORKFLOWS else floor
    default_frames = sum(first + step * operation((length - first) / step) for length in lengths)
    minimum = first + step * ceil((minimum - first) / step)
    maximum = first + step * floor((maximum - first) / step)
    if minimum > maximum:
        return None
    return FrameTiming(nodes, fps, offset, default_frames, first, step, minimum, maximum)


def with_video_duration(workflow, timing, seconds):
    result = copy(workflow)
    result.graph = deepcopy(workflow.graph)
    if isinstance(timing, SliderTiming):
        validate_seconds(seconds, timing.describe())
        state = deepcopy(timing.state)
        state["sliders"][timing.index]["value"] = seconds
        result.graph[timing.node]["inputs"]["SlidersState"] = json.dumps(state, ensure_ascii=False)
    else:
        frames = timing.frames(seconds)
        for key in timing.nodes:
            result.graph[key]["inputs"]["length"] = frames
    return result
