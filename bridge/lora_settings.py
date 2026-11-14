"""LoRA catalogs, numbering, trigger words, and next-job selections."""

import asyncio
import hashlib
import json
import re
from copy import copy
from pathlib import Path
from threading import Lock
from weakref import WeakValueDictionary

from astrbot.api.web import error_response, json_response, request

from .workflows.workflow import WorkflowError

# The tags are taken from the training metadata of these Anima weights.
ANIMA_LORAS = {
    "alya": (
        "艾莉莎（Alya）", "alisa_mikhailovna_kujou", "alisa mikhailovna kujou (roshidere)"
    ),
    "masha": (
        "玛利亚（Masha）", "maria_mikhailovna_kujou", "maria mikhailovna kujou (roshidere)"
    ),
    "yuki": ("周防有希（Yuki）", "yuki_suou", "yuki suou (roshidere)"),
}
LORA_ALIASES = {
    f"{stem}-roshidere_s1-ana-anime-soralz": (key, title, tag)
    for key, (title, stem, tag) in ANIMA_LORAS.items()
}
LORA_CATEGORIES = {"C": "人物", "S": "风格", "O": "其他"}
LORA_CATEGORY_FOLDERS = {
    "c": "C", "character": "C", "characters": "C", "人物": "C", "角色": "C",
    "s": "S", "style": "S", "styles": "S", "风格": "S",
    "o": "O", "other": "O", "others": "O", "其他": "O",
}
LORA_TAG_LIMIT = 1000
LORA_SETTINGS_LIMIT = 2 * 1024 * 1024


