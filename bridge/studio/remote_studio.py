"""Serve the workbench on a separate, authenticated LAN port."""

import asyncio
import hmac
import ipaddress
import re
import secrets
from collections import deque
from time import monotonic

from aiohttp import web

from .. import PACKAGE_ROOT
from ..client import VIDEO_MIME, ComfyError
from ..workflows.workflow import WorkflowError
from ..workflows.workflow_archive import ARCHIVE_LIMIT
from .mask_image import reference_body_limit
from .studio_settings import COMMAND_IMPORT_LIMIT

ASSETS = ("style.css", "app.js", "image_review.js", "remote.js", "prompt_library.js", "mask_editor.js", "videos.js")
VIEW = PACKAGE_ROOT / "views" / "anima"
API_PATHS = frozenset({
    "studio", "studio/navigation-order", "studio/workflow", "studio/presets", "studio/presets/accounts",
    "studio/workflow/alias",
    "studio/workflow/export", "studio/workflows/export", "studio/workflows/import", "studio/workflows/replace",
    "studio/workflow/configs", "studio/workflow/configs/import", "studio/workflow/configs/export",
    "studio/lora-tags", "studio/queue/templates/import",
    "studio/presets/import", "studio/queue", "studio/queue/command", "studio/queue/templates", "studio/queue/cancel",
    "studio/queue/qq-timeout",
    "studio/queue/cancel-all", "studio/images", "studio/images/file", "studio/images/thumbnails", "studio/images/delete",
    "studio/prompt-tags", "studio/prompt-tags/preview",
    "studio/videos", "studio/videos/play", "studio/videos/delete",
    "anima/settings", "anima/branches",
})
PRIVATE_NETWORKS = tuple(map(ipaddress.ip_network, (
    "127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10",
    "::1/128", "fc00::/7", "fe80::/10",
)))
CSP = (
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; "
    "img-src 'self' data: blob:; media-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
)
LOGIN_CODE = re.compile(r"(?:[0-9]{6}|[A-Za-z0-9_-]{24,128})")
LOGIN_WINDOW = 300
LOGIN_LIMIT = 5
SESSION_SECONDS = 12 * 60 * 60
SESSION_LIMIT = 64
WORKFLOW_UPLOAD_LIMIT = ARCHIVE_LIMIT + 64 * 1024


