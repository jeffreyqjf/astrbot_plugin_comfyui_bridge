"""List and resolve generated videos from the ComfyUI and AstrBot output folders."""

from pathlib import PureWindowsPath
from stat import S_ISREG

from .client import VIDEO_MIME, video_suffix
from .image_archive import _output_relative_path
from .workflows.workflow import VIDEO_FOLDER, WorkflowError

PAGE_SIZE = 24


class VideoLibrary:
    def __init__(self, output_dir, local_output):
        self.cache_dir = output_dir.resolve() / VIDEO_FOLDER
        self.directories = {"cache": self.cache_dir}
        if local_output is not None:
            output = local_output.resolve()
            self.directories.update({"comfyui": output / VIDEO_FOLDER, "legacy": output / "video"})

    def cache(self):
        if self.cache_dir.resolve() != self.cache_dir:
            raise WorkflowError("视频目录必须位于插件输出目录内。")
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        return self.cache_dir

    def original(self, ref):
        root = self.directories.get("comfyui")
        relative = _output_relative_path(ref)
        if root is None or not relative:
            return None
        parts = relative.split("/")
        if len(parts) != 2 or parts[0] != VIDEO_FOLDER:
            return None
        try:
            return self.file("comfyui", parts[1])
        except (OSError, ValueError):
            return None

    def file(self, source, filename, version=None):
        if (
            not isinstance(source, str) or source not in self.directories
            or not isinstance(filename, str) or len(filename) > 255
            or PureWindowsPath(filename).name != filename or PureWindowsPath(filename).is_reserved()
            or any(ord(char) < 32 or char in '<>:"/\\|?*' for char in filename)
        ):
            raise WorkflowError("视频路径无效。")
        path = self.directories[source] / filename
        suffix = path.suffix.lower()
        if suffix not in VIDEO_MIME or path.is_symlink() or path.resolve() != path:
            raise WorkflowError("视频路径无效。")
        stat = path.stat()
        if not S_ISREG(stat.st_mode) or (version is not None and version != self._version(stat)):
            raise WorkflowError("视频已发生变化，请刷新列表。")
        with path.open("rb") as stream:
            if video_suffix(stream.read(64), suffix) != suffix:
                raise WorkflowError("无法识别视频格式。")
        return path

    @staticmethod
    def _version(stat):
        return f"{stat.st_mtime_ns:x}-{stat.st_size:x}-{stat.st_ino:x}"

    def list(self, page):
        rows = []
        for source, root in self.directories.items():
            if root.resolve() != root or not root.is_dir():
                continue
            for path in root.iterdir():
                if path.suffix.lower() not in VIDEO_MIME or path.is_symlink():
                    continue
                try:
                    stat = path.stat()
                except FileNotFoundError:
                    continue
                if not S_ISREG(stat.st_mode) or not stat.st_size:
                    continue
                rows.append({
                    "source": source, "name": path.name, "size": stat.st_size,
                    "modified": stat.st_mtime, "version": self._version(stat),
                })
        rows.sort(key=lambda row: (-row["modified"], row["name"], row["source"]))
        pages = max(1, (len(rows) + PAGE_SIZE - 1) // PAGE_SIZE)
        page = min(page, pages)
        return {"videos": rows[(page - 1) * PAGE_SIZE:page * PAGE_SIZE], "page": page, "pages": pages}

    def delete(self, source, filename, version):
        self.file(source, filename, version).unlink()
