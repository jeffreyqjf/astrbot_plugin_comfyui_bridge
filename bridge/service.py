"""Bounded jobs, per-user workflow selection and persistent plugin data."""

import asyncio
import hashlib
import json
import logging
import re
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

from .client import VIDEO_MIME, ComfyCancelled, ComfyClient, ComfyError, output_refs
from .image_archive import DEFAULT_ARCHIVE, ImageArchive, ImageFavorites, ImageReviews, folder_name
from .video_library import VideoLibrary
from .workflows.anima_aio import AIO_MAPPING, AIO_WORKFLOW
from .workflows.workflow import (
    ANIMA_WORKFLOW,
    SDXL_WORKFLOW,
    WAI_MAPPING,
    WAI_WORKFLOW,
    Workflow,
    WorkflowError,
    image_loras,
)
from .workflows.workflow_store import (
    WORKFLOW_ALIASES,
    WORKFLOW_SHORT_NAMES,
    atomic_write,
    initialize_workflows,
    load_workflows,
    profile_bytes,
    renamed_keys,
)

PLUGIN_NAME = "astrbot_plugin_comfyui_bridge"
JOB_RETENTION_SECONDS = 3600
JOB_ID_PREFIX_LENGTH = 8
GENERATION_TIMEOUT_MIN = 5
IMAGE_TIMEOUT_DEFAULT = 500
VIDEO_TIMEOUT_DEFAULT = 1500
IMAGE_TIMEOUT_MAX = 3600
VIDEO_TIMEOUT_MAX = 7200
QUEUE_LIMIT_MAX = 128
ANIMA_MAPPING = {
    "positive": ["504.text"], "negative": ["507.text"], "seed": ["50.seed"],
    "image": [], "optional_image": ["21.image", "129.image"],
}
CACHE_FILE = re.compile(r"comfy_[0-9a-f]{32}\.[a-z0-9]+", re.I)


def number(config, key, default, minimum, maximum):
    try:
        return max(minimum, min(maximum, int(config.get(key, default))))
    except (TypeError, ValueError):
        return default


@dataclass
class Job:
    id: str
    owner: str
    workflow: str
    seed: int | None
    kind: str = "text_to_image"
    task: asyncio.Task | None = None
    prompt_id: str = ""
    submission_done: asyncio.Event = field(default_factory=asyncio.Event)
    state: str = "queued"
    error: str = ""
    paths: list[Path] = field(default_factory=list)
    image_count: int = 0
    sent_count: int = 0
    delivery_state: str = "waiting"
    delivery_error: str = ""
    delivery_task: asyncio.Task | None = None
    finished: float | None = None
    delivery_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    qq_parameters: tuple[str, ...] = ()
    timeout_seconds: int = IMAGE_TIMEOUT_DEFAULT
    preset: dict | None = None

    @property
    def short_id(self):
        return self.id[:JOB_ID_PREFIX_LENGTH]

    @property
    def delivered(self):
        return self.delivery_state == "sent"


