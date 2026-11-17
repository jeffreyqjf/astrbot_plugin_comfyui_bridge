"""Keep ControlNet artifacts addressable while moving them between review states."""

import hashlib
import io
import json
import math
import os
import re
import stat
import time
from pathlib import Path
from tempfile import NamedTemporaryFile
from threading import Lock

from PIL import Image, ImageOps, ImageSequence

from .workflows.workflow import WorkflowError
from .workflows.workflow_store import profile_bytes

STATES = ("unevaluated", "favourite", "pass")
ASSET_ID = re.compile(r"[0-9a-f]{64}")
CONTROL_TOKEN = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}")
JOB_ID = re.compile(r"[0-9a-f]{32}")
FORMATS = {"PNG": (".png", "image/png"), "JPEG": (".jpg", "image/jpeg"),
           "WEBP": (".webp", "image/webp"), "GIF": (".gif", "image/gif")}
MAX_PIXELS = 16_000_000
MAX_RECORD = 16 * 1024


def _asset_id(job_id, branch, slot):
    return hashlib.sha256(f"{job_id}:{branch}:{slot}".encode("ascii")).hexdigest()


def _token(value):
    return isinstance(value, str) and CONTROL_TOKEN.fullmatch(value) is not None


def _valid_slot(job_id, branch, slot):
    return (isinstance(job_id, str) and JOB_ID.fullmatch(job_id)
            and _token(branch) and type(slot) is int and 0 <= slot <= 2**31 - 1)


def _label(value):
    if not isinstance(value, str):
        return ""
    leaf = re.split(r"[?#]", value, maxsplit=1)[0].replace("\\", "/").rsplit("/", 1)[-1]
    leaf = leaf.rsplit(":", 1)[-1]
    return "".join(char for char in leaf if char.isprintable())[:128].strip()


def _public(row):
    preprocessor = row.get("preprocessor")
    if isinstance(preprocessor, dict):
        preprocessor = preprocessor.get("name")
    source_kind = row.get("source_kind")
    return {
        "asset_id": row["asset_id"], "state": row["state"], "branch": row["branch"], "type": row["type"],
        "job_id": row["job_id"], "artifact_slot": row["artifact_slot"], "created": row["created"],
        "source_kind": source_kind if _token(source_kind) else "",
        "source_label": _label(row.get("source_label")), "preprocessor": _label(preprocessor),
    }


def _identity(info):
    return [info.st_dev, info.st_ino, info.st_mtime_ns, info.st_size, info.st_nlink]


def _direct_stat(path):
    """Verify every ancestor before accessing a managed path."""
    for parent in reversed(path.parents):
        info = parent.lstat()
        if _redirected(info) or not stat.S_ISDIR(info.st_mode):
            raise WorkflowError("控制图路径经过重定向或无效目录。")
    info = path.lstat()
    if _redirected(info):
        raise WorkflowError("控制图路径经过重定向。")
    return info


def _redirected(info):
    return (stat.S_ISLNK(info.st_mode)
            or getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT)


def _file_stat(path):
    info = _direct_stat(path)
    if not stat.S_ISREG(info.st_mode) or info.st_nlink > 1:
        raise WorkflowError("控制图位置不是独立的普通文件。")
    return info


def _ensure_directory(path):
    try:
        info = _direct_stat(path)
    except FileNotFoundError:
        _ensure_directory(path.parent)
        path.mkdir(exist_ok=True)
        info = _direct_stat(path)
    if not stat.S_ISDIR(info.st_mode):
        raise WorkflowError("控制图归档位置不是目录。")


def _read_file(path, limit):
    identity = _identity(_file_stat(path))
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    with os.fdopen(os.open(path, flags), "rb") as stream:
        if _identity(os.fstat(stream.fileno())) != identity or _identity(_file_stat(path)) != identity:
            raise WorkflowError("读取时控制图文件位置已变更。")
        data = stream.read(limit + 1)
        if _identity(os.fstat(stream.fileno())) != identity or _identity(_file_stat(path)) != identity:
            raise WorkflowError("读取时控制图文件内容已变更。")
    if len(data) > limit:
        raise WorkflowError("控制图超过大小上限。")
    return data, identity


def _digest(data):
    return hashlib.sha256(data).hexdigest()


