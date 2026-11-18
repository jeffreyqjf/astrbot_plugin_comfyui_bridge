"""RGB regional conditioning for the existing Advanced V40 branch."""

import base64
import io
from copy import deepcopy

from PIL import Image

from .controlnet import CONTROL_BRANCHES
from .workflow import ADVANCED_V40_WORKFLOW, ANIMA_WORKFLOW, WorkflowError

CHANNELS = ("R", "G", "B")
REGIONS = (("1", "4", "7"), ("2", "5", "18"), ("3", "6", "26"))
ANIMA_REGIONS = (("0", "3", "6"), ("1", "4", "7"), ("2", "5", "8"))
UPSCALE_FEATURES = [
    {"id": "upscale.pre", "kind": "branch", "branch": "pre", "title": "Ultimate 放大 · Detailer 前"},
    {"id": "upscale.post", "kind": "branch", "branch": "post", "title": "Ultimate 放大 · Detailer 后"},
]
SAMPLING_FEATURES = [
    {"id": "sampling.hires_pre", "kind": "branch", "branch": "hires_pre", "title": "Hires PreDetailer"},
    {"id": "sampling.hires_post", "kind": "branch", "branch": "hires_post", "title": "Hires PostDetailer"},
    {"id": "sampling.second_sampler", "kind": "branch", "branch": "second_sampler", "title": "2ndSampler"},
]


ANIMA_FEATURES = [
    {"id": "regional", "kind": "regional", "title": "Regional Prompting"},
    *SAMPLING_FEATURES,
    {"id": "anima.ultimate", "kind": "branch", "branch": "ultimate", "title": "Ultimate SD Upscaler"},
]


def feature_catalog(workflow):
    if workflow.task_features:
        if not isinstance(workflow.task_features, list) or len(workflow.task_features) > 16:
            raise WorkflowError("工作流可选功能声明无效。")
        seen = set()
        for item in workflow.task_features:
            if (not isinstance(item, dict) or not isinstance(item.get("id"), str)
                    or not isinstance(item.get("title"), str) or not 1 <= len(item["title"]) <= 80
                    or item["id"] in seen):
                raise WorkflowError("工作流可选功能 ID 或名称无效。")
            seen.add(item["id"])
            if item.get("kind") == "controlnet":
                branch = item.get("branch")
                if not isinstance(branch, str) or branch not in CONTROL_BRANCHES.get(workflow.name, {}) or item["id"] != f"controlnet.{branch}":
                    raise WorkflowError("工作流未适配所声明的 ControlNet 分支。")
            elif ((workflow.name == ADVANCED_V40_WORKFLOW and item in UPSCALE_FEATURES + SAMPLING_FEATURES)
                  or (workflow.name == ANIMA_WORKFLOW and item in ANIMA_FEATURES)):
                pass
            elif item.get("kind") != "regional" or item["id"] != "regional" or workflow.name != ADVANCED_V40_WORKFLOW:
                raise WorkflowError("工作流可选功能需要对应的已注册适配器。")
        result = deepcopy(workflow.task_features)
        if workflow.name == ADVANCED_V40_WORKFLOW:
            result.extend(deepcopy(item) for item in UPSCALE_FEATURES + SAMPLING_FEATURES if item["id"] not in seen)
        if workflow.name == ANIMA_WORKFLOW:
            result.extend(deepcopy(item) for item in ANIMA_FEATURES if item["id"] not in seen)
        return result
    result = [
        {"id": f"controlnet.{key}", "kind": "controlnet", "branch": key,
         "title": {"openpose": "OpenPose", "any": "Any ControlNet", "lllite": "Anima LLLite"}.get(key, key)}
        for key in CONTROL_BRANCHES.get(workflow.name, {})
    ]
    if workflow.name == ADVANCED_V40_WORKFLOW:
        result.append({"id": "regional", "kind": "regional", "title": "区域提示词 · RGB"})
        result.extend(deepcopy(UPSCALE_FEATURES))
        result.extend(deepcopy(SAMPLING_FEATURES))
    if workflow.name == ANIMA_WORKFLOW:
        result.extend(deepcopy(ANIMA_FEATURES))
    return result


def upscale_options(name, value):
    if (name != ADVANCED_V40_WORKFLOW or not isinstance(value, dict) or value.keys() != {"pre", "post"}
            or any(type(item) is not bool for item in value.values())):
        raise WorkflowError("V40 放大设置须包含 pre、post 两个布尔开关。")
    return {"43": value["pre"], "upscale_post": value["post"]}


