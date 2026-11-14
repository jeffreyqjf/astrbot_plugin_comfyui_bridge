"""Select the executable path of the WAN 2.2 SVI video profile."""

from .workflow import SVI_WORKFLOW, Workflow, WorkflowError, is_link
from .workflow_fields import combo_options, editable_fields

OUTPUTS = (
    "562:561", "585:577", "602:760", "619:772", "636:784", "653:796",
    "670:808", "687:820", "704:832", "721:844", "738:856", "755:868",
)
SVI_STAGE_LIMIT = len(OUTPUTS)
DEFAULTS = {
    "segments": 1, "samplers": 3, "model_format": "gguf", "upscale": False,
    "interpolate": False, "stages": [], "stage_loras": {},
}
NUMERIC_RUN_OPTIONS = {"segments", "samplers", "frames", "fps"}
RUN_OPTIONS = NUMERIC_RUN_OPTIONS | {"stages", "stage_loras"}
LORA_PHASES = ("high", "low", "both", "svi-high", "lightning-high")
MODEL_LORA_PHASES = {
    "368:366": {"high", "both", "svi-high"},
    "368:359": {"high", "both", "lightning-high"},
    "368:365": {"low", "both"},
}


def parse_stages(text):
    try:
        return [int(part) for part in text.split(",")] if text.strip() else []
    except ValueError as exc:
        raise WorkflowError("SVI 段号请用逗号分隔，例如 3,1,7。") from exc


def parse_stage_loras(specs):
    stages = {}
    for spec in specs:
        stage, sep, rows = spec.partition("=")
        stage = stage.strip()
        if not sep or stage in stages or not rows.strip():
            raise WorkflowError("逐段 LoRA 用法：--lora \"3=high:文件名:0.8\"，同一段只写一次。")
        parsed = []
        if rows.strip().casefold() != "off":
            for item in rows.split(","):
                phase, _, rest = item.strip().partition(":")
                filename, sep, strength = rest.rpartition(":")
                try:
                    strength = float(strength) if sep else 1
                except ValueError as exc:
                    raise WorkflowError("逐段 LoRA 强度必须是数值。") from exc
                parsed.append({"phase": phase.strip().casefold(), "name": filename.strip() if sep else rest.strip(),
                               "strength": strength})
        stages[stage] = parsed
    return stages


def validate_stage_loras(stages, limit=SVI_STAGE_LIMIT):
    if not isinstance(stages, dict):
        raise WorkflowError("SVI 逐段 LoRA 必须按段号设置。")
    stage_ids = {str(i) for i in range(1, limit + 1)}
    for stage, rows in stages.items():
        if stage not in stage_ids:
            raise WorkflowError(f"逐段 LoRA 的段号必须为 1 到 {limit}。")
        if not isinstance(rows, list) or len(rows) > 16:
            raise WorkflowError(f"SVI 第 {stage} 段最多可配置 16 个 LoRA。")
        for row in rows:
            if (not isinstance(row, dict) or row.keys() != {"phase", "name", "strength"}
                    or row["phase"] not in LORA_PHASES or not isinstance(row["name"], str)
                    or not row["name"].strip() or len(row["name"]) > 512
                    or type(row["strength"]) not in (int, float) or not -100 <= row["strength"] <= 100):
                raise WorkflowError(f"SVI 第 {stage} 段 LoRA 需要文件名、有效的作用阶段和 -100 到 100 的强度。")


def svi_lora_files(schemas):
    inputs = schemas.get("LoraLoaderModelOnly", {}).get("input", {}).get("required", {})
    return [
        name for name in (combo_options(inputs.get("lora_name")) or [])
        if isinstance(name, str)
        and name.replace("\\", "/").partition("/")[0].casefold() not in {"anima", "illustrious"}
    ]