def _publish(path, data, *, replace=False):
    """Publish a verified sibling temporary file."""
    parent = _direct_stat(path.parent)
    temporary = None
    try:
        with NamedTemporaryFile(dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        staged, _ = _read_file(temporary, len(data))
        if _digest(staged) != _digest(data):
            raise WorkflowError("控制图写入后校验失败。")
        if not os.path.samestat(parent, _direct_stat(path.parent)):
            raise WorkflowError("写入时控制图目录位置已变更。")
        if replace:
            _file_stat(path)
            temporary.replace(path)
        elif os.name == "nt":
            temporary.rename(path)
        else:
            path.hardlink_to(temporary)
    finally:
        if temporary is not None and os.path.samestat(parent, _direct_stat(path.parent)):
            temporary.unlink(missing_ok=True)


def _image_format(data):
    try:
        with Image.open(io.BytesIO(data), formats=tuple(FORMATS)) as image:
            pixels = 0
            for frame in ImageSequence.Iterator(image):
                pixels += frame.width * frame.height
                if pixels > MAX_PIXELS:
                    raise WorkflowError("控制图的总像素超过上限。")
                frame.load()
            return image.format
    except (OSError, ValueError, Image.DecompressionBombError) as exc:
        raise WorkflowError("控制图必须是可解码的 PNG、JPEG、WebP 或 GIF。") from exc


class ControlNetArchive:
    """A local index and its media, accessed by artifact ID."""

    lock = Lock()

    def __init__(self, input_root, data_dir, max_image_bytes=20 * 1024 * 1024):
        self.input_root = Path(input_root).absolute()
        self.index = Path(data_dir).absolute() / "controlnet_assets"
        if ".." in self.input_root.parts or ".." in self.index.parts:
            raise WorkflowError("控制图归档根路径无效。")
        if type(max_image_bytes) is not int or max_image_bytes < 1:
            raise ValueError("max_image_bytes must be a positive integer")
        self.limit = max_image_bytes

    def _index_path(self, asset_id):
        return self.index / f"{asset_id}.json"

    def _media(self, row, state=None):
        suffix = FORMATS[row["format"]][0]
        return self.input_root / "my_input" / (state or row["state"]) / f"{row['asset_id']}{suffix}"

    def _record(self, asset_id):
        if not isinstance(asset_id, str) or not ASSET_ID.fullmatch(asset_id):
            raise WorkflowError("控制图 ID 无效。")
        try:
            raw, _ = _read_file(self._index_path(asset_id), MAX_RECORD)
            row = json.loads(raw)
        except FileNotFoundError:
            return None
        except (ValueError, RecursionError) as exc:
            raise WorkflowError("控制图归档记录无效。") from exc
        if not (isinstance(row, dict) and row.get("asset_id") == asset_id
                and _valid_slot(row.get("job_id"), row.get("branch"), row.get("artifact_slot"))
                and _asset_id(row["job_id"], row["branch"], row["artifact_slot"]) == asset_id
                and _token(row.get("type")) and row.get("state") in STATES
                and isinstance(row.get("format"), str) and row["format"] in FORMATS
                and isinstance(row.get("sha256"), str) and ASSET_ID.fullmatch(row["sha256"])
                and type(row.get("created")) in (int, float) and 0 <= row["created"] < math.inf):
            raise WorkflowError("控制图归档记录无效。")
        return row

    def _lookup(self, asset_id):
        row = self._record(asset_id)
        if row is None:
            raise WorkflowError("控制图归档记录不存在。")
        try:
            _file_stat(self._media(row))
        except FileNotFoundError as exc:
            raise WorkflowError("控制图文件已缺失。") from exc
        return row

    def _read_media(self, row, path):
        data, identity = _read_file(path, self.limit)
        if _digest(data) != row["sha256"]:
            raise WorkflowError("控制图内容已变更。")
        return data, identity

    def _publish_media(self, row, path, data):
        if not stat.S_ISDIR(_direct_stat(self.input_root).st_mode):
            raise WorkflowError("ComfyUI input 目录不可用。")
        _ensure_directory(path.parent)
        try:
            _publish(path, data)
        except FileExistsError:
            # A retry can complete an index write after its media was published.
            self._read_media(row, path)

    def record(self, job_id, branch, artifact_slot, data, *, control_type, source_kind="",
               source_label="", source_sha256=None, preprocessor=None):
        if not _valid_slot(job_id, branch, artifact_slot) or not _token(control_type):
            raise WorkflowError("控制图任务、分支、产物槽或类型无效。")
        if not isinstance(data, bytes) or not 0 < len(data) <= self.limit:
            raise WorkflowError("控制图超过大小上限或内容为空。")
        if source_sha256 is not None and (
            not isinstance(source_sha256, str) or not ASSET_ID.fullmatch(source_sha256)
        ):
            raise WorkflowError("控制图来源摘要无效。")
        image_format = _image_format(data)
        asset_id = _asset_id(job_id, branch, artifact_slot)
        row = {
            "asset_id": asset_id, "job_id": job_id, "branch": branch, "artifact_slot": artifact_slot,
            "type": control_type, "state": STATES[0], "created": time.time(), "format": image_format,
            "sha256": _digest(data), "source_kind": source_kind if _token(source_kind) else "",
            "source_label": _label(source_label), "source_sha256": source_sha256, "preprocessor": preprocessor,
        }
        try:
            raw = profile_bytes(row)
        except (TypeError, ValueError, RecursionError) as exc:
            raise WorkflowError("控制图预处理参数无效。") from exc
        if len(raw) > MAX_RECORD - 512:
            raise WorkflowError("控制图归档记录超过大小上限。")

        with self.lock:
            existing = self._record(asset_id)
            if existing is not None:
                if existing["sha256"] != row["sha256"] or existing["type"] != row["type"]:
                    raise WorkflowError("控制图产物槽已归档不同的内容。")
                self._read_media(existing, self._media(existing))
                return _public(existing)
            _ensure_directory(self.index)
            media = self._media(row)
            for suffix, _ in FORMATS.values():
                if suffix != media.suffix:
                    try:
                        _file_stat(media.with_suffix(suffix))
                    except FileNotFoundError:
                        continue
                    raise WorkflowError("控制图产物槽已存在不同格式的文件。")
            self._publish_media(row, media, data)
            _publish(self._index_path(asset_id), raw)
            return _public(row)

    def lookup(self, asset_id):
        with self.lock:
            return _public(self._lookup(asset_id))

    def read(self, asset_id, *, original=False):
        with self.lock:
            row = self._lookup(asset_id)
            data, _ = self._read_media(row, self._media(row))
        if original:
            return FORMATS[row["format"]][1], data
        with Image.open(io.BytesIO(data), formats=(row["format"],)) as image:
            preview = ImageOps.exif_transpose(image)
            preview.thumbnail((384, 384), Image.Resampling.LANCZOS)
            preview.info.clear()
            with io.BytesIO() as output:
                preview.save(output, "WEBP", quality=78)
                return "image/webp", output.getvalue()

    def list(self, state, page=1, size=24):
        if state not in STATES or type(page) is not int or page < 1 or type(size) is not int or not 1 <= size <= 100:
            raise WorkflowError("控制图状态或页码无效。")
        with self.lock:
            rows = list(self._gallery_rows(state))
            rows.sort(key=lambda row: (-row["created"], row["asset_id"]))
            start = (page - 1) * size
            end = start + size
            return {"assets": [_public(row) for row in rows[start:end]], "total": len(rows),
                    "page": page, "page_size": size, "has_more": len(rows) > end}

    def _gallery_rows(self, state):
        try:
            info = _direct_stat(self.index)
        except FileNotFoundError:
            return
        if not stat.S_ISDIR(info.st_mode):
            raise WorkflowError("控制图归档位置不是目录。")
        for path in self.index.iterdir():
            if path.suffix != ".json" or not ASSET_ID.fullmatch(path.stem):
                continue
            try:
                row = self._record(path.stem)
                if row is not None and row["state"] == state:
                    _file_stat(self._media(row))
                    yield row
            except (OSError, WorkflowError):
                continue

    def write_gallery_zip(self, state, archive):
        if state not in STATES:
            raise WorkflowError("请选择有效的控制图状态。")
        with self.lock:
            rows = list(self._gallery_rows(state))
        for row in rows:
            with self.lock:
                current = self._lookup(row["asset_id"])
                if current["state"] != state:
                    raise WorkflowError("控制图集已有变动，请刷新后重新导出。")
                path = self._media(current)
                data, _ = self._read_media(current, path)
            archive.writestr(path.name, data)

    def _write_record(self, row):
        _publish(self._index_path(row["asset_id"]), profile_bytes(row), replace=True)

    def _complete_move(self, row):
        previous = row.get("previous")
        if isinstance(previous, dict) and previous.get("state") in STATES and previous["state"] != row["state"]:
            path = self._media(row, previous["state"])
            try:
                if _identity(_file_stat(path)) == previous.get("identity"):
                    path.unlink()
            except FileNotFoundError:
                pass
            del row["previous"]
            self._write_record(row)

    def rate(self, asset_id, state):
        if state not in STATES:
            raise WorkflowError("控制图状态无效。")
        with self.lock:
            row = self._lookup(asset_id)
            source = self._media(row)
            data, identity = self._read_media(row, source)
            self._complete_move(row)
            if row["state"] != state:
                self._publish_media(row, self._media(row, state), data)
                # Keep the current copy until the new state is durable.
                row["previous"] = {"state": row["state"], "identity": identity}
                row["state"] = state
                self._write_record(row)
                self._complete_move(row)
            return _public(row)
