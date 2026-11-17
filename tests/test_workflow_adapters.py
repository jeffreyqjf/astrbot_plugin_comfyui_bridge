"""Regression coverage for Workbench ControlNet bindings and Detailer repair order."""

import json
import unittest
from copy import deepcopy
from itertools import product
from pathlib import Path

from bridge.workflows.controlnet import (
    add_controlnet_previews,
    configure_controlnets,
    controlnet_capabilities,
    controlnet_switches,
    without_controlnet_images,
)
from bridge.workflows.detailer import LEGACY_FEET_LINKS
from bridge.workflows.v40 import advanced_v40_loras, upgrade_detailer, v40_workflow
from bridge.workflows.workflow import (
    ADVANCED_V40_WORKFLOW,
    AIO_WORKFLOW,
    ANIMA_WORKFLOW,
    DETAILER_WORKFLOW,
    WAI_WORKFLOW,
    Workflow,
    WorkflowError,
    image_loras,
)

ROOT = Path(__file__).resolve().parents[1]


def profile(name):
    return json.loads((ROOT / "workflows" / f"{name}.json").read_bytes())


def node(kind, **inputs):
    return {"class_type": kind, "inputs": inputs}


def combo(field, choices, *, group="required"):
    return {"input": {group: {field: [choices]}}}


SCHEMAS = {
    "LoadImage": {},
    "PreviewImage": {},
    "ControlNetApplyAdvanced": {},
    "AnimaLLLiteApply": {},
    "ControlNetLoader": combo("control_net_name", [
        "IL-controlnet\\openpose_noob.safetensors",
        "control-lora-canny-rank256.safetensors",
        "control-lora-depth-rank256.safetensors",
    ]),
    "ModelPatchLoader": combo("name", ["anima\\anima-lllite-depth-1.safetensors"]),
    "OpenposePreprocessor": combo("scale_stick_for_xinsr_cn", ["disable", "enable"], group="optional"),
    "AIO_Preprocessor": combo(
        "preprocessor", ["none", "CannyEdgePreprocessor", "DepthAnythingV2Preprocessor"], group="optional",
    ),
}


