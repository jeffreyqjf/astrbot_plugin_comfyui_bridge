"""Read-only model inventory from installed workflows, with reviewed release sources."""

import asyncio
import json
from fnmatch import fnmatchcase
from pathlib import PurePosixPath

from astrbot.api.web import error_response, json_response, request

from .. import PACKAGE_ROOT
from ..workflows.workflow_store import profile_parts, workflow_path

# Explicit loader contracts prevent ordinary text/image filenames becoming model dependencies.
LOADERS = {
    "UNETLoader": ("unet_name", "diffusion_models", "扩散主模型", True),
    "UnetLoaderGGUF": ("unet_name", "diffusion_models", "GGUF 主模型候选", False),
    "AnimaBoosterLoader": ("model_name", "diffusion_models", "Anima 增强模型", False),
    "CheckpointLoaderSimple": ("ckpt_name", "checkpoints", "整合绘图模型／分割模型", True),
    "CLIPLoader": ("clip_name", "text_encoders", "提示词编码", True),
    "VAELoader": ("vae_name", "vae", "图像／视频／音频编解码", True),
    "ControlNetLoader": ("control_net_name", "controlnet", "构图／姿态／边缘控制", False),
    "ModelPatchLoader": ("name", "model_patches", "模型控制补丁", False),
    "AnimaLLLiteApply_sdscripts": ("lllite_name", "controlnet", "Anima LLLite 控制", False),
    "UpscaleModelLoader": ("model_name", "upscale_models", "图像超分", False),
    "easy hiresFix": ("model_name", "upscale_models", "高清修复超分", False),
    "LatentUpscaleModelLoader": ("model_name", "latent_upscale_models", "潜空间放大", False),
    "UltralyticsDetectorProvider": ("model_name", "ultralytics", "局部修复区域检测", False),
    "SAMLoader": ("model_name", "sams", "区域分割", False),
    "CLIPVisionLoader": ("clip_name", "clip_vision", "参考图视觉编码", False),
    "IPAdapterModelLoader": ("ipadapter_file", "ipadapter", "参考风格／构图适配", False),
    "LoraLoader": ("lora_name", "loras", "风格／人物 LoRA", False),
    "LoraLoaderModelOnly": ("lora_name", "loras", "模型 LoRA／加速", False),
    "VOSR2ModelLoader": ("model", "vosr2", "视觉超分模型包", False),
    "TIPO": ("tipo_model", "kgen", "提示词扩写", False),
    "PixAITaggerPlus": ("model", "pixai_tagger", "图片标签反推", True),
    "FL_RIFE": ("ckpt_name", "rife", "视频补帧，首次运行由节点下载", False),
}


