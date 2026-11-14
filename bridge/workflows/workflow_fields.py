"""Interpret ComfyUI node schemas for the workbench parameter editors."""

import math
import re

from .workflow import WorkflowError, is_link

NODE_LABELS = {
    "22": "扩散模型",
    "26": "LoRA",
    "40": "文本编码器",
    "48": "VAE",
    "50": "主采样设置",
    "67": "宽度",
    "74": "高度",
    "77": "批量",
    "507": "负向提示词",
    "510": "最终图片",
}
JSON_WIDGETS = {"loras", "toggle_trigger_words"}


def widget_specs(schema, values):
    required, optional = {}, {}

    def expand(groups, prefix=""):
        for category, target in (("required", required), ("optional", optional)):
            for name, spec in groups.get(category, {}).items():
                key = prefix + name
                if spec[0] == "COMFY_AUTOGROW_V3" and (
                    any(field.startswith(key + ".") for field in values)
                    or spec[1]["template"].get("min", 0) == 0
                ):
                    continue
                if spec[0] != "COMFY_DYNAMICCOMBO_V3":
                    target[key] = spec
                    continue
                choices = spec[1]["options"]
                target[key] = [[choice["key"] for choice in choices], {}]
                for choice in choices:
                    if choice["key"] == values.get(key):
                        expand(choice["inputs"], key + ".")
                        break

    expand(schema.get("input", {}))
    if schema.get("name") == "CustomCombo":
        choices = [value for name, value in values.items() if name.startswith("option") and value]
        required["choice"] = [choices, {}] if choices else ["STRING", {}]
    return required, optional


def combo_options(spec):
    if not spec:
        return None
    if isinstance(spec[0], list):
        return spec[0]
    return spec[1].get("options") if len(spec) > 1 and isinstance(spec[1], dict) else None


def editable_fields(graph, schemas, *, v40=False):
    fields = {}
    for key, node in graph.items():
        node_type = node["class_type"]
        schema = schemas.get(node_type, {})
        required, optional = widget_specs(schema, node["inputs"])
        inputs = {**required, **optional}
        title = (
            (None if v40 else NODE_LABELS.get(key))
            or node.get("_meta", {}).get("title")
            or schema.get("display_name", node_type)
        )
        for name, value in node["inputs"].items():
            if is_link(value) or name.startswith(("Select to add ", "__lm_")) or (
                v40 and node_type == "CustomCombo" and name == "index"
            ):
                continue
            if not v40 and ((key == "504" and name == "text") or (
                node_type == "Lora Loader (LoraManager)" and name == "text"
            )):
                continue
            spec = inputs.get(name, [])
            options = spec[1] if len(spec) > 1 and isinstance(spec[1], dict) else {}
            kind = spec[0] if spec else ""
            choices = combo_options(spec)
            if v40 and node_type == "CustomCombo" and name.startswith("option"):
                kind = "STRING"
            if v40 and kind == "AUTOCOMPLETE_TEXT_LORAS":
                kind = "STRING"
            if (v40 and choices is not None) or (choices and isinstance(value, (str, int, float))):
                kind = "select"
            elif name in JSON_WIDGETS and isinstance(value, (list, dict)):
                value = value.get("__value__", value) if isinstance(value, dict) else value
                kind = "json"
            elif kind not in ("INT", "FLOAT", "BOOLEAN", "STRING"):
                continue
            fields[f"{key}.{name}"] = {
                "node": key,
                "name": name,
                "title": title,
                "class_type": node_type,
                "kind": kind,
                "value": str(value) if kind == "INT" else value,
                "choices": choices,
                "min": options.get("min"),
                "max": options.get("max"),
                "multiline": options.get("multiline", False)
                or name in ("text", "wildcard", "fragment_shader"),
                "active": True,
            }
    return fields


def parse_field(field, value):
    kind = field["kind"]
    if kind == "INT" and isinstance(value, str) and re.fullmatch(r"-?[0-9]{1,20}", value):
        value = int(value)
    if kind == "INT":
        valid = type(value) is int
    elif kind == "FLOAT":
        valid = type(value) in (int, float) and math.isfinite(value)
    elif kind == "BOOLEAN":
        valid = type(value) is bool
    elif kind == "select":
        valid = value in field["choices"]
    elif kind == "json":
        valid = isinstance(value, list) and len(value) <= 128
        if valid and field["name"] == "loras":
            valid = all(
                isinstance(row, dict)
                and isinstance(row.get("name"), str)
                and bool(row["name"])
                and type(row.get("active")) is bool
                and type(row.get("strength")) in (float, int)
                and math.isfinite(row["strength"])
                and type(row.get("clipStrength", row["strength"])) in (float, int)
                and math.isfinite(row.get("clipStrength", row["strength"]))
                for row in value
            )
        if valid:
            value = {"__value__": value}
    else:
        valid = isinstance(value, str) and len(value) <= 64000
    if kind in ("INT", "FLOAT") and valid:
        low, high = field["min"], field["max"]
        if field["name"] == "seed":
            high = min(high if high is not None else 2**63 - 1, 2**63 - 1)
        valid = (low is None or value >= low) and (high is None or value <= high)
    if not valid:
        raise WorkflowError(f"{field['title']} · {field['name']} 的值无效。")
    return value


def validate_graph(graph, schemas, replaced_images=()):
    for key, node in graph.items():
        kind = node["class_type"]
        schema = schemas.get(kind)
        if not schema or schema.get("api_node"):
            raise WorkflowError(f"节点 #{key}（{kind}）在本机不可用。")
        inputs = node["inputs"]
        required, optional = widget_specs(schema, inputs)
        for name in required:
            if name not in inputs:
                raise WorkflowError(f"节点 #{key}（{kind}）缺少输入 {name}。")
        for name, value in inputs.items():
            if is_link(value):
                continue
            spec = required.get(name) or optional.get(name)
            if not spec:
                continue
            choices = combo_options(spec)
            if choices is not None and value not in choices and (key, name) not in replaced_images:
                raise WorkflowError(
                    f"节点 #{key}（{kind}）的 {name} 找不到选项 {value!s}。可显示旁路参数，选择本机已有文件。"
                )