class ControlNetWorkflowsTest(unittest.TestCase):
    def test_v40_bindings_use_independent_inputs_and_effective_outputs(self):
        name = ADVANCED_V40_WORKFLOW
        data = profile(name)
        graph, settings = data["prompt"], data["astrbot"]
        original = deepcopy(data)
        for pose_mode, any_mode, type_, second, reference in product(
            ("direct", "preprocess"), ("direct", "preprocess"), ("canny", "depth"), (False, True), (False, True)
        ):
            controlnets = {
                "openpose": {"type": "openpose", "mode": pose_mode, "image": "nested/pose.png"},
                "any": {"type": type_, "mode": any_mode, "image": "nested/any.png"},
            }
            workflow = v40_workflow(
                name, graph, settings, options={"second_sampler": second, "img2img": reference},
                controlnets=controlnets, schemas=SCHEMAS,
            )
            prompt, _ = workflow.prepare("example", image_filename="reference.png" if reference else None)
            self.assertEqual(workflow.outputs, ["501"])
            self.assertEqual([field.node for field in workflow.image_inputs], ["0"] if reference else [])
            for sample in ("114", "81") if second else ("114",):
                self.assertEqual(prompt[sample]["inputs"]["positive"], ["165", 0])
                self.assertEqual(prompt[sample]["inputs"]["negative"], ["165", 1])
            self.assertEqual(prompt["165"]["inputs"]["positive"], ["163", 0])
            self.assertEqual(prompt["165"]["inputs"]["negative"], ["163", 1])
            for branch, source, preprocessor, target, mode in (
                ("openpose", "121", "177", "163", pose_mode), ("any", "123", "172", "165", any_mode)
            ):
                expected = [source if mode == "direct" else preprocessor, 0]
                self.assertEqual(prompt[source]["inputs"]["image"], controlnets[branch]["image"])
                self.assertEqual(prompt[target]["inputs"]["image"], expected)
                if mode == "preprocess":
                    self.assertEqual(prompt[workflow.controlnet_outputs[branch]]["inputs"]["images"], expected)
                else:
                    self.assertNotIn(branch, workflow.controlnet_outputs)
                self.assertEqual(preprocessor in prompt, mode == "preprocess")
            self.assertEqual(prompt["178"]["inputs"]["control_net_name"], f"control-lora-{type_}-rank256.safetensors")
            if reference:
                self.assertEqual(prompt["0"]["inputs"]["image"], "reference.png")
        self.assertEqual(data, original)

    def test_v40_missing_model_mismatch_and_disabled_branch(self):
        name = ADVANCED_V40_WORKFLOW
        data = profile(name)
        graph, settings = data["prompt"], data["astrbot"]
        with self.assertRaises(WorkflowError):
            controlnet_switches(name, {"openpose": {"type": "depth", "mode": "preprocess", "image": "depth.png"}})
        with self.assertRaises(WorkflowError):
            v40_workflow(name, graph, settings, controlnets={
                "any": {"type": "canny", "mode": "direct", "image": "canny.png"},
            }, schemas={})
        self.assertFalse(controlnet_capabilities(AIO_WORKFLOW))
        self.assertFalse(controlnet_capabilities(WAI_WORKFLOW))
        settings["v40"]["branches"]["17"]["enabled"] = True
        settings["v40"]["branches"]["23"]["enabled"] = True
        workflow = v40_workflow(name, graph, settings, controlnets={"openpose": None})
        self.assertNotIn("163", workflow.graph)
        self.assertIn("165", workflow.graph)
        self.assertFalse(workflow.controlnet_outputs)

    def test_v40_lora_override_preserves_auxiliary_controlnet_output(self):
        name = ADVANCED_V40_WORKFLOW
        data = profile(name)
        workflow = v40_workflow(name, data["prompt"], data["astrbot"], controlnets={
            "any": {"type": "canny", "mode": "preprocess", "image": "raw.png"},
        }, schemas=SCHEMAS)
        candidate = advanced_v40_loras(
            workflow, [{"id": "one", "strength": 0.8}],
            {"one": {"filename": "lora.safetensors", "title": "LoRA", "tag": "tag"}},
            {"lora.safetensors": "lora.safetensors"},
        )
        prompt, _ = candidate.prepare("example")
        self.assertIn("astrbot_v40_lora", prompt)
        self.assertEqual(candidate.outputs, ["501"])
        self.assertEqual(candidate.controlnet_outputs, {"any": "astrbot_controlnet_any"})
        self.assertEqual(prompt["astrbot_controlnet_any"]["inputs"]["images"], ["172", 0])

    def test_anima_preserves_ordinary_reference(self):
        name = ANIMA_WORKFLOW
        mapping = {"image": [], "optional_image": ["21.image", "129.image"]}
        for mode in ("preprocess", "direct"):
            graph = {
                "21": node("LoadImage", image="reference.png"),
                "84": node("ModelSource"),
                "129": node("LoadImage", image="default.png"),
                "130": node("AIO_Preprocessor", image=["129", 0], preprocessor="none", resolution=1024),
                "131": node("AnimaLLLiteApply", image=["130", 0], model_patch=["138", 0], model=["84", 0]),
                "138": node("ModelPatchLoader", name="historical-patch.safetensors"),
                "510": node("PreviewImage", images=["sample", 0]),
                "sample": node("ImageSampling", model=["131", 0], source=["21", 0]),
            }
            bindings = {"lllite": {"type": "depth", "mode": mode, "image": "independent/control.png"}}
            self.assertEqual(controlnet_switches(name, bindings), {"120": True})
            replaced = configure_controlnets(name, graph, bindings, SCHEMAS)
            workflow = Workflow(name, graph, without_controlnet_images(mapping, replaced), require_prompt=False)
            add_controlnet_previews(workflow, bindings)
            prompt, _ = workflow.prepare("", image_filename="uploaded-reference.png")
            self.assertEqual(workflow.outputs, ["510"])
            self.assertEqual(prompt["21"]["inputs"]["image"], "uploaded-reference.png")
            self.assertEqual(prompt["129"]["inputs"]["image"], "independent/control.png")
            self.assertEqual(prompt["138"]["inputs"]["name"], "anima\\anima-lllite-depth-1.safetensors")
            expected = ["130" if mode == "preprocess" else "129", 0]
            self.assertEqual(prompt["131"]["inputs"]["image"], expected)
            if mode == "preprocess":
                self.assertEqual(prompt[workflow.controlnet_outputs["lllite"]]["inputs"]["images"], expected)
            else:
                self.assertFalse(workflow.controlnet_outputs)
            self.assertEqual("130" in prompt, mode == "preprocess")
        self.assertEqual(mapping["optional_image"], ["21.image", "129.image"])


