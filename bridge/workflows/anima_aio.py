"""Wire the selected paths of the Anima I2I AIO API workflow."""

from copy import deepcopy

from .workflow import AIO_WORKFLOW, Workflow, WorkflowError

AIO_MAPPING = {"positive": ["1610.String"], "negative": ["1611.String"], "optional_image": ["1608.image"]}
LORA_SLOTS = ("1846", "1850", "1849", "1847", "1848")

# Choices double as panel labels and saved values.
AIO_CHOICES = {
    "loader": ("原生", "Booster"),
    "latent": ("整图重绘", "遮罩重绘"),
    "size": ("手动宽高", "比例与像素数"),
    "control": ("关闭", "参考图 LLLite", "深度 LLLite", "Inpaint LLLite"),
    "upscale": ("关闭", "Ultimate SD Upscale", "RTX VSR", "VOSR2"),
}
AIO_SWITCHES = ("teacache", "sage", "artists", "cleanup", *LORA_SLOTS)


def aio_options(settings):
    saved = settings.get("aio", {})
    return {
        **{key: saved.get(key, choices[0]) for key, choices in AIO_CHOICES.items()},
        **{key: saved.get(key, False) for key in AIO_SWITCHES},
        "threshold": saved.get("threshold", 0.35),
    }


def aio_workflow(graph, settings, has_image, *, denoise=None, mapping=None):
    graph = deepcopy(graph)
    options = aio_options(settings)
    inputs = {key: node["inputs"] for key, node in graph.items()}

    model = ["1077" if options["loader"] == "Booster" else "1758", 0]
    clip = ["1073", 0]
    for slot in LORA_SLOTS:
        if options[slot]:
            inputs[slot].update(model=model, clip=clip)
            model, clip = [slot, 0], [slot, 1]
    if options["teacache"]:
        inputs["1076"]["model"] = model
        model = ["1076", 0]
    if options["sage"]:
        inputs["1687"]["model"] = model
        model = ["1687", 0]
    if options["artists"]:
        inputs["1690"]["clip"] = clip
        inputs["1691"]["model"] = model
        model = ["1691", 0]
    inputs["1636"]["clip"] = inputs["1638"]["clip"] = clip

    latent = "1427"
    if has_image:
        latent = "1424" if options["latent"] == AIO_CHOICES["latent"][1] else "1426"
        control = options["control"]
        if control == "Inpaint LLLite":
            if latent != "1424":
                raise WorkflowError("Inpaint LLLite 需要启用遮罩重绘。")
            inputs["1039"]["model"] = model
            model = ["1039", 0]
        elif control != AIO_CHOICES["control"][0]:
            inputs["1038"].update(
                model=model, image=["1370" if control == AIO_CHOICES["control"][2] else "1608", 0]
            )
            model = ["1038", 0]
    elif options["size"] == AIO_CHOICES["size"][1]:
        latent = "1428"

    sampler = inputs["118"]
    positive = ["1691" if options["artists"] else "1636", int(options["artists"])]
    sampler.update(model=model, latent_image=[latent, 0], positive=positive)
    sampler["denoise"] = (
        denoise if denoise is not None else sampler["denoise"]
    ) if has_image else 1.0
    output = ["119", 0]
    upscale = options["upscale"]
    if upscale == "Ultimate SD Upscale":
        inputs["1665"].update(model=model, positive=positive)
        output = ["1665", 0]
    elif upscale == "RTX VSR":
        output = ["1818", 0]
    elif upscale == "VOSR2":
        output = ["1824", 0]
    if options["cleanup"]:
        inputs["1011"]["anything"] = output
        output = ["1011", 0]
    inputs["1649"]["images"] = output

    profile = {"prompt": graph, "astrbot": {**settings, "reference_source": "qq"}}
    workflow = Workflow(AIO_WORKFLOW, profile, mapping or AIO_MAPPING)
    workflow.graph = {key: node for key, node in graph.items() if key in workflow.active}
    return workflow
