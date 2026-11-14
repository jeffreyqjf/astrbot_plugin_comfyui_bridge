"""Pack a browser-painted mask for ComfyUI's LoadImage node."""

from io import BytesIO

from PIL import Image, ImageOps

from ..workflows.workflow import WorkflowError

MASK_PIXELS = 24_000_000


def reference_body_limit(image_limit):
    return 8 * ((image_limit + 2) // 3) + 128 * 1024


def apply_mask(image_data, mask_data, limit):
    try:
        with Image.open(BytesIO(image_data)) as original, Image.open(
            BytesIO(mask_data), formats=("PNG",),
        ) as mask:
            if max(original.width * original.height, mask.width * mask.height) > MASK_PIXELS:
                raise WorkflowError("遮罩编辑支持最高 2400 万像素的图片。")
            image = ImageOps.exif_transpose(original).convert("RGB")
            if image.size != mask.size:
                raise WorkflowError("遮罩与参考图尺寸不同，请重新编辑遮罩。")
            # ComfyUI reads 1 - alpha as MASK. Pillow preserves RGB even under zero alpha.
            image.putalpha(ImageOps.invert(mask.convert("RGBA").getchannel("A")))
            result = BytesIO()
            image.save(result, format="PNG", compress_level=3)
    except (OSError, Image.DecompressionBombError) as exc:
        raise WorkflowError("无法读取参考图或 PNG 遮罩。") from exc
    if result.tell() > limit:
        raise WorkflowError("带遮罩的 PNG 超过单张图片大小上限，请缩小参考图后重试。")
    return result.getvalue()