def resolve_stage_loras(rows, files):
    names = {name.replace("\\", "/").casefold(): name for name in files}
    resolved = []
    for row in rows:
        query = row["name"].strip().replace("\\", "/").casefold()
        filename = names.get(query)
        if filename is None:
            matches = [
                name for path, name in names.items()
                if path.rsplit("/", 1)[-1] == query
                or path.rsplit("/", 1)[-1].removesuffix(".safetensors") == query
            ]
            if len(matches) != 1:
                reason = "有同名文件，请填写相对路径" if matches else "未在 ComfyUI 的视频 LoRA 中找到"
                raise WorkflowError(f"LoRA「{row['name']}」{reason}。")
            filename = matches[0]
        resolved.append({**row, "name": filename})
    return resolved


def stage_lora_chain(graph, model, loras, phases, prefix):
    for index, row in enumerate(loras):
        if row["phase"] not in phases or not row["strength"]:
            continue
        key = f"{prefix}_{index}"
        graph[key] = {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {"model": model, "lora_name": row["name"], "strength_model": row["strength"]},
        }
        model = [key, 0]
    return model


def svi_options(settings, overrides=None):
    return video_options(settings, overrides, "svi", len(OUTPUTS), (2, 3))


def video_options(settings, overrides, family, limit, sampler_choices):
    if not isinstance(settings, dict):
        raise WorkflowError("分段视频工作流设置格式无效。")
    saved = settings.get(family, {})
    if not isinstance(saved, dict) or saved.keys() - DEFAULTS.keys():
        raise WorkflowError("分段视频工作流设置格式无效。")
    options = overrides or {}
    if options.keys() - RUN_OPTIONS:
        raise WorkflowError("分段视频单次参数支持段号、段数、采样阶段、帧数、帧率和逐段 LoRA。")
    if "segments" in options and "stages" in options:
        raise WorkflowError("请在 --segments 和 --stages 中选择一项。")
    values = {**DEFAULTS, "samplers": sampler_choices[-1], **saved, **options}
    segments, samplers = values["segments"], values["samplers"]
    if type(segments) is not int or not 1 <= segments <= limit:
        raise WorkflowError(f"视频段数必须为 1 到 {limit} 的整数。")
    stages = [] if "segments" in options else values["stages"]
    if (not isinstance(stages, list) or any(type(i) is not int or not 1 <= i <= limit for i in stages)
            or len(set(stages)) != len(stages) or ("stages" in options and not stages)):
        raise WorkflowError(f"段号必须为 1 到 {limit} 的整数，且不能重复。")
    values["stages"] = stages or list(range(1, segments + 1))
    saved_loras = saved.get("stage_loras", {})
    override_loras = options.get("stage_loras", {})
    if override_loras == "off":
        override_loras = {str(stage): [] for stage in values["stages"]}
    validate_stage_loras(saved_loras, limit)
    validate_stage_loras(override_loras, limit)
    if override_loras.keys() - {str(i) for i in values["stages"]}:
        raise WorkflowError("逐段 LoRA 只能指定本次选中的段号。")
    values["stage_loras"] = {**saved_loras, **override_loras}
    if type(samplers) is not int or samplers not in sampler_choices:
        raise WorkflowError("采样阶段数可选 " + " 或 ".join(map(str, sampler_choices)) + "。")
    if values["model_format"] not in ("gguf", "fp8"):
        raise WorkflowError("SVI 模型格式必须为 GGUF 或 FP8。")
    if type(values["upscale"]) is not bool or type(values["interpolate"]) is not bool:
        raise WorkflowError("SVI 放大和插帧开关必须为布尔值。")
    if "frames" in values:
        validate_video_frames(values["frames"])
    if "fps" in values and (
        type(values["fps"]) not in (int, float) or not 1 <= values["fps"] <= 120
    ):
        raise WorkflowError("SVI 帧率必须在 1 到 120 之间。")
    return values


def validate_video_frames(frames):
    if type(frames) is not int or not 1 <= frames <= 16381 or frames % 4 != 1:
        raise WorkflowError("每段帧数必须为 4n+1，例如 17、49 或 81。")


def _check_sampling(graph, samplers):
    def value(node):
        return graph[node]["inputs"]["value"]

    cuts = (value("193"), value("194"), value("195")) if samplers == 3 else (
        value("566"), value("564")
    )
    if any(type(step) is not int for step in cuts) or any(
        left >= right for left, right in zip((0, *cuts[:-1]), cuts, strict=True)
    ):
        raise WorkflowError(f"SVI {samplers} 阶段采样的切换步必须递增且小于总步数。")


