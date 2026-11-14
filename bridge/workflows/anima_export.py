"""Export the Anima canvas with the ComfyUI workspace's installed converter."""

import json
import sys
from copy import deepcopy

from comfy_cli.workflow_to_api import WorkflowConversionError, convert_ui_to_api


def export(canvas, schemas):
    output = next(node for node in canvas["nodes"] if node["id"] == 510)
    preview = output["mode"] == 4
    if preview:
        canvas = {**canvas, "nodes": [
            {**node, "mode": 0} if node is output else node for node in canvas["nodes"]
        ]}
    graph = convert_ui_to_api(canvas, schemas)
    if preview:
        graph["510"]["class_type"] = "PreviewImage"
        graph["510"]["inputs"].pop("filename_prefix", None)
    pending, active = ["510"], {}
    while pending:
        key = pending.pop()
        if key in active:
            continue
        node = graph[key]
        active[key] = node
        for value in node["inputs"].values():
            if (
                isinstance(value, list)
                and len(value) == 2
                and isinstance(value[0], str)
                and isinstance(value[1], int)
            ):
                pending.append(value[0])

    for node in active.values():
        inputs = node["inputs"]
        if node["class_type"] == "Lora Loader (LoraManager)":
            inputs.setdefault("text", "")
            loras = inputs.get("loras", [])
            inputs["loras"] = {"__value__": loras} if isinstance(loras, list) else loras
        elif node["class_type"] == "TriggerWord Toggle (LoraManager)":
            value = inputs.get("toggle_trigger_words", [])
            if isinstance(value, list):
                inputs["toggle_trigger_words"] = {"__value__": value}
            strength = inputs.get("allow_strength_adjustment")
            inputs["allow_strength_adjustment"] = strength if isinstance(strength, bool) else False
        if "Select to add Wildcard" in inputs:
            spec = schemas[node["class_type"]]["input"]["required"].get("Select to add Wildcard")
            choices = spec and (spec[0] if isinstance(spec[0], list) else spec[1].get("options"))
            current = inputs["Select to add Wildcard"]
            if (
                choices
                and isinstance(current, str)
                and current.startswith("Select Wildcard")
                and current not in choices
            ):
                inputs["Select to add Wildcard"] = choices[0]
    return active


def main():
    request = json.load(sys.stdin.buffer)
    canvas, schemas = request["canvas"], request["schemas"]
    variants = request.get("variants")
    if variants is None:
        result = export(canvas, schemas)
    else:
        result = {}
        for key, member_ids in variants.items():
            candidate = deepcopy(canvas)
            enabled = set(member_ids)
            for node in candidate["nodes"]:
                if node["id"] in enabled:
                    node["mode"] = 0
            try:
                result[key] = {"graph": export(candidate, schemas)}
            except (WorkflowConversionError, KeyError, TypeError, ValueError) as exc:
                result[key] = {"error": str(exc)[:350]}
    sys.stdout.write(json.dumps(result, ensure_ascii=True, allow_nan=False))


if __name__ == "__main__":
    main()
