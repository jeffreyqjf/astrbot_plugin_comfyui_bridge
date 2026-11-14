"""Format QQ task receipts and show the effective Anima settings."""

from urllib.parse import unquote

from ..workflows.anima_settings import ANIMA_RUN_BRANCHES, BRANCH_LABELS
from ..workflows.detailer import FEET_DETAILER
from ..workflows.workflow import (
    ADVANCED_V40_WORKFLOW,
    AIO_WORKFLOW,
    ANIMA_WORKFLOW,
    DETAILER_WORKFLOW,
    LIGHTNING_WORKFLOW,
    SDXL_WORKFLOW,
    SVI_WORKFLOW,
    WAI_WORKFLOW,
)


def format_loras(rows):
    if rows is None:
        return "沿用画布"
    return "、".join(
        f"{row.get('id') or row['name']} × {row['strength']:g}" for row in rows
    ) or "关闭"


def anima_details(workflow):
    canvas_loras = workflow.graph.get("26", {}).get("inputs", {}).get("loras", [])
    if isinstance(canvas_loras, dict):
        canvas_loras = canvas_loras.get("__value__", [])
    if not isinstance(canvas_loras, list):
        canvas_loras = []
    return {
        "active_branches": [
            key for key, (_, node) in ANIMA_RUN_BRANCHES.items() if node in workflow.active
        ],
        "denoise": workflow.graph.get("50", {}).get("inputs", {}).get("denoise"),
        "loras": [
            {"id": unquote(key.removeprefix("astrbot_lora_")), "strength": node["inputs"]["strength_model"]}
            for key, node in workflow.graph.items()
            if key.startswith("astrbot_lora_") and node["class_type"] == "LoraLoaderModelOnly"
        ] + [
            {"name": row["name"], "strength": row["strength"]}
            for row in canvas_loras if isinstance(row, dict) and row.get("active")
            and isinstance(row.get("name"), str) and type(row.get("strength")) in (int, float)
        ],
    }


QQ_WORKFLOW_NAMES = {
    ANIMA_WORKFLOW: "Anima T2I",
    AIO_WORKFLOW: "Anima I2I AIO",
    DETAILER_WORKFLOW: "Detailer V40",
    ADVANCED_V40_WORKFLOW: "Advanced Gemma V40",
    WAI_WORKFLOW: "WAI-Illustrious T2I",
    "WAN22_T2V_AstrBot": "WAN 2.2 T2V",
    "WAN22_I2V_AstrBot": "WAN 2.2 I2V",
    SVI_WORKFLOW: "WAN 2.2 SVI I2V",
    LIGHTNING_WORKFLOW: "WAN 2.2 Lightning I2V",
    SDXL_WORKFLOW: "SDXL Turbo",
}
SVI_LORA_LABELS = {
    "SVI_v2_PRO_Wan2.2-I2V-A14B_HIGH_lora_rank_128_fp16": "SVI High",
    "SVI_v2_PRO_Wan2.2-I2V-A14B_LOW_lora_rank_128_fp16": "SVI Low",
    "wan2.2_i2v_A14b_high_noise_lora_rank64_lightx2v_4step_1022": "LightX2V High",
    "Wan2.2-Lightning_I2V-A14B-4steps-lora_LOW_fp16": "Lightning Low",
}


def qq_job_header(job):
    return f"{QQ_WORKFLOW_NAMES.get(job.workflow, job.workflow)} · ID {job.short_id}"


def qq_job_summary(job):
    details = job.qq_parameters
    if job.seed is not None:
        details = (*details, f"种子 {job.seed}")
    header = qq_job_header(job)
    return f"{header}\n" + " · ".join(details) if details else header


def qq_lora_names(graph):
    filenames = []
    for node in graph.values():
        inputs = node["inputs"]
        name = inputs.get("lora_name")
        if isinstance(name, str) and (inputs.get("strength_model") or inputs.get("strength_clip")):
            filenames.append(name)
        rows = inputs.get("loras")
        if isinstance(rows, dict):
            rows = rows.get("__value__")
        if isinstance(rows, list):
            filenames.extend(
                row["name"] for row in rows
                if isinstance(row, dict) and row.get("active") and isinstance(row.get("name"), str)
                and (row.get("strength") or row.get("clipStrength"))
            )
    paths = list(dict.fromkeys(
        name.replace("\\", "/").removesuffix(".safetensors") for name in filenames
        if name and name != "None"
    ))
    names = [path.rsplit("/", 1)[-1] for path in paths]
    return [name if names.count(name) == 1 else path for path, name in zip(paths, names, strict=True)]


