"""Describe the accepted execution graph without exposing credentials."""

import json
import re

from ..workflows.workflow import image_loras, is_link


def clean_value(value):
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            name = re.sub(r"[^a-z]", "", key.lower())
            private = name.endswith("token") or name == "headers" or any(
                word in name for word in ("apikey", "password", "secret", "authorization", "credential", "cookie")
            )
            result[key] = "已隐藏" if private else clean_value(item)
        return result
    if isinstance(value, list):
        return [clean_value(item) for item in value]
    if type(value) is int and abs(value) > 2**53 - 1:
        return str(value)
    if isinstance(value, str) and value.lstrip().startswith(("{", "[")):
        try:
            return json.dumps(clean_value(json.loads(value)), ensure_ascii=False)
        except (ValueError, RecursionError):
            pass
    return value


def describe_configuration(snapshot):
    if not snapshot:
        return None
    graph = {key: node for key, node in snapshot["graph"].items() if key in snapshot.get("active", snapshot["graph"])}
    prompts = {
        role: [{"node": key, "field": field, "text": clean_value(graph[key]["inputs"][field])}
               for key, field in snapshot[role] if key in graph]
        for role in ("positive", "negative")
    }
    nodes, models = [], []
    for key, node in graph.items():
        parameters = {name: value for name, value in node["inputs"].items()
                      if not (is_link(value) and str(value[0]) in graph)}
        if parameters:
            nodes.append({"id": key, "title": node.get("_meta", {}).get("title", node["class_type"]),
                          "type": node["class_type"], "parameters": clean_value(parameters)})
        if "Loader" in node["class_type"]:
            for name, value in parameters.items():
                if name in {"ckpt_name", "unet_name", "clip_name", "vae_name", "control_net_name", "model_name", "name"} and isinstance(value, str):
                    models.append({"node": key, "field": name, "name": value})
    return {**prompts, "models": models, "loras": image_loras(graph, snapshot["outputs"]), "nodes": nodes}
