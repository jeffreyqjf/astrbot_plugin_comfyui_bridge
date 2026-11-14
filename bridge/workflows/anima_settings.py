"""Manage the Anima workflow and its AstrBot dashboard view."""

import asyncio
import json
import os
import subprocess
from copy import deepcopy
from pathlib import Path
from urllib.parse import quote

from astrbot.api.web import error_response, json_response, request

from ..client import ComfyError
from ..lora_settings import LoraSettings
from ..service import ANIMA_MAPPING, ANIMA_WORKFLOW
from .workflow import Workflow, WorkflowError, profile_parts, sweep_lora_family
from .workflow_fields import editable_fields, parse_field, validate_graph
from .workflow_store import atomic_write, profile_bytes, read_profile, workflow_revision

BRANCH_LABELS = {
    3: "图生图参考图",
    4: "保存 ComfyUI 原图",
    5: "修手",
    7: "NSFW 修复",
    8: "修脸",
    9: "修眼",
    10: "细化使用 SAM",
    12: "整图细化",
    13: "细化前放大",
    14: "细化后放大",
    15: "二次采样",
    16: "签名",
    17: "去背景",
    19: "Ultimate SD 放大",
    21: "颜色匹配",
    100: "遮罩细化",
    118: "SAM 3.1 细化",
    119: "分区提示词",
    120: "ControlNet LLLite",
    122: "RTX 超分",
    123: "修脚",
}
BRANCH_CATEGORIES = {
    str(key): label
    for label, ids in (
        ("参考与构图", (3, 119, 120)),
        ("局部修复", (5, 7, 8, 9, 123, 10, 12, 100, 118)),
        ("采样与放大", (13, 14, 15, 19, 99, 121, 122)),
        ("色彩与滤镜", (21, *range(102, 116), 117)),
        ("输出", (4, 16, 17)),
    )
    for key in ids
}
ANIMA_RUN_BRANCHES = {
    "img2img": ("3", "59"),
    "hands": ("5", "53"),
    "face": ("8", "55"),
    "eyes": ("9", "56"),
    "feet": ("123", "514"),
    "nsfw_repair": ("7", "54"),
}
IMG2IMG_DENOISE = 0.55
QQ_IMAGE_NODES = tuple(field.split(".", 1)[0] for field in ANIMA_MAPPING["optional_image"])
BACKGROUND_WEIGHTS = {
    "BEN2": "BEN2_Base.pth",
    "RMBG-1.4": "RMBG-1.4.pth",
    "RMBG-2.0": "RMBG-2.0/config.json",
}


def nodes_in_group(canvas, group):
    x, y, w, h = group["bounding"]
    return [
        node
        for node in canvas["nodes"]
        if node["mode"] in (0, 4)
        and node["type"] != "Image Comparer (rgthree)"
        and x <= node["pos"][0] < x + w
        and y <= node["pos"][1] < y + h
    ]


def branch_groups(canvas):
    groups = {}
    for group in canvas["groups"]:
        key = group["id"]
        if str(key) not in BRANCH_CATEGORIES:
            continue
        nodes = nodes_in_group(canvas, group)
        if nodes:
            groups[str(key)] = (BRANCH_LABELS.get(key, group["title"]), nodes)
    return groups


def all_fields(graph, canvas, schemas):
    fields = editable_fields(graph, schemas)
    dormant = {}
    for node in canvas["nodes"]:
        key = str(node["id"])
        named = node.get("widgets_values_named")
        if key in graph or node["mode"] != 4 or not isinstance(named, dict):
            continue
        linked = {slot["name"] for slot in node.get("inputs", []) if slot.get("link") is not None}
        dormant[key] = {
            "class_type": node["type"],
            "inputs": {name: value for name, value in named.items() if name not in linked},
            "_meta": {"title": node.get("title")},
        }
    for key, field in editable_fields(dormant, schemas).items():
        field["active"] = False
        fields[key] = field
    return fields


