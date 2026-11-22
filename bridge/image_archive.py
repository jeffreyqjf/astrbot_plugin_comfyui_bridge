"""Route generated images and keep favorites in the local archive."""

import errno
import hashlib
import io
import json
import os
import re
import shutil
import time
from collections import OrderedDict
from itertools import chain
from pathlib import Path, PureWindowsPath
from stat import S_ISREG
from tempfile import NamedTemporaryFile
from threading import Lock

from PIL import Image, ImageOps

from .client import image_suffix, output_refs, video_suffix
from .controlnet_archive import ASSET_ID, CONTROL_TOKEN
from .workflows.workflow import WorkflowError, image_loras
from .workflows.workflow_store import atomic_write, profile_bytes

DEFAULT_ARCHIVE = {
    "default_folder": "SFW",
    "rules": [{"tag": "NSFW", "folder": "NSFW"}, {"tag": "SFW", "folder": "SFW"}],
}


def folder_name(value):
    if (
        not isinstance(value, str)
        or not re.fullmatch(r'[^<>:"/\\|?*\x00-\x1f]{1,64}', value)
        or value != value.strip()
        or "%" in value
        or value.endswith(".")
        or PureWindowsPath(value).is_reserved()
    ):
        raise WorkflowError("文件夹名须为单层目录名，不能包含路径符号、变量占位符、首尾空格或保留名称。")
    return value


class ImageArchive:
    def __init__(self, data):
        if not isinstance(data, dict) or not isinstance(data.get("rules"), list):
            raise WorkflowError("图片归档规则格式无效。")
        self.default_folder = folder_name(data.get("default_folder"))
        self.rules = []
        self._patterns = []
        seen = set()
        if len(data["rules"]) > 64:
            raise WorkflowError("最多可设置 64 条归档规则。")
        for rule in data["rules"]:
            if not isinstance(rule, dict):
                raise WorkflowError("图片归档规则格式无效。")
            tag = rule.get("tag")
            if (
                not isinstance(tag, str)
                or not tag
                or tag != tag.strip()
                or len(tag) > 64
                or any(c in tag for c in "[]()【】（）\r\n")
                or tag.casefold() in seen
            ):
                raise WorkflowError("归档标签须唯一，且不能包含括号、换行或首尾空格。")
            seen.add(tag.casefold())
            folder = folder_name(rule.get("folder"))
            literal = re.escape(tag)
            word = rf"(?<![a-zA-Z0-9_-]){literal}(?![a-zA-Z0-9_-])"
            pattern = re.compile(
                rf"\[{literal}\]|【{literal}】|\({literal}\)|（{literal}）|{word}",
                re.IGNORECASE,
            )
            self.rules.append({"tag": tag, "folder": folder})
            self._patterns.append((pattern, folder, "nsfw" in {tag.casefold(), folder.casefold()}))

    def describe(self):
        return {"default_folder": self.default_folder, "rules": self.rules}

    def split(self, prompt, *, allow_nsfw=True):
        folder = None
        cleaned = prompt
        for pattern, destination, restricted in self._patterns:
            if restricted and not allow_nsfw and pattern.search(prompt):
                raise WorkflowError("此归档标签仅限管理员私聊使用。")
            cleaned, matches = pattern.subn("", cleaned)
            if matches and folder is None:
                folder = destination
        if folder is not None:
            cleaned = re.sub(r"([,，])\s*[,，]+", r"\1", cleaned).strip(" ,，\t\r\n")
        return cleaned, folder


FAVORITES_FOLDER = "Favorites"


