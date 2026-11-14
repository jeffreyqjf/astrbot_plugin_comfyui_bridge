"""Assemble the selected Painter Lightning video segments for AstrBot."""

from copy import deepcopy

from .svi import (
    resolve_stage_loras,
    stage_lora_chain,
    validate_video_frames,
    vhs_field_schemas,
    video_options,
    video_plan_fields,
)
from .workflow import LIGHTNING_WORKFLOW, Workflow, WorkflowError, is_link
from .workflow_fields import editable_fields

# Conditioner, decode, accumulated video, last-frame selector, reference resize.
STAGES = (
    ("1252:1248", "1252:1249", None, None, None),
    ("1262:1256", "1262:1258", "1262:1253", "1262:1261", "1262:1260"),
    ("1272:1266", "1272:1269", "1272:1263", "1272:1271", "1272:1270"),
    ("1280:1274", "1280:1278", "1280:1279", "1210", "1211"),
)
HIGH, LOW = "1252:1238", "1252:1239"
OUTPUT = "1039"
COLOR_REFERENCE, COLOR_MATCH = "1284", "1285"
LATER_FRAMES, SHARPEN, FRAME_BATCH = "1286", "1287", "1288"
SHARPEN_STRENGTH = "method.strength"


def add_lightning_output_nodes(graph):
    frames = [STAGES[0][1], 0]
    graph.setdefault(COLOR_REFERENCE, {
        "class_type": "ImageFromBatch",
        "inputs": {"image": frames, "batch_index": 0, "length": 1},
        "_meta": {"title": "首帧参考"},
    })
    graph.setdefault(COLOR_MATCH, {
        "class_type": "ColorTransfer",
        "inputs": {
            "image_target": frames, "image_ref": [COLOR_REFERENCE, 0],
            "method": "reinhard_lab", "source_stats": "per_frame", "strength": 0.8,
        },
        "_meta": {"title": "首帧亮度与色彩校正"},
    })
    graph.setdefault(LATER_FRAMES, {
        "class_type": "VHS_SplitImages",
        "inputs": {"images": [COLOR_MATCH, 0], "split_index": 1},
        "_meta": {"title": "选择后续帧"},
    })
    graph.setdefault(SHARPEN, {
        "class_type": "ImageSharpenKJ",
        "inputs": {
            "image": [LATER_FRAMES, 2], "method": "adaptive_usm",
            SHARPEN_STRENGTH: 0.32, "method.radius": 1.0, "method.threshold": 0.05,
        },
        "_meta": {"title": "后续帧细节增强"},
    })
    graph.setdefault(FRAME_BATCH, {
        "class_type": "ImageBatchMulti",
        "inputs": {"inputcount": 2, "image_1": [COLOR_REFERENCE, 0], "image_2": [SHARPEN, 0]},
        "_meta": {"title": "按顺序合并首帧与后续帧"},
    })


def lightning_options(settings, overrides=None):
    options = video_options(settings, overrides, "lightning", len(STAGES), (2,))
    if any(row["phase"] not in ("high", "low", "both") for rows in options["stage_loras"].values() for row in rows):
        raise WorkflowError("Lightning 长视频的逐段 LoRA 可用 high、low 或 both。")
    return options


