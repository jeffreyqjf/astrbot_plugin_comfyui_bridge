"""Explicitly confirmed model downloads, separate from the ComfyUI API session."""

import asyncio
import ipaddress
import json
import os
import shutil
import uuid
from pathlib import Path, PurePosixPath
from urllib.parse import urljoin, urlsplit

import aiohttp
import yaml
from astrbot.api.web import error_response, json_response, request


def model_roots(workspace, category):
    aliases = {"diffusion_models": ("diffusion_models", "unet"), "text_encoders": ("text_encoders", "clip")}.get(category, (category,))
    roots = [workspace / "models" / alias for alias in aliases]
    config = workspace / "extra_model_paths.yaml"
    if config.is_file():
        try:
            data = yaml.safe_load(config.read_text(encoding="utf-8")) or {}
        except yaml.YAMLError as exc:
            raise ValueError("extra_model_paths.yaml 无法解析，未检查模型。") from exc
        if not isinstance(data, dict):
            raise ValueError("extra_model_paths.yaml 格式无效，无法确认模型是否存在。")
        for entry in data.values():
            if not isinstance(entry, dict):
                continue
            base = Path(os.path.expandvars(os.path.expanduser(str(entry.get("base_path", workspace)))))
            if not base.is_absolute():
                base = workspace / base
            for alias in aliases:
                for value in str(entry.get(alias, "")).splitlines():
                    if value.strip():
                        roots.append(base / os.path.expanduser(os.path.expandvars(value.strip())))
    return list(dict.fromkeys(path.resolve() for path in roots))


def local_status(workspace, row, cache):
    category = row["folder"].split("/")[1] if row["folder"].startswith("models/") else None
    roots = model_roots(workspace, category) if category else [workspace / row["folder"]]
    name = PurePosixPath(row["name"]).name
    if name == "rife49":
        name += ".pth"
    matches = []
    for root in roots:
        if root not in cache:
            files = {}
            for directory, directories, filenames in os.walk(root, followlinks=False):
                directories[:] = [name for name in directories if not (Path(directory) / name).is_symlink()
                                  and not getattr(Path(directory) / name, "is_junction", lambda: False)()]
                for filename in filenames:
                    path = Path(directory) / filename
                    if not path.is_symlink() and path.is_file() and path.stat().st_size:
                        files.setdefault(filename.casefold(), []).append(str(path))
            cache[root] = files
        matches.extend(cache[root].get(name.casefold(), []))
    if category == "pixai_tagger":
        matches = [str(path.parent) for root in roots for path in root.glob(f"**/{name}/model.safetensors")
                   if path.is_file() and path.stat().st_size and (path.parent / "config.json").is_file()]
    elif category == "vosr2":
        matches = [str(path.parent) for root in roots for path in root.glob(f"**/{name}/dinov2_vitl14.safetensors")
                   if (path.parent / "Qwen-Image-vae-2d/config.json").is_file()
                   and (path.parent / "Qwen-Image-vae-2d/diffusion_pytorch_model.safetensors").is_file()
                   and any((path.parent / item).is_file() for item in ("checkpoints/ema_model.safetensors", "clean_weights/ema_model.safetensors", "ema_model.safetensors"))]
    return {"installed": bool(matches), "locations": sorted(set(matches)), "local_checked": True}


def destination(workspace, folder, name):
    relative = PurePosixPath(folder) / PurePosixPath(name).name
    if not folder.startswith("models/") or relative.is_absolute() or ".." in relative.parts or any(":" in part or "\\" in part for part in relative.parts):
        raise ValueError("模型下载目录无效。")
    target = workspace / relative
    if target.resolve() != target or not target.is_relative_to(workspace / "models"):
        raise ValueError("模型目录含链接或越界，无法下载。")
    return target


def allowed_url(url):
    parts = urlsplit(url)
    host = parts.hostname or ""
    if parts.scheme != "https" or parts.username or parts.password or parts.port not in (None, 443) or not (
        host in {"huggingface.co", "github.com"} or host.endswith((".huggingface.co", ".hf.co", ".githubusercontent.com"))
    ):
        raise ValueError("下载地址不在已核对的模型分发站点内。")
    return url


class PublicResolver(aiohttp.resolver.DefaultResolver):
    async def resolve(self, host, port=0, family=0):
        records = await super().resolve(host, port, family)
        if any(not ipaddress.ip_address(row["host"]).is_global for row in records):
            raise ValueError("下载站点不能解析到本地或内部地址。")
        return records