def inventory(workflow, sources, canvas=None, saved_graph=None):
    nodes = [(str(key), node["class_type"], node.get("inputs", {}), key in workflow.active)
             for key, node in workflow.graph.items()]
    for key, node in (saved_graph or {}).items():
        if key not in workflow.graph:
            nodes.append((str(key), node["class_type"], node.get("inputs", {}), False))
    # Canvas-only loaders cover dormant Anima branches absent from its minimal API graph.
    if canvas:
        for node in canvas.get("nodes", []):
            kind = node.get("type")
            values = node.get("widgets_values", [])
            if str(node["id"]) not in workflow.graph and kind in LOADERS and isinstance(values, list) and values:
                nodes.append((str(node["id"]), kind, {LOADERS[kind][0]: values[0]}, False))
    rows = {}
    expanded = []
    for identity, kind, inputs, connected in nodes:
        if kind == "PixaromaLoraLoader":
            try:
                stack = json.loads(inputs.get("LoraLoaderState", "{}"))
                for entry in stack.get("loras", []):
                    expanded.append((identity, "LoraLoaderModelOnly", {"lora_name": entry.get("name")}, connected and entry.get("on", True)))
            except (ValueError, TypeError, AttributeError):
                pass
        stack = inputs.get("loras", {})
        if isinstance(stack, dict):
            stack = stack.get("__value__", [])
        if isinstance(stack, list):
            for entry in stack:
                if isinstance(entry, dict):
                    expanded.append((identity, "LoraLoader", {"lora_name": entry.get("name")}, connected and entry.get("active", False)))
    for identity, kind, inputs, connected in nodes + expanded:
        if kind not in LOADERS:
            continue
        field, folder, purpose, core = LOADERS[kind]
        name = inputs.get(field)
        if not isinstance(name, str) or not name.strip() or name.casefold() in {"none", "disabled"}:
            continue
        if name.startswith("KBlueLeaf/"):
            name = name.split(" | ")[-1]
        name = name.replace("\\", "/")
        # Literal model names are display-only; never used to read user-supplied paths.
        basename = PurePosixPath(name).name
        info = next((row for row in sources if fnmatchcase(basename.casefold(), row["pattern"].casefold())), {})
        required = core and connected and not basename.casefold().startswith(("sam", "taesd"))
        if workflow.name in {"WAN22_SVI_I2V_AstrBot", "WAN22_Lightning_Long_I2V_AstrBot"} and folder == "diffusion_models":
            required = False
            purpose = "基础主模型候选；按 FP8／GGUF 模式选择对应高低噪声一套"
        row = rows.setdefault((folder, name), {
            "name": name, "folder": f"models/{folder}/{str(PurePosixPath(name).parent)}/".replace("/./", "/"),
            "purpose": purpose, "required": False, "connected": False, "nodes": [],
            "url": info.get("url"), "source": info.get("source", "来源待核实"),
            "note": info.get("note", "未核实此精确文件的作者下载页；请勿以同名镜像或同系列模型直接替代。"),
        })
        if kind == "PixAITaggerPlus":
            row["folder"] = f"models/pixai_tagger/{name}/"
            row["note"] += " 同时准备 model.safetensors 和 config.json。"
        elif kind == "FL_RIFE":
            row["folder"] = "custom_nodes/comfyui_fill-nodes/nodes/cache/rife_models/"
        row["required"] |= required
        row["connected"] |= connected
        row["nodes"].append(f"#{identity} · {kind}")
    return sorted(rows.values(), key=lambda row: (not row["required"], not row["connected"], row["folder"], row["name"]))


async def catalog_data(service, anima):
    data = json.loads((PACKAGE_ROOT / "templates/model_sources.json").read_text(encoding="utf-8"))
    await service.initialize()
    workflows = []
    async with service.workflow_lock:
        for name, workflow in service.workflows.items():
            canvas = None
            if name == "Anima_T2I_AstrBot":
                canvas = json.loads(anima.canvas_source().read_bytes())
            saved_graph, _ = profile_parts(json.loads(workflow_path(service.workflow_dir, name).read_bytes()))
            rows = inventory(workflow, data["sources"], canvas, saved_graph)
            workflows.append({"name": name, "models": rows})
    from .model_downloads import local_status
    def annotate():
        cache = {}
        for workflow in workflows:
            for row in workflow["models"]:
                try:
                    workspace = anima.workspace.resolve()
                    if not (workspace / "folder_paths.py").is_file():
                        raise ValueError("未确认本机 ComfyUI 目录，无法检测模型。")
                    row.update(local_status(workspace, row, cache))
                except (OSError, ValueError, AttributeError) as exc:
                    row.update(installed=False, local_checked=False, locations=[], local_error=str(exc))
                row["download_url"] = data.get("downloads", {}).get(PurePosixPath(row["name"]).name)
    await asyncio.to_thread(annotate)
    return {"checked_at": data["checked_at"], "workflows": workflows}


async def catalog_api(service, anima):
    if not request.username:
        return error_response("请登录 AstrBot 面板。", status_code=401)
    return json_response(await catalog_data(service, anima))