class ComfyService:
    def __init__(self, config, data_dir, bundled_dir):
        self.config = config
        self.data_dir = Path(data_dir)
        self.bundled_dir = Path(bundled_dir)
        self.workflow_dir = self.data_dir / "workflows"
        self.output_dir = self.data_dir / "outputs"
        self.metadata_dir = self.data_dir / "generation_metadata"
        self.archive_path = self.data_dir / "image_archive.json"
        self.qq_timeout_path = self.data_dir / "qq_generation_timeout.json"
        self.qq_timeouts = {}
        self.workflow_aliases = {}
        self.archive = ImageArchive(DEFAULT_ARCHIVE)
        self.init_lock = asyncio.Lock()
        self.workflow_lock = asyncio.Lock()
        self.state_lock = asyncio.Lock()
        self.slots = asyncio.Semaphore(number(config, "max_concurrent", 1, 1, 4))
        self.client = ComfyClient(
            str(config.get("comfyui_url", "http://127.0.0.1:8188")),
            str(config.get("api_token", "")),
            number(config, "request_timeout", 20, 2, 120),
            number(config, "max_image_mb", 20, 1, 100),
            number(config, "max_video_mb", 100, 1, 1024),
        )
        local_output = None
        if urlsplit(self.client.url).hostname in {"127.0.0.1", "::1", "localhost"}:
            local_output = Path(config.get("anima_workspace", r"G:\ComfyUI")) / "output"
        self.favorites = ImageFavorites(
            self.data_dir, self.output_dir, local_output, str(config.get("favorites_directory") or ""),
        )
        self.image_reviews = ImageReviews(self.data_dir, self.output_dir, local_output)
        self.video_library = VideoLibrary(self.output_dir, local_output)
        self.workflows, self.errors, self.selections, self.jobs = {}, {}, {}, {}
        self.ready = False
        self.closed = False
        self.caption_pending = 0
        self.last_cleanup = 0

    async def initialize(self):
        async with self.init_lock:
            if not self.ready:
                await asyncio.to_thread(self._initialize_files)
                await self.reload()
                await asyncio.to_thread(self._load_qq_timeouts)
                self.ready = True

    def _initialize_files(self):
        initialize_workflows(self.workflow_dir, self.bundled_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.image_reviews.initialize()
        if self.archive_path.is_file():
            self.archive = ImageArchive(json.loads(self.archive_path.read_bytes()))
        aliases_path = self.data_dir / "workflow_aliases.json"
        if aliases_path.is_file() and not aliases_path.is_symlink():
            try:
                aliases = json.loads(aliases_path.read_bytes())
                if isinstance(aliases, dict):
                    self.workflow_aliases = {
                        name: alias for name, alias in aliases.items()
                        if isinstance(alias, str) and re.fullmatch(r"[a-z][a-z0-9_-]{0,31}", alias)
                    }
            except (OSError, ValueError):
                pass
        state = self.data_dir / "selections.json"
        try:
            saved = json.loads(state.read_text(encoding="utf-8"))
            if isinstance(saved, dict):
                selections = {k: v for k, v in saved.items() if isinstance(v, str)}
                self.selections = {key: WORKFLOW_ALIASES.get(value.casefold(), value) for key, value in selections.items()}
                if self.selections != selections:
                    self._save_selections(json.dumps(self.selections, ensure_ascii=False, indent=2))
        except (OSError, ValueError):
            self.selections = {}
        self._cleanup()

    def _cleanup(self):
        cutoff = time.time() - number(self.config, "output_retention_hours", 24, 1, 720) * 3600
        root = self.output_dir.resolve()
        for directory in (root, *root.iterdir()):
            # Include retired folders, but only remove files this plugin named.
            try:
                if not directory.is_dir() or directory.resolve() != directory:
                    continue
            except (OSError, RuntimeError):
                continue
            for path in directory.glob("comfy_*"):
                if directory == self.video_library.cache_dir and path.suffix.lower() in VIDEO_MIME:
                    continue
                try:
                    if (
                        CACHE_FILE.fullmatch(path.name) and path.is_file()
                        and not path.is_symlink() and path.stat().st_mtime < cutoff
                    ):
                        path.unlink()
                except OSError:
                    pass
        self.last_cleanup = time.monotonic()

    async def save_archive(self, data):
        archive = ImageArchive(data)
        async with self.state_lock:
            atomic_write(self.archive_path, profile_bytes(archive.describe()))
            self.archive = archive
        return archive.describe()

    def _load_qq_timeouts(self):
        try:
            saved = json.loads(self.qq_timeout_path.read_bytes())
        except (OSError, ValueError):
            return
        if type(saved) is int and GENERATION_TIMEOUT_MIN <= saved <= IMAGE_TIMEOUT_MAX:
            timeouts = {
                name: saved for name, workflow in self.workflows.items()
                if workflow.kind != "image_to_text"
            }
            self._write_qq_timeouts(timeouts)
            self.qq_timeouts = timeouts
        elif isinstance(saved, dict):
            timeouts = {
                name: seconds for name, seconds in renamed_keys(saved).items()
                if type(seconds) is int and GENERATION_TIMEOUT_MIN <= seconds <= VIDEO_TIMEOUT_MAX
            }
            if timeouts != saved:
                self._write_qq_timeouts(timeouts)
            self.qq_timeouts = timeouts

    def _write_qq_timeouts(self, timeouts):
        atomic_write(self.qq_timeout_path, profile_bytes(timeouts))

    def qq_timeout_for(self, workflow):
        seconds = self.qq_timeouts.get(workflow.name)
        if seconds is not None and (workflow.is_video or seconds <= IMAGE_TIMEOUT_MAX):
            return seconds
        return None

    async def save_qq_timeout(self, name, seconds):
        await self.initialize()
        async with self.state_lock:
            workflow = self.workflows.get(name) if isinstance(name, str) else None
            if workflow is None or workflow.kind == "image_to_text":
                raise WorkflowError("请选择可用的图片或视频生成工作流。")
            timeouts = self.updated_qq_timeouts(workflow, seconds)
            self._write_qq_timeouts(timeouts)
            self.qq_timeouts = timeouts

    @staticmethod
    def validate_qq_timeout(workflow, seconds):
        maximum = VIDEO_TIMEOUT_MAX if workflow.is_video else IMAGE_TIMEOUT_MAX
        if seconds is not None and (
            type(seconds) is not int or not GENERATION_TIMEOUT_MIN <= seconds <= maximum
        ):
            raise WorkflowError(f"QQ 等待超时须为 {GENERATION_TIMEOUT_MIN} 到 {maximum} 秒的整数。")

    def updated_qq_timeouts(self, workflow, seconds):
        self.validate_qq_timeout(workflow, seconds)
        timeouts = dict(self.qq_timeouts)
        if seconds is None:
            timeouts.pop(workflow.name, None)
        else:
            timeouts[workflow.name] = seconds
        return timeouts

    async def reload(self):
        async with self.workflow_lock:
            workflows, errors = await asyncio.to_thread(
                load_workflows, self.workflow_dir, self.workflow_mappings()
            )
            self.workflows, self.errors = workflows, errors

    def workflow_mappings(self):
        raw = self.config.get("node_mappings", "{}") or "{}"
        try:
            mappings = json.loads(raw) if isinstance(raw, str) else raw
        except ValueError as exc:
            raise WorkflowError("node_mappings 不是有效 JSON。") from exc
        if not isinstance(mappings, dict):
            raise WorkflowError("node_mappings 必须是 JSON 对象。")
        mappings = renamed_keys(mappings)
        anima = mappings.get(ANIMA_WORKFLOW, {})
        if not isinstance(anima, dict):
            raise WorkflowError("Anima 节点映射必须是 JSON 对象。")
        return {
            AIO_WORKFLOW: AIO_MAPPING,
            WAI_WORKFLOW: WAI_MAPPING,
            **mappings,
            ANIMA_WORKFLOW: {**ANIMA_MAPPING, **anima},
        }

    @staticmethod
    def owner(event):
        raw = json.dumps([event.unified_msg_origin, str(event.get_sender_id())], ensure_ascii=False)
        return hashlib.sha256(raw.encode()).hexdigest()

    def _match_workflow_name(self, name):
        if name in self.workflows:
            return name
        folded = name.casefold()
        alias = WORKFLOW_ALIASES.get(folded)
        if alias in self.workflows:
            return alias
        matches = [key for key in self.workflows if key.casefold() == folded]
        if matches:
            return matches[0] if len(matches) == 1 else None
        matches = [key for key, value in self.workflow_aliases.items() if value == folded and key in self.workflows]
        return matches[0] if len(matches) == 1 else None

    def workflow_short_name(self, name):
        return self.workflow_aliases.get(name, WORKFLOW_SHORT_NAMES.get(name, name))

    def custom_workflow_for_command(self, alias):
        name = self._match_workflow_name(alias)
        return name if alias not in WORKFLOW_ALIASES and self.workflow_aliases.get(name) == alias else None

    async def save_workflow_alias(self, workflow, alias):
        if not isinstance(alias, str):
            raise WorkflowError("请输入工作流简称。")
        alias = alias.strip().lower()
        if alias and not re.fullmatch(r"[a-z][a-z0-9_-]{0,31}", alias):
            raise WorkflowError("简称须以英文字母开头，最多 32 个字母、数字、连字符或下划线。")
        async with self.workflow_lock:
            if not isinstance(workflow, str) or workflow not in self.workflows:
                raise WorkflowError("请选择可用的工作流。")
            reserved = WORKFLOW_ALIASES.get(alias)
            other = self._match_workflow_name(alias)
            if alias and (
                reserved not in (None, workflow) or other not in (None, workflow)
                or any(value == alias and name != workflow for name, value in self.workflow_aliases.items())
                or alias in {
                    "video", "anima", "list", "use", "off", "clear", "check", "reload", "sweep", "sweep-loras",
                    "t2v", "gen", "help", "commands", "lora", "wf", "set", "state", "prompt", "caption",
                    "preset", "presets", "archive", "queue", "job", "result", "redraw", "comfy",
                }
            ):
                raise WorkflowError("此简称已被其他工作流或命令使用。")
            aliases = dict(self.workflow_aliases)
            if alias:
                aliases[workflow] = alias
            else:
                aliases.pop(workflow, None)
            path = self.data_dir.resolve() / "workflow_aliases.json"
            if path.is_symlink() or path.resolve() != path:
                raise WorkflowError("工作流简称文件必须位于插件数据目录。")
            atomic_write(path, profile_bytes(aliases))
            self.workflow_aliases = aliases
            return alias

    def resolve(self, owner, name=""):
        name = name.strip()
        if name:
            key = self._match_workflow_name(name)
            if key is None and name.isdecimal():
                index = int(name) - 1
                names = list(self.workflows)
                if 0 <= index < len(names):
                    key = names[index]
        else:
            saved = self.selections.get(owner, "").strip()
            key = self._match_workflow_name(saved)
            if key is None:
                name = str(self.config.get("default_workflow", SDXL_WORKFLOW)).strip()
                key = self._match_workflow_name(name)
        if key is None:
            raise WorkflowError(
                f"工作流 {name or '（未设置）'} 不可用，请先执行 /comfy wf 查看列表。"
            )
        return self.workflows[key]

    async def select(self, owner, name):
        workflow = self.resolve(owner, name)
        if workflow.kind == "image_to_text":
            raise WorkflowError("反推工作流使用 /comfy prompt 调用。")
        async with self.state_lock:
            self.selections[owner] = workflow.name
            # Bound long-running public-bot state; insertion order retains recent selections.
            self.selections[owner] = self.selections.pop(owner)
            while len(self.selections) > 4096:
                self.selections.pop(next(iter(self.selections)))
            snapshot = json.dumps(self.selections, ensure_ascii=False, indent=2)
            await asyncio.to_thread(self._save_selections, snapshot)
        return workflow.name

    def resolve_for(self, owner, name="", kind=None):
        if name or not kind:
            wf = self.resolve(owner, name)
        else:
            try:
                wf = self.resolve(owner)
            except WorkflowError:
                wf = None
            if wf is None or wf.kind != kind:
                defaults = {
                    "text_to_video": ("default_t2v_workflow", "WAN22_T2V_AstrBot"),
                    "image_to_video": ("default_i2v_workflow", "WAN22_I2V_AstrBot"),
                }
                key, fallback = defaults[kind]
                wf = self.resolve(owner, str(self.config.get(key, fallback)))
        if kind and wf.kind != kind:
            raise WorkflowError(f"工作流 {wf.name} 的类型是 {wf.kind}，不适合此指令。")
        return wf

    def _save_selections(self, snapshot):
        atomic_write(self.data_dir / "selections.json", snapshot.encode())

    def listing(self, owner):
        try:
            selected = self.resolve(owner).name
        except WorkflowError:
            selected = ""
        return {
            "selected": selected,
            "workflows": [
                dict(index=i, **wf.describe()) for i, wf in enumerate(self.workflows.values(), 1)
            ],
            "invalid_workflows": self.errors,
        }

    async def start(
        self,
        owner,
        prompt,
        workflow="",
        negative=None,
        seed=None,
        image_data=None,
        *,
        image_folder=None,
        timeout_seconds=None,
        preset=None,
        allow_nsfw=True,
    ):
        await self.initialize()
        wf = workflow if isinstance(workflow, Workflow) else self.resolve(owner, workflow)
        jobs = self._enqueue(
            owner, [(wf, prompt, negative, seed, image_folder, preset)], image_data,
            timeout_seconds=timeout_seconds, allow_nsfw=allow_nsfw,
        )
        return jobs[0]

    async def caption(self, image_data, threshold=0.35):
        if urlsplit(self.client.url).hostname not in {"127.0.0.1", "::1", "localhost"}:
            raise WorkflowError("本地反推要求 ComfyUI 地址指向本机。")
        graph_path = self.bundled_dir.parent / "templates/Anima_WD14_Caption_AstrBot.json"
        graph = json.loads(graph_path.read_text(encoding="utf-8"))
        graph["2"]["inputs"]["threshold"] = threshold
        return await self.run_caption(graph, image_data, "1", "3")

    async def run_caption(self, graph, image_data, image_node, output_node):
        if self.closed or self.caption_pending >= self.queue_limit:
            raise ComfyError("暂时无法接收更多反推任务，请稍后重试。")
        self.caption_pending += 1
        try:
            try:
                await asyncio.wait_for(
                    self.slots.acquire(), number(self.config, "queue_timeout", 120, 5, 3600)
                )
            except TimeoutError as exc:
                raise WorkflowError("等待反推超时，请稍后重试。") from exc
            try:
                graph[image_node]["inputs"]["image"] = await self.client.upload_image(image_data)
                prompt_id = await self.client.submit(graph)
                try:
                    result = await self.client.wait(
                        prompt_id, self.generation_timeout()
                    )
                except (ComfyError, asyncio.CancelledError):
                    await self.client.delete_queued(prompt_id)
                    raise
            finally:
                self.slots.release()
        finally:
            self.caption_pending -= 1
        texts = result.get("outputs", {}).get(output_node, {}).get("text", [])
        if not isinstance(texts, list) or not texts or not isinstance(texts[0], str) or not texts[0].strip():
            raise WorkflowError("没有识别到达到置信度阈值的标签，请尝试另一张图片。")
        return texts[0].strip()

    async def start_batch(self, owner, prompt, workflow, negative, count, *, timeout_seconds=None, preset=None, image_data=None):
        await self.initialize()
        if type(count) is not int or not 1 <= count <= self.queue_limit:
            raise WorkflowError(f"生成批次须为 1 到 {self.queue_limit} 的整数。")
        wf = workflow if isinstance(workflow, Workflow) else self.resolve(owner, workflow)
        request = (wf, prompt, negative, -1 if count > 1 else None, None, preset)
        return self._enqueue(owner, [request] * count, image_data, timeout_seconds=timeout_seconds)

    async def start_preset_sweep(self, owner, workflow, presets, seed, *, timeout_seconds=None, allow_nsfw=True, account=""):
        await self.initialize()
        if not presets:
            raise WorkflowError("当前账号没有可运行的提示词预设。")
        wf = workflow if isinstance(workflow, Workflow) else self.resolve(owner, workflow)
        requests = [
            (
                wf, row["positive"], row["negative"] or None, seed, None,
                {"index": index, "name": row["name"], **({"id": row["id"], "account": account} if "id" in row else {})},
            )
            for index, row in enumerate(presets, 1)
        ]
        return self._enqueue(owner, requests, None, timeout_seconds=timeout_seconds, allow_nsfw=allow_nsfw)

    async def start_lora_sweep(
        self, owner, workflows, prompt, negative, seed, *, preset, image_folder, timeout_seconds, allow_nsfw,
        image_data=None,
    ):
        await self.initialize()
        requests = [(wf, prompt, negative, seed, image_folder, preset) for wf in workflows]
        return self._enqueue(owner, requests, image_data, timeout_seconds=timeout_seconds, allow_nsfw=allow_nsfw)

    @property
    def queue_limit(self):
        return number(self.config, "max_pending", 16, 1, QUEUE_LIMIT_MAX)

    def queue_limit_for(self, name):
        raw = self.config.get("workflow_queue_limits", "{}")
        try:
            limits = json.loads(raw) if isinstance(raw, str) else raw
            if not isinstance(limits, dict) or any(
                not isinstance(key, str) or type(limit) is not int or not 1 <= limit <= QUEUE_LIMIT_MAX
                for key, limit in limits.items()
            ):
                raise ValueError
        except ValueError as exc:
            raise WorkflowError("按工作流设置的队列上限须为 JSON 对象，数值范围 1–128。") from exc
        configured = {(self._match_workflow_name(key) or key).casefold(): value for key, value in limits.items()}
        return min(configured.get(name.casefold(), self.queue_limit), self.queue_limit)

    def generation_timeout(self, *, video=False):
        if video:
            return number(self.config, "video_generation_timeout", VIDEO_TIMEOUT_DEFAULT, GENERATION_TIMEOUT_MIN, VIDEO_TIMEOUT_MAX)
        return number(self.config, "generation_timeout", IMAGE_TIMEOUT_DEFAULT, GENERATION_TIMEOUT_MIN, IMAGE_TIMEOUT_MAX)

    def check_queue_capacity(self, workflow_name, count):
        if self.closed:
            raise ComfyError("插件正在卸载，请稍后重试。")
        self._prune_jobs()
        active = [job for job in self.jobs.values() if not job.task.done()]
        available = max(0, min(
            self.queue_limit - len(active),
            self.queue_limit_for(workflow_name) - sum(job.workflow == workflow_name for job in active),
        ))
        if count > available:
            raise ComfyError(f"队列剩余 {available} 个位置，本次需要 {count} 个。请等待或调整队列上限。")
        if len(self.jobs) + count > 256:
            raise ComfyError("近期任务较多，请稍后重试。")

    def _enqueue(self, owner, requests, image_data, *, timeout_seconds=None, allow_nsfw=True):
        # Each batch consists of variants of the same workflow.
        wf = requests[0][0]
        self.check_queue_capacity(wf.name, len(requests))
        if wf.kind == "image_to_text":
            raise WorkflowError("请附图或回复图片并发送 /comfy prompt 进行反推。")
        if timeout_seconds is None:
            timeout_seconds = self.generation_timeout(video=wf.is_video)
        else:
            maximum = VIDEO_TIMEOUT_MAX if wf.is_video else IMAGE_TIMEOUT_MAX
            if type(timeout_seconds) is not int or not GENERATION_TIMEOUT_MIN <= timeout_seconds <= maximum:
                raise WorkflowError(f"超时时间须为 {GENERATION_TIMEOUT_MIN} 到 {maximum} 秒的整数。")
        if image_data is not None and (
            not isinstance(image_data, bytes) or len(image_data) > self.client.max_image_bytes
        ):
            raise WorkflowError("参考图片无效或超过大小上限。")
        prefix = str(self.config.get("positive_prefix", "")).strip()
        prepared = []
        for wf, prompt, negative, seed, image_folder, preset in requests:
            if not isinstance(prompt, str) or (wf.positive and not prompt.strip()):
                raise WorkflowError("正向提示词不能为空。")
            if wf.is_video:
                image_folder = None
            else:
                prompt, detected_folder = self.archive.split(prompt, allow_nsfw=allow_nsfw)
                if wf.positive and not prompt.strip():
                    raise WorkflowError("请填写画面描述，归档标签只用来指定保存目录。")
                image_folder = folder_name(image_folder or detected_folder or self.archive.default_folder)
            job_id = uuid.uuid4().hex
            actual_prompt = f"{prefix}, {prompt}" if prefix else prompt
            graph, actual_seed = wf.prepare(
                actual_prompt, negative, seed,
                "__astrbot_upload_pending__.png" if image_data else None,
                image_folder=self.image_reviews.pending_folder(image_folder, job_id) if image_folder else None,
            )
            prepared.append((job_id, wf, graph, actual_seed, image_folder, preset))
        jobs = []
        for job_id, wf, graph, actual_seed, image_folder, preset in prepared:
            job = Job(
                job_id, owner, wf.name, actual_seed, kind=wf.kind,
                timeout_seconds=timeout_seconds, preset=preset,
            )
            job.task = asyncio.create_task(
                self._run(
                    job, graph, wf.outputs, image_data, wf.image_inputs,
                    image_folder=image_folder,
                )
            )
            self.jobs[job.id] = job
            jobs.append(job)
        return jobs

    async def _run(self, job, graph, outputs, image_data, image_fields, *, image_folder):
        acquired = False
        record = None
        trace = {
            "id": job.id, "workflow": job.workflow, "kind": job.kind, "seed": job.seed,
            "preset": job.preset, "timeout_seconds": job.timeout_seconds, "started_at_unix": time.time(),
            "reference_sha256": hashlib.sha256(image_data).hexdigest() if image_data else None,
        }
        metadata_path = self.metadata_dir / f"{job.id}.json"
        try:
            await self.slots.acquire()
            acquired = True
            job.state = "running"
            video = job.kind.endswith("video")
            directory = await asyncio.to_thread(self.video_library.cache) if video else self.output_dir
            if image_folder:
                directory = directory.resolve() / folder_name(image_folder)
                if directory.resolve() != directory:
                    raise WorkflowError("归档目录必须位于插件输出目录内。")
                await asyncio.to_thread(directory.mkdir, exist_ok=True)
            if image_data:
                filename = await self.client.upload_image(image_data)
                for target in image_fields:
                    graph[target.node]["inputs"][target.name] = filename
            if not video:
                trace["image_loras"] = image_loras(graph, outputs)
            await asyncio.to_thread(self.metadata_dir.mkdir, exist_ok=True)
            await asyncio.to_thread(atomic_write, metadata_path, profile_bytes({
                **trace, "state": job.state, "prompt": graph,
            }))
            embedded = trace
            if job.preset:
                embedded = {**trace, "preset": {key: value for key, value in job.preset.items() if key != "account"}}
            job.prompt_id = await self.client.submit(graph, metadata=embedded)
            job.submission_done.set()
            record = await self.client.wait(job.prompt_id, job.timeout_seconds)
            job.paths, job.image_count = await self.client.download_outputs(
                record,
                outputs,
                directory,
                number(self.config, "max_videos", 1, 1, 4)
                if video
                else number(self.config, "max_images", 4, 1, 16),
                video=video,
                existing_video=self.video_library.original if video else None,
            )
            try:
                refs = output_refs(record, outputs, video=video, include_node=not video)
                if video:
                    for ref in refs[len(job.paths):]:
                        try:
                            if await asyncio.to_thread(self.video_library.original, ref) is None:
                                await self.client.download_video(ref, directory)
                        except (OSError, ComfyError) as exc:
                            logging.getLogger(__name__).warning("Could not archive additional video for %s: %s", job.short_id, exc)
                    await asyncio.to_thread(
                        self.favorites.remember, job.id, job.owner, job.paths, refs[:len(job.paths)], video=True,
                    )
                else:
                    await self._archive_images(job, refs, image_folder, directory, trace["image_loras"])
            except (OSError, ValueError, ComfyError) as exc:
                logging.getLogger(__name__).warning("Could not archive media for %s: %s", job.short_id, exc)
            job.state = "completed"
        except asyncio.CancelledError:
            job.state = "cancelled"
            job.error = job.error or "插件重载或卸载，任务等待已取消。"
            raise
        except ComfyCancelled as exc:
            job.state, job.error = "cancelled", str(exc)
        except (ComfyError, WorkflowError) as exc:
            job.state, job.error = "failed", str(exc)
        except Exception as exc:
            job.state, job.error = (
                "failed",
                f"处理生图任务时出现异常（{type(exc).__name__}）。",
            )
        finally:
            job.submission_done.set()
            job.finished = time.monotonic()
            try:
                await asyncio.to_thread(self.metadata_dir.mkdir, exist_ok=True)
                await asyncio.to_thread(atomic_write, metadata_path, profile_bytes({
                    **trace, "state": job.state, "error": job.error, "prompt": graph,
                    "prompt_id": job.prompt_id, "finished_at_unix": time.time(),
                    "comfyui_history": {key: record[key] for key in ("outputs", "status", "meta") if key in record}
                    if record is not None else None,
                    "cached_outputs": [
                        path.resolve().relative_to(self.output_dir.resolve()).as_posix()
                        for path in job.paths if path.resolve().is_relative_to(self.output_dir.resolve())
                    ],
                }))
            except (OSError, ValueError) as exc:
                logging.getLogger(__name__).error("Could not save generation metadata for %s: %s", job.short_id, exc)
                if job.state == "completed":
                    job.error = "已生成媒体，但无法保存完整的追溯元数据。"
            if job.state != "completed" and job.prompt_id:
                await self.client.delete_queued(job.prompt_id)
            if acquired:
                self.slots.release()
            if time.monotonic() - self.last_cleanup > 3600:
                await asyncio.to_thread(self._cleanup)

    async def _archive_images(self, job, refs, image_folder, directory, loras):
        originals = await asyncio.to_thread(self.image_reviews.originals, image_folder, job.id, refs)
        caches = list(job.paths)
        for index in range(len(caches), len(refs)):
            cached = None
            if originals[index] is None:
                try:
                    cached = await self.client.download_image(refs[index], directory)
                except (ComfyError, OSError) as exc:
                    logging.getLogger(__name__).warning("Could not archive image %d for %s: %s", index + 1, job.short_id, exc)
            caches.append(cached)
        await asyncio.to_thread(
            self.image_reviews.remember, job.id, job.owner, job.workflow, image_folder, caches, originals,
            metadata={
                "seed": job.seed, "preset": job.preset,
                "loras": [loras[ref["output_node"]] for ref in refs],
            },
        )

    def _prune_jobs(self):
        cutoff = time.monotonic() - JOB_RETENTION_SECONDS
        self.jobs = {
            key: job
            for key, job in self.jobs.items()
            if job.finished is None or job.finished >= cutoff
            or (job.delivery_task and not job.delivery_task.done())
        }

    def recent_jobs(self, owner, media_type=""):
        self._prune_jobs()
        return (
            job for job in reversed(self.jobs.values())
            if job.owner == owner and (not media_type or job.kind.endswith(f"_{media_type}"))
        )

    def queue_jobs(self):
        self._prune_jobs()
        return list(self.jobs.values())

    async def cancel_job(self, job_id):
        self._prune_jobs()
        job = self.jobs.get(job_id)
        if job is None:
            raise ComfyError("没有找到此插件任务，可能已过期。")
        if job.state == "running":
            if not job.prompt_id:
                raise ComfyError("任务正在提交，请稍后再取消。")
            cancelled = await self.client.cancel_prompt(job.prompt_id)
            if job.state == "running" and not cancelled:
                raise ComfyError("ComfyUI 未确认取消，任务可能正在完成。")
        if job.state in {"queued", "running"}:
            job.state, job.error = "cancelled", "任务已取消。"
            job.finished = time.monotonic()
            job.task.cancel()
        return job

    async def cancel_all(self):
        jobs = [job for job in self.queue_jobs() if job.state in {"queued", "running"}]
        for job in jobs:
            if job.state == "queued":
                await self.cancel_job(job.id)

        async def cancel_running(job):
            if job.state == "running":
                await job.submission_done.wait()
                try:
                    await self.cancel_job(job.id)
                except ComfyError as exc:
                    return {"id": job.short_id, "message": str(exc)}
            return None

        results = await asyncio.gather(*(cancel_running(job) for job in jobs))
        return {
            "cancelled": sum(job.state == "cancelled" for job in jobs),
            "finished": sum(job.state not in {"queued", "running", "cancelled"} for job in jobs),
            "failed": [result for result in results if result is not None],
        }

    def get_job(self, owner, job_id):
        self._prune_jobs()
        job_id = job_id.lower()
        job = self.jobs.get(job_id)
        if job and (owner is None or job.owner == owner):
            return job
        if JOB_ID_PREFIX_LENGTH <= len(job_id) < 32:
            matches = [
                job for job in self.jobs.values()
                if (owner is None or job.owner == owner) and job.id.startswith(job_id)
            ]
            if len(matches) == 1:
                return matches[0]
            if matches:
                raise ComfyError("任务短 ID 重复，请使用更长的 ID。")
        if owner is None:
            raise ComfyError("没有找到此插件任务，可能已过期。")
        raise ComfyError("没有找到属于当前用户和会话的任务；插件重载后旧任务不可查询。")

    async def close(self):
        self.closed = True
        tasks = [job.task for job in self.jobs.values() if not job.task.done()]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        await self.client.close()