class RemoteStudio:
    def __init__(self, plugin):
        self.plugin = plugin
        self.routes = {}
        self.runner = None
        self.token = ""
        self.sessions = {}
        self.login_failures = deque()

    async def start(self):
        config = self.plugin.config
        if not config.get("remote_studio_enabled", False) or self.runner is not None:
            return
        host = config.get("remote_studio_host", "0.0.0.0")
        port = config.get("remote_studio_port", 8790)
        token = config.get("remote_studio_token", "")
        if not isinstance(token, str) or not LOGIN_CODE.fullmatch(token):
            raise ValueError("远程工作台口令须为 6 位数字，或 24–128 位字母、数字、下划线或连字符。")
        if not isinstance(host, str) or type(port) is not int or not 1024 <= port <= 65535:
            raise ValueError("请填写监听 IP 及 1024–65535 范围内的端口。")
        ipaddress.ip_address(host)
        self.token = token
        app = web.Application(middlewares=[self.authorize], client_max_size=max(
            reference_body_limit(self.plugin.service.client.max_image_bytes), WORKFLOW_UPLOAD_LIMIT,
        ))
        app.on_response_prepare.append(self._headers)
        app.router.add_get("/", self._index)
        app.router.add_get("/video/{token}", self._video)
        for asset in ASSETS:
            app.router.add_get("/" + asset, self._asset)
        for (method, route) in self.routes:
            app.router.add_route(method, "/api/" + route, self._api)
        app.router.add_post("/api/login", self._login)
        app.router.add_post("/api/logout", self._logout)
        app.router.add_post("/api/command", self._command)
        runner = web.AppRunner(app, access_log=None, shutdown_timeout=3)
        await runner.setup()
        try:
            await web.TCPSite(runner, host, port).start()
        except OSError:
            await runner.cleanup()
            raise
        self.runner = runner

    async def stop(self):
        if self.runner is not None:
            await self.runner.cleanup()
            self.runner = None
            self.sessions.clear()
            self.login_failures.clear()
            self.plugin.studio.video_links.clear()

    @web.middleware
    async def authorize(self, request, handler):
        try:
            peer = ipaddress.ip_address(request.remote or "")
        except ValueError:
            raise web.HTTPForbidden() from None
        if isinstance(peer, ipaddress.IPv6Address) and peer.ipv4_mapped:
            peer = peer.ipv4_mapped
        if not any(peer in network for network in PRIVATE_NETWORKS):
            raise web.HTTPForbidden()
        if request.path.startswith("/api/") and request.path != "/api/login":
            if not self._active_session(self._bearer(request)):
                return self._error("请输入远程工作台口令。", 401)
        return await handler(request)

    @staticmethod
    def _bearer(request):
        scheme, _, token = request.headers.get("Authorization", "").partition(" ")
        return token if scheme == "Bearer" else ""

    def _matches_code(self, provided):
        return hmac.compare_digest(provided.encode("utf-8"), self.token.encode("ascii"))

    def _active_session(self, token):
        return (len(self.token) >= 24 and self._matches_code(token)) or self.sessions.get(token, 0) > monotonic()

    async def _login(self, request):
        code = self._bearer(request)
        if not LOGIN_CODE.fullmatch(code):
            return self._error("请输入远程工作台口令。", 401)
        now = monotonic()
        while self.login_failures and now - self.login_failures[0] >= LOGIN_WINDOW:
            self.login_failures.popleft()
        if len(self.login_failures) >= LOGIN_LIMIT:
            remaining = int(LOGIN_WINDOW - (now - self.login_failures[0])) + 1
            return self._error(f"口令尝试次数过多，请在 {remaining} 秒后重试。", 429)
        if not self._matches_code(code):
            self.login_failures.append(now)
            return self._error("远程工作台口令错误。", 401)
        token = secrets.token_urlsafe(32)
        if len(self.sessions) >= SESSION_LIMIT:
            self.sessions.pop(next(iter(self.sessions)))
        self.sessions[token] = now + SESSION_SECONDS
        return web.json_response({"token": token})

    async def _logout(self, request):
        token = self._bearer(request)
        self.sessions.pop(token, None)
        for key, link in list(self.plugin.studio.video_links.items()):
            if link[2] == f"Bearer {token}":
                self.plugin.studio.video_links.pop(key)
        return web.json_response({})

    @staticmethod
    async def _headers(request, response):
        response.headers.update({
            "Cache-Control": "no-store",
            "Content-Security-Policy": CSP,
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
        })

    @staticmethod
    async def _index(request):
        return web.FileResponse(VIEW / "index.html")

    @staticmethod
    async def _asset(request):
        return web.FileResponse(VIEW / request.path.removeprefix("/"))

    async def _video(self, request):
        link = self.plugin.studio.video_links.get(request.match_info["token"])
        if link is None or link[0] <= monotonic() or not self._active_session(link[2].removeprefix("Bearer ")):
            raise web.HTTPNotFound()
        try:
            path = await asyncio.to_thread(self.plugin.service.video_library.file, *link[1])
        except (OSError, ValueError):
            raise web.HTTPNotFound() from None
        return web.FileResponse(path, headers={"Content-Type": VIDEO_MIME[path.suffix.lower()]})

    @staticmethod
    def _error(message, status=400):
        return web.json_response({"status": "error", "message": message}, status=status)

    async def _api(self, request):
        from astrbot.api.web import PluginRequest, bind_request_context
        from starlette.requests import Request
        from starlette.responses import StreamingResponse

        route = request.path.removeprefix("/api/")
        limit = 2 * 1024 * 1024
        if request.method == "POST":
            if route in {"studio/queue", "studio/queue/command"}:
                limit = reference_body_limit(self.plugin.service.client.max_image_bytes)
            elif route in {"studio/workflows/import", "studio/workflows/replace", "studio/workflow/configs/import"}:
                limit = WORKFLOW_UPLOAD_LIMIT
            elif route == "studio/queue/templates/import":
                limit = COMMAND_IMPORT_LIMIT
        if request.content_length is not None and request.content_length > limit:
            return self._error("请求数据过大。", 413)
        if request.headers.get("Transfer-Encoding"):
            return self._error("请求须包含数据长度。", 411)
        body = await request.read()

        async def receive():
            return {"type": "http.request", "body": body}

        scope = {
            "type": "http", "method": request.method, "path": request.path,
            "headers": [(key.lower(), value) for key, value in request.raw_headers],
            "query_string": request.rel_url.raw_query_string.encode("ascii"),
        }
        incoming = Request(scope, receive)
        try:
            with bind_request_context(PluginRequest(incoming, username="remote")):
                result = await self.routes[(request.method, route)]()
        finally:
            await incoming.close()
        if isinstance(result, StreamingResponse):
            return web.Response(body=result.body_iterator, status=result.status_code, headers=result.headers)
        return web.Response(body=result.body, status=result.status_code, content_type="application/json")

    async def _command(self, request):
        if request.content_type != "multipart/form-data":
            return self._error("请使用网页上的任务命令表单。", 415)
        try:
            data = await request.post()
            command, account, upload = (data.get(key, "") for key in ("command", "account", "image"))
            if not isinstance(command, str) or not isinstance(account, str):
                raise WorkflowError("任务命令和预设账号须为文本。")
            image = None
            if isinstance(upload, web.FileField):
                if upload.filename:
                    limit = self.plugin.service.client.max_image_bytes
                    image = upload.file.read(limit + 1)
                    if len(image) > limit:
                        raise WorkflowError("参考图超过插件配置的大小上限。")
            elif upload:
                raise WorkflowError("请选择本机参考图文件。")
            return web.json_response(await self.plugin.run_remote_command(command, account, image, allow_nsfw=True))
        except web.HTTPRequestEntityTooLarge:
            return self._error("参考图超过插件配置的大小上限。", 413)
        except (ValueError, ComfyError, OSError) as exc:
            return self._error(str(exc))