def panel_reference_available(graph, schemas, nodes=QQ_IMAGE_NODES):
    spec = schemas.get("LoadImage", {}).get("input", {}).get("required", {}).get("image")
    return bool(spec and isinstance(spec[0], list) and all(
        graph[key]["inputs"]["image"] in spec[0] for key in nodes if key in graph
    ))


RESOURCE_FIELDS = {
    "unet_name",
    "clip_name",
    "vae_name",
    "ckpt_name",
    "model_name",
    "lora_name",
    "control_net_name",
    "upscale_model",
}


def resource_names(kind, values):
    for name, value in values.items():
        if not isinstance(value, str) or not value:
            continue
        if name in RESOURCE_FIELDS or (kind == "ModelPatchLoader" and name == "name"):
            yield value
        elif kind == "LoadImage" and name == "image":
            yield f"素材：{value}"
        elif kind == "AIO_Preprocessor" and name == "preprocessor":
            yield f"预处理器：{value}"
        elif kind == "easy imageRemBg" and name == "rem_mode":
            filename = BACKGROUND_WEIGHTS.get(value)
            yield f"{value} · {filename}" if filename else value
    if kind == "RTXVideoSuperResolution":
        yield "NVIDIA RTX Video Super Resolution"


def branch_resources(nodes, graph, overrides):
    names = []
    ids = {str(node["id"]) for node in nodes}
    for node in nodes:
        key, kind = str(node["id"]), node["type"]
        values = dict(node.get("widgets_values_named") or {})
        if key in graph:
            values.update(graph[key]["inputs"])
        for name, setting in overrides.items():
            owner, field = name.split(".", 1)
            if owner == key and setting["class_type"] == kind:
                values[field] = setting["value"]
        names.extend(resource_names(kind, values))
    for key, node in graph.items():
        if ":" in key and key.split(":", 1)[0] in ids:
            names.extend(resource_names(node["class_type"], node["inputs"]))
    if "29" in graph and any(node["type"] == "FaceDetailerPipe" for node in nodes):
        names.extend(resource_names(graph["29"]["class_type"], graph["29"]["inputs"]))
    return list(dict.fromkeys(names))


def apply_overrides(graph, overrides, schemas):
    fields = editable_fields(graph, schemas)
    for name, setting in overrides.items():
        field = fields.get(name)
        if field and field["class_type"] == setting["class_type"]:
            value = setting["value"]
            if field["kind"] == "json" and isinstance(value, dict):
                value = value["__value__"]
            graph[field["node"]]["inputs"][field["name"]] = parse_field(field, value)


def merge_options(base, changes):
    merged = {**base, **changes}
    if "branches" in base or "branches" in changes:
        merged["branches"] = {**base.get("branches", {}), **changes.get("branches", {})}
    return merged