def svi_workflow(graph, settings, mapping=None, overrides=None, *, lora_files=None):
    options = svi_options(settings, overrides)
    samplers = options["samplers"]
    _check_sampling(graph, samplers)
    graph = dict(graph)
    patches = {}
    first_conditions = set()
    previous_samples = output = None
    plan = []
    for stage in options["stages"]:
        key = OUTPUTS[stage - 1]
        decode = [key, 0] if stage == 1 else graph[key]["inputs"]["new_images"]
        conditions = _conditioning_nodes(graph, key)
        join = None
        if previous_samples is None:
            first_conditions.update(conditions)
            output = decode
        else:
            for condition in conditions:
                patches[condition] = {"prev_samples": previous_samples}
                if stage == 1:
                    patches[condition]["motion_latent_count"] = 1
            join = key if stage != 1 else "svi_join_1"
            if stage == 1:
                graph[join] = {
                    "class_type": "ImageBatchExtendWithOverlap",
                    "inputs": {"overlap": 5, "overlap_side": "source", "overlap_mode": "linear_blend"},
                }
            patches[join] = {"source_images": output, "new_images": decode}
            output = [join, 2]
        previous_samples = graph[decode[0]]["inputs"]["samples"]
        plan.append((conditions, join))

        loras = [
            row for row in options["stage_loras"].get(str(stage), [])
            if row["strength"] and (samplers == 3 or row["phase"] != "svi-high")
        ]
        if lora_files is not None:
            loras = resolve_stage_loras(loras, lora_files)
        if loras:
            prefix = key.split(":")[0] + ":"
            chains = {}
            for node_id, node in list(graph.items()):
                if node_id.startswith(prefix) and node["class_type"] == "KSamplerAdvanced":
                    model = node["inputs"]["model"]
                    base = model[0]
                    if base not in chains:
                        phases = MODEL_LORA_PHASES.get(base)
                        if phases is None:
                            raise WorkflowError(f"SVI 第 {stage} 段采样器 #{node_id} 的模型连线不支持逐段 LoRA。")
                        chains[base] = stage_lora_chain(
                            graph, model, loras, phases, f"svi_lora_{stage}_{base.rsplit(':', 1)[-1]}"
                        )
                    patches[node_id] = {"model": chains[base]}
    if options["model_format"] == "fp8":
        patches.update({"368:364": {"model": ["37", 0]}, "368:356": {"model": ["56", 0]}})
    if options["upscale"]:
        patches["509"] = {"image": output}
        output = ["511", 0]
    fps = options.get("fps", graph["512"]["inputs"]["frame_rate"])
    if options["interpolate"]:
        patches["507"] = {"images": output}
        output = ["507", 0]
        fps *= graph["507"]["inputs"]["multiplier"]
    patches["512"] = {"images": output, "frame_rate": fps}

    def resolve(link):
        seen = set()
        while True:
            key = str(link[0])
            if key in seen:
                raise WorkflowError("SVI 工作流存在循环切换。")
            seen.add(key)
            node = graph[key]
            kind, inputs = node["class_type"], node["inputs"]
            if kind == "LazySwitchKJ":
                link = inputs["on_true" if samplers == 3 else "on_false"]
            elif kind == "StringConcatenate" and not inputs["string_b"].strip():
                link = inputs["string_a"]
            else:
                return [key, link[1]]

    selected = {}
    pending = ["512"]
    while pending:
        key = pending.pop()
        if key in selected:
            continue
        node = graph[key]
        inputs = {**node["inputs"], **patches.get(key, {})}
        if key in first_conditions:
            inputs.pop("prev_samples", None)
            inputs["motion_latent_count"] = 0
        if node["class_type"] == "WanImageToVideoSVIPro" and "frames" in options:
            inputs["length"] = options["frames"]
        for field, value in inputs.items():
            if is_link(value):
                inputs[field] = resolve(value)
                pending.append(inputs[field][0])
        selected[key] = {**node, "inputs": inputs}

    previous_frames = total_frames = 0
    for conditions, join in plan:
        conditioning, = (selected[key]["inputs"] for key in conditions if key in selected)
        frames = conditioning["length"]
        validate_video_frames(frames)
        overlap = selected[join]["inputs"]["overlap"] if join else 0
        motion_frames = min(conditioning["motion_latent_count"], (previous_frames + 3) // 4)
        if join and (motion_frames > (frames - 1) // 4 or overlap > min(total_frames, frames)):
            raise WorkflowError("SVI 续写段帧数太少，请增加帧数或减少动作潜帧和重叠帧数。")
        previous_frames = frames
        total_frames += frames - overlap

    workflow = Workflow(SVI_WORKFLOW, {"prompt": selected, "astrbot": settings}, mapping)
    workflow.video_stages = tuple(options["stages"])
    return workflow


def check_video_rife(workflow, workspace, host):
    rife = next((workflow.graph[key] for key in workflow.active
                 if workflow.graph[key]["class_type"] == "FL_RIFE"), None)
    if rife is None:
        return
    name = rife["inputs"]["ckpt_name"]
    cache = workspace / "custom_nodes/comfyui_fill-nodes/nodes/cache/rife_models"
    if host not in {"127.0.0.1", "::1", "localhost"} or name not in ("rife47", "rife49") or not (
        cache / f"{name}.pth"
    ).is_file():
        raise WorkflowError("视频插帧需要本机 RIFE 权重。请准备对应的 .pth 文件或关闭插帧。")


SETTING_LABELS = {
    "segments": "视频段数（首段加续写）",
    "samplers": "采样阶段数",
    "model_format": "扩散模型格式",
    "upscale": "启用模型放大",
    "interpolate": "启用 RIFE 插帧",
}
NODE_GROUPS = {
    **dict.fromkeys(("369", "370", "37", "56", "368:355", "368:353", "368:364"), "模型与编码器"),
    **dict.fromkeys(("368:356", "368:366", "368:359", "368:365"), "SVI 与 Lightning LoRA"),
    **dict.fromkeys(("193", "194", "195", "314", "564", "566", "562:559", "562:556", "562:557"), "采样与阶段切换"),
    **dict.fromkeys(("507", "510", "511"), "放大与插帧"),
    "110": "参考图尺寸", "512": "视频输出", "900": "基础设置", "902": "基础设置",
}
FIELD_TITLES = {
    "193.value": "三阶段 · SVI 高噪声结束步",
    "194.value": "三阶段 · Lightning 高噪声结束步",
    "195.value": "三阶段 · 总步数",
    "314.value": "三阶段 · SVI 高噪声 CFG",
    "564.value": "两阶段 · 总步数",
    "566.value": "两阶段 · 高低噪声切换步",
    "562:556.cfg": "Lightning 高噪声 CFG",
    "562:557.cfg": "Lightning 低噪声 CFG",
    "110.upscale": "允许放大较小的参考图",
}


def _conditioning_nodes(graph, output):
    prefix = output.split(":")[0] + ":"
    return [
        key for key, node in graph.items()
        if key.startswith(prefix) and node["class_type"] == "WanImageToVideoSVIPro"
    ]


def video_plan_fields(family, settings, options, limit, sampler_choices):
    fields = {}
    for name, label in SETTING_LABELS.items():
        if name == "samplers" and len(sampler_choices) == 1:
            continue
        value = options[name]
        fields[f"{family}.{name}"] = {
            "node": family, "name": name, "label": label, "title": label,
            "category": "放大与插帧" if name in ("upscale", "interpolate") else "基础设置",
            "kind": "BOOLEAN" if type(value) is bool else "select", "value": value,
            "choices": {
                "segments": list(range(1, limit + 1)),
                "samplers": list(sampler_choices),
                "model_format": ["gguf", "fp8"],
            }.get(name),
            "active": True,
        }
    fields[f"{family}.stages"] = {
        "node": family, "name": "stages", "label": "默认段号顺序",
        "title": "默认段号顺序", "category": "基础设置", "kind": "STRING", "active": True,
        "value": ",".join(map(str, settings.get(family, {}).get("stages", []))),
        "placeholder": "例如 3,1,2，留空使用上面的段数",
    }
    for index in range(1, limit + 1):
        label, name = f"第 {index} 段", f"stage_loras_{index}"
        fields[f"{family}.{name}"] = {
            "node": family, "name": name, "label": "附加 LoRA", "title": label, "category": label,
            "kind": "json", "editor": "svi-loras", "active": True,
            "value": options["stage_loras"].get(str(index), []),
        }
    return fields


def vhs_field_schemas(schemas):
    schema = schemas.get("VHS_VideoCombine")
    if not schema:
        return schemas
    inputs = schema["input"]
    # VHS advertises codec widgets under the format combo instead of normal inputs.
    format_spec = inputs.get("required", {}).get("format", [])
    formats = format_spec[1].get("formats", {}) if len(format_spec) > 1 else {}
    codec_specs = formats.get("video/h264-mp4", [])
    optional = {**inputs.get("optional", {}), **{name: spec for name, *spec in codec_specs}}
    if "crf" in optional:
        optional["crf"] = ["INT", {**optional["crf"][1], "max": 51}]
    return {**schemas, "VHS_VideoCombine": {**schema, "input": {**inputs, "optional": optional}}}


def svi_fields(graph, schemas, settings):
    options = svi_options(settings)
    fields = video_plan_fields("svi", settings, options, len(OUTPUTS), (2, 3))
    categories = dict(NODE_GROUPS)
    allowed = {
        "512": {"filename_prefix", "frame_rate", "crf", "save_metadata"},
        "562:559": {"sampler_name", "scheduler"},
        "562:556": {"cfg"}, "562:557": {"cfg"},
    }
    for index, output in enumerate(OUTPUTS, 1):
        label = f"第 {index} 段"
        positive, negative = str(1000 + index), str(1100 + index)
        condition = _conditioning_nodes(graph, output)[0]
        categories.update(dict.fromkeys((positive, negative, condition, output), label))
        allowed[positive] = allowed[negative] = {"string_b"}
        allowed[condition] = {"length"} if index == 1 else {"length", "motion_latent_count"}
    for key, field in editable_fields(graph, vhs_field_schemas(schemas)).items():
        node, name = field["node"], field["name"]
        if node not in categories or (node in allowed and name not in allowed[node]):
            continue
        field["category"] = categories[node]
        if key in FIELD_TITLES:
            field["label"] = FIELD_TITLES[key]
        if name == "string_b":
            field["label"] = "附加正向词" if int(node) < 1100 else "附加负向词"
        if node == "512" and name == "frame_rate":
            field.update(label="基础帧率", max=120)
        if node == "900":
            field["min"] = 0
        fields[key] = field
    order = (
        "基础设置", "参考图尺寸", "模型与编码器", "SVI 与 Lightning LoRA", "采样与阶段切换",
        *(f"第 {i} 段" for i in range(1, len(OUTPUTS) + 1)), "放大与插帧", "视频输出",
    )
    return dict(sorted(fields.items(), key=lambda item: order.index(item[1]["category"])))


def sync_svi_fields(graph, changes):
    for output in OUTPUTS:
        first, second = _conditioning_nodes(graph, output)
        for name in ("length", "motion_latent_count"):
            if f"{first}.{name}" in changes:
                graph[second]["inputs"][name] = graph[first]["inputs"][name]
    for node in graph.values():
        if node["class_type"] != "KSamplerAdvanced":
            continue
        inputs = node["inputs"]
        for name in ("sampler_name", "scheduler"):
            if f"562:559.{name}" in changes:
                inputs[name] = graph["562:559"]["inputs"][name]
        cfg_node = {"368:359": "562:556", "368:365": "562:557"}.get(inputs["model"][0])
        if cfg_node and f"{cfg_node}.cfg" in changes:
            inputs["cfg"] = graph[cfg_node]["inputs"]["cfg"]
