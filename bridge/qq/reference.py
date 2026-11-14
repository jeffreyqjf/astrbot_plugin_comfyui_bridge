"""Resolve images from this event only; never accept model-supplied filesystem paths."""

import asyncio
from pathlib import Path

from astrbot.api.message_components import Image, Plain, Reply, Video

from ..client import ComfyError, image_suffix


async def reference_images(event):
    messages = event.get_messages() if hasattr(event, "get_messages") else []
    direct = [part for part in messages if isinstance(part, Image)]
    if direct:
        return direct
    return [image for _, image in await quoted_images(event)]


async def quoted_images(event):
    return [(reply, part) for reply in await quoted_replies(event)
            for part in (reply.chain or []) if isinstance(part, Image)]


async def quoted_replies(event):
    messages = event.get_messages() if hasattr(event, "get_messages") else []
    return [reply if reply.chain else await _fetch_reply(event, reply)
            for reply in messages if isinstance(reply, Reply)]


async def _fetch_reply(event, reply):
    # OneBot may leave Reply.chain empty when its initial lookup failed.
    bot = getattr(event, "bot", None)
    if not bot or not hasattr(bot, "call_action"):
        return reply
    try:
        raw = await asyncio.wait_for(bot.call_action(action="get_msg", message_id=reply.id), 10)
        chain = []
        for segment in raw.get("message", []):
            if not isinstance(segment, dict):
                continue
            data = segment.get("data", {})
            kind = segment.get("type")
            if kind == "text":
                chain.append(Plain(data.get("text", "")))
            elif kind in {"image", "video"}:
                source = data.get("url") or data.get("file", "")
                if source.startswith(("http://", "https://", "base64://", "file://")):
                    chain.append((Image if kind == "image" else Video)(file=source))
        return Reply(id=reply.id, chain=chain, sender_id=raw.get("sender", {}).get("user_id"))
    except Exception:
        return reply


async def read_reference(event, index, max_bytes, *, required=True, images=None):
    if images is None:
        images = await reference_images(event)
    if not images and not required:
        return None
    if isinstance(index, bool) or not isinstance(index, int) or not 1 <= index <= len(images):
        raise ComfyError(
            "未找到指定参考图。请将图片与指令一起发送，或回复一张图片后再生成；图片序号从 1 开始。"
        )
    try:
        path = Path(await asyncio.wait_for(images[index - 1].convert_to_file_path(), 30))
        data = await asyncio.to_thread(_read_bounded, path, max_bytes)
        image_suffix(data)
        return data
    except (OSError, ValueError, asyncio.TimeoutError) as exc:
        raise ComfyError("无法读取参考图，请重新发送图片，并确认图片大小未超过面板上限。") from exc


def _read_bounded(path, limit):
    if not path.is_file() or path.stat().st_size > limit:
        raise ValueError("Reference image is not a file or is too large")
    with path.open("rb") as handle:
        data = handle.read(limit + 1)
    if len(data) > limit:
        raise ValueError("Reference image is too large")
    return data