def lightning_workflow(graph, settings, mapping=None, overrides=None, *, lora_files=None):
    options = lightning_options(settings, overrides)
    graph = deepcopy(graph)
    high, low = (graph[key]["inputs"] for key in (HIGH, LOW))
    if (type(high["steps"]) is not int or type(high["end_at_step"]) is not int
            or not 0 < high["end_at_step"] < high["steps"]):
        raise WorkflowError("Lightning 的切换步必须大于 0 且小于总步数。")
    if options["model_format"] == "fp8":
        graph["1252:1246"]["inputs"]["model"] = ["1282", 0]
        graph["1252:1247"]["inputs"]["model"] = ["1283", 0]

    opening = deepcopy(graph[STAGES[0][0]])
    continuation = deepcopy(graph[STAGES[1][0]])
    output = None
    total_frames = 0
    for stage in options["stages"]:
        condition, decode, join, selector, resize = STAGES[stage - 1]
        original = graph[condition]["inputs"]
        frames = options.get("frames", original["length"])
        validate_video_frames(frames)
        total_frames += frames
        first = output is None
        if first:
            graph[condition] = deepcopy(opening)
        elif stage == 1:
            graph[condition] = deepcopy(continuation)
            join, selector, resize = "lightning_join_1", "lightning_last_1", "lightning_resize_1"
            for key, template in zip((join, selector, resize), STAGES[1][2:], strict=True):
                graph[key] = deepcopy(graph[template])
        inputs = graph[condition]["inputs"]
        inputs.update(positive=original["positive"], negative=original["negative"], length=frames)

        end_id = graph[decode]["inputs"]["samples"][0]
        start_id = graph[end_id]["inputs"]["latent_image"][0]
        loras = [
            row for row in options["stage_loras"].get(str(stage), [])
            if row["strength"]
        ]
        if lora_files is not None:
            loras = resolve_stage_loras(loras, lora_files)
        for node_id, phase, shared, slots in (
            (start_id, "high", high, (0, 1)),
            (end_id, "low", low, (2, 3) if first else (0, 1)),
        ):
            sampler = graph[node_id]["inputs"]
            sampler.update(steps=high["steps"], cfg=shared["cfg"], sampler_name=shared["sampler_name"],
                           scheduler=shared["scheduler"], positive=[condition, slots[0]], negative=[condition, slots[1]])
            if phase == "high":
                sampler.update(start_at_step=0, end_at_step=high["end_at_step"],
                               latent_image=[condition, 4 if first else 2])
            else:
                sampler.update(start_at_step=high["end_at_step"], end_at_step=high["steps"])
            sampler["model"] = stage_lora_chain(
                graph, sampler["model"], loras, {phase, "both"}, f"lightning_lora_{stage}_{phase}"
            )
        if first:
            output = [decode, 0]
        else:
            graph[selector]["inputs"]["image"] = output
            graph[resize]["inputs"]["image"] = [selector, 0]
            inputs["previous_video"] = [resize, 0]
            graph[join]["inputs"].update(image_1=output, image_2=[decode, 0])
            output = [join, 0]

    add_lightning_output_nodes(graph)
    graph[COLOR_REFERENCE]["inputs"]["image"] = output
    correction = graph[COLOR_MATCH]["inputs"]
    strength = correction["strength"]
    if type(strength) not in (int, float) or not 0 <= strength <= 1:
        raise WorkflowError("视频亮度校正强度须在 0 到 1 之间。")
    if strength:
        correction["image_target"] = output
        output = [COLOR_MATCH, 0]
    strength = graph[SHARPEN]["inputs"][SHARPEN_STRENGTH]
    if type(strength) not in (int, float) or not 0 <= strength <= 3:
        raise WorkflowError("后续帧细节增强强度须在 0 到 3 之间。")
    if strength and total_frames > 1:
        graph[LATER_FRAMES]["inputs"]["images"] = output
        output = [FRAME_BATCH, 0]

    if options["upscale"]:
        graph["1224"]["inputs"]["image"] = output
        output = ["1223", 0]
    fps = options.get("fps", graph[OUTPUT]["inputs"]["frame_rate"])
    if options["interpolate"]:
        graph["1059"]["inputs"]["images"] = output
        output = ["1059", 0]
        fps *= graph["1059"]["inputs"]["multiplier"]
    graph[OUTPUT]["inputs"].update(images=output, frame_rate=fps)

    selected, pending = {}, [OUTPUT]
    while pending:
        key = pending.pop()
        if key in selected:
            continue
        node = selected[key] = graph[key]
        for name, value in node["inputs"].items():
            if not is_link(value):
                continue
            source = graph[str(value[0])]
            if source["class_type"] == "StringConcatenate" and not source["inputs"]["string_b"].strip():
                value = node["inputs"][name] = source["inputs"]["string_a"]
            pending.append(str(value[0]))
    workflow = Workflow(LIGHTNING_WORKFLOW, {"prompt": selected, "astrbot": settings}, mapping)
    workflow.video_stages = tuple(options["stages"])
    return workflow