class ImageFavorites:
    def __init__(self, data_dir, cache_dir, local_output, configured_directory=""):
        self.index = data_dir / "favorite_sources"
        self.cache_dir = cache_dir
        self.local_output = local_output
        self.configured_directory = configured_directory.strip()
        self.lock = Lock()

    def remember(self, job_id, owner, paths, refs, *, video=False):
        local = self.local_output is not None and self.local_output.is_dir()
        if not local and not video:
            return
        sources = []
        for path, ref in zip(paths, refs, strict=True):
            relative = _output_relative_path(ref) if local else None
            cache_root = self.cache_dir.resolve()
            resolved = path.resolve()
            cache = resolved.relative_to(cache_root).as_posix() if video and resolved.is_relative_to(cache_root) else None
            sources.append([relative, _file_digest(path), cache] if relative or cache else None)
        if any(sources):
            directory = self.index / job_id[:2]
            directory.mkdir(parents=True, exist_ok=True)
            atomic_write(directory / f"{job_id}.json", profile_bytes({
                "owner": owner, "sources": sources, "video": video,
            }))

    def move_original(self, short_id, index, owner, is_admin, *, video=False):
        if not re.fullmatch("[0-9a-f]{8}", short_id):
            raise WorkflowError("任务 ID 无效，请使用 8 位短 ID。")
        matches = list((self.index / short_id[:2]).glob(f"{short_id}*.json"))
        if not matches:
            return None
        if len(matches) != 1:
            raise WorkflowError("任务 ID 重复，无法确认对应媒体。")
        record = json.loads(matches[0].read_bytes())
        record_video = record.get("video", False)
        if video is not None and record_video != video:
            return None
        if record["owner"] != owner and not is_admin:
            raise WorkflowError("只能移动自己在本会话生成的媒体，管理员可以移动其他人的媒体。")
        if not 1 <= index <= len(record["sources"]):
            raise WorkflowError("未找到对应的媒体序号。")
        entry = record["sources"][index - 1]
        if entry is None:
            return None

        relative, digest, *cache = entry
        root = self.local_output.resolve() if self.local_output is not None and relative else None
        source = self._contained_file(root, relative) if root is not None else None
        cached = self._contained_file(self.cache_dir.resolve(), cache[0]) if cache and cache[0] else None
        if source is None and cached is None:
            return None
        media = "原视频" if record_video else "原图"
        with self.lock:
            directory = self._directory()
            filename = source or cached
            destination = directory / filename.name
            alternate = directory / f"{filename.stem[:160]}_{matches[0].stem}_{index}{filename.suffix}"
            if source == destination and _matches_digest(destination, digest):
                return f"这份{media}已在收藏文件夹。"
            original = source is not None and _matches_digest(source, digest)
            if not original:
                if any(_matches_digest(path, digest) for path in (destination, alternate)):
                    return f"这份{media}已在收藏文件夹。"
                if cached is None or not _matches_digest(cached, digest):
                    return None
            if (destination.exists() or destination.is_symlink()) and not _matches_digest(destination, digest):
                destination = alternate
            if not _matches_digest(destination, digest):
                _place_file(source if original else cached, destination, digest)
            if original:
                source.unlink()
                return f"已将{media}移到收藏文件夹。"
            return "已将视频缓存保存到收藏文件夹。"

    @staticmethod
    def _contained_file(root, relative):
        path = root / relative
        if not path.is_relative_to(root) or path.resolve() != path:
            raise WorkflowError("媒体路径必须位于对应的输出目录内。")
        return path

    def save_video(self, path, limit):
        if not path.is_file() or path.stat().st_size > limit:
            raise WorkflowError("视频不可读取或超过文件大小上限。")
        with path.open("rb") as handle:
            suffix = video_suffix(handle.read(64), path.suffix.lower())
        if suffix is None:
            raise WorkflowError("收藏支持 MP4、MOV、WebM、MKV 和 GIF。")
        digest = _file_digest(path)
        with self.lock:
            target = self._directory() / f"QQ_{digest}{suffix}"
            if _matches_digest(target, digest):
                return "这份视频已在收藏文件夹。"
            _place_file(path, target, digest)
        return "已将引用视频保存到收藏文件夹。"

    def _directory(self):
        if self.configured_directory:
            directory = Path(self.configured_directory).expanduser()
            if not directory.is_absolute():
                raise WorkflowError("请在插件设置中填写收藏文件夹的完整路径。")
            directory = directory.resolve()
        else:
            root = self.local_output if self.local_output is not None and self.local_output.is_dir() else self.cache_dir
            directory = root.resolve() / FAVORITES_FOLDER
            if directory.resolve() != directory:
                raise WorkflowError("默认收藏文件夹必须位于图片输出目录内。")
        directory.mkdir(parents=True, exist_ok=True)
        return directory



REVIEW_STATES = ("unevaluate", "favourite", "pass", "hd")
REVIEW_RATINGS = ("SFW", "NSFW")
IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif"}
GALLERY_STATES = ("favourite", "pass", "hd")
JOB_ID = re.compile(r"[0-9a-f]{32}")
MANUAL_ID = re.compile(r"manual:(unevaluate|favourite|pass|hd):-?[0-9a-f]+:[0-9a-f]+:(.+)")
UNSAFE_MANUAL_PATH = re.compile(r'[<>:"\\|?*\x00-\x1f]')
IMAGE_FILTERS = ("preset", "workflow", "lora")


