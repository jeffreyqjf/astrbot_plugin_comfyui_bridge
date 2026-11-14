"""Read ComfyUI API graphs without importing AstrBot or executing workflow content."""

import copy
import re
import secrets
from dataclasses import dataclass
from math import isfinite

WAI_WORKFLOW = "WAI-Illustrious_T2I_AstrBot"
WAI_MAPPING = {"positive": ["98.text"], "negative": ["100.text"]}
ANIMA_WORKFLOW = "Anima_T2I_AstrBot"
AIO_WORKFLOW = "Anima_I2I_AIO_AstrBot"
DETAILER_WORKFLOW = "Detailer_V40_AstrBot"
ADVANCED_V40_WORKFLOW = "Advanced_Gemma_V40_AstrBot"
REVERSE_WORKFLOW = "Anima_Reverse_AstrBot"
SDXL_WORKFLOW = "SDXL_Turbo_T2I_AstrBot"
SVI_WORKFLOW = "WAN22_SVI_I2V_AstrBot"
LIGHTNING_WORKFLOW = "WAN22_Lightning_Long_I2V_AstrBot"
SEGMENTED_VIDEO_WORKFLOWS = {SVI_WORKFLOW, LIGHTNING_WORKFLOW}
SWEEP_LORA_DEFAULTS = {
    ANIMA_WORKFLOW: "anima",
    WAI_WORKFLOW: "illustrious",
    ADVANCED_V40_WORKFLOW: "illustrious",
}


VIDEO_FOLDER = "vedio"
VIDEO_OUTPUT_NODES = frozenset({"SaveVideo", "SaveWEBM", "VHS_VideoCombine"})


class WorkflowError(ValueError):
    pass


def sweep_lora_family(name, settings):
    default = SWEEP_LORA_DEFAULTS.get(name)
    family = settings.get("sweep_lora_family", default)
    if family is None:
        return None
    if (
        not isinstance(family, str) or not family or family in (".", "..")
        or any(char in family for char in ('/', '\\', ':', '\0'))
    ):
        raise WorkflowError("请选择 ComfyUI LoRA 目录下的文件夹。")
    return family


def profile_parts(data):
    if isinstance(data, dict) and isinstance(data.get("prompt"), dict):
        return data["prompt"], data.get("astrbot", {})
    return data, {}


def is_link(value):
    return (
        isinstance(value, list)
        and len(value) == 2
        and isinstance(value[0], (str, int))
        and isinstance(value[1], int)
    )


def image_loras(graph, outputs):
    """Return the active LoRA paths and weights feeding each output."""
    def collect(key, seen, rows):
        if key in seen or key not in graph:
            return
        seen.add(key)
        node = graph[key]
        inputs = node["inputs"]
        for value in inputs.values():
            if is_link(value):
                collect(str(value[0]), seen, rows)
        name = inputs.get("lora_name")
        if isinstance(name, str):
            add(rows, name, inputs.get("strength_model"), inputs.get("strength_clip"))
        stack = inputs.get("loras")
        if isinstance(stack, dict):
            stack = stack.get("__value__")
        if isinstance(stack, list):
            for row in stack:
                if isinstance(row, dict) and row.get("active"):
                    add(rows, row.get("name"), row.get("strength"), row.get("clipStrength", row.get("strength")))
        if node.get("class_type") == "Power Lora Loader (rgthree)":
            for field, row in inputs.items():
                if field.startswith("lora_") and isinstance(row, dict) and row.get("on"):
                    add(rows, row.get("lora"), row.get("strength"), row.get("strengthTwo", row.get("strength")))
        syntax = inputs.get("lora_syntax")
        if isinstance(syntax, str) and node.get("class_type") == "LoRA Text Loader (LoraManager)":
            for name, model, clip in re.findall(r"<lora:([^:>]+):([^:>]+)(?::([^:>]+))?>", syntax, re.I):
                try:
                    add(rows, name, float(model), float(clip or model))
                except ValueError:
                    continue

    def add(rows, name, model, clip):
        if not isinstance(name, str) or not name or name.lower() == "none":
            return
        model = model if type(model) is int or (type(model) is float and isfinite(model)) else 0
        clip = clip if type(clip) is int or (type(clip) is float and isfinite(clip)) else 0
        if model or clip:
            rows[(name.replace("\\", "/"), model, clip)] = None

    by_output = {}
    for key in outputs:
        rows = {}
        collect(key, set(), rows)
        by_output[key] = [{"name": name, "model": model, "clip": clip} for name, model, clip in rows]
    return by_output