def lightning_fields(graph, schemas, settings):
    options = lightning_options(settings)
    fields = video_plan_fields("lightning", settings, options, len(STAGES), (2,))
    categories = {
        **dict.fromkeys(("917", "918", "919", "920", "916", "921", "1252:1246", "1252:1247"), "模型与编码器"),
        **dict.fromkeys(("1282", "1283"), "FP8 Lightning LoRA"),
        **dict.fromkeys((HIGH, LOW), "采样设置"),
        **dict.fromkeys(("604", "605", "606"), "参考与续写"),
        **dict.fromkeys(("1059", "1221", "1223"), "放大与插帧"),
        "607": "参考图尺寸", "900": "基础设置", "902": "基础设置",
        COLOR_MATCH: "视频输出", SHARPEN: "视频输出", OUTPUT: "视频输出",
    }
    allowed = {
        HIGH: {"steps", "end_at_step", "cfg", "sampler_name", "scheduler"},
        LOW: {"cfg", "sampler_name", "scheduler"},
        COLOR_MATCH: {"strength"},
        SHARPEN: {SHARPEN_STRENGTH},
        OUTPUT: {"filename_prefix", "frame_rate", "crf", "save_metadata"},
    }
    labels = {
        f"{HIGH}.steps": "两阶段总步数", f"{HIGH}.end_at_step": "高低噪声切换步",
        "604.value": "动作幅度", "605.value": "续写参考帧数", "606.value": "色彩保护强度",
        f"{OUTPUT}.frame_rate": "基础帧率", "607.upscale": "允许放大较小的参考图",
        f"{COLOR_MATCH}.strength": "首帧亮度校正（0 关闭）",
        f"{SHARPEN}.{SHARPEN_STRENGTH}": "后续帧细节增强（0 关闭）",
    }
    for index, (condition, _, _, selector, resize) in enumerate(STAGES, 1):
        category = f"第 {index} 段"
        categories[condition] = category
        allowed[condition] = {"length", "color_protect"} if index == 1 else {"length"}
        if resize:
            categories[selector] = category
            categories[resize] = category
            allowed[selector] = {"indexes"}
            allowed[resize] = {"scale_by", "upscale_method"}
            labels[f"{selector}.indexes"] = "续写参考帧索引"
        for base, title in ((1000, "附加正向词"), (1100, "附加负向词")):
            key = str(base + index)
            categories[key] = category
            allowed[key] = {"string_b"}
            labels[f"{key}.string_b"] = title
    for key, field in editable_fields(graph, vhs_field_schemas(schemas)).items():
        node, name = field["node"], field["name"]
        if node not in categories or (node in allowed and name not in allowed[node]):
            continue
        field["category"] = categories[node]
        if node in (HIGH, LOW):
            field["title"] = "高噪声阶段" if node == HIGH else "低噪声阶段"
        if key in labels:
            field["label"] = labels[key]
        if key == f"{OUTPUT}.frame_rate":
            field["max"] = 120
        if node == COLOR_MATCH:
            field.update(min=0, max=1, step=0.01)
        if node == SHARPEN:
            field["step"] = 0.01
        if node == "900":
            field["min"] = 0
        fields[key] = field
    order = (
        "基础设置", "参考图尺寸", "模型与编码器", "FP8 Lightning LoRA", "采样设置", "参考与续写",
        *(f"第 {i} 段" for i in range(1, len(STAGES) + 1)), "放大与插帧", "视频输出",
    )
    return dict(sorted(fields.items(), key=lambda item: order.index(item[1]["category"])))