class ImageReviews:
    def __init__(self, data_dir, output_dir, local_output):
        self.local_output = local_output if (
            local_output is not None and local_output.is_absolute() and local_output.parent.is_dir()
        ) else None
        self.root = (self.local_output or output_dir).resolve()
        self.index = data_dir / "image_reviews"
        self.metadata_dir = data_dir / "generation_metadata"
        self.legacy_metadata = OrderedDict()
        self.lock = Lock()

    @staticmethod
    def pending_folder(folder, job_id):
        rating = "NSFW" if folder.casefold() == "nsfw" else "SFW"
        custom = "" if folder.casefold() == rating.casefold() else f"/{folder}"
        return f"unevaluate/{rating}{custom}/{job_id}"

    def initialize(self):
        for state in REVIEW_STATES:
            for rating in REVIEW_RATINGS:
                self._path(f"{state}/{rating}").mkdir(parents=True, exist_ok=True)

    def _path(self, relative):
        return ImageFavorites._contained_file(self.root, relative)

    def originals(self, folder, job_id, refs):
        directory = self.pending_folder(folder, job_id)
        paths = []
        for ref in refs:
            relative = _output_relative_path(ref) if self.local_output is not None else None
            path = self._path(relative) if relative and relative.startswith(directory + "/") else None
            paths.append(path if path is not None and path.is_file() else None)
        return paths

    def _record(self, job_id):
        path = self.index / job_id[:2] / f"{job_id}.json"
        try:
            return json.loads(path.read_bytes())
        except FileNotFoundError:
            return None

    def _write_record(self, job_id, record):
        path = self.index / job_id[:2] / f"{job_id}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write(path, profile_bytes(record))

    def remember(self, job_id, owner, workflow, folder, caches, originals, *, metadata=None, refinement=None):
        directory = self.pending_folder(folder, job_id)
        files = []
        digests = {}
        transfers = []
        for index, (cache, original) in enumerate(zip(caches, originals, strict=True), 1):
            source = cache or original
            if source is None:
                files.append(None)
                continue
            with source.open("rb") as handle:
                suffix = image_suffix(handle.read(16))
            digest = _file_digest(source)
            use_original = original is not None and (original == source or _matches_digest(original, digest))
            name = f"{index:04}{suffix}"
            files.append(name)
            digests[name] = digest
            transfers.append((original if use_original else source, self._path(f"{directory}/{name}"), digest, use_original))
        if not transfers:
            return
        record = {"id": job_id, "owner": owner, "workflow": workflow, "created": time.time(),
                  "directory": directory.removeprefix("unevaluate/"), "files": files, "digests": digests}
        if metadata is not None:
            record["generation"] = metadata
        with self.lock:
            if refinement:
                image = refinement["image"]
                suffix = image_suffix(image)
                target = self._refinement_path(job_id, suffix)
                target.parent.mkdir(parents=True, exist_ok=True)
                atomic_write(target, image)
                record.setdefault("generation", {"loras": [[] for _ in files]})["refinement"] = {
                    "input_id": job_id, "suffix": suffix, "source": refinement.get("source"),
                }
            self._write_record(job_id, record)
            for source, target, digest, move in transfers:
                target.parent.mkdir(parents=True, exist_ok=True)
                if source != target:
                    if not _matches_digest(target, digest):
                        _place_file(source, target, digest)
                    if move:
                        source.unlink()

    def _refinement_path(self, identity, suffix):
        if not JOB_ID.fullmatch(identity or "") or suffix not in {*IMAGE_TYPES, ".thumb.webp"}:
            raise WorkflowError("细化原图标识无效。")
        root = self.index.absolute()
        if root.resolve() != root:
            raise WorkflowError("细化原图目录不能是链接。")
        return ImageFavorites._contained_file(root, f"detailer_inputs/{identity}{suffix}")

    def verify_reference_origin(self, image, origin):
        if not isinstance(origin, dict) or origin.keys() != {"id", "state"} or origin["state"] not in REVIEW_STATES:
            raise WorkflowError("参考图来源无效。")
        with self.lock:
            identity, state = origin["id"], origin["state"]
            if not isinstance(identity, str):
                raise WorkflowError("参考图来源无效。")
            if identity.startswith("manual:"):
                current, path, _ = self._manual_lookup(identity)
                if current != state:
                    raise WorkflowError("参考图已移走，请重新选择。")
            else:
                record, index = self._lookup(identity)
                path = self._path(f"{state}/{record['directory']}/{record['files'][index - 1]}")
            digest = hashlib.sha256(image or b"").hexdigest()
            if not _matches_digest(path, digest):
                raise WorkflowError("参考图与所选原图不匹配，请重新选择。")
            return {"image": image, "source": {"id": identity, "state": state, "digest": digest,
                    "relative": path.relative_to(self.root / state).as_posix()}}

    def capture_refinement(self, image, owner):
        digest = hashlib.sha256(image).hexdigest()
        matches = []
        with self.lock:
            for state in REVIEW_STATES:
                for record in self._records(state):
                    if record.get("owner") != owner:
                        continue
                    for index, path in self._files(record, state):
                        if record["digests"].get(record["files"][index - 1]) == digest and _matches_digest(path, digest):
                            matches.append({"id": f"{record['id']}:{index}", "state": state, "digest": digest,
                                            "relative": path.relative_to(self.root / state).as_posix()})
        return {"image": image, "source": matches[0] if len(matches) == 1 else None}

    def refinement_input(self, image_id, original, limit):
        with self.lock:
            record, index = self._lookup(image_id)
            relation = self._refinement(record, index)
            if not relation:
                raise WorkflowError("该图片没有细化原图记录。")
            path = self._refinement_path(record["id"], relation["suffix"])
            if not original:
                path = self._make_thumbnail(self._refinement_path(record["id"], ".thumb.webp"), path)
            if path is None:
                raise WorkflowError("细化原图无法预览。")
            with path.open("rb") as stream:
                image = stream.read(limit + 1)
            if len(image) > limit:
                raise WorkflowError("细化原图超过图片大小上限。")
            return IMAGE_TYPES[path.suffix.lower()], image

    @staticmethod
    def _refinement(record, index):
        relation = record.get("generation", {}).get("refinement")
        return relation if relation and index not in relation.get("detached", []) else None

    @staticmethod
    def _refinement_relative(record, relation):
        source = relation.get("source")
        return source["relative"] if source else f"{record['directory'].split('/')[0]}/detailer_inputs/{record['id']}{relation['suffix']}"

    def detach_refinement(self, image_id, state):
        if state not in REVIEW_STATES:
            raise WorkflowError("请选择有效的图片图集。")
        with self.lock:
            record, index = self._lookup(image_id)
            name = record["files"][index - 1]
            if not _matches_digest(self._path(f"{state}/{record['directory']}/{name}"), record["digests"][name]):
                raise WorkflowError("图片已变更或移走，请刷新列表。")
            relation = self._refinement(record, index)
            if not relation:
                return
            origin = relation.get("source")
            snapshot = self._refinement_path(record["id"], relation["suffix"])
            digest = _file_digest(snapshot)
            if origin and digest != origin["digest"]:
                raise WorkflowError("细化原图快照已变更，未解除关联。")
            relative = self._refinement_relative(record, relation)
            candidates = [self._path(f"{section}/{relative}") for section in REVIEW_STATES]
            if any(path.exists() and not _matches_digest(path, digest) for path in candidates):
                raise WorkflowError("原图位置已有不同内容，未覆盖或解除关联。")
            target = self._path(f"hd/{relative}")
            created = not any(_matches_digest(path, digest) for path in candidates)
            if created:
                target.parent.mkdir(parents=True, exist_ok=True)
                _place_file(snapshot, target, digest)
            relation.setdefault("detached", []).append(index)
            try:
                self._write_record(record["id"], record)
            except (OSError, ValueError):
                if created:
                    target.unlink(missing_ok=True)
                raise

    def _hd_source_paths(self):
        hidden = set()
        for record in self._records("hd"):
            relation = record.get("generation", {}).get("refinement", {})
            if not relation:
                continue
            source = relation.get("source")
            relative = self._refinement_relative(record, relation)
            if source:
                digest = source["digest"]
            else:
                try:
                    digest = _file_digest(self._refinement_path(record["id"], relation["suffix"]))
                except OSError:
                    continue
            if any(self._refinement(record, index) for index, _ in self._files(record, "hd")) and _matches_digest(
                self._path(f"hd/{relative}"), digest,
            ):
                hidden.add(relative)
        return hidden

    def _records(self, state, rating=None):
        for section in (rating,) if rating else REVIEW_RATINGS:
            root = self._path(f"{state}/{section}")
            for path in chain(root.glob("*"), root.glob("*/*")):
                if not JOB_ID.fullmatch(path.name) or not path.is_dir():
                    continue
                record = self._record(path.name)
                if record and self._path(f"{state}/{record['directory']}") == path:
                    yield record

    def _files(self, record, state):
        for index, name in enumerate(record["files"], 1):
            if name:
                path = self._path(f"{state}/{record['directory']}/{name}")
                if path.is_file():
                    yield index, path

    @staticmethod
    def _item(record, index, legacy=None, *, include_generation=True):
        item = {"id": f"{record['id']}:{index}", "index": index, "rating": record["directory"].split("/", 1)[0]}
        if not include_generation:
            return item
        generation = record.get("generation")
        info = {"workflow": record["workflow"]}
        if generation is not None:
            info.update(seed=generation.get("seed"), loras=generation["loras"][index - 1])
            preset = generation.get("preset")
            relation = ImageReviews._refinement(record, index)
            if relation:
                info["refinement"] = {"input_id": relation["input_id"], "linked": bool(relation.get("source"))}
            slots = generation.get("controlnets")
            if isinstance(slots, list) and index <= len(slots):
                links = _controlnet_links(slots[index - 1])
                if links:
                    info["controlnets"] = links
        else:
            preset = legacy.get("preset") if legacy else None
            if legacy:
                info["seed"] = legacy.get("seed")
                loras = legacy.get("loras", [])
                if index <= len(loras):
                    info["loras"] = loras[index - 1]
        if isinstance(preset, dict) and isinstance(preset.get("name"), str) and preset["name"]:
            info["preset"] = {key: preset[key] for key in ("id", "account", "name") if key in preset}
        config = (generation if generation is not None else legacy or {}).get("workflow_config")
        if isinstance(config, str) and config:
            info["workflow_config"] = config
        if type(info.get("seed")) is int:
            info["seed"] = str(info["seed"])
        item["generation"] = info
        return item

    def _legacy_metadata(self, record):
        if "generation" in record:
            return None
        job_id = record["id"]
        try:
            path = self.metadata_dir / f"{job_id}.json"
            if not JOB_ID.fullmatch(job_id) or path.is_symlink():
                return None
            stamp = path.stat().st_mtime_ns
            cached = self.legacy_metadata.get(job_id)
            if cached and cached[0] == stamp:
                self.legacy_metadata.move_to_end(job_id)
                return cached[1]
            with path.open("rb") as stream:
                raw = stream.read(16 * 1024 * 1024 + 1)
            if len(raw) > 16 * 1024 * 1024:
                return None
            data = json.loads(raw)
        except (OSError, ValueError, RecursionError):
            return None
        if not isinstance(data, dict):
            return None
        trace = {"preset": data.get("preset"), "seed": data.get("seed")}
        graph = data.get("prompt")
        history = data.get("comfyui_history")
        if isinstance(graph, dict) and isinstance(history, dict) and isinstance(history.get("outputs"), dict):
            outputs = [key for key in graph if key in history["outputs"]]
            try:
                loras = image_loras(graph, outputs)
                refs = output_refs(history, outputs, include_node=True)
                trace["loras"] = [loras[ref["output_node"]] for ref in refs]
            except (KeyError, TypeError, AttributeError, RecursionError):
                pass
        self.legacy_metadata[job_id] = (stamp, trace)
        self.legacy_metadata.move_to_end(job_id)
        if len(self.legacy_metadata) > 1024:
            self.legacy_metadata.popitem(last=False)
        return trace

    @staticmethod
    def preset_identity(preset):
        if not preset:
            return ""
        if preset.get("id"):
            return "id:" + preset.get("account", "") + ":" + preset["id"]
        return "name:" + preset["name"]

    @classmethod
    def _filter_values(cls, item):
        info = item.get("generation", {})
        return {
            "preset": {cls.preset_identity(info.get("preset"))},
            "workflow": {info.get("workflow") or ""},
            "lora": {row["name"] for row in info.get("loras", [])} or {""},
        }

    @classmethod
    def _matches_filters(cls, item, filters, lora_match):
        values = cls._filter_values(item)
        for key, selected in filters.items():
            if key == "lora" and lora_match == "all":
                if not selected.issubset(values[key]):
                    return False
            elif selected and not selected.intersection(values[key]):
                return False
        return True

    def _indexed_names(self, state, directory):
        relative = directory.relative_to(self.root / state)
        if (len(relative.parts) not in {2, 3} or relative.parts[0] not in REVIEW_RATINGS
                or not JOB_ID.fullmatch(directory.name)):
            return ()
        if state == "unevaluate":
            # ComfyUI can write to these task directories before the job is indexed.
            return None
        record = self._record(directory.name)
        if record and record["directory"] == relative.as_posix():
            return set(record["files"])
        return ()

    @staticmethod
    def _manual_item(state, relative, stat):
        rating = "NSFW" if relative.parts[0].casefold() == "nsfw" and len(relative.parts) > 1 else "SFW"
        return {
            "id": f"manual:{state}:{stat.st_mtime_ns:x}:{stat.st_size:x}:{relative.as_posix()}",
            "index": 1, "rating": rating, "name": relative.name,
        }

    def _manual_files(self, state, rating=None):
        root = self._path(state)
        for directory, subdirs, files in os.walk(root):
            parent = Path(directory)
            indexed = self._indexed_names(state, parent)
            if indexed is None:
                subdirs.clear()
                continue
            subdirs[:] = [
                name for name in subdirs if not (parent / name).is_symlink() and (parent / name).resolve() == parent / name
            ]
            for name in files:
                path = parent / name
                if (path.suffix.lower() not in IMAGE_TYPES or name in indexed
                        or path.is_symlink() or path.resolve() != path):
                    continue
                relative = path.relative_to(root)
                if UNSAFE_MANUAL_PATH.search(relative.as_posix()):
                    continue
                try:
                    stat = path.stat()
                except OSError:
                    continue
                if not S_ISREG(stat.st_mode):
                    continue
                item = self._manual_item(state, relative, stat)
                if not rating or item["rating"] == rating:
                    yield stat.st_mtime, item, path

    def _manual_lookup(self, image_id):
        match = MANUAL_ID.fullmatch(image_id)
        if not match:
            raise WorkflowError("图片 ID 无效。")
        state, relative = match.groups()
        if UNSAFE_MANUAL_PATH.search(relative) or any(
            part in {"", ".", ".."} for part in relative.split("/")
        ):
            raise WorkflowError("图片路径无效。")
        path = self._path(f"{state}/{relative}")
        if path.suffix.lower() not in IMAGE_TYPES or not path.is_file():
            raise WorkflowError("图片已移走，请刷新列表。")
        indexed = self._indexed_names(state, path.parent)
        if indexed is None or path.name in indexed:
            raise WorkflowError("图片属于生成任务，请刷新列表。")
        item = self._manual_item(state, path.relative_to(self.root / state), path.stat())
        if item["id"] != image_id:
            raise WorkflowError("图片已更新，请刷新列表。")
        return state, path, item

    def pending(self, limit, *, filters=None, page=None, lora_match="any"):
        filters = filters or {}
        with self.lock:
            jobs = []
            for record in self._records("unevaluate"):
                legacy = self._legacy_metadata(record)
                images = [self._item(record, index, legacy) for index, _ in self._files(record, "unevaluate")]
                if filters:
                    images = [item for item in images if self._matches_filters(item, filters, lora_match)]
                if images:
                    jobs.append((record["created"], record["id"], {
                        "id": record["id"][:8], "workflow": record["workflow"], "images": images,
                    }))
            for created, item, _ in self._manual_files("unevaluate"):
                if not filters or self._matches_filters(item, filters, lora_match):
                    jobs.append((created, item["id"], {"workflow": "手动添加", "images": [item]}))
            jobs.sort(key=lambda row: row[:2])
            start = (page - 1) * limit if page is not None else 0
            end = start + limit
            result = {"jobs": [job for _, _, job in jobs[start:end]], "limit": limit}
            if page is not None:
                result.update(total=len(jobs), page=page, page_size=limit, has_more=len(jobs) > end)
            return result

    def gallery(self, rating, page, size=24, *, state="favourite", filters=None, lora_match="any", include_sources=False):
        with self.lock:
            hidden = self._hd_source_paths() if state == "hd" else set()
            start = (page - 1) * size
            entries = []
            page_metadata = {}
            for record in self._records(state, rating):
                legacy = self._legacy_metadata(record) if filters else None
                for index, path in self._files(record, state):
                    if not include_sources and path.relative_to(self.root / state).as_posix() in hidden:
                        continue
                    item = self._item(record, index, legacy, include_generation=bool(filters))
                    if not filters or self._matches_filters(item, filters, lora_match):
                        entries.append((record["created"], item, record))
            entries.extend(
                (created, item, None) for created, item, path in self._manual_files(state, rating)
                if (include_sources or path.relative_to(self.root / state).as_posix() not in hidden)
                and (not filters or self._matches_filters(item, filters, lora_match))
            )
            entries.sort(key=lambda row: (-row[0], row[1]["id"]))
            rows = []
            for _, item, record in entries[start:start + size]:
                if record and not filters:
                    job_id = record["id"]
                    if job_id not in page_metadata:
                        page_metadata[job_id] = self._legacy_metadata(record)
                    item = self._item(record, item["index"], page_metadata[job_id])
                rows.append(item)
            if include_sources:
                for item in rows:
                    if item["id"].startswith("manual:"):
                        _, path, _ = self._manual_lookup(item["id"])
                        relative = path.relative_to(self.root / state).as_posix()
                    else:
                        record, index = self._lookup(item["id"])
                        relative = f"{record['directory']}/{record['files'][index - 1]}"
                    if relative in hidden:
                        item["refinement_source"] = True
            return {
                "images": rows, "has_more": len(entries) > start + size,
                "total": len(entries), "page": page, "page_size": size,
            }

    def filter_options(self, state, rating, *, include_sources=False):
        with self.lock:
            hidden = self._hd_source_paths() if state == "hd" else set()
            facets = {key: {} for key in IMAGE_FILTERS}
            for record in self._records(state, rating):
                legacy = self._legacy_metadata(record)
                for index, path in self._files(record, state):
                    if not include_sources and path.relative_to(self.root / state).as_posix() in hidden:
                        continue
                    item = self._item(record, index, legacy)
                    for key, values in self._filter_values(item).items():
                        for value in values - {""}:
                            label = item["generation"]["preset"]["name"] if key == "preset" else value
                            facets[key][value] = label
            return facets

    def _lookup(self, image_id):
        match = re.fullmatch(r"([0-9a-f]{32}):([1-9][0-9]{0,5})", image_id or "")
        if not match:
            raise WorkflowError("图片 ID 无效。")
        record, index = self._record(match[1]), int(match[2])
        if not record or index > len(record["files"]) or not record["files"][index - 1]:
            raise WorkflowError("未找到此图片。")
        return record, index

    def _move(self, record, index, state, *, source_state="unevaluate", from_pass=False):
        name = record["files"][index - 1]
        digest = record["digests"][name]
        relative = f"{record['directory']}/{name}"
        target = self._path(f"{state}/{relative}")
        if target.is_file():
            if not _matches_digest(target, digest):
                raise WorkflowError("目标目录已有同名图片，未覆盖。")
            return False
        source = self._path(f"{source_state}/{relative}")
        if not source.is_file() and from_pass:
            source = self._path(f"pass/{relative}")
        if not source.is_file():
            raise WorkflowError("这张图片已评价或已移走。")
        if not _matches_digest(source, digest):
            raise WorkflowError("原图内容已变更，未移动。")
        if state in {"favourite", "hd"}:
            self._thumbnail(record, index, source)
        target.parent.mkdir(parents=True, exist_ok=True)
        _place_file(source, target, digest)
        try:
            source.unlink()
        except OSError:
            target.unlink()
            raise
        try:
            source.parent.rmdir()
        except OSError:
            pass
        return True

    def _move_refinement_hd(self, record, index, source_state):
        relation = record.get("generation", {}).get("refinement", {})
        origin = relation.get("source")
        if not origin:
            snapshot = self._refinement_path(record["id"], relation["suffix"])
            digest = _file_digest(snapshot)
            target = self._path(f"hd/{self._refinement_relative(record, relation)}")
            created = not target.exists()
            if not created and not _matches_digest(target, digest):
                raise WorkflowError("高清图集已有不同的同名原图，未覆盖或移动。")
            if created:
                target.parent.mkdir(parents=True, exist_ok=True)
                _place_file(snapshot, target, digest)
            try:
                return self._move(record, index, "hd", source_state=source_state)
            except (OSError, ValueError):
                if created:
                    target.unlink(missing_ok=True)
                raise
        name = record["files"][index - 1]
        relative = f"{record['directory']}/{name}"
        plans = [(self._path(f"{source_state}/{relative}"), self._path(f"hd/{relative}"), record["digests"][name])]
        candidates = [self._path(f"{state}/{origin['relative']}") for state in REVIEW_STATES]
        existing = [path for path in candidates if path.is_file()]
        matches = [path for path in existing if _matches_digest(path, origin["digest"])]
        if existing and not matches:
            raise WorkflowError("细化原图已变更，未移动任何图片。")
        if len(matches) > 1:
            raise WorkflowError("细化原图存在多份，无法安全确定移动来源。")
        if matches and matches[0] != self._path(f"hd/{origin['relative']}"):
            plans.append((matches[0], self._path(f"hd/{origin['relative']}"), origin["digest"]))
        created, removed = [], []
        for source, target, digest in plans:
            if target.exists() and not _matches_digest(target, digest):
                raise WorkflowError("高清图集已有不同的同名图片，未覆盖或移动。")
            if not _matches_digest(source, digest) and not _matches_digest(target, digest):
                raise WorkflowError("图片已变更或移走，请刷新后重试。")
        try:
            for source, target, digest in plans:
                if not target.exists():
                    target.parent.mkdir(parents=True, exist_ok=True)
                    _place_file(source, target, digest)
                    created.append(target)
            if any(not _matches_digest(target, digest) for _, target, digest in plans):
                raise WorkflowError("高清图片校验失败，未移除来源图片。")
            for source, target, digest in plans:
                if source != target and source.is_file():
                    source.unlink()
                    removed.append((source, target, digest))
        except (OSError, ValueError):
            for source, target, digest in removed:
                _place_file(target, source, digest)
            for path in created:
                path.unlink(missing_ok=True)
            raise
        return bool(created or removed)

    def rate(self, image_id, state, *, source="unevaluate"):
        if state not in GALLERY_STATES or source not in REVIEW_STATES or source == state:
            raise WorkflowError("图片的来源或目标分类无效。")
        with self.lock:
            if image_id.startswith("manual:"):
                self._rate_manual(image_id, state, source)
            else:
                record, index = self._lookup(image_id)
                if state == "hd" and self._refinement(record, index):
                    self._move_refinement_hd(record, index, source)
                else:
                    self._move(record, index, state, source_state=source)

    def delete(self, image_id, state):
        if state not in {"unevaluate", "pass", "hd"}:
            raise WorkflowError("只能删除待评价、Pass 或高清图集中的图片。")
        with self.lock:
            if image_id.startswith("manual:"):
                current, path, _ = self._manual_lookup(image_id)
                if current != state:
                    raise WorkflowError("图片来源已变更，请刷新列表。")
                thumbnail = self._manual_thumbnail(image_id)
            else:
                record, index = self._lookup(image_id)
                name = record["files"][index - 1]
                path = self._path(f"{state}/{record['directory']}/{name}")
                if not _matches_digest(path, record["digests"][name]):
                    raise WorkflowError("原图已变更或移走，请刷新列表。")
                thumbnail = self._thumbnail_path(record, index)
            thumbnail.unlink(missing_ok=True)
            path.unlink()

    def _rate_manual(self, image_id, state, source_state):
        current, source, item = self._manual_lookup(image_id)
        if current != source_state:
            raise WorkflowError("图片来源已变更，请刷新列表。")
        relative = source.relative_to(self.root / current)
        folders = relative.parts[1:-1] if relative.parts[0].upper() in REVIEW_RATINGS and len(relative.parts) > 1 else relative.parts[:-1]
        directory = self._path(Path(state, item["rating"], *folders))
        directory.mkdir(parents=True, exist_ok=True)
        target = directory / source.name
        index = 2
        while target.exists() or target.is_symlink():
            target = directory / f"{source.stem[:160]}_{index}{source.suffix}"
            index += 1
        digest = _file_digest(source)
        self._manual_lookup(image_id)
        _place_file(source, target, digest)
        try:
            source.unlink()
        except OSError:
            target.unlink()
            raise
        if state in {"favourite", "hd"}:
            item = self._manual_item(state, target.relative_to(self.root / state), target.stat())
            self._make_thumbnail(self._manual_thumbnail(item["id"]), target)

    def favorite_qq(self, short_id, index, owner, is_admin, allow_nsfw):
        if not re.fullmatch("[0-9a-f]{8}", short_id):
            raise WorkflowError("任务 ID 无效，请使用 8 位短 ID。")
        with self.lock:
            matches = list((self.index / short_id[:2]).glob(f"{short_id}*.json"))
            if not matches:
                return None
            if len(matches) != 1:
                raise WorkflowError("任务 ID 重复，无法确认对应图片。")
            record, _ = self._lookup(f"{matches[0].stem}:{index}")
            if record["owner"] != owner and not is_admin:
                raise WorkflowError("只能移动自己在本会话生成的媒体，管理员可以移动其他人的媒体。")
            if record["directory"].startswith("NSFW/") and not allow_nsfw:
                raise WorkflowError("此图片只能在管理员私聊中收藏。")
            added = self._move(record, index, "favourite", from_pass=True)
            count = 0
            selected = record["created"], record["id"]
            for pending in list(self._records("unevaluate")):
                order = pending["created"], pending["id"]
                if (pending["owner"] != record["owner"] or order > selected
                        or (not allow_nsfw and pending["directory"].startswith("NSFW/"))):
                    continue
                for earlier, _ in self._files(pending, "unevaluate"):
                    if order < selected or earlier < index:
                        count += self._move(pending, earlier, "pass")
            reply = "已将原图移到收藏文件夹。" if added else "这份原图已在收藏文件夹。"
            return f"{reply}已跳过前面 {count} 张未评价图片。" if count else reply

    def save_quoted(self, data):
        digest = hashlib.sha256(data).hexdigest()
        job_id = digest[:32]
        name = f"0001{image_suffix(data)}"
        record = {"id": job_id, "owner": "", "workflow": "QQ 引用图", "created": time.time(),
                  "directory": f"SFW/{job_id}", "files": [name], "digests": {name: digest}}
        target = self._path(f"favourite/{record['directory']}/{name}")
        with self.lock:
            if _matches_digest(target, digest):
                return "这张引用图已在收藏文件夹。"
            if target.exists():
                raise WorkflowError("收藏文件夹内已有同名文件，未覆盖。")
            target.parent.mkdir(parents=True, exist_ok=True)
            self._write_record(job_id, record)
            atomic_write(target, data)
            self._thumbnail(record, 1, target)
        return "已将引用图保存到收藏文件夹。"

    def _thumbnail_path(self, record, index):
        return self._path(f".astrbot-thumbnails/{record['directory']}/{index:04}.webp")

    def _manual_thumbnail(self, image_id):
        key = hashlib.sha256(image_id.encode("utf-8")).hexdigest()
        return self._path(f".astrbot-thumbnails/manual/{key}.webp")

    def _thumbnail(self, record, index, source):
        return self._make_thumbnail(self._thumbnail_path(record, index), source)

    @staticmethod
    def _make_thumbnail(path, source):
        if not path.is_file():
            try:
                if source.resolve() != source or not source.is_file():
                    return None
                with Image.open(source, formats=("PNG", "JPEG", "WEBP", "GIF")) as image:
                    image.thumbnail((384, 384), Image.Resampling.LANCZOS)
                    preview = ImageOps.exif_transpose(image)
                    with io.BytesIO() as data:
                        preview.save(data, "WEBP", quality=78)
                        path.parent.mkdir(parents=True, exist_ok=True)
                        atomic_write(path, data.getvalue())
            except (OSError, ValueError, Image.DecompressionBombError):
                return None
        return path

    def generate_gallery_thumbnails(self, state="favourite"):
        with self.lock:
            files = [
                (self._thumbnail_path(record, index), source)
                for record in self._records(state) for index, source in self._files(record, state)
            ]
            files.extend((self._manual_thumbnail(item["id"]), source)
                         for _, item, source in self._manual_files(state))
        counts = {"created": 0, "existing": 0, "failed": 0}
        for thumbnail, source in files:
            with self.lock:
                if thumbnail.is_file():
                    counts["existing"] += 1
                elif self._make_thumbnail(thumbnail, source) is not None:
                    counts["created"] += 1
                else:
                    counts["failed"] += 1
        return counts

    def write_gallery_zip(self, state, archive):
        if state not in REVIEW_STATES:
            raise WorkflowError("请选择有效的图片图集。")
        with self.lock:
            hidden = self._hd_source_paths() if state == "hd" else set()
            paths = {
                path
                for record in self._records(state) for _, path in self._files(record, state)
            }
            paths.update(path for _, _, path in self._manual_files(state))
            paths = {path for path in paths if path.relative_to(self.root / state).as_posix() not in hidden}
            inputs = []
            if state == "hd":
                for record in self._records(state):
                    relation = record.get("generation", {}).get("refinement")
                    if relation and any(self._refinement(record, index) for index, _ in self._files(record, state)):
                        inputs.append((self._refinement_path(record["id"], relation["suffix"]),
                                       f"{record['directory']}/input/original{relation['suffix']}"))
        root = self._path(state)
        for path in sorted(paths):
            relative = path.relative_to(root).as_posix()
            with self.lock:
                source = self._path(f"{state}/{relative}")
                if source.suffix.lower() not in IMAGE_TYPES or UNSAFE_MANUAL_PATH.search(relative) or not source.is_file():
                    raise WorkflowError("图集文件已变动或不可读取，请刷新后重新导出。")
                archive.write(source, relative)
        for path, relative in inputs:
            with self.lock:
                archive.write(path, relative)

    def read(self, image_id, original, limit, *, state=None):
        with self.lock:
            digest = None
            if image_id and image_id.startswith("manual:"):
                current, path, _ = self._manual_lookup(image_id)
                if state is not None and state != current:
                    raise WorkflowError("图片已不在所选图集，请刷新列表。")
                if not original:
                    path = self._make_thumbnail(self._manual_thumbnail(image_id), path)
            else:
                record, index = self._lookup(image_id)
                name = record["files"][index - 1]
                for current in (state,) if state else REVIEW_STATES:
                    path = self._path(f"{current}/{record['directory']}/{name}")
                    if path.is_file():
                        break
                else:
                    raise WorkflowError("图片已移走，请刷新列表。")
                if original:
                    digest = record["digests"][name]
                else:
                    path = self._thumbnail(record, index, path)
            if path is None:
                raise WorkflowError("无法生成这张图片的缩略图。")
            with path.open("rb") as handle:
                data = handle.read(limit + 1)
            if len(data) > limit:
                raise WorkflowError("图片超过插件设置的单张大小上限。")
            if digest is not None and hashlib.sha256(data).hexdigest() != digest:
                raise WorkflowError("原图内容已变更。")
            return IMAGE_TYPES[path.suffix.lower()], data


