"""AstrBot workbench settings for workflows, image archives and drawing prompts."""

import asyncio
import base64
import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
import uuid
from contextlib import nullcontext
from pathlib import Path
from time import monotonic
from urllib.parse import urlsplit

from astrbot.api.web import error_response, json_response, request, stream_response

from .. import PACKAGE_ROOT
from ..client import ComfyError, image_suffix
from ..image_archive import GALLERY_STATES, IMAGE_FILTERS, REVIEW_RATINGS
from ..lora_settings import LORA_SETTINGS_LIMIT, LoraSettings
from ..service import (
    ANIMA_WORKFLOW,
    GENERATION_TIMEOUT_MIN,
    IMAGE_TIMEOUT_MAX,
    VIDEO_TIMEOUT_MAX,
    number,
)
from ..workflows.anima_aio import (
    AIO_CHOICES,
    AIO_SWITCHES,
    AIO_WORKFLOW,
    LORA_SLOTS,
    aio_options,
    aio_workflow,
)
from ..workflows.detailer import FEET_NODES, detailer_workflow, feet_switch
from ..workflows.illustrious import (
    WAI_BRANCHES,
    lora_loader_files,
    wai_branches,
    wai_generation,
    wai_prompt_modes,
    wai_workflow,
)
from ..workflows.lightning import (
    add_lightning_output_nodes,
    lightning_fields,
    lightning_options,
    lightning_workflow,
)
from ..workflows.svi import (
    check_video_rife,
    parse_stages,
    resolve_stage_loras,
    svi_fields,
    svi_lora_files,
    svi_options,
    svi_workflow,
    sync_svi_fields,
    validate_stage_loras,
)
from ..workflows.v40 import (
    REPAIR_OPTIONS,
    V40_FBCNN_SCHEMA,
    V40_WORKFLOWS,
    v40_branches,
    v40_workflow,
)
from ..workflows.workflow import (
    ADVANCED_V40_WORKFLOW,
    DETAILER_WORKFLOW,
    LIGHTNING_WORKFLOW,
    REVERSE_WORKFLOW,
    SEGMENTED_VIDEO_WORKFLOWS,
    SVI_WORKFLOW,
    WAI_WORKFLOW,
    WorkflowError,
    profile_parts,
)
from ..workflows.workflow_archive import (
    ARCHIVE_LIMIT,
    export_archive,
    export_profile,
    install_workflows,
    replace_workflow_files,
    validate_anima_canvas,
    validate_workflow_profile,
    workflow_file_stem,
)
from ..workflows.workflow_fields import combo_options, editable_fields, parse_field, validate_graph
from ..workflows.workflow_store import (
    WORKFLOW_LIMIT,
    atomic_write,
    profile_bytes,
    read_profile,
    workflow_from_profile,
    workflow_path,
    workflow_revision,
)
from .mask_image import apply_mask, reference_body_limit
from .prompt_library import PromptLibrary

WAN_WORKFLOWS = {"WAN22_T2V_AstrBot", "WAN22_I2V_AstrBot"}
PERSONA_LIMIT = 16000
PERSONA_TEMPLATE = PACKAGE_ROOT / "templates" / "drawing_persona.txt"
PRESET_FILE_LIMIT = 1024 * 1024
COMMAND_IMPORT_LIMIT = 6 * 1024 * 1024
WORKFLOW_CONFIG_LIMIT = 2 * WORKFLOW_LIMIT + 64 * 1024
VIDEO_LINK_SECONDS = 6 * 60 * 60
VIDEO_LINK_LIMIT = 128
LEGACY_PRESET_ACCOUNT = "legacy"
AIO_LABELS = dict(zip(
    (*AIO_CHOICES, *AIO_SWITCHES, "threshold"),
    ("扩散模型加载器", "QQ 图片重绘方式", "文生图尺寸模式", "LLLite 控制", "放大方式",
     "TeaCache", "SageAttention", "画师混合", "生成后清理显存", "人物 LoRA",
     "画风质量 LoRA", "动漫 LoRA", "写实 LoRA", "杂项 LoRA", "WD14 标签置信度"),
    strict=True,
))



def validate_presets(presets):
    if not isinstance(presets, list):
        raise WorkflowError("提示词预设格式无效。")
    names, ids = set(), set()
    rows = []
    for row in presets:
        if not isinstance(row, dict):
            raise WorkflowError("提示词预设格式无效。")
        name = row.get("name")
        if not isinstance(name, str) or not re.fullmatch(r'[^"\x00-\x1f\x7f]{1,64}', name.strip()):
            raise WorkflowError("预设名称需为 1 到 64 个字符，不能包含英文双引号或控制字符。")
        name = name.strip()
        if name.casefold() in names:
            raise WorkflowError(f"提示词预设名称重复：{name}。")
        positive, negative = row.get("positive"), row.get("negative", "")
        if not isinstance(positive, str) or not positive.strip():
            raise WorkflowError(f"请填写「{name}」的正向提示词。")
        if any(not isinstance(value, str) or len(value) > 8000 or "\0" in value for value in (positive, negative)):
            raise WorkflowError(f"「{name}」的单项提示词最多 8000 字符，不能包含空字符。")
        names.add(name.casefold())
        normalized = {"name": name, "positive": positive, "negative": negative}
        identity = row.get("id")
        if identity is not None:
            if not isinstance(identity, str) or not re.fullmatch(r"[0-9a-f]{32}", identity) or identity in ids:
                raise WorkflowError(f"「{name}」的预设 ID 无效或重复。")
            normalized["id"] = identity
            ids.add(identity)
        preview = row.get("preview")
        if preview is not None:
            if not isinstance(preview, str) or len(preview) > 2048 or not re.fullmatch(
                r"(?:[0-9a-f]{32}:[1-9][0-9]*|manual:favourite:-?[0-9a-f]+:[0-9a-f]+:[^\x00-\x1f]+)", preview,
            ):
                raise WorkflowError(f"「{name}」的预览图标识无效。")
            normalized["preview"] = preview
        rows.append(normalized)
    return rows


WORKFLOW_ZIP_NAME = "astrbot-comfyui-workflows.zip"
WORKFLOW_ZIP_DIALOG = """
import sys
from tkinter import Tk, filedialog

root = Tk()
root.withdraw()
root.attributes("-topmost", True)
try:
    path = filedialog.asksaveasfilename(
        parent=root, title="导出工作流 ZIP", initialfile=sys.argv[1],
        defaultextension=".zip", filetypes=[("ZIP 文件", "*.zip")], confirmoverwrite=True,
    )
    print(path)
finally:
    root.destroy()
"""