@dataclass(frozen=True)
class Field:
    node: str
    name: str

    def label(self):
        return f"{self.node}.{self.name}"


class Workflow:
    ENCODERS = {
        "CLIPTextEncode",
        "CLIPTextEncodeSDXL",
        "CLIPTextEncodeSD3",
        "AdvancedCLIPTextEncode",
        "BNK_CLIPTextEncodeAdvanced",
    }
    STRING_NODES = {
        "Primitive string [Crystools]": "string",
        "PrimitiveString": "value",
    }

    def __init__(self, name, data, overrides=None, *, require_prompt=True):
        self.name = name
        data, settings = profile_parts(data)
        if not isinstance(settings, dict) or not isinstance(settings.get("positive_prefix", ""), str):
            raise WorkflowError("AstrBot 工作流设置格式无效。")
        self.sweep_lora_family = sweep_lora_family(name, settings)
        if not isinstance(data, dict) or not data or "nodes" in data:
            raise WorkflowError("需要 ComfyUI 导出的 API 格式 JSON，不能使用画布格式。")
        self.graph = copy.deepcopy(data)
        for node in self.graph.values():
            if not isinstance(node, dict) or not isinstance(node.get("class_type"), str):
                raise WorkflowError("API 工作流节点缺少 class_type。")
            if not isinstance(node.get("inputs"), dict):
                raise WorkflowError("API 工作流节点缺少 inputs 对象。")
        reverse = name == REVERSE_WORKFLOW
        self.expand_caption = settings.get("expand_caption", False) if reverse else False
        if reverse and type(self.expand_caption) is not bool:
            raise WorkflowError("TIPO 扩写开关必须为布尔值。")
        self.outputs = [
            key
            for key, node in self.graph.items()
            if node["class_type"]
            in ({"PreviewAny"} if reverse else {
                "SaveImage", "PreviewImage", *VIDEO_OUTPUT_NODES
            })
        ]
        if reverse:
            if len(self.outputs) != 1:
                raise WorkflowError("Anima 反推流需要一个 PreviewAny 文字输出节点。")
            if self.expand_caption:
                self.graph[self.outputs[0]]["inputs"]["source"] = ["444", 0]
        if not self.outputs:
            raise WorkflowError(
                "需要 SaveImage、PreviewImage、SaveVideo、SaveWEBM 或 VHS_VideoCombine 输出节点。"
            )
        self.active = set()
        for node_id in self.outputs:
            self._visit(node_id, set())
        self.is_video = any(
            self.graph[key]["class_type"] in VIDEO_OUTPUT_NODES
            for key in self.outputs
        )
        overrides = {} if overrides is None else overrides
        if not isinstance(overrides, dict):
            raise WorkflowError("节点映射必须是 JSON 对象。")
        stored_mapping = settings.get("node_mapping", {})
        if not isinstance(stored_mapping, dict):
            raise WorkflowError("工作流的节点映射必须是 JSON 对象。")
        overrides = {**overrides, **stored_mapping}
        self.mapping = overrides
        positive, negative = set(), set()
        for key in self.active:
            inputs = self.graph[key]["inputs"]
            for role, result in (("positive", positive), ("negative", negative)):
                if role not in overrides and is_link(inputs.get(role)):
                    result.update(self._trace_conditioning(str(inputs[role][0]), set()))
            if (
                "positive" not in overrides
                and self.graph[key]["class_type"] == "BasicGuider"
                and is_link(inputs.get("conditioning"))
            ):
                positive.update(self._trace_conditioning(str(inputs["conditioning"][0]), set()))
        self.positive = self._override(overrides, "positive", positive)
        self.negative = self._override(overrides, "negative", negative)
        seeds = {
            Field(key, name)
            for key in self.active
            for name in ("seed", "noise_seed")
            if name in self.graph[key]["inputs"]
            and (self.name != WAI_WORKFLOW or not is_link(self.graph[key]["inputs"][name]))
        }
        if name == WAI_WORKFLOW and "109" in self.active:
            seeds.add(Field("109", "value"))
        self.seeds = self._override(overrides, "seed", seeds)
        if name == WAI_WORKFLOW and "seed" not in overrides:
            self.seeds.sort(key=lambda field: field.node != "245")
        self.default_seed = -1
        if settings.get("use_canvas_seed") and self.seeds:
            field = self.seeds[0]
            self.default_seed = self.graph[field.node]["inputs"][field.name]
        self.positive_prefix = settings.get("positive_prefix", "")
        images = {
            Field(key, "image")
            for key in self.active
            if self.graph[key]["class_type"] == "LoadImage" and "image" in self.graph[key]["inputs"]
        }
        self.image_inputs = self._override(overrides, "image", images)
        self.image_required = bool(self.image_inputs)
        self.shared_reference = not self.image_inputs
        self.reference_source = settings.get(
            "reference_source",
            "qq" if name == ANIMA_WORKFLOW else "auto",
        )
        reference_fields = self.image_inputs
        if not reference_fields:
            optional = overrides.get("optional_image", [])
            if not isinstance(optional, list):
                raise WorkflowError("optional_image 映射必须是字符串数组。")
            reference_fields = sorted(
                (field for field in images if field.label() in optional), key=lambda field: field.label()
            )
            if self.reference_source != "local":
                self.image_inputs = reference_fields
                self.image_required = bool(reference_fields) and self.reference_source == "qq"
        self.kind = (
            "image_to_text" if reverse else ("image_to_video" if reference_fields else "text_to_video")
            if self.is_video
            else ("image_to_image" if reference_fields else "text_to_image")
        )
        self.lora_selectable = self.kind == "text_to_image" and bool(self.lora_model_nodes())
        if name not in SWEEP_LORA_DEFAULTS and not self.lora_selectable:
            self.sweep_lora_family = None
        if reverse and len(self.image_inputs) != 1:
            raise WorkflowError("Anima 反推流需要一个 QQ 图片输入节点。")
        if require_prompt and not reverse and not self.positive:
            raise WorkflowError("未识别正向提示词，请在面板 node_mappings 中设置节点映射。")
        if set(self.positive) & set(self.negative):
            raise WorkflowError("正负向提示词共用同一个字符串字段，请分开节点或配置映射。")
        self.models = [
            node["inputs"][field]
            for key, node in self.graph.items()
            for field in ("ckpt_name", "unet_name", "clip_name", "vae_name")
            if key in self.active and isinstance(node["inputs"].get(field), str)
        ]

    def lora_model_nodes(self):
        return [
            key for key, node in self.graph.items()
            if key in self.active and is_link(node["inputs"].get("model"))
            and ({"positive", "negative", "conditioning"} & node["inputs"].keys())
        ]

    def _visit(self, key, stack):
        if key in stack:
            raise WorkflowError("工作流存在循环连接。")
        if key in self.active:
            return
        if key not in self.graph:
            raise WorkflowError(f"连接引用了不存在的节点 {key}。")
        stack.add(key)
        for value in self.graph[key]["inputs"].values():
            if is_link(value):
                self._visit(str(value[0]), stack)
        stack.remove(key)
        self.active.add(key)

    def _trace_conditioning(self, key, seen):
        if key in seen:
            return set()
        seen = seen | {key}
        node = self.graph[key]
        inputs = node["inputs"]
        if node["class_type"] in self.ENCODERS:
            result = set()
            for name in ("text", "text_g", "text_l"):
                if name in inputs:
                    result.update(self._text_source(key, name, set()))
            return result
        result = set()
        # Do not follow model/CLIP/image/control inputs and accidentally rewrite unrelated text.
        for name, value in inputs.items():
            if is_link(value) and ("conditioning" in name.lower() or name in {"input", "value"}):
                result.update(self._trace_conditioning(str(value[0]), seen))
        return result

    def _text_source(self, key, name, seen):
        field = Field(key, name)
        if field in seen:
            raise WorkflowError("提示词字符串连接存在循环。")
        node = self.graph[key]
        value = node["inputs"][name]
        if isinstance(value, str):
            return {field}
        if not is_link(value):
            raise WorkflowError(f"{field.label()} 不是字符串或节点连接。")
        source = str(value[0])
        upstream = self.graph[source]
        source_field = self.STRING_NODES.get(upstream["class_type"])
        if source_field and source_field in upstream["inputs"]:
            return self._text_source(source, source_field, seen | {field})
        if upstream["class_type"] == "Reroute" and len(upstream["inputs"]) == 1:
            return self._text_source(source, next(iter(upstream["inputs"])), seen | {field})
        # Explicitly fail instead of guessing and damaging a custom text-processing chain.
        raise WorkflowError(f"无法自动识别 {field.label()} 的上游字符串，请配置节点映射。")

    def _override(self, overrides, role, detected):
        if role not in overrides:
            return sorted(detected, key=lambda f: (f.node, f.name))
        refs = overrides[role]
        if not isinstance(refs, list):
            raise WorkflowError(f'{role} 映射应为字符串数组，如 ["29.string"]。')
        fields = []
        for ref in refs:
            if not isinstance(ref, str) or "." not in ref:
                raise WorkflowError("映射格式应为 节点ID.输入字段。")
            key, name = ref.split(".", 1)
            if key not in self.active or name not in self.graph[key]["inputs"]:
                raise WorkflowError(f"无效或未连接到图片输出的映射：{ref}")
            if role != "seed" and not isinstance(self.graph[key]["inputs"][name], str):
                raise WorkflowError(f"提示词映射必须指向字符串字段：{ref}")
            fields.append(Field(key, name))
        return fields

    def prepare(self, prompt, negative=None, seed=None, image_filename=None, *, image_folder=None):
        if not isinstance(prompt, str) or (self.positive and not prompt.strip()):
            raise WorkflowError("正向提示词不能为空。")
        if self.positive_prefix:
            prompt = f"{self.positive_prefix}, {prompt.strip()}"
        use_stage_seeds = self.name == WAI_WORKFLOW and seed is None and self.default_seed != -1
        if seed is None:
            seed = self.default_seed
        if len(prompt) > 8000 or (negative is not None and len(negative) > 8000):
            raise WorkflowError("单项提示词不能超过 8000 字符。")
        if isinstance(seed, bool) or not isinstance(seed, int) or not -1 <= seed <= 2**63 - 1:
            raise WorkflowError("种子应为 -1（随机）或 0 到 9223372036854775807 的整数。")
        if seed != -1 and not self.seeds:
            raise WorkflowError("工作流未识别到 seed/noise_seed，请手动设置 seed 映射。")
        if self.image_required and not image_filename:
            raise WorkflowError("此工作流需要参考图片，请随指令发送图片，或回复一张图片后使用。")
        if image_filename and not self.image_inputs:
            raise WorkflowError("此工作流没有图片输入节点。")
        if len(self.image_inputs) > 1 and not self.shared_reference:
            raise WorkflowError(
                "存在多个图片输入，请通过 node_mappings 的 image 映射指定本次使用的一个字段。"
            )
        actual_seed = secrets.randbelow(2**63) if seed == -1 else seed
        graph = copy.deepcopy(self.graph)
        for field in self.positive:
            graph[field.node]["inputs"][field.name] = prompt.strip()
        if negative is not None:
            if not self.negative:
                raise WorkflowError("当前工作流没有可修改的负向提示词节点。")
            for field in self.negative:
                graph[field.node]["inputs"][field.name] = negative
        if not use_stage_seeds:
            for field in self.seeds:
                graph[field.node]["inputs"][field.name] = actual_seed
        if image_filename:
            for field in self.image_inputs:
                graph[field.node]["inputs"][field.name] = image_filename
        for key in self.outputs:
            node = graph[key]
            node_type = node["class_type"]
            folder = image_folder if node_type == "SaveImage" else None
            if node_type in VIDEO_OUTPUT_NODES:
                folder = VIDEO_FOLDER
            if folder:
                prefix = node["inputs"].get("filename_prefix")
                filename = prefix.replace("\\", "/").rsplit("/", 1)[-1] if isinstance(prefix, str) else ""
                if filename.strip() in {"", ".", ".."}:
                    filename = self.name
                node["inputs"]["filename_prefix"] = f"{folder}/{filename}"
            if node_type == "VHS_VideoCombine":
                node["inputs"].update(save_output=True, save_metadata=True)
        return graph, actual_seed if self.seeds else None

    def prepare_caption(self):
        graph = copy.deepcopy({key: node for key, node in self.graph.items() if key in self.active})
        if self.seeds and self.default_seed == -1:
            for field in self.seeds:
                graph[field.node]["inputs"][field.name] = secrets.randbelow(2**63)
        return graph

    def describe(self):
        return {
            "name": self.name,
            "models": self.models,
            "kind": self.kind,
            "output_type": "text" if self.kind == "image_to_text" else "video" if self.is_video else "image",
            "requires_image": self.image_required,
            "image_inputs": [f.label() for f in self.image_inputs],
            "video_settings": [
                {
                    "node": key,
                    **{
                        name: node["inputs"][name]
                        for name in ("width", "height", "length", "fps")
                        if name in node["inputs"]
                    },
                }
                for key, node in self.graph.items()
                if self.is_video
                and key in self.active
                and any(name in node["inputs"] for name in ("length", "fps"))
            ],
            "positive": [f.label() for f in self.positive],
            "negative": [f.label() for f in self.negative],
            "seed": [f.label() for f in self.seeds],
            "outputs": self.outputs,
        }