def sampling_options(name, value):
    branches = ({"hires_pre": "13", "hires_post": "14", "second_sampler": "15"} if name == ANIMA_WORKFLOW
                else {"hires_pre": "18", "hires_post": "40", "second_sampler": "second_sampler"})
    if (name not in {ADVANCED_V40_WORKFLOW, ANIMA_WORKFLOW} or not isinstance(value, dict) or value.keys() != branches.keys()
            or any(type(item) is not bool for item in value.values())):
        raise WorkflowError("Hires 与 2ndSampler 设置须包含三个布尔开关。")
    return {branch: value[key] for key, branch in branches.items()}


def regional_text(value):
    if not isinstance(value, dict) or value.keys() != {"regions", "base_strength"}:
        raise WorkflowError("区域提示词格式无效。")
    regions = value["regions"]
    if not isinstance(regions, list) or len(regions) != 3:
        raise WorkflowError("请配置红、绿、蓝三个区域。")
    for row in regions:
        if (not isinstance(row, dict) or row.keys() != {"text", "strength"}
                or not isinstance(row["text"], str) or len(row["text"]) > 8000 or "\0" in row["text"]):
            raise WorkflowError("每个区域提示词最多 8000 字符。")
    if any(type(x) not in (int, float) or not 0 <= x <= 10
           for x in [value["base_strength"], *(row["strength"] for row in regions)]):
        raise WorkflowError("区域与全局强度须为 0 到 10。")
    return deepcopy(value)


def prepare_regional(name, graph, settings, value, limit):
    anima = name == ANIMA_WORKFLOW
    branch = "119" if anima else "24"
    if not anima and (name != ADVANCED_V40_WORKFLOW or "24" not in settings.get("v40", {}).get("branches", {})):
        raise WorkflowError("当前工作流没有 RGB 区域提示词分支。")
    if value is None:
        return graph, {branch: False}, {}
    if not isinstance(value, dict) or value.keys() != {"mask", "regions", "base_strength"}:
        raise WorkflowError("区域提示词任务参数无效。")
    texts = regional_text({key: value[key] for key in ("regions", "base_strength")})
    encoded = value["mask"]
    if not isinstance(encoded, str) or len(encoded) > 4 * ((limit + 2) // 3):
        raise WorkflowError("区域遮罩过大。")
    try:
        raw = base64.b64decode(encoded, validate=True)
        if len(raw) > limit:
            raise WorkflowError("区域遮罩过大。")
        with Image.open(io.BytesIO(raw), formats=("PNG",)) as image:
            if image.width * image.height > 4_194_304:
                raise WorkflowError("区域遮罩最高支持 419 万像素。")
            rgba = image.convert("RGBA")
            rgb = Image.new("RGB", rgba.size)
            rgb.paste(rgba, mask=rgba.getchannel("A"))
            if not any(rgb.getchannel(channel).getbbox() for channel in CHANNELS):
                raise WorkflowError("请绘制至少一个区域遮罩。")
            for row, channel in zip(texts["regions"], CHANNELS, strict=True):
                if rgb.getchannel(channel).getbbox() and row["strength"] > 0 and not row["text"].strip():
                    raise WorkflowError("有遮罩的区域需要填写提示词，或将强度设为 0。")
            output = io.BytesIO()
            rgb.save(output, "PNG")
            mask = output.getvalue()
    except (OSError, ValueError, Image.DecompressionBombError) as exc:
        raise WorkflowError(f"无法读取 RGB 区域遮罩：{exc}") from exc
    selected = deepcopy(graph)
    if selected.get("20" if anima else "51", {}).get("class_type") != "AttentionCouplePPM":
        raise WorkflowError("区域提示词缺少 Attention Couple 节点。")
    images = {}
    for (image, prompt, strength), row in zip(ANIMA_REGIONS if anima else REGIONS, texts["regions"], strict=True):
        if (selected.get(image, {}).get("class_type") != "LoadImage"
                or selected.get(prompt, {}).get("class_type") != "ImpactWildcardProcessor"
                or selected.get(strength, {}).get("class_type") != "ConditioningSetAreaStrength"):
            raise WorkflowError("区域提示词节点映射已变化，请更新工作流。")
        selected[image]["inputs"]["image"] = "__astrbot_region_pending__.png"
        selected[prompt]["inputs"].update(wildcard_text=row["text"], populated_text=row["text"], mode="fixed")
        selected[strength]["inputs"]["strength"] = row["strength"]
        images[image] = mask
    base = selected.get("9" if anima else "27", {})
    if base.get("class_type") != "ConditioningSetAreaStrength":
        raise WorkflowError("区域提示词缺少全局强度节点。")
    base["inputs"]["strength"] = texts["base_strength"]
    return selected, {branch: True}, images
