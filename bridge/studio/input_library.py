"""Read-only navigation and raster snapshots under the local ComfyUI input root."""

import base64
import os
import re
import stat
from contextlib import ExitStack, contextmanager
from io import BytesIO
from pathlib import Path, PureWindowsPath
from urllib.parse import urlsplit

from PIL import Image, ImageOps, ImageSequence

from ..workflows.workflow import WorkflowError

INPUT_PAGE_SIZE = 50
INPUT_ID_LIMIT = 2048
IMAGE_PIXEL_LIMIT = 16_000_000
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
IMAGE_FORMATS = ("PNG", "JPEG", "WEBP", "GIF")
INVALID_COMPONENT = re.compile(r'[<>:"|?*\\\x00-\x1f\x7f\ud800-\udfff]|\[(?:input|output|temp)\]$', re.I)


class InputUnavailable(WorkflowError):
    pass


if os.name == "nt":
    import ctypes
    import msvcrt
    from ctypes import wintypes

    _GENERIC_READ = 0x80000000
    _FILE_SHARE_READ = 1
    _OPEN_EXISTING = 3
    _FILE_FLAG_BACKUP_SEMANTICS = 0x02000000
    _FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000
    _FILE_ATTRIBUTE_TAG_INFO_CLASS = 9

    class _FileAttributeTagInfo(ctypes.Structure):
        _fields_ = [("attributes", wintypes.DWORD), ("tag", wintypes.DWORD)]

    _kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    _create_file = _kernel32.CreateFileW
    _create_file.argtypes = (
        wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID,
        wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE,
    )
    _create_file.restype = wintypes.HANDLE
    _get_file_info = _kernel32.GetFileInformationByHandleEx
    _get_file_info.argtypes = (wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID, wintypes.DWORD)
    _get_file_info.restype = wintypes.BOOL
    _close_handle = _kernel32.CloseHandle
    _close_handle.argtypes = (wintypes.HANDLE,)
    _close_handle.restype = wintypes.BOOL

    def _open_windows(path, *, directory):
        # Hold each ancestor without FILE_SHARE_DELETE so it cannot be replaced mid-read.
        flags = _FILE_FLAG_OPEN_REPARSE_POINT
        if directory:
            flags |= _FILE_FLAG_BACKUP_SEMANTICS
        handle = _create_file(str(path), _GENERIC_READ, _FILE_SHARE_READ, None, _OPEN_EXISTING, flags, None)
        if handle == ctypes.c_void_p(-1).value:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            info = _FileAttributeTagInfo()
            if not _get_file_info(handle, _FILE_ATTRIBUTE_TAG_INFO_CLASS, ctypes.byref(info), ctypes.sizeof(info)):
                raise ctypes.WinError(ctypes.get_last_error())
            if (info.attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT
                    or bool(info.attributes & stat.FILE_ATTRIBUTE_DIRECTORY) != directory):
                raise WorkflowError("input 资源必须是普通文件或目录。")
        except BaseException:
            _close_handle(handle)
            raise
        return handle


def _safe_component(name):
    return (
        bool(name) and not name.endswith((".", " "))
        and not INVALID_COMPONENT.search(name) and not PureWindowsPath(name).is_reserved()
    )


def _path_parts(identity, *, allow_root=False):
    if identity == "" and allow_root:
        return ()
    if not isinstance(identity, str) or len(identity) > INPUT_ID_LIMIT:
        raise WorkflowError("input 资源标识无效。")
    parts = identity.split("/")
    if not all(_safe_component(part) for part in parts):
        raise WorkflowError("input 资源标识无效。")
    return parts


def _open_child(parent, name, stack):
    if os.name == "nt":
        path = parent / name
        stack.callback(_close_handle, _open_windows(path, directory=True))
        return path
    fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
    stack.callback(os.close, fd)
    return fd


def _open_file(parent, name):
    if os.name != "nt":
        return os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    handle = _open_windows(parent / name, directory=False)
    try:
        return msvcrt.open_osfhandle(handle, os.O_RDONLY | os.O_BINARY)
    except OSError:
        _close_handle(handle)
        raise