class StudioSettings:
    def __init__(self, service, anima):
        self.service = service
        self.anima = anima
        self.lora_families = {
            "anima": anima,
            "illustrious": LoraSettings(service, "illustrious", "Illustrious"),
        }
        self.extra_lora_catalogs = {}
        self.persona_path = service.data_dir / PERSONA_TEMPLATE.name
        self.persona_default = PERSONA_TEMPLATE.read_text(encoding="utf-8")
        self.presets_path = service.data_dir.resolve() / "prompt_presets" / "presets.json"
        self.preset_users_dir = self.presets_path.parent / "users"
        self.navigation_order_path = service.data_dir.resolve() / "navigation_order.json"
        self.prompt_library = PromptLibrary(
            service.data_dir, service.config.get("prompt_library_directory", ""),
        )
        self.workflow_save_lock = asyncio.Lock()
        self.video_links = {}

    async def lora_catalog_for(self, family):
        await asyncio.to_thread(self.anima.validate_sweep_directory, family, None)
        if family in self.lora_families:
            return self.lora_families[family]
        if family not in self.extra_lora_catalogs:
            self.extra_lora_catalogs[family] = LoraSettings(self.service, family, family)
        return self.extra_lora_catalogs[family]

    async def lora_order(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            catalog = await self.lora_catalog_for(request.query.get("family"))
            return await catalog.get_lora_order()
        except (OSError, ValueError) as exc:
            return error_response(str(exc), status_code=400)

    async def save_lora_order(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            body = await request.body()
            if len(body) > LORA_SETTINGS_LIMIT:
                raise WorkflowError("LoRA 设置文件过大。")
            payload = json.loads(body)
            family = payload.get("family") if isinstance(payload, dict) else None
            if not isinstance(family, str):
                raise WorkflowError("请选择 LoRA 文件夹。")
            catalog = await self.lora_catalog_for(family)
            return await catalog.save_lora_order(payload)
        except (OSError, ValueError, TypeError) as exc:
            return error_response(str(exc), status_code=400)

    async def lora_tags(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            catalog = await self.lora_catalog_for(request.query.get("family"))
            return json_response(await asyncio.to_thread(catalog.saved_tags))
        except (OSError, ValueError) as exc:
            return error_response(str(exc), status_code=400)

    async def import_lora_tags(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            body = await request.body()
            if len(body) > LORA_SETTINGS_LIMIT:
                raise WorkflowError("LoRA 附带词文件过大。")
            data = json.loads(body)
            if not isinstance(data, dict):
                raise WorkflowError("LoRA 附带词格式无效。")
            catalog = await self.lora_catalog_for(data.get("family"))
            await self.service.initialize()
            result = await asyncio.to_thread(catalog.import_tags, data.get("tags"))
            return json_response(result)
        except (OSError, ValueError, RecursionError) as exc:
            return error_response(str(exc), status_code=400)

    async def initialize_presets(self):
        async with self.service.state_lock:
            self.presets_path.parent.mkdir(exist_ok=True)
            legacy_path = self.service.data_dir / "prompt_presets.json"
            if legacy_path.is_file() and not self.presets_path.exists():
                legacy_path.rename(self.presets_path)

    def _preset_path(self, account):
        if account == LEGACY_PRESET_ACCOUNT:
            return self.presets_path
        if not isinstance(account, str):
            raise WorkflowError("请先选择提示词预设的所属用户。")
        platform, _, user = account.partition(":")
        if (
            not platform or platform != platform.strip() or len(platform.encode("utf-8")) > 80
            or not user or user != user.strip()
            or len(user.encode("utf-8")) > 100
            or re.search(r"[\x00-\x1f\x7f]", account)
        ):
            raise WorkflowError("请填写有效的平台和用户 ID。")
        path = self.preset_users_dir / platform.encode().hex() / (user.encode().hex() + ".json")
        if path.resolve() != path:
            raise WorkflowError("用户预设文件必须位于插件预设目录。")
        return path

    @staticmethod
    def _preset_revision(path, raw):
        return hashlib.sha256(str(path).encode() + b"\0" + raw).hexdigest()

    def _preset_snapshot(self, path):
        try:
            with path.open("rb") as file:
                raw = file.read(PRESET_FILE_LIMIT + 1)
        except FileNotFoundError:
            return {"presets": [], "revision": self._preset_revision(path, b"")}
        if len(raw) > PRESET_FILE_LIMIT:
            raise WorkflowError("提示词预设文件过大。")
        try:
            rows = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise WorkflowError(f"提示词预设文件的 JSON 格式有误（第 {exc.lineno} 行）。") from exc
        rows = validate_presets(rows)
        revision = self._preset_revision(path, raw)
        if any("id" not in row for row in rows):
            for row in rows:
                if "id" not in row:
                    row["id"] = uuid.uuid4().hex
            revision = self._write_presets(path, rows)
        return {"presets": rows, "revision": revision}

    async def preset_rows(self, account):
        return (await self._read_presets(account))["presets"]

    async def preset_names(self, account):
        return [row["name"] for row in await self.preset_rows(account)]

    @staticmethod
    def _find_preset(rows, name):
        if not isinstance(name, str) or not name.strip():
            raise WorkflowError("请填写提示词预设名称或编号。")
        name_key = name.strip().casefold()
        for row in rows:
            if row["name"].casefold() == name_key or row.get("id") == name_key:
                return row
        if re.fullmatch(r"#?[0-9]{1,7}", name_key):
            index = int(name_key.lstrip("#"))
            if 1 <= index <= len(rows):
                return rows[index - 1]
        raise WorkflowError(f"找不到提示词预设「{name}」。可用 /comfy prompt preset 查看编号和名称。")

    async def get_preset(self, account, name):
        snapshot = await self._read_presets(account)
        return self._find_preset(snapshot["presets"], name)

    async def resolve_preset(self, account, name):
        row = await self.get_preset(account, name)
        return row["positive"], row["negative"] if row["negative"].strip() else None

    @staticmethod
    def preset_use(account, row, **selection):
        return {**selection, "id": row["id"], "account": account, "name": row["name"]}

    async def _read_presets(self, account):
        async with self.service.state_lock:
            path = self._preset_path(account)
            return {**self._preset_snapshot(path), "path": str(path), "account": account}

    def _write_presets(self, path, rows):
        raw = json.dumps(rows, ensure_ascii=False, indent=2).encode("utf-8")
        if len(raw) > PRESET_FILE_LIMIT:
            raise WorkflowError("提示词预设数据过大。")
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_suffix(".tmp")
        if temp.resolve() != temp:
            raise WorkflowError("预设临时文件必须位于插件预设目录。")
        temp.write_bytes(raw)
        temp.replace(path)
        return self._preset_revision(path, raw)

    async def change_preset(self, account, name, *, positive=None, negative="", overwrite=False):
        async with self.service.state_lock:
            path = self._preset_path(account)
            rows = self._preset_snapshot(path)["presets"]
            if overwrite:
                row = self._find_preset(rows, name)
                row.update(positive=positive, negative=negative)
                rows = validate_presets(rows)
            elif positive is not None:
                rows = validate_presets([*rows, {
                    "id": uuid.uuid4().hex, "name": name, "positive": positive, "negative": negative,
                }])
                row = rows[-1]
            else:
                row = self._find_preset(rows, name)
                rows.remove(row)
            self._write_presets(path, rows)
            return row["name"]

    async def preset_accounts(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            accounts = []
            async with self.service.state_lock:
                for path in self.preset_users_dir.glob("*/*.json"):
                    try:
                        platform = bytes.fromhex(path.parent.name).decode("utf-8")
                        user = bytes.fromhex(path.stem).decode("utf-8")
                        account = f"{platform}:{user}"
                        if self._preset_path(account) == path and path.is_file():
                            accounts.append(account)
                    except ValueError:
                        continue
            return json_response({"accounts": sorted(accounts), "legacy": self.presets_path.is_file()})
        except OSError as exc:
            return error_response(str(exc), status_code=400)

    async def presets(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            return json_response(await self._read_presets(request.query.get("account")))
        except (OSError, ValueError) as exc:
            return error_response(str(exc), status_code=400)

    async def prompt_tags(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            data = await asyncio.to_thread(
                self.prompt_library.search, request.query.get("q", "")[:120],
                request.query.get("group", ""), max(0, int(request.query.get("offset", "0"))),
                request.query.get("reload") == "1",
            )
            return json_response(data)
        except (OSError, ValueError) as exc:
            return error_response(str(exc), status_code=400)

    async def prompt_preview(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            src = await asyncio.to_thread(self.prompt_library.preview, request.query.get("id"))
            return json_response({"src": src})
        except (OSError, ValueError) as exc:
            return error_response(str(exc), status_code=400)

    async def preview_preset_import(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            body = await request.body()
            if len(body) > PRESET_FILE_LIMIT:
                raise WorkflowError("提示词预设数据过大。")
            data = json.loads(body)
            incoming = validate_presets(data.get("presets") if isinstance(data, dict) else None)
            if not incoming:
                raise WorkflowError("导入文件没有提示词预设。")
            snapshot = await self._read_presets(data.get("account"))
            positions = {row["name"].casefold(): index for index, row in enumerate(snapshot["presets"])}
            identities = {row["id"]: index for index, row in enumerate(snapshot["presets"])}
            return json_response({
                **snapshot,
                "incoming": incoming,
                "positions": [positions.get(row["name"].casefold(), identities.get(row.get("id"))) for row in incoming],
            })
        except (OSError, ValueError) as exc:
            return error_response(str(exc), status_code=400)

    async def save_presets(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            body = await request.body()
            if len(body) > PRESET_FILE_LIMIT:
                raise WorkflowError("提示词预设数据过大。")
            data = json.loads(body)
            rows = validate_presets(data.get("presets") if isinstance(data, dict) else None)
            await self.service.initialize()
            async with self.service.state_lock:
                account = data.get("account")
                path = self._preset_path(account)
                current = self._preset_snapshot(path)
                if data.get("revision") != current["revision"]:
                    return error_response("提示词预设已有更新。请保留草稿，重新打开工作台后再编辑。", status_code=409)
                existing = {row["name"].casefold(): row["id"] for row in current["presets"]}
                for row in rows:
                    if "id" not in row:
                        row["id"] = existing.get(row["name"].casefold()) or uuid.uuid4().hex
                rows = validate_presets(rows)
                revision = self._write_presets(path, rows)
            return json_response({
                "presets": rows, "revision": revision,
                "path": str(path), "account": account,
            })
        except (OSError, ValueError) as exc:
            return error_response(str(exc), status_code=400)

    async def initialize_persona(self):
        async with self.service.state_lock:
            try:
                with self.persona_path.open("x", encoding="utf-8", newline="\n") as file:
                    file.write(self.persona_default)
            except FileExistsError:
                pass

    def _persona_snapshot(self):
        try:
            with self.persona_path.open("rb") as file:
                raw = file.read(4 * PERSONA_LIMIT + 4)
        except FileNotFoundError:
            return self.persona_default, "default", ""
        revision = hashlib.sha256(raw).hexdigest()
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            return self.persona_default, revision, "外置文件需要使用 UTF-8 编码，当前使用默认提示词。"
        if not text.strip() or len(text) > PERSONA_LIMIT or "\0" in text:
            return self.persona_default, revision, "外置文件为空、超长或含无效字符，当前使用默认提示词。"
        return text.replace("\r\n", "\n").replace("\r", "\n"), revision, ""

    def persona_prompt(self):
        try:
            return self._persona_snapshot()[0].strip()
        except OSError:
            return self.persona_default.strip()

    def _describe_persona(self):
        text, revision, warning = self._persona_snapshot()
        return {
            "text": text,
            "revision": revision,
            "warning": warning,
            "default_text": self.persona_default,
            "path": str(self.persona_path),
        }

    async def persona(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            return json_response(await asyncio.to_thread(self._describe_persona))
        except OSError as exc:
            return error_response(str(exc), status_code=400)

    async def save_persona(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            body = await request.body()
            if len(body) > 256 * 1024:
                raise WorkflowError("提示词数据过大。")
            data = json.loads(body)
            text = data.get("text") if isinstance(data, dict) else None
            if not isinstance(text, str) or not text.strip() or len(text) > PERSONA_LIMIT or "\0" in text:
                raise WorkflowError(f"提示词需要包含内容，且最多 {PERSONA_LIMIT} 字。")
            await self.service.initialize()
            async with self.service.state_lock:
                if data.get("revision") != self._persona_snapshot()[1]:
                    return error_response("提示词文件已有更新。请保留你的草稿，重新读取后再保存。", status_code=409)
                temp = self.persona_path.with_suffix(".tmp")
                temp.write_text(text, encoding="utf-8", newline="\n")
                temp.replace(self.persona_path)
                return json_response(self._describe_persona())
        except (OSError, ValueError) as exc:
            return error_response(str(exc), status_code=400)

    async def get(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            await self.service.initialize()
            try:
                async with self.service.state_lock:
                    navigation_order = await asyncio.to_thread(self._read_navigation_order)
            except OSError:
                navigation_order = {}
            return json_response(
                {
                    "workflows": [
                        {**workflow.describe(), "kind": "auto_image", "requires_image": False}
                        if workflow.name == AIO_WORKFLOW else workflow.describe()
                        for workflow in self.service.workflows.values()
                    ],
                    "default": self.service._match_workflow_name(str(self.service.config.get("default_workflow", ANIMA_WORKFLOW))),
                    "anima": ANIMA_WORKFLOW,
                    "anima_image": AIO_WORKFLOW,
                    "workflow_aliases": self.service.workflow_aliases,
                    "lora_families": {key: catalog.title for key, catalog in self.lora_families.items()},
                    "lora_directories": await asyncio.to_thread(self.anima.directory_names),
                    "archive": self.service.archive.describe(),
                    "local_workflow_files": self._local_workflow_files(),
                    "navigation_order": navigation_order,
                }
            )
        except (OSError, ValueError) as exc:
            return error_response(str(exc), status_code=400)

    def _read_navigation_order(self):
        path = self.navigation_order_path
        try:
            if path.is_symlink():
                return {}
            order = json.loads(path.read_bytes())
        except (FileNotFoundError, ValueError):
            return {}
        return order if isinstance(order, dict) else {}

    async def save_navigation_order(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            body = await request.body()
            if len(body) > 512 * 1024:
                raise WorkflowError("导航排序数据过大。")
            data = json.loads(body)
            if not isinstance(data, dict):
                raise WorkflowError("导航排序格式无效。")
            section, order = data.get("section"), data.get("order")
            if (
                section not in ("workflows", "management") or not isinstance(order, list)
                or any(not isinstance(item, str) or not item for item in order)
                or len(set(order)) != len(order)
            ):
                raise WorkflowError("导航排序格式无效。")
            path = self.navigation_order_path
            async with self.service.state_lock:
                if path.resolve() != path:
                    raise WorkflowError("导航排序文件必须位于插件数据目录。")
                saved = await asyncio.to_thread(self._read_navigation_order)
                saved[section] = order
                await asyncio.to_thread(atomic_write, path, profile_bytes(saved))
            return json_response({})
        except (OSError, ValueError) as exc:
            return error_response(str(exc), status_code=400)

    @staticmethod
    def _local_workflow_files():
        if sys.platform != "win32" or not request.username:
            return False
        if request.client_host not in {"127.0.0.1", "::1", "::ffff:127.0.0.1"}:
            return False
        headers = request.headers
        host = headers.get("host", "")
        return "forwarded" not in headers and "x-forwarded-for" not in headers and bool(
            re.fullmatch(r"(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?", host, re.I)
        )

    async def _workflow_zip(self):
        await self.service.initialize()
        async with self.service.workflow_lock:
            return await asyncio.to_thread(
                export_archive, self.service.workflow_dir, self.service.workflows, self.anima.canvas_source()
            )

    async def save_workflows(self):
        if not self._local_workflow_files():
            return error_response("请在运行 AstrBot 的 Windows 电脑上通过本机地址打开面板。", status_code=403)
        if self.workflow_save_lock.locked():
            return error_response("请先完成已打开的工作流导出窗口。", status_code=409)
        async with self.workflow_save_lock:
            try:
                data = await self._workflow_zip()
                result = await asyncio.to_thread(
                    subprocess.run,
                    [sys.executable, "-I", "-X", "utf8", "-c", WORKFLOW_ZIP_DIALOG, WORKFLOW_ZIP_NAME],
                    capture_output=True, encoding="utf-8", check=True, timeout=180,
                    creationflags=subprocess.CREATE_NO_WINDOW,
                )
                selected = result.stdout.rstrip("\r\n")
                if not selected:
                    return json_response({"cancelled": True})
                path = Path(selected)
                if not path.is_absolute() or path.suffix.casefold() != ".zip":
                    raise WorkflowError("请为工作流 ZIP 选择以 .zip 结尾的文件名。")
                await asyncio.to_thread(atomic_write, path, data)
                return json_response({"path": str(path)})
            except subprocess.TimeoutExpired:
                return error_response("另存为窗口等待超时，请重新导出。", status_code=408)
            except subprocess.CalledProcessError:
                return error_response("无法打开另存为窗口，请确认 AstrBot 在 Windows 桌面会话中运行。", status_code=500)
            except (OSError, ValueError, TypeError, RecursionError) as exc:
                return error_response(str(exc), status_code=400)

    async def open_workflow_directory(self):
        if not self._local_workflow_files():
            return error_response("请在运行 AstrBot 的 Windows 电脑上通过本机地址打开面板。", status_code=403)
        try:
            await self.service.initialize()
            await asyncio.to_thread(os.startfile, self.service.workflow_dir.resolve())
            return json_response({})
        except (OSError, ValueError) as exc:
            return error_response(str(exc), status_code=400)

    async def export_workflows(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            data = await self._workflow_zip()
            return stream_response(
                [data], content_type="application/zip",
                headers={"Content-Disposition": f'attachment; filename="{WORKFLOW_ZIP_NAME}"'},
            )
        except (OSError, ValueError, TypeError, RecursionError) as exc:
            return error_response(str(exc), status_code=400)

    async def export_workflow(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            await self.service.initialize()
            async with self.service.workflow_lock:
                workflow = self.service.workflows.get(request.query.get("name"))
                if workflow is None:
                    raise WorkflowError("请选择可用的工作流。")
                data = await asyncio.to_thread(export_profile, self.service.workflow_dir, workflow)
            return json_response(json.loads(data))
        except (OSError, ValueError, TypeError, RecursionError) as exc:
            return error_response(str(exc), status_code=400)

    async def import_workflows(self, *, replace=False):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            upload = (await request.files()).get("file")
            if upload is None:
                raise WorkflowError("请选择要导入的工作流 JSON 或 ZIP。")
            data = await upload.read(ARCHIVE_LIMIT + 1)
            await self.service.initialize()
            async with self.service.workflow_lock:
                imported, skipped = await asyncio.to_thread(
                    install_workflows, self.service.workflow_dir, self.service.data_dir / "templates",
                    data, self.service.workflow_mappings(), filename=upload.filename or "", replace=replace,
                )
                self.service.workflows = dict(sorted((self.service.workflows | imported).items()))
                for name in imported:
                    self.service.errors.pop(name, None)
            return json_response({"imported": list(imported), "skipped": skipped})
        except (OSError, ValueError, TypeError, RecursionError) as exc:
            return error_response(str(exc), status_code=400)

    async def replace_workflows(self):
        return await self.import_workflows(replace=True)

    def _config_directory(self, name):
        if not isinstance(name, str) or name not in self.service.workflows:
            raise WorkflowError("请选择可用的工作流。")
        workflow_file_stem(f"{name}.json")
        directory = self.service.data_dir.resolve() / "workflow_configs" / name
        if directory.resolve() != directory:
            raise WorkflowError("工作流配置目录无效。")
        return directory

    @staticmethod
    def _config_name(name):
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 64 or "\x7f" in name:
            raise WorkflowError("配置名称须为 1 到 64 个字符。")
        return workflow_file_stem(f"{name.strip()}.json")

    @staticmethod
    def _config_names(directory):
        return sorted(
            (path.stem for path in directory.glob("*.json") if not path.is_symlink() and path.is_file()),
            key=str.casefold,
        )

    def _config_path(self, directory, title):
        title = self._config_name(title)
        title = next((name for name in self._config_names(directory) if name.casefold() == title.casefold()), title)
        return workflow_path(directory, title)

    @staticmethod
    def _read_config_bytes(path):
        if not path.is_file():
            raise WorkflowError("找不到此工作流配置，请刷新列表。")
        with path.open("rb") as stream:
            content = stream.read(WORKFLOW_CONFIG_LIMIT + 1)
        if len(content) > WORKFLOW_CONFIG_LIMIT:
            raise WorkflowError("工作流配置文件超过大小上限。")
        return content

    def _validate_config(self, data):
        if (
            not isinstance(data, dict) or data.get("format") != "astrbot-comfyui-workflow-config"
            or type(data.get("version")) is not int or data["version"] != 1
            or not {"workflow", "name", "profile", "qq_timeout_seconds"} <= data.keys()
        ):
            raise WorkflowError("请选择工作台导出的工作流配置 JSON。")
        name = data["workflow"]
        self._config_directory(name)
        self._config_name(data["name"])
        profile = data["profile"]
        raw = profile_bytes(profile)
        if len(raw) > WORKFLOW_LIMIT:
            raise WorkflowError("配置中的工作流超过 4 MB。")
        candidate = validate_workflow_profile(name, profile, self.service.workflow_mappings().get(name))
        canvas_raw = None
        if name == ANIMA_WORKFLOW:
            canvas = data.get("canvas")
            validate_anima_canvas(canvas)
            canvas_raw = profile_bytes(canvas)
            if len(canvas_raw) > WORKFLOW_LIMIT:
                raise WorkflowError("配置中的 Anima 画布超过 4 MB。")
        seconds = data["qq_timeout_seconds"]
        if candidate.kind == "image_to_text" and seconds is not None:
            raise WorkflowError("反推工作流配置没有 QQ 生成超时。")
        self.service.validate_qq_timeout(candidate, seconds)
        return raw, canvas_raw, candidate

    async def save_workflow_alias(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            body = await request.body()
            if len(body) > 4096:
                raise WorkflowError("工作流简称请求过大。")
            data = json.loads(body)
            if not isinstance(data, dict):
                raise WorkflowError("工作流简称格式无效。")
            await self.service.initialize()
            name = data.get("workflow")
            alias = await self.service.save_workflow_alias(name, data.get("alias"))
            return json_response({"alias": alias, "short_name": self.service.workflow_short_name(name)})
        except (OSError, ValueError) as exc:
            return error_response(str(exc), status_code=400)

    async def workflow_configs(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            await self.service.initialize()
            async with self.service.workflow_lock:
                directory = self._config_directory(request.query.get("workflow"))
                return json_response({"names": self._config_names(directory)})
        except (OSError, ValueError, TypeError, RecursionError) as exc:
            return error_response(str(exc), status_code=400)

    async def export_workflow_config(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            await self.service.initialize()
            async with self.service.workflow_lock:
                directory = self._config_directory(request.query.get("workflow"))
                path = self._config_path(directory, request.query.get("name"))
                raw = self._read_config_bytes(path)
            return stream_response([raw], content_type="application/json")
        except (OSError, ValueError, TypeError, RecursionError) as exc:
            return error_response(str(exc), status_code=400)

    async def edit_workflow_config(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            body = await request.body()
            if len(body) > 4096:
                raise WorkflowError("工作流配置请求过大。")
            data = json.loads(body)
            if not isinstance(data, dict) or data.get("action") not in ("save", "update", "rename", "apply", "delete"):
                raise WorkflowError("请选择工作流配置操作。")
            await self.service.initialize()
            name, action = data.get("workflow"), data["action"]
            async with self.service.workflow_lock:
                directory = self._config_directory(name)
                path = self._config_path(directory, data.get("name"))
                if action == "delete":
                    path.unlink()
                    return json_response({"names": self._config_names(directory)})
                if action == "rename":
                    title = self._config_name(data.get("new_name"))
                    conflict = self._config_path(directory, title)
                    if conflict != path and conflict.exists():
                        return error_response("已有同名配置，请使用其他名称。", status_code=409)
                    saved = json.loads(self._read_config_bytes(path))
                    if not isinstance(saved, dict) or saved.get("workflow") != name:
                        raise WorkflowError("配置和所选工作流不匹配。")
                    target = workflow_path(directory, title)
                    if target.name != path.name:
                        path.rename(target)
                        try:
                            self._write_config(target, {**saved, "name": title})
                        except (OSError, ValueError, RecursionError):
                            target.rename(path)
                            raise
                    return json_response({"names": self._config_names(directory), "name": title})
                live = workflow_path(self.service.workflow_dir, name)
                current = read_profile(live)
                canvas = read_profile(self.anima.canvas_source()) if name == ANIMA_WORKFLOW else None
                if data.get("revision") != workflow_revision(current, canvas):
                    return error_response("工作流已更新，请刷新参数页后重试。", status_code=409)
                if action in ("save", "update"):
                    async with self.service.state_lock:
                        if action == "update" and not path.is_file():
                            raise WorkflowError("找不到此工作流配置，请刷新列表。")
                        if action == "save" and path.exists() and data.get("replace") is not True:
                            return error_response("已有同名配置，请确认覆盖。", status_code=409)
                        workflow = self.service.workflows[name]
                        saved = self._snapshot_config(path.stem, workflow, current, canvas)
                        self._write_config(path, saved)
                        return json_response({"names": self._config_names(directory), "name": path.stem})
                saved = json.loads(self._read_config_bytes(path))
                if not isinstance(saved, dict) or saved.get("workflow") != name:
                    raise WorkflowError("配置和所选工作流不匹配。")
                raw, canvas_raw, candidate = self._validate_config(saved)
                graph, settings = profile_parts(saved["profile"])
                files = {live: raw}
                if canvas_raw is not None:
                    if json.loads(canvas) == saved["canvas"]:
                        canvas_raw = canvas
                    else:
                        canvas_dir = self.service.data_dir.resolve() / "templates"
                        if canvas_dir.resolve() != canvas_dir:
                            raise WorkflowError("Anima 画布目录无效。")
                        canvas_dir.mkdir(exist_ok=True)
                        files[workflow_path(canvas_dir, name)] = canvas_raw
                    described = await self.anima.describe_profile(
                        workflow_revision(raw, canvas_raw), graph, settings, saved["canvas"], cached=True,
                    )
                else:
                    if name == LIGHTNING_WORKFLOW:
                        add_lightning_output_nodes(graph)
                        candidate = workflow_from_profile(name, saved["profile"], candidate.mapping)
                    schemas = await self._node_schemas(
                        candidate, graph if name in SEGMENTED_VIDEO_WORKFLOWS | V40_WORKFLOWS else None, cached=True,
                    )
                    described = self._describe(workflow_revision(raw), settings, candidate, schemas, graph)
                async with self.service.state_lock:
                    timeouts = self.service.updated_qq_timeouts(candidate, saved["qq_timeout_seconds"])
                    if timeouts != self.service.qq_timeouts:
                        timeout_path = self.service.data_dir.resolve() / self.service.qq_timeout_path.name
                        if timeout_path.resolve() != timeout_path:
                            raise WorkflowError("QQ 超时设置文件必须位于插件数据目录。")
                        files[timeout_path] = profile_bytes(timeouts)
                    if read_profile(live) != current or (
                        canvas is not None and read_profile(self.anima.canvas_source()) != canvas
                    ):
                        return error_response("工作流已更新，请刷新参数页后重试。", status_code=409)
                    summary = candidate.describe()
                    if name == AIO_WORKFLOW:
                        summary.update(kind="auto_image", requires_image=False)
                    response = json_response({"settings": described, "workflow": summary, "name": path.stem})
                    replace_workflow_files({path: data for path, data in files.items() if path != live or data != current})
                    self.service.workflows[name] = candidate
                    self.service.errors.pop(name, None)
                    self.service.qq_timeouts = timeouts
                    return response
        except (OSError, ValueError, KeyError, TypeError, RecursionError, ComfyError) as exc:
            return error_response(str(exc), status_code=400)

    def _snapshot_config(self, title, workflow, raw, canvas):
        profile = json.loads(raw)
        if workflow.mapping:
            graph, settings = profile_parts(profile)
            profile = {"prompt": graph, "astrbot": {**settings, "node_mapping": workflow.mapping}}
        saved = {
            "format": "astrbot-comfyui-workflow-config", "version": 1,
            "workflow": workflow.name, "name": title, "profile": profile,
            "qq_timeout_seconds": self.service.qq_timeout_for(workflow) if workflow.kind != "image_to_text" else None,
        }
        if canvas is not None:
            saved["canvas"] = json.loads(canvas)
        self._validate_config(saved)
        return saved

    async def _update_config_with_settings(self, title, workflow, path, before, raw, canvas=None):
        config_path = self._config_path(self._config_directory(workflow.name), title)
        if not config_path.is_file():
            raise WorkflowError("找不到此工作流配置，请刷新列表。")
        async with self.service.state_lock:
            saved = self._snapshot_config(config_path.stem, workflow, raw, canvas)
            atomic_write(path, raw)
            try:
                self._write_config(config_path, saved)
            except (OSError, ValueError, RecursionError):
                atomic_write(path, before)
                raise

    async def save_anima(self):
        return await self.anima.save(update_config=self._update_config_with_settings)

    @staticmethod
    def _write_config(path, data):
        raw = profile_bytes(data)
        if len(raw) > WORKFLOW_CONFIG_LIMIT:
            raise WorkflowError("工作流配置文件超过大小上限。")
        path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write(path, raw)

    async def import_workflow_config(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            upload = (await request.files()).get("file")
            raw = await upload.read(WORKFLOW_CONFIG_LIMIT + 1) if upload else b""
            if not raw or len(raw) > WORKFLOW_CONFIG_LIMIT:
                raise WorkflowError("请选择有效大小的工作流配置 JSON。")
            saved = json.loads(raw)
            await self.service.initialize()
            async with self.service.workflow_lock:
                self._validate_config(saved)
                directory = self._config_directory(saved["workflow"])
                title = self._config_name(saved["name"])
                names = {name.casefold() for name in self._config_names(directory)}
                available = title
                suffix = 2
                while available.casefold() in names:
                    ending = f" ({suffix})"
                    available = title[:64 - len(ending)].rstrip() + ending
                    suffix += 1
                path = workflow_path(directory, available)
                self._write_config(path, {**saved, "name": path.stem})
                return json_response({"workflow": saved["workflow"], "name": path.stem})
        except (OSError, ValueError, KeyError, TypeError, RecursionError) as exc:
            return error_response(str(exc), status_code=400)

    @staticmethod
    def _queue_row(job):
        return {
            "id": job.id,
            "workflow": job.workflow,
            "state": job.state,
            "seed": str(job.seed) if job.seed is not None else "",
            "timeout_seconds": job.timeout_seconds,
            "error": job.error,
            "outputs": [str(path) for path in job.paths],
            "can_cancel": job.state == "queued" or (job.state == "running" and bool(job.prompt_id)),
        }

    async def queue(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        jobs = self.service.queue_jobs()
        return json_response({
            "jobs": [self._queue_row(job) for job in jobs],
            "active": sum(not job.task.done() for job in jobs),
            "limit": self.service.queue_limit,
            "qq_timeouts": {
                workflow.name: seconds for workflow in self.service.workflows.values()
                if workflow.kind != "image_to_text"
                and (seconds := self.service.qq_timeout_for(workflow)) is not None
            },
            "timeouts": {
                "min": GENERATION_TIMEOUT_MIN,
                "image": {"default": self.service.generation_timeout(), "max": IMAGE_TIMEOUT_MAX},
                "video": {"default": self.service.generation_timeout(video=True), "max": VIDEO_TIMEOUT_MAX},
            },
        })

    async def save_qq_timeout(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            body = await request.body()
            if len(body) > 1024:
                raise WorkflowError("QQ 超时设置数据过大。")
            data = json.loads(body)
            if not isinstance(data, dict) or "timeout_seconds" not in data:
                raise WorkflowError("请填写 QQ 等待超时，或留空恢复默认。")
            name, seconds = data.get("workflow"), data["timeout_seconds"]
            await self.service.save_qq_timeout(name, seconds)
            return json_response({"workflow": name, "qq_timeout_seconds": seconds})
        except (OSError, ValueError) as exc:
            return error_response(str(exc), status_code=400)

    def read_queue_reference(self, data):
        encoded, reference, mask = (data.get(key, "") for key in ("image", "reference_id", "mask"))
        if not all(isinstance(value, str) for value in (encoded, reference, mask)):
            raise WorkflowError("参考图或遮罩格式无效。")
        if encoded and reference:
            raise WorkflowError("请选择一张参考图。")
        limit = self.service.client.max_image_bytes
        if any(len(value) > 4 * ((limit + 2) // 3) for value in (encoded, mask)):
            raise WorkflowError("参考图或遮罩超过插件配置的大小上限。")
        if reference:
            _, image = self.service.image_reviews.read(reference, True, limit, state="favourite")
        else:
            image = base64.b64decode(encoded, validate=True) if encoded else None
        if mask:
            if image is None:
                raise WorkflowError("请先选择参考图，再编辑遮罩。")
            mask_data = base64.b64decode(mask, validate=True)
            if len(mask_data) > limit:
                raise WorkflowError("遮罩超过插件配置的大小上限。")
            image = apply_mask(image, mask_data, limit)
        if image is not None:
            if len(image) > limit:
                raise WorkflowError("参考图超过插件配置的大小上限。")
            image_suffix(image)
        return image

    async def add_jobs(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            if not self.service.config.get("enabled", True):
                raise ComfyError("ComfyUI 插件已在面板禁用。")
            body = await request.body()
            if len(body) > reference_body_limit(self.service.client.max_image_bytes):
                raise WorkflowError("任务数据过大。")
            data = json.loads(body)
            if not isinstance(data, dict):
                raise WorkflowError("任务格式无效。")
            name = data.get("workflow")
            prompt, negative, preset = (data.get(key, "") for key in ("positive", "negative", "preset"))
            if not all(isinstance(value, str) for value in (name, prompt, negative, preset)):
                raise WorkflowError("工作流和提示词必须是文本。")
            if any(len(value) > 8000 for value in (prompt, negative)) or len(preset) > 64:
                raise WorkflowError("提示词或预设名称超长。")
            await self.service.initialize()
            workflow = self.service.workflows.get(name)
            if workflow is None or (
                workflow.image_required and workflow.name not in V40_WORKFLOWS | {AIO_WORKFLOW}
            ):
                raise WorkflowError("请选择可直接生成的工作流。需要参考图时可用命令表单上传。")
            image = None
            if workflow.name == DETAILER_WORKFLOW or (
                workflow.name == ADVANCED_V40_WORKFLOW and workflow.image_inputs
            ):
                image = await asyncio.to_thread(self.read_queue_reference, data)
                if image is None and workflow.image_required:
                    raise WorkflowError("当前 V40 分支需要一张参考图。")
            if not prompt.strip() and not preset and workflow.name in V40_WORKFLOWS and workflow.positive:
                field = workflow.positive[0]
                prompt = workflow.graph[field.node]["inputs"][field.name]
            negative = negative if negative.strip() else None
            preset_details = None
            if preset:
                account = data.get("preset_account")
                row = await self.get_preset(account, preset)
                base = row["positive"]
                preset_details = self.preset_use(account, row, selector=preset)
                prompt = f"{base}, {prompt}" if prompt.strip() else base
                if negative is None:
                    negative = row["negative"] or None
            owner = f"studio:{request.username}"
            catalog = self.anima if workflow.name == ANIMA_WORKFLOW else (
                self.lora_families["illustrious"] if workflow.name == WAI_WORKFLOW else None
            )
            lock = catalog.submission_locks.setdefault(owner, asyncio.Lock()) if catalog else nullcontext()
            async with lock:
                pending = catalog.pending_loras.get(owner) if catalog else None
                options = {"loras": pending} if pending is not None else {}
                if workflow.name == ANIMA_WORKFLOW:
                    workflow = await self.anima.for_generation(workflow, options, False, {})
                elif workflow.name == AIO_WORKFLOW:
                    workflow = await asyncio.to_thread(self.aio_generation, False)
                elif workflow.name == WAI_WORKFLOW:
                    workflow = await self.illustrious_generation(options)
                jobs = await self.service.start_batch(
                    owner, prompt, workflow, negative, data.get("count", 1),
                    timeout_seconds=self.service.qq_timeout_for(workflow), preset=preset_details, image_data=image,
                )
                if pending is not None and catalog.pending_loras.get(owner) is pending:
                    catalog.pending_loras.pop(owner)
            return json_response({"jobs": [self._queue_row(job) for job in jobs]})
        except (ComfyError, OSError, ValueError) as exc:
            return error_response(str(exc), status_code=400)

    def _command_template_file(self):
        root = self.service.data_dir.resolve()
        path = root / "command_templates.json"
        if path.resolve() != path:
            raise WorkflowError("常用命令文件必须位于插件数据目录。")
        return path

    @staticmethod
    def _read_command_templates(path):
        if not path.is_file():
            return {}
        rows = json.loads(path.read_bytes())
        if not isinstance(rows, dict) or any(not isinstance(command, str) for command in rows.values()):
            raise WorkflowError("常用命令文件格式无效。")
        return rows

    async def command_templates(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            rows = await asyncio.to_thread(self._read_command_templates, self._command_template_file())
            return json_response({"templates": rows})
        except (OSError, ValueError) as exc:
            return error_response(str(exc), status_code=400)

    @staticmethod
    def _command_template_name(name):
        if not isinstance(name, str) or not re.fullmatch(r"[^\x00-\x1f]{1,64}", name.strip()):
            raise WorkflowError("常用命令名称须为 1 到 64 个字符。")
        return name.strip()

    @staticmethod
    def _command_template_text(command):
        if not isinstance(command, str) or not 1 <= len(command.strip()) <= 16000:
            raise WorkflowError("请填写不超过 16000 字符的任务命令。")
        return command.strip()

    async def save_command_template(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            body = await request.body()
            if len(body) > 128 * 1024:
                raise WorkflowError("常用命令数据过大。")
            data = json.loads(body)
            if not isinstance(data, dict) or "command" not in data:
                raise WorkflowError("请指定要保存或删除的常用命令。")
            name = self._command_template_name(data.get("name"))
            command = None if data["command"] is None else self._command_template_text(data["command"])
            path = self._command_template_file()
            async with self.service.state_lock:
                rows = await asyncio.to_thread(self._read_command_templates, path)
                if command is None:
                    rows.pop(name, None)
                else:
                    if name not in rows and len(rows) >= 50:
                        raise WorkflowError("最多保存 50 条常用命令。")
                    rows[name] = command
                path.parent.mkdir(parents=True, exist_ok=True)
                await asyncio.to_thread(atomic_write, path, profile_bytes(rows))
            return json_response({"templates": rows})
        except (OSError, ValueError) as exc:
            return error_response(str(exc), status_code=400)

    async def import_command_templates(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            body = await request.body()
            if len(body) > COMMAND_IMPORT_LIMIT:
                raise WorkflowError("常用命令文件过大。")
            data = json.loads(body)
            templates = data.get("templates") if isinstance(data, dict) else None
            if not isinstance(templates, dict) or len(templates) > 50 or type(data.get("replace")) is not bool:
                raise WorkflowError("请选择包含最多 50 条常用命令的 JSON。")
            incoming = {}
            for title, text in templates.items():
                name = self._command_template_name(title)
                if name in incoming:
                    raise WorkflowError(f"常用命令文件包含重复名称：{name}")
                incoming[name] = self._command_template_text(text)
            path = self._command_template_file()
            async with self.service.state_lock:
                rows = await asyncio.to_thread(self._read_command_templates, path)
                imported = incoming if data["replace"] else {name: text for name, text in incoming.items() if name not in rows}
                rows.update(imported)
                if len(rows) > 50:
                    raise WorkflowError("合并后超过 50 条常用命令，请删除部分命令后再导入。")
                if imported:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    await asyncio.to_thread(atomic_write, path, profile_bytes(rows))
            return json_response({"templates": rows, "imported": len(imported), "skipped": len(incoming) - len(imported)})
        except (OSError, ValueError, RecursionError) as exc:
            return error_response(str(exc), status_code=400)

    async def cancel_job(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            body = await request.body()
            if len(body) > 1024:
                raise WorkflowError("取消任务的请求过大。")
            data = json.loads(body)
            job_id = data.get("id") if isinstance(data, dict) else None
            if not isinstance(job_id, str) or not re.fullmatch(r"[0-9a-f]{32}", job_id):
                raise WorkflowError("任务 ID 无效。")
            return json_response(self._queue_row(await self.service.cancel_job(job_id)))
        except (ComfyError, ValueError) as exc:
            return error_response(str(exc), status_code=400)

    async def cancel_all(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        return json_response(await self.service.cancel_all())

    async def images(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            await self.service.initialize()
            review = self.service.image_reviews
            state = request.query.get("state", "unevaluate")
            raw = request.query.get("filters", "")
            filters = {}
            if raw:
                if len(raw) > 8192:
                    raise WorkflowError("筛选条件过多。")
                selected = json.loads(raw)
                if not isinstance(selected, dict) or any(
                    key not in IMAGE_FILTERS or not isinstance(values, list) or len(values) > 50
                    or any(not isinstance(value, str) or len(value) > 1024 for value in values)
                    for key, values in selected.items()
                ):
                    raise WorkflowError("图片筛选条件无效。")
                filters = {key: set(values) for key, values in selected.items() if values}
            rating = request.query.get("rating", "")
            if state not in ("unevaluate", *GALLERY_STATES) or rating not in ("", *REVIEW_RATINGS):
                raise WorkflowError("图片列表参数无效。")
            if request.query.get("facets") == "1":
                facets = await asyncio.to_thread(review.filter_options, state, rating)
                facets["preset"], _ = await self._gallery_preset_labels(facets["preset"])
                counts = {}
                for label in facets["preset"].values():
                    counts[label] = counts.get(label, 0) + 1
                for identity, label in facets["preset"].items():
                    if counts[label] > 1:
                        account, _, preset_id = identity[3:].rpartition(":") if identity.startswith("id:") else ("", "", "")
                        suffix = f"{account} · {preset_id[:6]}" if account else "历史名称"
                        facets["preset"][identity] = f"{label} · {suffix}"
                missing = {"preset": "未使用预设 / 无记录", "workflow": "未记录工作流", "lora": "未使用 LoRA / 无记录"}
                return json_response({"facets": {
                    key: [{"id": "", "label": missing[key]}, *(
                        {"id": value, "label": label}
                        for value, label in sorted(options.items(), key=lambda row: (row[1].casefold(), row[0]))
                    )]
                    for key, options in facets.items()
                }})
            if state == "unevaluate":
                limit = number(self.service.config, "review_task_limit", 5, 1, 50)
                result = await asyncio.to_thread(review.pending, limit, filters=filters)
            else:
                page = request.query.get("page", "1")
                if not re.fullmatch(r"[1-9][0-9]{0,6}", page):
                    raise WorkflowError("图片列表参数无效。")
                result = await asyncio.to_thread(review.gallery, rating, int(page), state=state, filters=filters)
            items = result.get("images")
            if items is None:
                items = [item for job in result["jobs"] for item in job["images"]]
            presets = {}
            for item in items:
                preset = item.get("generation", {}).get("preset")
                if preset:
                    presets[review.preset_identity(preset)] = preset["name"]
            names, current_presets = await self._gallery_preset_labels(presets)
            for item in items:
                preset = item.get("generation", {}).get("preset")
                if preset:
                    identity = review.preset_identity(preset)
                    account = preset.get("account")
                    item["generation"]["preset"] = {
                        "name": names[identity],
                        **({"id": preset["id"]} if "id" in preset else {}),
                        **({"account": account} if isinstance(account, str) and identity in current_presets else {}),
                    }
            return json_response(result)
        except (OSError, ValueError) as exc:
            return error_response(str(exc), status_code=400)

    async def _gallery_preset_labels(self, fallback):
        libraries = {}
        names = dict(fallback)
        current = set()
        for key in fallback:
            if not key.startswith("id:"):
                continue
            account, _, identity = key[3:].rpartition(":")
            if not account:
                continue
            if account not in libraries:
                try:
                    libraries[account] = {row["id"]: row["name"] for row in await self.preset_rows(account)}
                except (OSError, ValueError):
                    libraries[account] = {}
            if identity in libraries[account]:
                names[key] = libraries[account][identity]
                current.add(key)
        return names, current

    async def rate_image(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            body = await request.body()
            if len(body) > 8 * 1024:
                raise WorkflowError("图片评价数据过大。")
            data = json.loads(body)
            if not isinstance(data, dict) or not all(isinstance(data.get(key), str) for key in ("id", "state")):
                raise WorkflowError("图片评价格式无效。")
            source = data.get("source", "unevaluate")
            if not isinstance(source, str):
                raise WorkflowError("图片来源格式无效。")
            await asyncio.to_thread(self.service.image_reviews.rate, data["id"], data["state"], source=source)
            return json_response({})
        except (OSError, ValueError) as exc:
            return error_response(str(exc), status_code=400)

    async def delete_image(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            body = await request.body()
            if len(body) > 8 * 1024:
                raise WorkflowError("图片删除数据过大。")
            data = json.loads(body)
            if not isinstance(data, dict) or not all(isinstance(data.get(key), str) for key in ("id", "state")):
                raise WorkflowError("图片删除格式无效。")
            await asyncio.to_thread(self.service.image_reviews.delete, data["id"], data["state"])
            return json_response({})
        except (OSError, ValueError) as exc:
            return error_response(str(exc), status_code=400)

    async def generate_thumbnails(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            await self.service.initialize()
            body = await request.body()
            if len(body) > 1024:
                raise WorkflowError("缩略图请求数据过大。")
            data = json.loads(body) if body else {}
            state = data.get("state", "favourite") if isinstance(data, dict) else None
            if state not in GALLERY_STATES:
                raise WorkflowError("请选择收藏图集或 Pass 图集。")
            result = await asyncio.to_thread(self.service.image_reviews.generate_gallery_thumbnails, state)
            return json_response(result)
        except (OSError, ValueError) as exc:
            return error_response(str(exc), status_code=400)

    async def image_file(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            state = request.query.get("state")
            if state is not None and state not in (*GALLERY_STATES, "unevaluate"):
                raise WorkflowError("请选择有效的图集。")
            mime, data = await asyncio.to_thread(
                self.service.image_reviews.read, request.query.get("id"), request.query.get("original") == "1",
                self.service.client.max_image_bytes, state=state,
            )
            return json_response({"src": f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"})
        except (OSError, ValueError) as exc:
            return error_response(str(exc), status_code=400)

    async def videos(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            page = max(1, int(request.query.get("page", "1")))
            return json_response(await asyncio.to_thread(self.service.video_library.list, page))
        except (OSError, ValueError) as exc:
            return error_response(str(exc), status_code=400)

    async def _video_selection(self):
        body = await request.body()
        if len(body) > 4096:
            raise WorkflowError("视频请求过大。")
        data = json.loads(body)
        if not isinstance(data, dict) or not all(isinstance(data.get(key), str) for key in ("source", "name", "version")):
            raise WorkflowError("请先选择视频。")
        return data["source"], data["name"], data["version"]

    async def video_play(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            selection = await self._video_selection()
            path = await asyncio.to_thread(self.service.video_library.file, *selection)
            if request.plugin_name:
                from astrbot.core import file_token_service

                token = await file_token_service.register_file(str(path), VIDEO_LINK_SECONDS, single_use=False)
                return json_response({"src": f"/api/v1/files/tokens/{token}"})
            now = monotonic()
            self.video_links = {key: link for key, link in self.video_links.items() if link[0] > now}
            if len(self.video_links) >= VIDEO_LINK_LIMIT:
                self.video_links.pop(next(iter(self.video_links)))
            token = secrets.token_urlsafe(32)
            self.video_links[token] = (now + VIDEO_LINK_SECONDS, selection, request.headers.get("authorization", ""))
            return json_response({"src": f"/video/{token}"})
        except (OSError, ValueError) as exc:
            return error_response(str(exc), status_code=400)

    async def delete_video(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            selection = await self._video_selection()
            await asyncio.to_thread(self.service.video_library.delete, *selection)
            self.video_links = {key: link for key, link in self.video_links.items() if link[1] != selection}
            return json_response({})
        except (OSError, ValueError) as exc:
            return error_response(str(exc), status_code=400)

    async def archive(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            await self.service.initialize()
            body = await request.body()
            if len(body) > 64 * 1024:
                raise WorkflowError("归档规则数据过大。")
            return json_response(await self.service.save_archive(json.loads(body)))
        except (OSError, ValueError) as exc:
            return error_response(str(exc), status_code=400)

    def _read(self, name):
        if (
            not isinstance(name, str)
            or name not in self.service.workflows
            or name == ANIMA_WORKFLOW
        ):
            raise WorkflowError("请选择可用的工作流。")
        path = workflow_path(self.service.workflow_dir, name)
        raw = read_profile(path)
        data = json.loads(raw)
        graph, settings = profile_parts(data)
        if name == LIGHTNING_WORKFLOW:
            add_lightning_output_nodes(graph)
        workflow = workflow_from_profile(name, data, self.service.workflow_mappings().get(name))
        return path, workflow_revision(raw), graph, settings, workflow, workflow.mapping

    def aio_caption_threshold(self):
        if AIO_WORKFLOW not in self.service.workflows:
            return 0.35
        return aio_options(self._read(AIO_WORKFLOW)[3])["threshold"]

    async def _node_schemas(self, workflow, graph=None, *, cached=False):
        types = {node["class_type"] for node in (workflow.graph if graph is None else graph).values()}
        if workflow.name == WAI_WORKFLOW:
            types.add("Canny")
        schemas = await self.service.client.node_schemas(types, cached=cached)
        if workflow.kind == "image_to_text":
            self._local_caption_models(schemas)
        return schemas

    async def detailer_generation(self, options):
        return await self.v40_generation(DETAILER_WORKFLOW, options)

    async def v40_generation(self, name, options, *, allow_nsfw=True):
        _, _, graph, settings, workflow, mapping = await asyncio.to_thread(self._read, name)
        if "v40" not in settings:
            return detailer_workflow(graph, settings, mapping, options) if name == DETAILER_WORKFLOW else workflow
        allowed = REPAIR_OPTIONS | ({"img2img"} if name == ADVANCED_V40_WORKFLOW else set())
        if options.keys() - allowed:
            raise WorkflowError("V40 支持单次切换局部修复。Advanced V40 也支持 --img2img on/off。")
        if not allow_nsfw:
            options = {**options, "nsfw_repair": False}
        return v40_workflow(name, graph, settings, mapping, options)

    def _local_caption_models(self, schemas):
        pixai = self.anima.workspace / "models/pixai_tagger/pixai-tagger-v1.0"
        installed = all((pixai / name).is_file() for name in ("model.safetensors", "config.json"))
        spec = schemas.get("PixAITaggerPlus", {}).get("input", {}).get("required", {}).get("model")
        choices = combo_options(spec)
        if choices is not None:
            choices[:] = [name for name in choices if not name.startswith(("⬇", "（"))
                          and (name != "pixai-tagger-v1.0" or installed)]
        spec = schemas.get("TIPO", {}).get("input", {}).get("required", {}).get("tipo_model")
        choices = combo_options(spec)
        if choices is not None:
            root = self.anima.workspace / "models/kgen"
            installed = {path.name for path in root.glob("*.gguf") if path.is_file()}
            choices[:] = [name for name in choices if name in installed or (
                " | " in name and name.rsplit("/", 1)[-1].replace(" | ", "_", 1) in installed
            )]

    async def reverse_caption(self, image_data):
        if urlsplit(self.service.client.url).hostname not in {"127.0.0.1", "::1", "localhost"}:
            raise WorkflowError("Anima 反推要求 ComfyUI 地址指向本机，以便核对本地模型。")
        _, _, _, _, workflow, _ = self._read(REVERSE_WORKFLOW)
        graph = workflow.prepare_caption()
        image_node = workflow.image_inputs[0].node
        schemas = await self._node_schemas(workflow)
        validate_graph(graph, schemas, {(image_node, "image")})
        return await self.service.run_caption(graph, image_data, image_node, workflow.outputs[0])

    def _check_aio_weights(self, workflow):
        workspace = self.anima.workspace
        if "1370" in workflow.active:
            ckpts = workspace / "custom_nodes/comfyui_controlnet_aux/ckpts"
            if not any(ckpts.rglob("depth_anything_v2_vitl.pth")):
                raise WorkflowError("Depth Anything V2 缺少本地 depth_anything_v2_vitl.pth。请选择其他 LLLite 模式。")
        if "1825" in workflow.active:
            root = (workspace / "models/vosr2").resolve()
            bundle = (root / workflow.graph["1825"]["inputs"]["model"]).resolve()
            if bundle.parent != root:
                raise WorkflowError("VOSR2 模型路径无效。")
            if not all((bundle / name).is_file() for name in (
                "Qwen-Image-vae-2d/config.json", "Qwen-Image-vae-2d/diffusion_pytorch_model.safetensors",
                "dinov2_vitl14.safetensors",
            )) or not any((bundle / name).is_file() for name in (
                "checkpoints/ema_model.safetensors", "clean_weights/ema_model.safetensors", "ema_model.safetensors",
            )):
                raise WorkflowError("VOSR2 缺少本地模型包。请选择其他放大模式。")

    def aio_generation(self, has_image, *, denoise=None):
        _, _, graph, settings, _, mapping = self._read(AIO_WORKFLOW)
        workflow = aio_workflow(graph, settings, has_image, denoise=denoise, mapping=mapping)
        self._check_aio_weights(workflow)
        filenames = []
        for slot in LORA_SLOTS:
            if slot not in workflow.active:
                continue
            inputs = workflow.graph[slot]["inputs"]
            if (inputs.get("strength_model") or inputs.get("strength_clip")) and isinstance(inputs.get("lora_name"), str):
                filenames.append(inputs["lora_name"])
        return self.anima.with_lora_tags(workflow, filenames)

    async def illustrious_generation(self, options):
        _, _, _, settings, workflow, mapping = await asyncio.to_thread(self._read, WAI_WORKFLOW)
        family = self.lora_families.get(workflow.sweep_lora_family)
        if family is None and options.get("loras"):
            family = await self.lora_catalog_for(workflow.sweep_lora_family)
        return await wai_generation(workflow, settings, mapping, family or self.lora_families["illustrious"], options)

    async def illustrious_sweep(self, family, catalog, characters):
        _, _, _, settings, workflow, mapping = await asyncio.to_thread(self._read, WAI_WORKFLOW)
        files = await lora_loader_files(self.service.client)
        return [
            await wai_generation(
                workflow, settings, mapping, family, {"loras": [{"id": entry["id"]}]},
                catalog=catalog, files=files,
            )
            for entry in characters
        ]

    async def svi_lora_catalog(self):
        return svi_lora_files(await self.service.client.node_schemas({"LoraLoaderModelOnly"}))

    async def segmented_video_generation(self, name, options):
        _, _, graph, settings, _, mapping = await asyncio.to_thread(self._read, name)
        parse, build = (lightning_options, lightning_workflow) if name == LIGHTNING_WORKFLOW else (
            svi_options, svi_workflow
        )
        plan = parse(settings, options)
        lora_files = (
            await self.svi_lora_catalog()
            if any(plan["stage_loras"].get(str(stage)) for stage in plan["stages"]) else None
        )
        workflow = build(graph, settings, mapping, options, lora_files=lora_files)
        check_video_rife(workflow, self.anima.workspace, urlsplit(self.service.client.url).hostname)
        return workflow

    @staticmethod
    def _fields(workflow, schemas, settings=None, raw_graph=None):
        if workflow.name in V40_WORKFLOWS and settings and "v40" in settings:
            config = settings["v40"]
            schemas = {"JPEG artifacts removal FBCNN": V40_FBCNN_SCHEMA, **schemas}
            fields = editable_fields(raw_graph, schemas, v40=True)
            for field in fields.values():
                key = field["node"]
                branch = raw_graph[key].get("_meta", {}).get("branch")
                if branch:
                    row = config["branches"][branch]
                    field["category"] = row["category"] if row["category"] == "局部修复" else row["title"]
                    field["repair_group"] = branch
                field["active"] = key in workflow.active or (
                    raw_graph[key]["class_type"] in {"easy anythingIndexSwitch", "easy imageSwitch"}
                    and (not branch or config["branches"][branch]["enabled"])
                )
            for switch in config["switches"]:
                fields.pop(f"{switch}.switch", None)
            return fields
        if workflow.name == SVI_WORKFLOW:
            return svi_fields(raw_graph, schemas, settings)
        if workflow.name == LIGHTNING_WORKFLOW:
            return lightning_fields(raw_graph, schemas, settings)
        aio = workflow.name == AIO_WORKFLOW
        reverse = workflow.kind == "image_to_text"
        graph = workflow.graph if aio or reverse or workflow.name == WAI_WORKFLOW else {
            key: node for key, node in workflow.graph.items() if key in workflow.active
        }
        if workflow.name == DETAILER_WORKFLOW and feet_switch(raw_graph):
            graph = {**graph, **{key: raw_graph[key] for key in FEET_NODES if key in raw_graph}}
        fields = editable_fields(graph, schemas)
        if workflow.name == DETAILER_WORKFLOW:
            for field in fields.values():
                if field["node"] in FEET_NODES:
                    field.update(
                        category="局部修复", repair_group="feet", active=field["node"] in workflow.active,
                    )
        if reverse:
            categories = {"416": "PixAI 图像反推", "400": "TIPO 提示词扩写", "444": "TIPO 提示词扩写"}
            fields = {key: field for key, field in fields.items() if field["node"] in categories}
            for field in fields.values():
                field["category"] = categories[field["node"]]
                if field["name"] == "delimiter":
                    field["multiline"] = True
            if "400" in graph:
                fields["caption.expand_caption"] = {
                    "node": "caption", "name": "expand_caption", "title": "启用 TIPO 扩写",
                    "category": "TIPO 提示词扩写", "kind": "BOOLEAN", "active": True,
                    "value": workflow.expand_caption,
                }
        if aio:
            options = aio_options(settings or {})
            for name, value in options.items():
                choices = AIO_CHOICES.get(name)
                category = (
                    "参考与构图" if name in {"latent", "control", "size", "threshold"}
                    else "采样与放大" if name == "upscale" else "基础设置"
                )
                fields[f"aio.{name}"] = {
                    "node": "aio", "name": name, "title": AIO_LABELS[name], "category": category,
                    "kind": "select" if choices else "BOOLEAN" if type(value) is bool else "FLOAT",
                    "choices": choices, "value": value, "min": 0, "max": 1, "active": True,
                }
            for field in fields.values():
                key = field["node"]
                if key == "aio":
                    continue
                field["category"] = (
                    "采样与放大" if key in {"118", "279", "1665", "1818", "1824", "1825"}
                    else "参考与构图" if key in {"1424", "1425", "1427", "1038", "1039", "1370"}
                    else "基础设置"
                )
            fields.pop("1370.preprocessor", None)
            fields.pop("1608.image", None)
            for key in ("1665", "1824"):
                fields.pop(f"{key}.seed", None)
        for field in (*workflow.positive, *workflow.image_inputs):
            fields.pop(field.label(), None)
        if workflow.name != WAI_WORKFLOW:
            for field in workflow.seeds[1:]:
                fields.pop(field.label(), None)
        else:
            active = wai_workflow(graph, settings, workflow.mapping).active
            categories = {
                "基础采样": {"87", "88", "91", "105", "107", "118", "126", "218", "245", "244", "247", "258"},
                "放大与重采样": {"13", "22", "24", "120", "128", "129", "138", "146", "185",
                                  "227", "228", "229", "230", "231", "237", "238", "255"},
                "人脸修复": {"172", "173", "180", "206", "211", "213", "219"},
                "眼部修复": {"125", "174", "195", "198", "202", "204", "205"},
            }
            for field in fields.values():
                key = field["node"]
                field["active"] = key in active
                field["category"] = next(
                    (category for category, keys in categories.items() if key in keys), "提示词与输出"
                )
                if field["name"] in {"seed", "noise_seed"} or key == "109":
                    field["min"] = 0
                    field["max"] = 2**63 - 1
        if workflow.name in WAN_WORKFLOWS:
            for field in fields.values():
                if field["node"] == "10":
                    field["title"] = "高噪声阶段"
                elif field["node"] == "11":
                    field["title"] = "低噪声阶段"
            high = graph.get("10", {}).get("inputs", {})
            low = graph.get("11", {}).get("inputs", {})
            if "10.steps" in fields and high.get("steps") == low.get("steps"):
                fields.pop("11.steps", None)
            if "10.end_at_step" in fields and high.get("end_at_step") == low.get("start_at_step"):
                fields.pop("11.start_at_step", None)
        return fields

    @staticmethod
    def _sync_wan(name, graph, original, changes):
        if name not in WAN_WORKFLOWS or not all(
            graph.get(key, {}).get("class_type") == "KSamplerAdvanced" for key in ("10", "11")
        ):
            return
        high, low = graph["10"]["inputs"], graph["11"]["inputs"]
        old_high, old_low = original["10"]["inputs"], original["11"]["inputs"]
        if "10.steps" in changes and old_high.get("steps") == old_low.get("steps"):
            low["steps"] = high["steps"]
            if (
                old_low.get("end_at_step") == old_low.get("steps")
                and "11.end_at_step" not in changes
            ):
                low["end_at_step"] = high["steps"]
        if "10.end_at_step" in changes and old_high.get("end_at_step") == old_low.get(
            "start_at_step"
        ):
            low["start_at_step"] = high["end_at_step"]

    def _describe(self, revision, settings, workflow, schemas, raw_graph=None):
        data = {
            "revision": revision,
            "workflow": workflow.name,
            "short_name": self.service.workflow_short_name(workflow.name),
            "kind": "auto_image" if workflow.name == AIO_WORKFLOW else workflow.kind,
            "branches": [],
            "fields": list(self._fields(workflow, schemas, settings, raw_graph).values()),
            "positive_prefix": settings.get("positive_prefix", ""),
            "use_canvas_seed": settings.get("use_canvas_seed", False),
            "requires_image": workflow.image_required and workflow.name != AIO_WORKFLOW,
        }
        if workflow.sweep_lora_family is not None or workflow.lora_selectable:
            data["sweep_lora_family"] = workflow.sweep_lora_family or ""
            data["sweep_lora_optional"] = workflow.name not in {ANIMA_WORKFLOW, WAI_WORKFLOW, ADVANCED_V40_WORKFLOW}
            data["sweep_lora_directories"] = self.anima.directory_names()

        if workflow.name in V40_WORKFLOWS and "v40" in settings:
            data["image_inputs"] = [field.label() for field in workflow.image_inputs]
            data["branches"] = [
                {"id": key, "title": row["title"], "category": row["category"], "enabled": row["enabled"]}
                for key, row in settings["v40"]["branches"].items()
            ]
        elif workflow.name == WAI_WORKFLOW:
            branches = wai_branches(settings)
            data["branches"] = [
                {"id": key, "title": title, "category": "Illustrious 生成阶段", "enabled": branches[key]}
                for key, (title, _) in WAI_BRANCHES.items()
            ]
        elif workflow.name == DETAILER_WORKFLOW:
            switch = feet_switch(raw_graph)
            if switch:
                data["branches"] = [{
                    "id": "feet", "title": "修脚", "category": "局部修复", "enabled": switch["switch"],
                }]
        elif workflow.name in SEGMENTED_VIDEO_WORKFLOWS:
            data["svi_lora_files"] = svi_lora_files(schemas)
        return data

    async def workflow(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            await self.service.initialize()
            _, revision, graph, settings, workflow, _ = await asyncio.to_thread(self._read, request.query.get("name"))
            schemas = await self._node_schemas(
                workflow, graph if workflow.name in SEGMENTED_VIDEO_WORKFLOWS | V40_WORKFLOWS else None,
            )
            return json_response(self._describe(revision, settings, workflow, schemas, graph))
        except (OSError, ValueError, KeyError, ComfyError) as exc:
            return error_response(str(exc), status_code=400)

    async def save_workflow(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            await self.service.initialize()
            body = await request.body()
            if len(body) > 512 * 1024:
                raise WorkflowError("参数数据过大。")
            payload = json.loads(body)
            if not isinstance(payload, dict) or not isinstance(payload.get("changes"), dict):
                raise WorkflowError("参数格式无效。")
            name = payload.get("workflow")
            async with self.service.workflow_lock:
                path, revision, graph, settings, workflow, mapping = self._read(name)
                if payload.get("revision") != revision:
                    return error_response("工作流已更新，请刷新后重试。", status_code=409)
                schemas = await self._node_schemas(
                    workflow, graph if name in SEGMENTED_VIDEO_WORKFLOWS | V40_WORKFLOWS else None,
                )
                fields = self._fields(workflow, schemas, settings, graph)
                changes = payload["changes"]
                for key, value in changes.items():
                    if key not in fields:
                        raise WorkflowError(f"字段 {key} 不可编辑。")
                    field = fields[key]
                    value = parse_field(field, value)
                    if field["node"] == "aio":
                        settings.setdefault("aio", {})[field["name"]] = value
                    elif field["node"] in ("svi", "lightning"):
                        config = settings.setdefault(field["node"], {})
                        field_name = field["name"]
                        if field_name.startswith("stage_loras_"):
                            stage = field_name.removeprefix("stage_loras_")
                            rows = value["__value__"]
                            validate_stage_loras({stage: rows})
                            config.setdefault("stage_loras", {})[stage] = resolve_stage_loras(
                                rows, svi_lora_files(schemas)
                            )
                        else:
                            config[field_name] = parse_stages(value) if field_name == "stages" else value
                    elif field["node"] == "caption":
                        settings[field["name"]] = value
                    else:
                        graph[field["node"]]["inputs"][field["name"]] = value
                self._sync_wan(name, graph, workflow.graph, changes)
                if name == SVI_WORKFLOW:
                    sync_svi_fields(graph, changes)
                prefix, fixed = payload.get("positive_prefix"), payload.get("use_canvas_seed")
                if not isinstance(prefix, str) or len(prefix) > 4000 or type(fixed) is not bool:
                    raise WorkflowError("提示词前缀或种子模式无效。")
                settings.update(positive_prefix=prefix.strip(), use_canvas_seed=fixed)
                if (workflow.sweep_lora_family is not None or workflow.lora_selectable) and "sweep_lora_family" in payload:
                    family = payload["sweep_lora_family"]
                    if family == "" and workflow.name not in {ANIMA_WORKFLOW, WAI_WORKFLOW, ADVANCED_V40_WORKFLOW}:
                        settings.pop("sweep_lora_family", None)
                    else:
                        self.anima.validate_sweep_directory(family, workflow.sweep_lora_family)
                        settings["sweep_lora_family"] = family
                if name == WAI_WORKFLOW:
                    settings["branches"] = wai_branches(settings, payload.get("branches"))
                    wai_prompt_modes(graph, schemas)
                elif name in V40_WORKFLOWS and "v40" in settings:
                    config = settings["v40"]
                    for key, enabled in v40_branches(config, payload.get("branches")).items():
                        config["branches"][key]["enabled"] = enabled
                    for switch, branch in config["switches"].items():
                        graph[switch]["inputs"]["switch"] = config["branches"][branch]["enabled"]
                    for node in graph.values():
                        inputs = node["inputs"]
                        for field, choices in config.get("dynamic_inputs", {}).get(node["class_type"], {}).items():
                            for child, default in choices[inputs[field]].items():
                                inputs.setdefault(child, default)
                elif name == DETAILER_WORKFLOW:
                    branches = payload.get("branches", {})
                    if branches:
                        switch = feet_switch(graph)
                        if not switch or not isinstance(branches, dict) or set(branches) != {"feet"}:
                            raise WorkflowError("Detailer V40 的分支设置无效。")
                        switch["switch"] = branches["feet"]
                data = {"prompt": graph, "astrbot": settings}
                candidate = workflow_from_profile(name, data, mapping)
                if name == AIO_WORKFLOW:
                    for has_image in (False, True):
                        selected = aio_workflow(graph, settings, has_image, mapping=mapping)
                        validate_graph(selected.graph, schemas, {("1608", "image")})
                        self._check_aio_weights(selected)
                elif name == WAI_WORKFLOW:
                    selected = wai_workflow(graph, settings, mapping)
                    validate_graph(selected.graph, schemas)
                elif name in SEGMENTED_VIDEO_WORKFLOWS | V40_WORKFLOWS:
                    if name in SEGMENTED_VIDEO_WORKFLOWS:
                        check_video_rife(candidate, self.anima.workspace, urlsplit(self.service.client.url).hostname)
                    validate_graph(candidate.graph, schemas, {
                        (field.node, field.name) for field in candidate.image_inputs
                        if name not in V40_WORKFLOWS or candidate.image_required
                    })
                else:
                    validate_graph(
                        {key: graph[key] for key in candidate.active},
                        schemas,
                        {(field.node, field.name) for field in candidate.image_inputs}
                        if candidate.image_required
                        else (),
                    )
                before = read_profile(path)
                if workflow_revision(before) != revision:
                    return error_response("工作流已更新，请刷新后重试。", status_code=409)
                saved = profile_bytes(data)
                response = json_response(
                    self._describe(
                        workflow_revision(saved),
                        settings,
                        candidate,
                        schemas,
                        graph,
                    )
                )
                if "update_config" in payload:
                    await self._update_config_with_settings(payload["update_config"], candidate, path, before, saved)
                else:
                    atomic_write(path, saved)
                self.service.workflows[name] = candidate
                self.service.errors.pop(name, None)
                return response
        except (OSError, ValueError, KeyError, TypeError, ComfyError) as exc:
            return error_response(str(exc), status_code=400)