class ModelDownloads:
    def __init__(self, studio):
        self.studio = studio
        self.jobs = {}
        self.tasks = {}
        self.lock = asyncio.Lock()
        self.closing = False

    async def close(self):
        self.closing = True
        for task in self.tasks.values():
            task.cancel()
        await asyncio.gather(*self.tasks.values(), return_exceptions=True)

    async def api(self):
        if not request.username:
            return error_response("请登录 AstrBot 面板。", status_code=401)
        owner = request.username
        if request.method == "GET":
            return json_response({"jobs": [job for job in self.jobs.values() if job["owner"] == owner]})
        try:
            if self.closing:
                raise ValueError("插件正在关闭，无法开始新下载。")
            body = await request.body()
            if len(body) > 4096:
                raise ValueError("下载请求过大。")
            data = json.loads(body)
            if data.get("action") == "cancel":
                job = self.jobs.get(data.get("id"))
                if not job or job["owner"] != owner:
                    raise ValueError("未找到当前用户的下载任务。")
                if job["state"] in {"queued", "downloading"}:
                    self.tasks[job["id"]].cancel()
                    await asyncio.gather(self.tasks[job["id"]], return_exceptions=True)
                    if job["state"] != "completed":
                        job["state"] = "cancelled"
                return json_response(job)
            if data.get("confirmed") is not True:
                raise ValueError("请先确认模型文件、下载来源和保存目录。")
            from .model_catalog import catalog_data
            catalog = await catalog_data(self.studio.service, self.studio.anima)
            row = next((row for wf in catalog["workflows"] if wf["name"] == data.get("workflow")
                        for row in wf["models"] if row["name"] == data.get("name") and row["folder"] == data.get("folder")), None)
            if not row or not row.get("download_url"):
                raise ValueError("此模型没有已核对的直链，请打开发布页下载。")
            if not row.get("local_checked"):
                raise ValueError("未能确认本机文件状态，请先刷新或打开发布页。")
            if row["installed"]:
                raise ValueError("模型已存在（可能位于子文件夹），请勿重复下载。")
            workspace = self.studio.anima.workspace.resolve()
            if not (workspace / "folder_paths.py").is_file() or not (workspace / "models").is_dir():
                raise ValueError("未确认本机 ComfyUI 目录，请使用发布页下载。")
            target = destination(workspace, row["folder"], row["name"])
            url = allowed_url(row["download_url"])
            async with self.lock:
                if any(job["state"] in {"queued", "downloading"} for job in self.jobs.values()):
                    raise ValueError("已有模型正在下载，请完成或取消后再试。")
                identity = uuid.uuid4().hex
                job = {"id": identity, "owner": owner, "name": row["name"], "destination": str(target),
                       "state": "queued", "received": 0, "total": None, "error": ""}
                # Bound completed history without dropping active tasks.
                for old in list(self.jobs)[:-19]:
                    self.jobs.pop(old, None)
                    self.tasks.pop(old, None)
                self.jobs[identity] = job
                self.tasks[identity] = asyncio.create_task(self.run(job, target, url))
                return json_response(job)
        except (OSError, ValueError, KeyError, TypeError, StopIteration, AttributeError, yaml.YAMLError) as exc:
            return error_response(str(exc), status_code=400)

    async def run(self, job, target, url):
        partial = target.with_name(f".{target.name}.{job['id']}.part")
        try:
            job["state"] = "downloading"
            if target.resolve() != target:
                raise ValueError("目标目录已变化，未下载模型。")
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.resolve() != target or partial.resolve() != partial or target.exists():
                raise ValueError("目标已存在或目录已变化，未覆盖文件。")
            timeout = aiohttp.ClientTimeout(total=None, sock_connect=30, sock_read=90)
            async with aiohttp.ClientSession(timeout=timeout, connector=aiohttp.TCPConnector(resolver=PublicResolver()), trust_env=False, auto_decompress=False) as session:
                for _ in range(8):
                    async with session.get(allowed_url(url), allow_redirects=False, headers={"Accept-Encoding": "identity"}) as response:
                        if response.status in {301, 302, 303, 307, 308}:
                            url = urljoin(url, response.headers.get("Location", ""))
                            continue
                        response.raise_for_status()
                        if response.headers.get("Content-Encoding", "identity").lower() != "identity":
                            raise ValueError("下载响应采用了额外压缩，请改用发布页。")
                        if any(value in response.headers.get("Content-Type", "").lower() for value in ("text/", "json", "html")):
                            raise ValueError("下载站返回了网页或错误信息，请改用打开发布页。")
                        job["total"] = response.content_length
                        if job["total"] and job["total"] > shutil.disk_usage(target.parent).free - 1024**3:
                            raise ValueError("磁盘空间不足，已停止下载。")
                        with partial.open("xb") as handle:
                            async for chunk in response.content.iter_chunked(1024 * 1024):
                                if job["received"] == 0 and chunk.lstrip().lower().startswith((b"<!doctype", b"<html", b"<?xml", b'{"error"')):
                                    raise ValueError("下载站返回错误页面，未保存为模型。")
                                handle.write(chunk)
                                job["received"] += len(chunk)
                                if job["received"] > 200 * 1024**3:
                                    raise ValueError("模型超过单文件 200 GiB 下载上限。")
                        if not job["received"] or (job["total"] is not None and job["received"] != job["total"]):
                            raise ValueError("下载内容不完整。")
                        if target.resolve() != target or partial.resolve() != partial:
                            raise ValueError("目标目录已变化，未保存模型。")
                        os.link(partial, target)  # Exclusive publication; never replace an existing model.
                        job["state"] = "completed"
                        break
                else:
                    raise ValueError("下载重定向过多，请打开发布页。")
        except asyncio.CancelledError:
            job["state"] = "cancelled"
        except asyncio.TimeoutError:
            job.update(state="failed", error="下载连接超时，请重试或打开发布页。")
        except aiohttp.ClientResponseError as exc:
            job.update(state="failed", error=f"下载站返回 HTTP {exc.status}，请打开发布页检查访问权限。")
        except (OSError, ValueError, aiohttp.ClientError) as exc:
            job.update(state="failed", error=str(exc))
        finally:
            try:
                if partial.resolve() == partial:
                    partial.unlink(missing_ok=True)
                else:
                    job["error"] = "临时目录已变化，未自动清理，请检查原始目录。"
            except OSError:
                job["error"] = "临时文件清理失败，请检查目标目录权限。"