class InputLibrary:
    def __init__(self, service, workspace):
        self.service = service
        self.workspace = workspace

    def _configured_root(self):
        if urlsplit(self.service.client.url).hostname not in {"127.0.0.1", "::1", "localhost"}:
            raise InputUnavailable("远程 ComfyUI 未开放 input 浏览。")
        configured = self.service.config.get("comfyui_input_directory", "")
        if not isinstance(configured, str):
            raise InputUnavailable("请在插件设置中填写可读取的本机 ComfyUI input 目录。")
        configured = configured.strip()
        root = Path(configured) if configured else self.workspace / "input"
        if (
            not root.is_absolute() or len(root.parts) < 2
            or (os.name == "nt" and not re.fullmatch(r"[A-Za-z]:", root.drive))
            or not all(_safe_component(part) for part in root.parts[1:])
        ):
            raise InputUnavailable("请在插件设置中填写可读取的本机 ComfyUI input 目录。")
        return root

    @contextmanager
    def _directory(self, parts):
        root = self._configured_root()
        with ExitStack() as stack:
            try:
                if os.name == "nt":
                    directory = Path(root.anchor)
                else:
                    directory = os.open(root.anchor, os.O_RDONLY | os.O_DIRECTORY)
                    stack.callback(os.close, directory)
                for part in root.parts[1:]:
                    directory = _open_child(directory, part, stack)
            except (OSError, WorkflowError) as exc:
                raise InputUnavailable("本机 ComfyUI input 目录不可用。") from exc
            for part in parts:
                directory = _open_child(directory, part, stack)
            yield directory

    def root(self):
        root = self._configured_root()
        with self._directory(()):
            return root

    def list(self, directory, page):
        parts = _path_parts(directory, allow_root=True)
        limit = self.service.client.max_image_bytes
        entries = []
        try:
            with self._directory(parts) as parent, os.scandir(parent) as children:
                prefix = f"{directory}/" if directory else ""
                for child in children:
                    identity = prefix + child.name
                    if len(identity) > INPUT_ID_LIMIT or not _safe_component(child.name):
                        continue
                    try:
                        info = child.stat(follow_symlinks=False)
                    except FileNotFoundError:
                        continue
                    if getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT:
                        continue
                    if stat.S_ISDIR(info.st_mode):
                        kind = "directory"
                    elif stat.S_ISREG(info.st_mode):
                        kind = "file"
                        if (Path(child.name).suffix.casefold() in IMAGE_SUFFIXES
                                and 0 < info.st_size <= limit):
                            kind = "image"
                    else:
                        continue
                    entries.append({"name": child.name, "id": identity, "kind": kind})
        except OSError as exc:
            raise WorkflowError("input 目录不存在或已不可读取。") from exc
        entries.sort(key=lambda row: (row["kind"] != "directory", row["name"].casefold(), row["name"]))
        start = (page - 1) * INPUT_PAGE_SIZE
        return {
            "directory": directory, "entries": entries[start:start + INPUT_PAGE_SIZE],
            "page": page, "page_size": INPUT_PAGE_SIZE, "total": len(entries),
            "has_more": start + INPUT_PAGE_SIZE < len(entries),
        }

    def _snapshot(self, identity):
        parts = _path_parts(identity)
        if Path(parts[-1]).suffix.casefold() not in IMAGE_SUFFIXES:
            raise WorkflowError("请选择 PNG、JPEG、WebP 或 GIF 图片。")
        limit = self.service.client.max_image_bytes
        try:
            with self._directory(parts[:-1]) as parent, os.fdopen(_open_file(parent, parts[-1]), "rb") as file:
                before = os.fstat(file.fileno())
                if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
                    raise WorkflowError("input 图片必须是普通文件。")
                if not 0 < before.st_size <= limit:
                    raise WorkflowError("input 图片为空或超过单张图片大小上限。")
                data = file.read(limit + 1)
                after = os.fstat(file.fileno())
                if (
                    len(data) != before.st_size or after.st_size != before.st_size
                    or after.st_mtime_ns != before.st_mtime_ns or after.st_ctime_ns != before.st_ctime_ns
                    or after.st_nlink != 1
                ):
                    raise WorkflowError("input 图片正在修改，请刷新后重试。")
        except OSError as exc:
            raise WorkflowError("input 图片不存在或已不可读取。") from exc
        return data

    @staticmethod
    @contextmanager
    def _image(data):
        try:
            with Image.open(BytesIO(data), formats=IMAGE_FORMATS) as image:
                pixels = 0
                for frame in ImageSequence.Iterator(image):
                    pixels += frame.width * frame.height
                    if pixels > IMAGE_PIXEL_LIMIT:
                        raise WorkflowError("input 图片解码后的总像素数不能超过 1600 万。")
                    frame.load()
                image.seek(0)
                yield image
        except Image.DecompressionBombError as exc:
            raise WorkflowError("input 图片解码后的总像素数不能超过 1600 万。") from exc
        except WorkflowError:
            raise
        except (EOFError, OSError, SyntaxError, ValueError) as exc:
            raise WorkflowError("input 图片格式无效或文件已损坏。") from exc

    def read_image(self, identity):
        data = self._snapshot(identity)
        with self._image(data):
            return data

    def preview(self, identity):
        with self._image(self._snapshot(identity)) as image:
            thumbnail = ImageOps.exif_transpose(image)
            thumbnail.thumbnail((360, 360))
            mode = "RGBA" if thumbnail.has_transparency_data else "RGB"
            output = BytesIO()
            thumbnail.convert(mode).save(output, format="WEBP", quality=85)
        return f"data:image/webp;base64,{base64.b64encode(output.getvalue()).decode('ascii')}"