class AnimaSettings(LoraSettings):
    def __init__(self, service):
        super().__init__(service, "anima", "Anima")
        self.workflow_name = ANIMA_WORKFLOW
        self.path = service.workflow_dir / f"{ANIMA_WORKFLOW}.json"
        self.state_path = service.data_dir / "anima_state.json"
        self.states = None
        self.canvas_path = self.workspace / "user/default/workflows" / self.path.name

    def canvas_source(self):
        candidates = (
            self.service.data_dir / "templates" / self.path.name,
            self.canvas_path,
            self.workspace / "user/default/workflows/AstrBot" / self.path.name,
            self.workspace / "user/default/workflows/AnimaAdvancedV10_AstrBot.json",
            self.service.bundled_dir.parent / "templates" / self.path.name,
        )
        return next((path for path in candidates if path.is_file()), candidates[-1])

    def _read(self):
        raw = read_profile(self.path)
        canvas = read_profile(self.canvas_source())
        graph, settings = profile_parts(json.loads(raw))
        revision = workflow_revision(raw, canvas)
        return revision, graph, settings, json.loads(canvas)

    def run_options(self, options, catalog=None, *, lora_settings=None):
        if not isinstance(options, dict) or options.keys() - {
            *ANIMA_RUN_BRANCHES, "branches", "denoise", "loras"
        }:
            raise WorkflowError("Anima 单次或会话参数无效，请查看 /comfy help gen。")
        branches = options.get("branches", {})
        if not isinstance(branches, dict):
            raise WorkflowError("Anima 分支参数必须是对象。")
        branches = dict(branches)
        for key, (branch, _) in ANIMA_RUN_BRANCHES.items():
            if key in options:
                branches[branch] = options[key]
        if any(
            key not in BRANCH_CATEGORIES or type(value) is not bool for key, value in branches.items()
        ):
            raise WorkflowError("Anima 分支需要有效的编号和 true 或 false。")
        result = {"branches": branches} if branches else {}
        if "denoise" in options:
            value = options["denoise"]
            if type(value) not in (float, int) or not 0 <= value <= 1:
                raise WorkflowError("Anima 降噪必须是 0 到 1 的数值。")
            result["denoise"] = value
        if "loras" in options:
            result["loras"] = (lora_settings or self).parse_loras(options["loras"], catalog)
        return result

    async def session_state(self, owner, changes=None, reset=False, *, inherit=()):
        if type(reset) is not bool:
            raise WorkflowError("reset 必须是 true 或 false。")
        async with self.service.state_lock:
            if self.states is None:
                self.states = json.loads(self.state_path.read_bytes()) if self.state_path.exists() else {}
            previous = self.states.get(owner, {})
            if changes is None and not reset and not inherit:
                return previous
            options = await asyncio.to_thread(self.run_options, {} if changes is None else changes)
            state = merge_options({} if reset else previous, options)
            for key in inherit:
                if key == "denoise":
                    state.pop(key, None)
                elif "branches" in state:
                    state["branches"].pop(key, None)
            if state.get("branches") == {}:
                state.pop("branches")
            states = dict(self.states)
            states.pop(owner, None)
            if state:
                states[owner] = state
            if len(states) > 4096:
                states.pop(next(iter(states)))
            temp = self.state_path.with_suffix(".tmp")
            temp.write_text(json.dumps(states, ensure_ascii=False), encoding="utf-8")
            temp.replace(self.state_path)
            self.states = states
            return state

    def generation_defaults(self, workflow, settings, canvas):
        return {
            "branches": [
                {"id": key, "title": title, "enabled": settings.get("branches", {}).get(
                    key, all(n["mode"] == 0 for n in nodes)
                )}
                for key, (title, nodes) in branch_groups(canvas).items()
            ],
            "denoise": workflow.graph.get("50", {}).get("inputs", {}).get("denoise"),
            "reference_source": workflow.reference_source,
        }

    def _describe(self, revision, graph, settings, canvas, schemas):
        switches = settings.get("branches", {})
        branches = branch_groups(canvas)
        groups = [
            {
                "id": key,
                "title": title,
                "category": BRANCH_CATEGORIES[key],
                "enabled": switches.get(key, all(n["mode"] == 0 for n in nodes)),
            }
            for key, (title, nodes) in branches.items()
        ]
        fields = all_fields(graph, canvas, schemas)
        node_groups = {
            str(node["id"]): key
            for key, (_, nodes) in branches.items() for node in nodes
        }
        shared_detailers = next((group for group in canvas["groups"] if group["id"] == 11), None)
        if shared_detailers is not None:
            node_groups.update({str(node["id"]): "11" for node in nodes_in_group(canvas, shared_detailers)})
        for field in fields.values():
            group = node_groups.get(field["node"].split(":", 1)[0])
            field["category"] = "局部修复" if group == "11" else BRANCH_CATEGORIES.get(group, "基础设置")
            if field["category"] == "局部修复":
                field["repair_group"] = group
        for name, setting in settings.get("overrides", {}).items():
            field = fields.get(name)
            if field and not field["active"] and field["class_type"] == setting["class_type"]:
                value = setting["value"]
                field["value"] = (
                    value.get("__value__", value)
                    if isinstance(value, dict)
                    else str(value)
                    if field["kind"] == "INT"
                    else value
                )
        source = settings.get("reference_source", "qq")
        reference_active = any(key in graph for key in QQ_IMAGE_NODES)
        return {
            "revision": revision,
            "workflow": self.workflow_name,
            "short_name": self.service.workflow_short_name(self.workflow_name),
            "kind": "image_to_image" if reference_active else "text_to_image",
            "reference_source": source,
            "reference_active": reference_active,
            "requires_image": reference_active and (
                source == "qq" or (source == "auto" and not panel_reference_available(graph, schemas))
            ),
            "branches": groups,
            "fields": list(fields.values()),
            "use_canvas_seed": settings.get("use_canvas_seed", False),
            "positive_prefix": settings.get("positive_prefix", ""),
            "sweep_lora_family": sweep_lora_family(self.workflow_name, settings),
            "sweep_lora_directories": self.directory_names(),
        }

    async def _export(self, canvas, schemas, variants=None):
        python = self.workspace / (
            "venv/Scripts/python.exe" if os.name == "nt" else "venv/bin/python"
        )
        if not python.is_file():
            raise WorkflowError("找不到 ComfyUI 的 Python 环境，请在插件配置检查 ComfyUI 目录。")
        process = await asyncio.create_subprocess_exec(
            str(python),
            "-B",
            str(Path(__file__).with_name("anima_export.py")),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        payload = json.dumps(
            {"canvas": canvas, "schemas": schemas, "variants": variants}, ensure_ascii=True
        ).encode()
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(payload), timeout=30)
        except (TimeoutError, asyncio.CancelledError):
            process.kill()
            await process.wait()
            raise
        if process.returncode:
            detail = stderr.decode("utf-8", errors="replace").strip().splitlines()
            raise WorkflowError(
                "画布导出失败。 " + (detail[-1][:350] if detail else "请检查工作流连接。")
            )
        return json.loads(stdout)

    async def describe_profile(self, revision, graph, settings, canvas, *, cached=False):
        node_types = {node["class_type"] for node in graph.values()}
        node_types.update(
            node["type"] for node in canvas["nodes"] if node["mode"] == 4 and node.get("widgets_values_named")
        )
        schemas = await self.service.client.node_schemas(node_types, cached=cached)
        return await asyncio.to_thread(self._describe, revision, graph, settings, canvas, schemas)

    async def get(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            await self.service.initialize()
            revision, graph, settings, canvas = await asyncio.to_thread(self._read)
            return json_response(await self.describe_profile(revision, graph, settings, canvas))
        except (OSError, ValueError, KeyError, ComfyError) as exc:
            return error_response(str(exc), status_code=400)

    async def check_branches(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            await self.service.initialize()
            revision, current, settings, canvas = self._read()
            schemas = await self.service.client.request("GET", "/object_info")
            return json_response(
                await self._check_branches(revision, current, settings, canvas, schemas)
            )
        except (OSError, ValueError, KeyError, TypeError, TimeoutError, ComfyError) as exc:
            return error_response(str(exc) or "分支检查超时，请重试。", status_code=400)

    async def _check_branches(self, revision, current, settings, canvas, schemas):
        groups = branch_groups(canvas)
        branches = settings.get("branches", {})
        overrides = settings.get("overrides", {})
        enabled = {}
        for key, (_, nodes) in groups.items():
            enabled[key] = branches.get(key, all(node["mode"] == 0 for node in nodes))
            if key in branches:
                for node in nodes:
                    node["mode"] = 0 if enabled[key] else 4
        variants = {key: [node["id"] for node in nodes] for key, (_, nodes) in groups.items()}
        exported = await self._export(canvas, schemas, variants)
        rows = []
        for key, (title, nodes) in groups.items():
            candidate = exported[key]
            graph = candidate.get("graph", {})
            error = candidate.get("error", "")
            if not error:
                try:
                    apply_overrides(graph, overrides, schemas)
                    mapping = {**self.service.workflow_mappings().get(self.workflow_name, {}), **settings.get("node_mapping", {})}
                    self._validate(graph, schemas, settings.get("reference_source", "qq"), mapping)
                except WorkflowError as exc:
                    error = str(exc)
            ids = {str(node["id"]) for node in nodes}
            reachable = any(name.split(":", 1)[0] in ids for name in graph)
            rows.append(
                {
                    "title": title,
                    "enabled": enabled[key],
                    "status": "blocked" if error else "ready" if reachable else "idle",
                    "detail": error or ("" if reachable else "当前搭配未连接到最终输出。"),
                    "resources": ["QQ 当前消息或引用图片"]
                    if key in {"3", "120"} and settings.get("reference_source", "qq") == "qq"
                    else branch_resources(nodes, graph, overrides),
                }
            )
        base = [
            name
            for key in ("22", "40", "48")
            if key in current
            for name in resource_names(current[key]["class_type"], current[key]["inputs"])
        ]
        return {"revision": revision, "models": base, "branches": rows}

    async def for_generation(self, workflow, options, has_reference, state, *, lora_settings=None):
        async with self.service.workflow_lock:
            workflow = self.service.workflows.get(self.workflow_name, workflow)
            _, _, settings, canvas = await asyncio.to_thread(self._read)
        loras = options.get("loras", state.get("loras"))
        catalog = await asyncio.to_thread((lora_settings or self).lora_catalog) if loras else {}
        options = merge_options(state, self.run_options(options, catalog, lora_settings=lora_settings))
        requested = dict(options.get("branches", {}))
        source = workflow.reference_source
        if has_reference and source != "local":
            requested.setdefault("3", True)
        known = {
            key: settings.get("branches", {}).get(key, all(node["mode"] == 0 for node in nodes))
            for key, (_, nodes) in branch_groups(canvas).items()
        }
        known.update({branch: node in workflow.active for branch, node in ANIMA_RUN_BRANCHES.values()})
        switches = {
            key: enabled for key, enabled in requested.items() if enabled != known.get(key)
        }
        ref_on = requested.get("3", "59" in workflow.active)
        denoise = options.get("denoise")
        graph = workflow.graph
        main_denoise = graph.get("50", {}).get("inputs", {}).get("denoise")
        if (
            denoise is None and ref_on and main_denoise == 1
            and "50.denoise" not in settings.get("overrides", {})
        ):
            denoise = IMG2IMG_DENOISE
        schemas = None
        if switches:
            schemas = await self.service.client.request("GET", "/object_info")
            _, workflow = await self._prepare(
                {
                    "branches": switches,
                    "rebuild": True,
                    "changes": {"50.denoise": denoise} if denoise is not None else {},
                    "positive_prefix": settings.get("positive_prefix", ""),
                    "use_canvas_seed": settings.get("use_canvas_seed", False),
                    "reference_source": source,
                },
                graph, settings, canvas, schemas,
            )
            for branch, node in ANIMA_RUN_BRANCHES.values():
                if branch in switches and switches[branch] != (node in workflow.active):
                    raise WorkflowError(f"分支「{BRANCH_LABELS[int(branch)]}」无法切换，请检查到最终输出的连线。")
        elif denoise is not None:
            if main_denoise is None:
                raise WorkflowError("Anima 主采样节点 #50 没有可调整的降噪参数。")
            graph = deepcopy(graph)
            graph["50"]["inputs"]["denoise"] = denoise
            workflow = Workflow(
                self.workflow_name, {"prompt": graph, "astrbot": settings},
                self.service.workflow_mappings().get(self.workflow_name),
            )

        if workflow.image_inputs and not has_reference:
            if workflow.image_required:
                raise WorkflowError("Anima 需要参考图。请同条消息附图，或回复一张图后再提交。")
            if source == "auto":
                if schemas is None:
                    schemas = await self.service.client.request("GET", "/object_info/LoadImage")
                if not panel_reference_available(workflow.graph, schemas, (f.node for f in workflow.image_inputs)):
                    raise WorkflowError("图生图需要参考图。请在 QQ 同条消息附图或引用图片。")
        loras = options.get("loras")
        if loras is None:
            loader = workflow.graph.get("26") if "26" in workflow.active else None
            rows = loader["inputs"].get("loras", []) if loader else []
            if isinstance(rows, dict):
                rows = rows.get("__value__", [])
            filenames = [
                row["name"] for row in rows
                if isinstance(row, dict) and row.get("active") and isinstance(row.get("name"), str)
                and any(type(row.get(key)) in (int, float) and row[key] for key in ("strength", "clipStrength"))
            ] if isinstance(rows, list) else []
            if filenames:
                return await asyncio.to_thread(self.with_lora_tags, workflow, filenames, canvas=True)
            return workflow
        return await self._apply_loras(workflow, loras, catalog, schemas)

    async def lora_sweep(self, workflow, characters, catalog, state, *, allow_nsfw):
        options = {"img2img": False, "loras": []}
        if not allow_nsfw:
            options["nsfw_repair"] = False
        workflow = await self.for_generation(workflow, options, False, state)
        schemas = await self.service.client.request("GET", "/object_info/LoraLoaderModelOnly")
        return [
            await self._apply_loras(workflow, [{"id": entry["id"]}], catalog, schemas)
            for entry in characters
        ]

    async def _apply_loras(self, workflow, loras, catalog, schemas):
        rows = self.parse_loras(loras, catalog)
        graph = deepcopy(workflow.graph)
        loader = graph.get("26")
        if not loader or loader["class_type"] != "Lora Loader (LoraManager)":
            raise WorkflowError("Anima 工作流缺少 LoRA 接入节点 #26。")
        inputs = loader["inputs"]
        inputs["text"] = ""
        inputs["loras"] = {"__value__": []}
        tags = []
        if rows:
            if schemas is None:
                schemas = await self.service.client.request("GET", "/object_info/LoraLoaderModelOnly")
            spec = schemas.get("LoraLoaderModelOnly", {}).get("input", {}).get("required", {})
            files = {name.replace("\\", "/"): name for name in spec.get("lora_name", [[]])[0]}
            for row in rows:
                key, strength = row["id"], row["strength"]
                entry = catalog[key]
                filename = files.get(entry["filename"])
                if not filename:
                    raise WorkflowError(f"ComfyUI 未找到 LoRA「{entry['title']}」。")
                node = f"astrbot_lora_{quote(key, safe='')}"
                graph[node] = {
                    "class_type": "LoraLoaderModelOnly",
                    "inputs": {"model": inputs["model"], "lora_name": filename, "strength_model": strength},
                }
                inputs["model"] = [node, 0]
                if strength:
                    tags.append(entry["tag"])
        return Workflow(
            self.workflow_name,
            {"prompt": graph, "astrbot": {
                "positive_prefix": ", ".join(dict.fromkeys(filter(None, [workflow.positive_prefix, *tags]))),
                "reference_source": workflow.reference_source,
                "use_canvas_seed": workflow.default_seed != -1,
                "sweep_lora_family": workflow.sweep_lora_family,
            }},
            workflow.mapping,
        )

    async def save(self, *, update_config=None):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            body = await request.body()
            if len(body) > 512 * 1024:
                raise WorkflowError("参数数据过大。")
            payload = json.loads(body)
            if not isinstance(payload, dict):
                raise WorkflowError("参数格式无效。")
            await self.service.initialize()
            async with self.service.workflow_lock:
                revision, graph, settings, canvas = self._read()
                if payload.get("revision") != revision:
                    return error_response("工作流已更新，请刷新参数页后重试。", status_code=409)
                schemas = await self.service.client.request("GET", "/object_info")
                profile, workflow = await self._prepare(payload, graph, settings, canvas, schemas)
                before = read_profile(self.path)
                canvas_raw = read_profile(self.canvas_source())
                if workflow_revision(before, canvas_raw) != revision:
                    return error_response("工作流已更新，请刷新参数页后重试。", status_code=409)
                saved = profile_bytes(profile)
                saved_graph, saved_settings = profile_parts(profile)
                response = json_response(await asyncio.to_thread(
                    self._describe, workflow_revision(saved, canvas_raw),
                    saved_graph, saved_settings, json.loads(canvas_raw), schemas,
                ))
                if update_config is not None and "update_config" in payload:
                    await update_config(payload["update_config"], workflow, self.path, before, saved, canvas_raw)
                else:
                    atomic_write(self.path, saved)
                self.service.workflows[self.workflow_name] = workflow
                self.service.errors.pop(self.workflow_name, None)
                return response
        except (OSError, ValueError, KeyError, TypeError, TimeoutError, ComfyError) as exc:
            return error_response(str(exc) or "导出超时，请重试。", status_code=400)

    async def _prepare(self, payload, graph, settings, canvas, schemas):
        fields = all_fields(graph, canvas, schemas)
        branches = dict(settings.get("branches", {}))
        overrides = dict(settings.get("overrides", {}))
        groups = branch_groups(canvas)
        changes = payload.get("changes", {})
        switches = payload.get("branches", {})
        if not isinstance(changes, dict) or not isinstance(switches, dict):
            raise WorkflowError("参数或分支格式无效。")
        for name, value in changes.items():
            if name not in fields:
                raise WorkflowError(f"字段 {name} 不可编辑。")
            field = fields[name]
            overrides[name] = {
                "value": parse_field(field, value),
                "class_type": field["class_type"],
            }
        for key, enabled in switches.items():
            if key not in groups or type(enabled) is not bool:
                raise WorkflowError("分支开关无效。")
            branches[key] = enabled
        if branches != settings.get("branches", {}) or payload.get("rebuild") is True:
            for key, enabled in branches.items():
                for node in groups.get(key, ("", []))[1]:
                    node["mode"] = 0 if enabled else 4
            graph = await self._export(canvas, schemas)
        prefix = payload.get("positive_prefix", "")
        fixed = payload.get("use_canvas_seed", False)
        source = payload.get("reference_source", settings.get("reference_source", "qq"))
        if source not in ("auto", "qq", "local"):
            raise WorkflowError("参考图来源无效。")
        if not isinstance(prefix, str) or len(prefix) > 4000 or type(fixed) is not bool:
            raise WorkflowError("提示词前缀或种子模式无效。")
        apply_overrides(graph, overrides, schemas)
        family = sweep_lora_family(self.workflow_name, settings)
        selected_family = payload.get("sweep_lora_family", family)
        self.validate_sweep_directory(selected_family, family)
        profile = {
            "prompt": graph,
            "astrbot": {
                **settings,
                "branches": branches,
                "overrides": overrides,
                "use_canvas_seed": fixed,
                "reference_source": source,
                "positive_prefix": prefix.strip(),
                "sweep_lora_family": selected_family,
            },
        }
        workflow = Workflow(
            self.workflow_name, profile, self.service.workflow_mappings().get(self.workflow_name)
        )
        self._validate(graph, schemas, source, workflow.mapping)
        return profile, workflow

    def _validate(self, graph, schemas, source, mapping=None):
        if mapping is None:
            mapping = self.service.workflow_mappings().get(self.workflow_name, {})
        image_fields = mapping.get("image") or mapping.get("optional_image", ANIMA_MAPPING["optional_image"])
        replacement = {
            (key, "image") for key in QQ_IMAGE_NODES
            if source in {"auto", "qq"} and f"{key}.image" in image_fields
            and graph.get(key, {}).get("class_type") == "LoadImage"
        }
        validate_graph(graph, schemas, replacement)
        for node in graph.values():
            if node["class_type"] == "easy imageRemBg":
                name = node["inputs"]["rem_mode"]
                weight = BACKGROUND_WEIGHTS.get(name)
                if weight and not (self.workspace / "models/rembg" / weight).is_file():
                    raise WorkflowError(
                        f"去背景需要本地 {name} 模型文件（models/rembg/{weight}）。"
                    )
