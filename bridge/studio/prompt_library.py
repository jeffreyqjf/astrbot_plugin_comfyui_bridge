"""Read an external prompt library and local supplements."""

import base64
import csv
import hashlib
import io
import json
import re
import zipfile
from pathlib import Path, PurePosixPath
from threading import Lock

from PIL import Image, ImageOps

from .. import PACKAGE_ROOT

DEFAULT_DIRECTORY = PACKAGE_ROOT.parent / "prompt_library"
LEGACY_DIRECTORY = PACKAGE_ROOT / "prompt_library"
IMAGE_TYPES = {".jpg", ".jpeg", ".png", ".webp"}
FILE_LIMIT = 16 * 1024 * 1024
PAGE_SIZE = 30
WINDOWS_CHARS = {f"0x{ord(c):04x}": c for c in '<>:"/\\|?*'}


def tag_key(value):
    return " ".join(value.casefold().replace("_", " ").split())


def read_file(path):
    if isinstance(path, Path) and path.resolve() != path:
        raise ValueError("不支持链接文件。")
    with path.open("rb") as source:
        data = source.read(FILE_LIMIT + 1)
    if len(data) > FILE_LIMIT:
        raise ValueError("单个词库文件超过 16 MB。")
    return data


def entries(folder):
    if isinstance(folder, Path) and folder.resolve() != folder:
        return []
    if not folder.is_dir():
        return []
    return sorted(
        (p for p in folder.iterdir() if p.name not in {".", ".."}
         and (not isinstance(p, Path) or p.resolve() == p)),
        key=lambda p: p.name.casefold(),
    )


def entry_name(path):
    name = path.name
    if isinstance(path, zipfile.Path) and not path.root.getinfo(path.at).flag_bits & 0x800:
        # Older Chinese ZIP tools wrote GBK names without a UTF-8 flag.
        try:
            name = name.encode("cp437").decode("gb18030")
        except UnicodeError:
            pass
    return PurePosixPath(name)


def magibook_tags(text):
    for raw in text.splitlines():
        line = raw.split("//", 1)[0].strip()
        if line.startswith(("#", ":", "<")):
            color = re.match(r"#[0-9a-fA-F]{6}:(.+)", line)
            if color is None:
                continue
            line = color[1]
        label, sep, prompt = line.partition("=")
        if sep:
            # The workbench inserts a literal prompt, so use the uncolored base tag.
            prompt = re.sub(r"<color\??>\s*", "", prompt).strip()
            if prompt and label.strip():
                yield prompt, label.strip()


class _Catalog:
    def __init__(self):
        self.groups = {}
        self.rows = []
        self.previews = {}
        self.warnings = []
        self.library_directory = ""
        self._seen = set()

    def load_directory(self, root, *, primary=False):
        try:
            if not root.is_dir():
                raise ValueError("目录不存在或不可访问。")
            paths = entries(root)
        except (OSError, ValueError, RuntimeError) as exc:
            self.warnings.append(f"{root}：{exc}")
            return
        folders = {"dict", "dictnsfw", "preview"}
        if any(path.is_dir() and path.name in {"dict", "dictnsfw"} for path in paths):
            paths = [root, *(path for path in paths if path.name not in folders)]
        for path in paths:
            if not (path.is_dir() or path.suffix.lower() in {".json", ".csv", ".zip"}):
                continue
            try:
                self.load(path)
            except (OSError, ValueError, zipfile.BadZipFile, RuntimeError, csv.Error) as exc:
                self.warnings.append(f"{path.name}：{exc}")
        if primary and not self.rows and not self.warnings:
            self.warnings.append(f"{root}：未找到词条，请检查目录结构。")

    def add_tags(self, group, title, tags):
        for en, zh in tags:
            key = tag_key(en)
            signature = (group, key, zh)
            if not key or signature in self._seen:
                continue
            self._seen.add(signature)
            self.groups.setdefault(group, title)
            self.rows.append((group, en, zh, key, f"{key} {tag_key(zh)}"))

    def magibook(self, root, archive=None):
        found = False
        for folder, prefix in (("dict", "Prompt_Lib"), ("dictnsfw", "Prompt_Lib · 特殊")):
            for path in entries(root / folder):
                if not path.is_file():
                    continue
                name = entry_name(path)
                if name.suffix.lower() == ".txt":
                    tags = list(magibook_tags(read_file(path).decode("utf-8-sig")))
                    self.add_tags(f"{folder}/{name.stem}", f"{prefix} · {name.stem}", tags)
                    found |= bool(tags)
        for path in entries(root / "preview"):
            if not path.is_file():
                continue
            name = entry_name(path)
            if name.suffix.lower() not in IMAGE_TYPES:
                continue
            stem = re.sub(r"0x[0-9a-f]{4}", lambda m: WINDOWS_CHARS.get(m[0].lower(), m[0]),
                          name.stem, flags=re.I)
            self.previews.setdefault(tag_key(stem), (archive, path.at if archive else path))
        return found

    def load(self, path):
        if path.is_dir():
            if not self.magibook(path):
                raise ValueError("没有找到 dict 或 dictnsfw 词条。")
        elif path.suffix.lower() == ".zip":
            with zipfile.ZipFile(path) as archive:
                root = zipfile.Path(archive)
                found = self.magibook(root, path)
                for folder in entries(root):
                    if folder.is_dir() and folder.name not in {"dict", "dictnsfw", "preview"}:
                        found |= self.magibook(folder, path)
                if not found:
                    raise ValueError("ZIP 内没有找到 dict 或 dictnsfw 词条。")
        elif path.suffix.lower() == ".csv":
            data = read_file(path).decode("utf-8-sig")
            tags = [(row[0], row[3]) for row in csv.reader(io.StringIO(data)) if len(row) >= 4]
            if not tags:
                raise ValueError("CSV 需要四列：英文标签、分类、数量、中文。")
            self.add_tags(f"csv/{path.stem}", path.stem, tags)
        else:
            groups = json.loads(read_file(path))
            if not isinstance(groups, list):
                raise ValueError("JSON 需要由 id、title、tags 组成的分类列表。")
            for group in groups:
                if (
                    not isinstance(group, dict)
                    or not all(isinstance(group.get(key), str) for key in ("id", "title"))
                    or not isinstance(group.get("tags"), list)
                    or not all(isinstance(row, list) and len(row) == 2
                               and all(isinstance(value, str) for value in row)
                               for row in group["tags"])
                ):
                    raise ValueError("JSON 词条须为 [英文, 中文]。")
                self.add_tags(group["id"], group["title"], group["tags"])