class LoraSettings:
    def __init__(self, service, family, title):
        self.service = service
        self.family = family
        self.title = title
        self.workspace = Path(service.config.get("anima_workspace", r"G:\ComfyUI"))
        filename = "lora_order.json" if family == "anima" else f"lora_order_{family}.json"
        self.lora_order_path = service.data_dir / filename
        self.lora_lock = Lock()
        self.lora_hashes = {}
        self.pending_loras = {}
        self.submission_locks = WeakValueDictionary()

    def directory_names(self):
        root = (self.workspace / "models/loras").resolve()
        if not root.is_dir():
            return []
        return sorted(
            (path.name for path in root.iterdir() if path.is_dir() and path.resolve() == path),
            key=str.casefold,
        )

    def validate_sweep_directory(self, family, previous):
        if not isinstance(family, str) or (family != previous and family not in self.directory_names()):
            raise WorkflowError("所选 LoRA 文件夹已不可用，请刷新后重新选择。")

    def saved_tags(self):
        with self.lora_lock:
            _, legacy, tags, _, _ = self._read_lora_settings()
            if legacy:
                _, _, _, tags, _, _ = self._load_lora_catalog()
        return {"version": 1, "tags": tags}

    def _read_lora_settings(self):
        try:
            saved = json.loads(self.lora_order_path.read_bytes())
        except (OSError, ValueError):
            saved = {}
        if isinstance(saved, list):
            return saved, {}, {}, {}, {}
        if not isinstance(saved, dict):
            return [], {}, {}, {}, {}
        order, legacy, tags = saved.get("order"), saved.get("tags"), saved.get("tags_by_sha256")
        return (
            order if isinstance(order, list) else [],
            {key: tag for key, tag in legacy.items() if isinstance(tag, str)}
            if isinstance(legacy, dict) else {},
            {sha256: tag for sha256, tag in tags.items() if isinstance(tag, str)}
            if isinstance(tags, dict) else {},
            {key: code for key, code in saved["categories"].items()
             if isinstance(code, str) and code in LORA_CATEGORIES}
            if isinstance(saved.get("categories"), dict) else {},
            {key: value for key, value in saved["default_strengths"].items()
             if type(value) in (int, float) and -100 <= value <= 100}
            if isinstance(saved.get("default_strengths"), dict) else {},
        )

    def _write_lora_settings(self, order, legacy, tags, categories, strengths):
        temp = self.lora_order_path.with_suffix(".tmp")
        if temp.resolve() != temp.absolute():
            raise WorkflowError("LoRA 设置临时文件必须位于插件数据目录。")
        data = {"order": order, "tags_by_sha256": tags}
        if categories:
            data["categories"] = categories
        if strengths:
            data["default_strengths"] = strengths
        if legacy:
            data["tags"] = legacy
        temp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        temp.replace(self.lora_order_path)

    @staticmethod
    def _lora_file_version(path):
        stat = path.stat()
        return stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns

    def _lora_sha256(self, path, version):
        cached = self.lora_hashes.get(path)
        if cached is not None and cached[0] == version:
            return cached[1]
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        if self._lora_file_version(path) != version:
            raise OSError("LoRA 文件在计算哈希时发生变化。")
        sha256 = digest.hexdigest()
        self.lora_hashes[path] = (version, sha256)
        return sha256

    @staticmethod
    def _default_category(relative, metadata):
        folder, separator, _ = relative.partition("/")
        if separator and folder.casefold() in LORA_CATEGORY_FOLDERS:
            return LORA_CATEGORY_FOLDERS[folder.casefold()]
        stem = Path(relative).stem
        title = str(metadata.get("modelspec.title", "")).casefold()
        if re.search(r"(?:^|[ _-])style(?:$|[ _-])", f"{stem.casefold()} {title}"):
            return "S"
        if stem in LORA_ALIASES or title.endswith(("-ana-anime-soralz", "-ixl-anime-soralz", "-ixl-game-soralz")):
            return "C"
        return "O"

    def _load_lora_catalog(self):
        order, legacy, tags, categories, strengths = self._read_lora_settings()
        root = (self.workspace / "models/loras").resolve() / self.family
        if root.resolve() != root:
            raise WorkflowError("LoRA 分类目录必须位于 ComfyUI 的 models/loras 下。")
        catalog = {}
        files = set()
        for path in sorted(root.rglob("*.safetensors"), key=lambda item: item.as_posix().casefold()):
            try:
                resolved = path.resolve()
                if not resolved.is_relative_to(root):
                    continue
                version = self._lora_file_version(resolved)
                with resolved.open("rb") as stream:
                    size = int.from_bytes(stream.read(8), "little")
                    if not 0 < size <= 16 * 1024 * 1024:
                        continue
                    header = json.loads(stream.read(size))
            except (OSError, ValueError):
                continue
            if not isinstance(header, dict) or not any(
                part in name.lower() for name in header
                for part in ("lora_", "hada_w", "lokr_w", "oft_blocks")
            ):
                continue
            meta = header.get("__metadata__", {})
            if not isinstance(meta, dict):
                continue
            architecture = " ".join(
                str(meta.get(field, "")) for field in ("modelspec.architecture", "ss_base_model_version")
            ).casefold()
            if self.family == "anima" and "anima" not in architecture and any(
                family in architecture for family in (
                    "sdxl", "stable-diffusion", "sd1", "sd2", "illustrious", "flux", "wan", "qwen", "z-image"
                )
            ):
                continue
            if self.family == "illustrious" and not any(
                family in architecture for family in ("illustrious", "sdxl", "stable-diffusion-xl")
            ) and any(
                family in architecture for family in (
                    "anima", "stable-diffusion", "sd1", "sd2", "flux", "wan", "qwen", "z-image"
                )
            ):
                continue
            relative = path.relative_to(root).as_posix()
            stem = path.with_suffix("").relative_to(root).as_posix()
            tag = meta.get("modelspec.trigger_phrase", "")
            aliases = LORA_ALIASES if self.family == "anima" else {}
            key, title, tag = aliases.get(stem, (
                f"{self.family}/{stem}", path.stem,
                tag.strip() if isinstance(tag, str) and len(tag) <= LORA_TAG_LIMIT else "",
            ))
            try:
                sha256 = self._lora_sha256(resolved, version)
            except OSError:
                continue
            files.add(resolved)
            catalog[key] = {
                "id": key, "title": title, "filename": f"{self.family}/{relative}", "sha256": sha256,
                "default_tag": tag, "category": categories.get(key) or self._default_category(relative, meta),
                "default_strength": strengths.get(key, 1),
            }
        self.lora_hashes = {path: self.lora_hashes[path] for path in files}
        migrated = legacy.keys() & catalog.keys()
        if migrated:
            for key in catalog:
                if key in migrated:
                    tags.setdefault(catalog[key]["sha256"], legacy.pop(key))
            self._write_lora_settings(order, legacy, tags, categories, strengths)
        ordered = dict.fromkeys(key for key in order if isinstance(key, str) and key in catalog)
        ordered.update(dict.fromkeys(catalog))
        return {key: catalog[key] for key in ordered}, order, legacy, tags, categories, strengths

    @staticmethod
    def _decorate_catalog(catalog, tags):
        counts = dict.fromkeys(LORA_CATEGORIES, 0)
        for entry in catalog.values():
            code = entry["category"]
            counts[code] += 1
            override = tags.get(entry["sha256"])
            entry.update(number=f"{code}{counts[code]}", tag=entry["default_tag"] if override is None else override,
                         tag_override=override)
        return catalog

    def lora_catalog(self):
        with self.lora_lock:
            catalog, _, _, tags, _, _ = self._load_lora_catalog()
            return self._decorate_catalog(catalog, tags)

    def _lora_order_snapshot(self, catalog, tags):
        entries = list(self._decorate_catalog(catalog, tags).values())
        tag_file = {"version": 1, "tags": tags}
        revision = hashlib.sha256(json.dumps([entries, tag_file], sort_keys=True).encode()).hexdigest()
        return {"entries": entries, "tag_file": tag_file, "revision": revision}

    def _get_lora_order(self):
        with self.lora_lock:
            catalog, _, _, tags, _, _ = self._load_lora_catalog()
            return self._lora_order_snapshot(catalog, tags)

    @staticmethod
    def _lora_tag(tag):
        if not isinstance(tag, str) or len(tag) > LORA_TAG_LIMIT or "\0" in tag:
            raise WorkflowError(f"LoRA 附带提示词最多 {LORA_TAG_LIMIT} 个字符，不能包含空字符。")
        return tag.strip()

    def _parse_lora_tag_file(self, data):
        if (
            not isinstance(data, dict) or type(data.get("version")) is not int
            or data["version"] != 1 or not isinstance(data.get("tags"), dict)
        ):
            raise WorkflowError("请选择版本为 1 的 LoRA 附带词 JSON。")
        tags = {}
        for sha256, tag in data["tags"].items():
            if not re.fullmatch(r"[0-9a-fA-F]{64}", sha256) or sha256.lower() in tags:
                raise WorkflowError("LoRA 附带词 JSON 包含无效或重复的 SHA-256。")
            tags[sha256.lower()] = self._lora_tag(tag)
        return tags

    def import_tags(self, tags):
        return self._update_lora_order({"import_tags": tags}, check_revision=False)["imported"]

    def _update_lora_order(self, data, *, check_revision=True):
        with self.lora_lock:
            catalog, order, legacy, tags, categories, strengths = self._load_lora_catalog()
            if check_revision and data.get("revision") != self._lora_order_snapshot(catalog, tags)["revision"]:
                return None
            imported = None
            if "import_tags" in data:
                incoming = self._parse_lora_tag_file(data["import_tags"])
                matched = incoming.keys() & {entry["sha256"] for entry in catalog.values()}
                imported = {"matched": len(matched), "missing": len(incoming) - len(matched)}
                tags.update(incoming)
            elif "order" in data:
                order = data["order"]
                if not isinstance(order, list) or any(not isinstance(key, str) for key in order):
                    raise WorkflowError("LoRA 编号顺序须为 LoRA ID 列表。")
                if len(order) != len(catalog) or set(order) != set(catalog):
                    raise WorkflowError("新顺序必须包含当前目录中每个 LoRA，且不能重复。")
                catalog = {key: catalog[key] for key in order}
            else:
                key = data.get("id")
                if not isinstance(key, str) or key not in catalog or not {"tag", "category", "default_strength"} & data.keys():
                    raise WorkflowError("请选择目录中的 LoRA，并指定要修改的设置。")
                if "category" in data:
                    code = data["category"]
                    if not isinstance(code, str) or code not in LORA_CATEGORIES:
                        raise WorkflowError("LoRA 分类须为人物、风格或其他。")
                    categories[key] = catalog[key]["category"] = code
                if "default_strength" in data:
                    strength = data["default_strength"]
                    if type(strength) not in (int, float) or not -100 <= strength <= 100:
                        raise WorkflowError("LoRA 默认权重必须是 -100 到 100 的数值。")
                    strengths[key] = catalog[key]["default_strength"] = strength
                if "tag" in data:
                    sha256 = catalog[key]["sha256"]
                    if data["tag"] is None:
                        tags.pop(sha256, None)
                    else:
                        tags[sha256] = self._lora_tag(data["tag"])
            self._write_lora_settings(order, legacy, tags, categories, strengths)
            snapshot = self._lora_order_snapshot(catalog, tags)
            if imported is not None:
                snapshot["imported"] = imported
            return snapshot

    async def get_lora_order(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            return json_response(await asyncio.to_thread(self._get_lora_order))
        except (OSError, ValueError) as exc:
            return error_response(str(exc), status_code=400)

    async def save_lora_order(self, data=None):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        try:
            if data is None:
                body = await request.body()
                if len(body) > LORA_SETTINGS_LIMIT:
                    raise WorkflowError("LoRA 设置文件过大。")
                data = json.loads(body)
            if not isinstance(data, dict):
                raise WorkflowError("LoRA 设置格式无效。")
            await self.service.initialize()
            snapshot = await asyncio.to_thread(self._update_lora_order, data)
            if snapshot is None:
                return error_response("LoRA 目录或设置已有更新，请刷新后再调整。", status_code=409)
            return json_response(snapshot)
        except (OSError, ValueError) as exc:
            return error_response(str(exc), status_code=400)

    def parse_loras(self, value, catalog=None):
        if not isinstance(value, list):
            raise WorkflowError("LoRA 请填写列表，空列表表示关闭。")
        if value and catalog is None:
            catalog = self.lora_catalog()
        numbers = {str(index): key for index, key in enumerate(catalog or {}, 1)}
        numbers.update((entry["number"].casefold(), key) for key, entry in (catalog or {}).items())
        rows, seen = [], set()
        for item in value:
            if not isinstance(item, dict) or not isinstance(item.get("id"), str):
                raise WorkflowError("LoRA 每项须包含目录中的 id。")
            key = item["id"]
            if key not in catalog:
                key = numbers.get(key.casefold(), key)
            if key not in catalog:
                matches = [
                    entry["id"] for entry in catalog.values()
                    if key.casefold() in (entry["id"].casefold(), entry["title"].casefold())
                ]
                if len(matches) != 1:
                    raise WorkflowError(f"找不到唯一的 LoRA「{key}」。请用 /comfy lora --wf 工作流简称 list 查看编号或 ID。")
                key = matches[0]
            if key in seen:
                raise WorkflowError(f"LoRA {key} 重复选择。")
            strength = item.get("strength", catalog[key]["default_strength"])
            if type(strength) not in (int, float) or not -100 <= strength <= 100:
                raise WorkflowError("LoRA 强度必须是 -100 到 100 的数值。")
            row = {"id": key, "strength": strength}
            if self.family == "illustrious" and "clip_strength" in item:
                clip_strength = item["clip_strength"]
                if type(clip_strength) not in (int, float) or not -100 <= clip_strength <= 100:
                    raise WorkflowError("LoRA 文本编码器强度必须是 -100 到 100 的数值。")
                row["clip_strength"] = clip_strength
            rows.append(row)
            seen.add(key)
        return rows

    def set_next_loras(self, owner, rows):
        self.pending_loras.pop(owner, None)
        if rows is not None:
            self.pending_loras[owner] = rows
            if len(self.pending_loras) > 4096:
                self.pending_loras.pop(next(iter(self.pending_loras)))

    def with_lora_tags(self, workflow, filenames, *, canvas=False):
        if not filenames:
            return workflow
        entries = {
            row["filename"].casefold().removesuffix(".safetensors"): row
            for row in self.lora_catalog().values()
        }
        tags = []
        for filename in filenames:
            name = filename.replace("\\", "/").casefold().removesuffix(".safetensors")
            entry = entries.get(name)
            if not entry and canvas and "/" not in name:
                matches = [row for path, row in entries.items() if path.rsplit("/", 1)[-1] == name]
                if len(matches) == 1:
                    entry = matches[0]
            if entry:
                tags.append(entry["tag_override"] if canvas else entry["tag"])
        prefix = ", ".join(dict.fromkeys(filter(None, [workflow.positive_prefix, *tags])))
        if prefix == workflow.positive_prefix:
            return workflow
        candidate = copy(workflow)
        candidate.positive_prefix = prefix
        return candidate