def qq_generation_parameters(workflow):
    graph = {key: node for key, node in workflow.graph.items() if key in workflow.active}
    lora_prefix = {SVI_WORKFLOW: "svi_lora_", LIGHTNING_WORKFLOW: "lightning_lora_"}.get(workflow.name)
    fields = []
    if workflow.is_video:
        inputs = [node["inputs"] for node in graph.values()]
        frames = next((row["length"] for row in inputs if type(row.get("length")) is int), None)
        if lora_prefix:
            stages = workflow.video_stages
            passes = sum(node["class_type"] == "KSamplerAdvanced" for node in graph.values())
            sequence = f"{len(stages)} 段" if stages == tuple(range(1, len(stages) + 1)) else (
                "段 " + "→".join(map(str, stages))
            )
            fields.extend((sequence, f"{passes // len(stages)} 阶段采样"))
        elif frames and frames > 0:
            fields.append(f"{frames} 帧")
        fps = next((
            row.get("fps", row.get("frame_rate")) for row in inputs
            if "fps" in row or "frame_rate" in row
        ), None)
        if type(fps) in (int, float) and fps > 0:
            fields.append(f"{fps:g} fps")
    elif workflow.name == WAI_WORKFLOW and "129" in graph:
        fields.append(f"ControlNet {graph['129']['inputs']['type']}")
    elif workflow.name == AIO_WORKFLOW:
        fields.append(f"降噪 {graph['118']['inputs']['denoise']:g}")

    if lora_prefix:
        loras = qq_lora_names({key: node for key, node in graph.items() if not key.startswith(lora_prefix)})
        loras = [SVI_LORA_LABELS.get(name, name) for name in loras]
        if any(node["class_type"] == "ImageUpscaleWithModel" for node in graph.values()):
            fields.append("放大")
        if any(node["class_type"] == "FL_RIFE" for node in graph.values()):
            fields.append("RIFE 插帧")
    else:
        loras = qq_lora_names(graph)
    if loras:
        fields.append("LoRA " + "、".join(loras))
    elif workflow.name in {ANIMA_WORKFLOW, AIO_WORKFLOW, WAI_WORKFLOW}:
        fields.append("LoRA 关闭")
    if lora_prefix:
        for stage in workflow.video_stages:
            prefix = f"{lora_prefix}{stage}_"
            added = qq_lora_names({key: node for key, node in graph.items() if key.startswith(prefix)})
            if added:
                fields.append(f"第 {stage} 段 LoRA " + "、".join(SVI_LORA_LABELS.get(name, name) for name in added))

    repairs = []
    if workflow.name == ANIMA_WORKFLOW:
        branches = [
            (node, BRANCH_LABELS[int(branch)])
            for key, (branch, node) in ANIMA_RUN_BRANCHES.items() if key != "img2img"
        ]
        branches.extend((node, BRANCH_LABELS[branch]) for node, branch in (
            ("29", 10), ("47", 12), ("46", 100), ("63", 118),
        ))
        repairs = [label for node, label in branches if node in graph]
    elif workflow.name == WAI_WORKFLOW:
        repairs = [label for node, label in (("211", "修脸"), ("174", "修眼")) if node in graph]
    elif workflow.name == DETAILER_WORKFLOW:
        repairs = [label for node, label in (
            ("55", "修手"), ("56", "NSFW 修复"), ("57", "修脸"), ("58", "修眼"), (FEET_DETAILER, "修脚"),
        ) if node in graph]
    elif workflow.name == ADVANCED_V40_WORKFLOW:
        repairs = [label for node, label in (
            ("34", "修手"), ("35", "NSFW 修复"), ("36", "修脸"), ("37", "修眼"), (FEET_DETAILER, "修脚"),
        ) if node in graph]
    elif any(node["class_type"] in {"FaceDetailer", "FaceDetailerPipe", "DetailerForEach"} for node in graph.values()):
        repairs = ["局部修复"]
    if repairs:
        fields.append("、".join(repairs))
    return tuple(fields)
