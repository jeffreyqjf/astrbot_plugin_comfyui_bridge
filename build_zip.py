"""Build an AstrBot-compatible archive with an explicit runtime file allowlist."""

import json
import zipfile
from pathlib import Path


def build():
    root = Path(__file__).resolve().parent
    target = root.parent / (root.name + ".zip")
    files = [
        "__init__.py",
        "main.py",
        "bridge/__init__.py",
        "bridge/client.py",
        "bridge/image_archive.py",
        "bridge/lora_settings.py",
        "bridge/qq/__init__.py",
        "bridge/qq/qq_commands.py",
        "bridge/qq/qq_messages.py",
        "bridge/qq/reference.py",
        "bridge/service.py",
        "bridge/video_library.py",
        "bridge/studio/__init__.py",
        "bridge/studio/mask_image.py",
        "bridge/studio/prompt_library.py",
        "bridge/studio/remote_studio.py",
        "bridge/studio/studio_settings.py",
        "bridge/workflows/__init__.py",
        "bridge/workflows/anima_aio.py",
        "bridge/workflows/anima_export.py",
        "bridge/workflows/detailer.py",
        "bridge/workflows/anima_settings.py",
        "bridge/workflows/illustrious.py",
        "bridge/workflows/lightning.py",
        "bridge/workflows/svi.py",
        "bridge/workflows/v40.py",
        "bridge/workflows/workflow.py",
        "bridge/workflows/workflow_archive.py",
        "bridge/workflows/workflow_fields.py",
        "bridge/workflows/workflow_store.py",
        "templates/drawing_persona.txt",
        "templates/Anima_T2I_AstrBot.json",
        "templates/Anima_I2I_AIO_AstrBot.json",
        "templates/Anima_WD14_Caption_AstrBot.json",
        "views/anima/index.html",
        "views/anima/app.js",
        "views/anima/image_review.js",
        "views/anima/videos.js",
        "views/anima/mask_editor.js",
        "views/anima/remote.js",
        "views/anima/prompt_library.js",
        "views/anima/style.css",
        "metadata.yaml",
        "logo.png",
        "_conf_schema.json",
        "requirements.txt",
        "README.md",
        "docs/COMMANDS.md",
        "docs/CONFIGURATION.md",
        "LICENSE",
    ]
    json.loads((root / "_conf_schema.json").read_text(encoding="utf-8"))
    temp = target.with_suffix(".zip.tmp")
    with zipfile.ZipFile(temp, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for relative in files:
            archive.write(root / relative, f"{root.name}/{relative}")
        for path in sorted((root / "workflows").glob("*.json")):
            json.loads(path.read_text(encoding="utf-8-sig"))
            archive.write(path, f"{root.name}/workflows/{path.name}")
    with zipfile.ZipFile(temp) as archive:
        assert archive.testzip() is None
        assert f"{root.name}/main.py" in archive.namelist()
        assert f"{root.name}/metadata.yaml" in archive.namelist()
    temp.replace(target)
    print(f"Created {target} ({target.stat().st_size} bytes)")


if __name__ == "__main__":
    build()