class PromptLibrary:
    def __init__(self, data_dir, source_directory=""):
        self.directory = data_dir.resolve() / "prompt_library"
        self.source_directory = str(source_directory or "").strip()
        self._lock = Lock()
        self._catalog = None

    def _source_path(self):
        if self.source_directory:
            return (PACKAGE_ROOT / Path(self.source_directory).expanduser()).resolve()
        if not DEFAULT_DIRECTORY.exists() and LEGACY_DIRECTORY.is_dir():
            return LEGACY_DIRECTORY
        return DEFAULT_DIRECTORY

    def _read(self, reload=False):
        with self._lock:
            if self._catalog is not None and not reload:
                return self._catalog
            self.directory.mkdir(exist_ok=True)
            catalog = _Catalog()
            try:
                source = self._source_path()
            except (OSError, ValueError, RuntimeError) as exc:
                source = None
                catalog.library_directory = self.source_directory
                catalog.warnings.append(f"词库路径无效：{exc}")
            else:
                catalog.library_directory = str(source)
                catalog.load_directory(source, primary=True)
            if source != self.directory:
                catalog.load_directory(self.directory)
            # Preview ids are derived from known tags, never from a user-supplied file path.
            catalog.previews = {
                key: (hashlib.sha256(key.encode("utf-8")).hexdigest(), file)
                for key, file in catalog.previews.items()
            }
            catalog.preview_files = {ident: file for ident, file in catalog.previews.values()}
            catalog._seen.clear()
            self._catalog = catalog
            return catalog

    def search(self, query, group, offset, reload=False):
        catalog = self._read(reload)
        terms = tag_key(query).split()
        matches = []
        seen = set()
        for category, en, zh, key, searchable in catalog.rows:
            if (group and group != category) or key in seen:
                continue
            if terms and not all(term in searchable for term in terms):
                continue
            seen.add(key)
            if offset < len(seen) <= offset + PAGE_SIZE:
                preview = catalog.previews.get(key)
                matches.append({"en": en, "zh": zh, "preview": preview[0] if preview else None})
        return {
            "groups": [{"id": ident, "title": title} for ident, title in catalog.groups.items()],
            "tags": matches,
            "total": len(seen),
            "library_directory": catalog.library_directory,
            "directory": str(self.directory),
            "warnings": catalog.warnings,
        }

    def preview(self, ident):
        file = self._read().preview_files.get(ident)
        if file is None:
            raise ValueError("这个词条没有示例图。")
        archive, path = file
        try:
            if archive is None:
                data = read_file(path)
            else:
                if archive.resolve() != archive:
                    raise ValueError("不支持链接文件。")
                with zipfile.ZipFile(archive) as source:
                    data = read_file(zipfile.Path(source, path))
            with Image.open(io.BytesIO(data), formats=("JPEG", "PNG", "WEBP")) as original:
                if original.width * original.height > 16_000_000:
                    raise ValueError("示例图尺寸过大。")
                image = ImageOps.exif_transpose(original)
                image.thumbnail((360, 360))
                output = io.BytesIO()
                image.convert("RGB").save(output, "WEBP", quality=80)
        except (OSError, ValueError, zipfile.BadZipFile, RuntimeError, Image.DecompressionBombError):
            raise ValueError("示例图无法读取，请检查词库文件并重新读取。") from None
        return f"data:image/webp;base64,{base64.b64encode(output.getvalue()).decode('ascii')}"