class DetailerFeetTest(unittest.TestCase):
    def test_repair_connects_to_upscale_filter_signature_and_both_outputs(self):
        name = DETAILER_WORKFLOW
        current = profile(name)
        for feet, eyes, mask, upscale, signature, quantize, rtx in product((False, True), repeat=7):
            flags = {
                "feet": feet, "eyes": eyes, "mask": mask, "full_detailer": not mask,
                "30": upscale, "39": signature, "119": quantize, "132": rtx,
            }
            workflow = v40_workflow(name, current["prompt"], current["astrbot"], options=flags)
            graph = workflow.graph
            for key, enabled in (
                ("499", feet), ("58", eyes), ("33", upscale), ("117", signature), ("125", quantize), ("19", rtx),
            ):
                self.assertEqual(key in graph, enabled)
            if feet:
                self.assertEqual(graph["499"]["inputs"]["image"], ["58" if eyes else "57", 0])
            if upscale:
                expected = ["499" if feet else "58" if eyes else "57", 0]
                for node_id, field in (("33", "image"), ("51", "image"), ("38", "a"), ("39", "a")):
                    self.assertEqual(graph[node_id]["inputs"][field], expected)
            self.assertEqual(graph["32"]["inputs"]["images"], graph["73"]["inputs"]["image_a"])

    def test_migration_keeps_saved_profile_settings_and_declines_custom_links(self):
        bundled = profile(DETAILER_WORKFLOW)
        older = deepcopy(bundled)
        for (key, field), previous in LEGACY_FEET_LINKS.items():
            older["prompt"][key]["inputs"][field] = previous
        older["astrbot"]["v40"]["branches"]["feet"]["enabled"] = True
        older["astrbot"]["positive_prefix"] = "kept"
        older["prompt"]["32"]["inputs"]["filename_prefix"] = "MyOutput"
        older["prompt"]["499"]["inputs"]["denoise"] = 0.33
        upgraded = upgrade_detailer(older, bundled)
        self.assertEqual(upgraded["astrbot"], older["astrbot"])
        self.assertEqual(upgraded["prompt"]["32"]["inputs"], {"filename_prefix": "MyOutput", "images": ["88", 0]})
        self.assertEqual(upgraded["prompt"]["499"]["inputs"]["denoise"], 0.33)
        self.assertIsNone(upgrade_detailer(upgraded, bundled))
        older["prompt"]["499"]["inputs"]["image"] = ["57", 0]
        self.assertIsNone(upgrade_detailer(older, bundled))


class LoRATraceTest(unittest.TestCase):
    def test_literal_connected_tags_per_output(self):
        graph = {
            "1": node("PrimitiveString", value="<lora:first:1> <lora:folder\\second:0.7:0.3>"),
            "2": node("LoRA Text Loader (LoraManager)", lora_syntax=["1", 0]),
            "3": node("LoRA Text Loader (LoraManager)", lora_syntax="<lora:third:-0.4>"),
            "4": node("SaveImage", images=["2", 0]),
            "5": node("SaveImage", images=["3", 0]),
        }
        self.assertEqual(image_loras(graph, ["4", "5"]), {
            "4": [{"name": "first", "model": 1.0, "clip": 1.0}, {"name": "folder/second", "model": 0.7, "clip": 0.3}],
            "5": [{"name": "third", "model": -0.4, "clip": -0.4}],
        })
        graph["2"]["inputs"]["lora_syntax"] = ["1", 1]
        self.assertFalse(image_loras(graph, ["4"])["4"])