def _controlnet_links(slot):
    if not isinstance(slot, list):
        return []
    links = []
    for link in slot:
        if not isinstance(link, dict):
            continue
        if all(isinstance(link.get(key), str) and pattern.fullmatch(link[key]) for key, pattern in (
            ("asset_id", ASSET_ID), ("branch", CONTROL_TOKEN), ("type", CONTROL_TOKEN),
        )):
            links.append({
                "asset_id": link["asset_id"], "branch": link["branch"], "type": link["type"],
                "new": link.get("new") is True,
            })
    return links


def _place_file(source, destination, digest):
    try:
        destination.hardlink_to(source)
        return
    except OSError as exc:
        if exc.errno not in {errno.EXDEV, errno.EPERM, errno.ENOTSUP, errno.EACCES}:
            raise
    # Stage the copy on the destination drive before publishing the finished file.
    with NamedTemporaryFile(dir=destination.parent, delete=False) as handle:
        temporary = Path(handle.name)
    try:
        shutil.copy2(source, temporary)
        if not _matches_digest(temporary, digest):
            raise WorkflowError("复制后的原图校验失败，请重试。")
        if os.name == "nt":
            temporary.rename(destination)  # Windows refuses to replace an existing file.
        else:
            destination.hardlink_to(temporary)
    finally:
        temporary.unlink(missing_ok=True)


def _output_relative_path(ref):
    if ref.get("type", "output") != "output":
        return None
    filename = ref["filename"]
    folder = ref.get("subfolder", "")
    if not isinstance(folder, str) or PureWindowsPath(filename).name != filename:
        return None
    path = PureWindowsPath(folder) / filename
    if path.anchor or not path.parts or any(
        part == ".." or PureWindowsPath(part).is_reserved() or re.search(r'[<>:"|?*\x00-\x1f]', part)
        for part in path.parts
    ):
        return None
    return path.as_posix()


def _file_digest(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _matches_digest(path, digest):
    return path.resolve() == path and path.is_file() and _file_digest(path) == digest
