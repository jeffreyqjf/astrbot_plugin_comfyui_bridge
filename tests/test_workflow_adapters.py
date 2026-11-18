"""Regression coverage for Workbench ControlNet bindings and Detailer repair order."""

import base64
import io
import json
import unittest
from copy import deepcopy
from itertools import product
from pathlib import Path

from PIL import Image

from bridge.workflows.controlnet import (
    add_controlnet_previews,
    configure_controlnets,
    controlnet_capabilities,
    controlnet_switches,
    normalize_controlnet_profiles,
    without_controlnet_images,
)
from bridge.workflows.detailer import LEGACY_FEET_LINKS
from bridge.workflows.minimax_h3 import (
    H3_V3_DEFAULT,
    h3_v3_fields,
    h3_with_reference,
    save_h3_v3_field,
)
from bridge.workflows.regional import (
    prepare_regional,
    regional_text,
    sampling_options,
    upscale_options,
)
from bridge.workflows.v40 import advanced_v40_loras, upgrade_detailer, v40_workflow
from bridge.workflows.workflow import (
    ADVANCED_V40_WORKFLOW,
    AIO_WORKFLOW,
    ANIMA_WORKFLOW,
    DETAILER_WORKFLOW,
    H3_SEED_FINAL,
    H3_SEED_FULL,
    H3_SEED_HUNTER,
    WAI_WORKFLOW,
    Workflow,
    WorkflowError,
    image_loras,
)
from bridge.workflows.workflow_store import workflow_from_profile

ROOT = Path(__file__).resolve().parents[1]


def profile(name):
    return json.loads((ROOT / "workflows" / f"{name}.json").read_bytes())


def node(kind, **inputs):
    return {"class_type": kind, "inputs": inputs}


def combo(field, choices, *, group="required"):
    return {"input": {group: {field: [choices]}}}


class MiniMaxH3WorkflowsTest(unittest.TestCase):
    def test_v3_modes_keep_subgraph_inputs_and_share_saved_parameters(self):
        data = profile(H3_SEED_FULL)
        graph, settings = data["prompt"], data["astrbot"]
        config = settings["h3_v3"]
        workflow = workflow_from_profile(H3_SEED_FULL, data)
        fields = h3_v3_fields(graph, settings, workflow, {})
        self.assertEqual(config["mode"], H3_V3_DEFAULT)
        self.assertEqual(workflow.outputs, ["18", "134", "144"])
        save_h3_v3_field(graph, settings, fields["597.slider_2"], 10, {})
        save_h3_v3_field(graph, settings, fields["h3_v3.134"], False, {})
        save_h3_v3_field(graph, settings, fields["593.SwitchState"], "2", {})
        workflow = workflow_from_profile(H3_SEED_FULL, data)
        self.assertEqual(workflow.outputs, ["18", "144"])
        prepared, _ = workflow.prepare("Write to the secondary editor", seed=10)
        self.assertEqual(prepared["585"]["inputs"]["prompt"], "Write to the secondary editor")
        self.assertEqual(prepared["16"]["inputs"]["seed"], 10)
        self.assertFalse(prepared["18"]["inputs"]["save_output"])
        self.assertEqual(prepared["125:12"]["inputs"]["sampler"], ["22:6", 0])
        self.assertEqual(prepared["125:12"]["inputs"]["sigmas"], ["542", 0])
        for mode in config["variants"]:
            config["mode"] = mode
            workflow = workflow_from_profile(H3_SEED_FULL, data)
            prepared, _ = workflow.prepare("Generate H3", seed=10)
            state = json.loads(prepared["597"]["inputs"]["SlidersState"])
            self.assertEqual(state["sliders"][2]["value"], 10)
            if "604" in prepared:
                self.assertEqual(prepared["604"]["inputs"]["samples"], ["600", 0])
                self.assertEqual(workflow.outputs, ["34"])

    def test_v3_reference_also_reaches_first_frame_guide(self):
        data = profile(H3_SEED_FULL)
        data["astrbot"]["h3_v3"]["mode"] = "搜种 · 首帧参考"
        workflow = workflow_from_profile(H3_SEED_FULL, data)
        reference = h3_with_reference(workflow)
        graph, _ = reference.prepare("Walk forward", seed=1, image_filename="ref.png")
        self.assertEqual(graph["274"]["inputs"]["image"], ["astrbot_h3_reference", 0])
        self.assertEqual(graph["5"]["inputs"]["ref_images.ref_image_0"], ["astrbot_h3_reference", 0])

    def test_candidate_seed_offsets_and_final_preserve_first_pass(self):
        hunter = Workflow(H3_SEED_HUNTER, profile(H3_SEED_HUNTER))
        final = Workflow(H3_SEED_FINAL, profile(H3_SEED_FINAL))
        first, actual = hunter.prepare("A fox", seed=1000)
        self.assertEqual(actual, 1000)
        self.assertEqual(hunter.outputs, ["15", "35", "55"])
        self.assertEqual(first["16"]["inputs"]["value"], 1000)
        for node_id, offset, noise in (("30", 1000, "31"), ("50", 2000, "51")):
            self.assertEqual(first[node_id]["inputs"]["expression"], f"(a + {offset}) % 9223372036854775808")
            self.assertEqual(first[noise]["inputs"]["noise_seed"], [node_id, 1])
        for output in hunter.outputs:
            self.assertTrue(first[output]["inputs"]["filename_prefix"].startswith("vedio/H3_Candidate_"))
            self.assertIn("audio", first[output]["inputs"])
        for node_id in ("1", "2", "3", "4", "5", "6", "7", "8", "9", "11", "12", "16"):
            self.assertEqual(hunter.graph[node_id], final.graph[node_id])
        rendered, _ = final.prepare("A fox", seed=2000)
        self.assertEqual(final.outputs, ["67"])
        self.assertEqual(rendered["16"]["inputs"]["value"], 2000)
        self.assertEqual(rendered["63"]["inputs"]["noise_seed"], final.graph["63"]["inputs"]["noise_seed"])
        self.assertEqual(rendered["61"]["inputs"]["samples"], ["12", 1])

    def test_optional_reference_keeps_seed_mapping_and_does_not_change_base_graph(self):
        for name in (H3_SEED_HUNTER, H3_SEED_FINAL):
            workflow = Workflow(name, profile(name))
            referenced = h3_with_reference(workflow)
            graph, seed = referenced.prepare("Keep <Picture 1>", seed=42, image_filename="uploaded.png")
            self.assertEqual(seed, 42)
            self.assertEqual(graph["5"]["inputs"]["ref_images.ref_image_0"], ["astrbot_h3_reference", 0])
            self.assertEqual(graph["astrbot_h3_reference"]["inputs"]["image"], "uploaded.png")
            self.assertNotIn("ref_images.ref_image_0", workflow.graph["5"]["inputs"])


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
    def test_custom_type_profile_applies_installed_model_processor_and_signed_strength(self):
        for name, branch, model, loader, field, apply, processor in (
            (ADVANCED_V40_WORKFLOW, "any", "test\\tile.safetensors", "178", "control_net_name", "165", "172"),
            (ANIMA_WORKFLOW, "lllite", "anima\\custom.safetensors", "138", "name", "131", "130"),
        ):
            with self.subTest(name=name):
                schemas = deepcopy(SCHEMAS)
                schemas["ControlNetLoader"] = combo("control_net_name", [model])
                schemas["ModelPatchLoader"] = combo("name", [model])
                schemas["AIO_Preprocessor"] = combo("preprocessor", ["TilePreprocessor"])
                strength = -0.4 if branch == "lllite" else 1.25
                configs = normalize_controlnet_profiles({"version": 1, "profiles": [{
                    "id": "my-tile", "workflow": name, "branch": branch, "type": "tile", "label": "Tile",
                    "model": model, "preprocessor": "TilePreprocessor", "resolution": 1024,
                    "strength": strength, "start_percent": 0.2, "end_percent": 0.55,
                }]})
                self.assertEqual(controlnet_capabilities(name, configs)[branch]["types"], ["tile"])
                bindings = {branch: {"type": "tile", "mode": "preprocess", "image": "raw.png", "profile": configs[0]}}
                if branch == "any":
                    data = profile(name)
                    workflow = v40_workflow(name, data["prompt"], data["astrbot"], controlnets=bindings, schemas=schemas)
                    graph = workflow.graph
                    self.assertNotEqual(data["prompt"][loader]["inputs"][field], model)
                else:
                    graph = {
                        "129": node("LoadImage", image="previous.png"),
                        "130": node("AIO_Preprocessor", image=["129", 0], preprocessor="none"),
                        "131": node("AnimaLLLiteApply", image=["130", 0], model_patch=["138", 0]),
                        "138": node("ModelPatchLoader", name="previous.safetensors"),
                    }
                    configure_controlnets(name, graph, bindings, schemas)
                self.assertEqual(graph[loader]["inputs"][field], model)
                self.assertEqual(graph[processor]["inputs"]["preprocessor"], "TilePreprocessor")
                self.assertEqual(graph[processor]["inputs"]["resolution"], 1024)
                values = graph[apply]["inputs"]
                self.assertEqual((values["strength"], values["start_percent"], values["end_percent"]), (strength, 0.2, 0.55))

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


class RegionalPromptTests(unittest.TestCase):
    def payload(self):
        image = Image.new("RGB", (30, 12))
        for x in range(30):
            for y in range(12):
                image.putpixel((x, y), ((255, 0, 0), (0, 255, 0), (0, 0, 255))[x // 10])
        buffer = io.BytesIO()
        image.save(buffer, "PNG")
        return {"mask": base64.b64encode(buffer.getvalue()).decode(), "base_strength": 0.8,
                "regions": [{"text": text, "strength": strength} for text, strength in
                            (("red subject", 0.5), ("green subject", 1), ("blue subject", 1.5))]}

    def test_rgb_prompt_binding_and_bypass(self):
        original = profile(ADVANCED_V40_WORKFLOW)
        source = deepcopy(original)
        graph, switches, images = prepare_regional(ADVANCED_V40_WORKFLOW, original["prompt"], original["astrbot"], self.payload(), 1024 * 1024)
        workflow = v40_workflow(ADVANCED_V40_WORKFLOW, graph, original["astrbot"], options=switches)
        self.assertIn("51", workflow.active)
        self.assertEqual(set(images), {"1", "2", "3"})
        self.assertEqual(len(set(images.values())), 1)
        self.assertEqual(workflow.graph["4"]["inputs"]["populated_text"], "red subject")
        self.assertEqual(workflow.graph["6"]["inputs"]["mode"], "fixed")
        self.assertEqual(workflow.graph["7"]["inputs"]["strength"], 0.5)
        self.assertEqual(workflow.graph["27"]["inputs"]["strength"], 0.8)
        prepared, _ = workflow.prepare("Global scene", seed=123)
        self.assertEqual(prepared["4"]["inputs"]["populated_text"], "red subject")
        self.assertEqual(prepared["39"]["inputs"]["channel"], "red")
        self.assertEqual(prepared["40"]["inputs"]["channel"], "green")
        self.assertEqual(prepared["41"]["inputs"]["channel"], "blue")
        self.assertEqual(original, source)
        combined = v40_workflow(ADVANCED_V40_WORKFLOW, graph, original["astrbot"], options=switches,
                               controlnets={"openpose": {"type": "openpose", "mode": "direct", "image": "pose.png"},
                                           "any": {"type": "canny", "mode": "direct", "image": "edges.png"}}, schemas=SCHEMAS)
        self.assertTrue({"51", "163", "165"}.issubset(combined.active))
        self.assertEqual(combined.graph["4"]["inputs"]["populated_text"], "red subject")
        graph, switches, images = prepare_regional(ADVANCED_V40_WORKFLOW, original["prompt"], original["astrbot"], None, 1024)
        disabled = v40_workflow(ADVANCED_V40_WORKFLOW, graph, original["astrbot"], options=switches)
        self.assertNotIn("51", disabled.active)
        self.assertFalse(images)

    def test_reject_invalid_masks_prompts_and_workflows(self):
        source = profile(ADVANCED_V40_WORKFLOW)
        for value in ({**self.payload(), "mask": "invalid"}, {**self.payload(), "regions": []},
                      {**self.payload(), "base_strength": float("nan")},
                      {**self.payload(), "regions": [{"text": "", "strength": 1}] * 3}):
            with self.assertRaises(WorkflowError):
                prepare_regional(ADVANCED_V40_WORKFLOW, source["prompt"], source["astrbot"], value, 1024 * 1024)
        with self.assertRaises(WorkflowError):
            prepare_regional(ANIMA_WORKFLOW, source["prompt"], source["astrbot"], self.payload(), 1024 * 1024)
        with self.assertRaises(WorkflowError):
            regional_text({"regions": [], "base_strength": 1})


class V40TaskUpscaleTests(unittest.TestCase):
    def test_independent_pre_post_switches(self):
        data = profile(ADVANCED_V40_WORKFLOW)
        for pre, post in product([False, True], repeat=2):
            workflow = v40_workflow(ADVANCED_V40_WORKFLOW, data["prompt"], data["astrbot"],
                                   options=upscale_options(ADVANCED_V40_WORKFLOW, {"pre": pre, "post": post}))
            self.assertEqual("125" in workflow.active, pre)
            self.assertEqual("130" in workflow.active, post)
            for key, row in workflow.graph.items():
                for value in row["inputs"].values():
                    if isinstance(value, list) and len(value) == 2 and isinstance(value[0], str):
                        self.assertIn(value[0], workflow.graph, key)
        for invalid in ({"pre": 1, "post": False}, {"pre": True}, None):
            with self.assertRaises(WorkflowError):
                upscale_options(ADVANCED_V40_WORKFLOW, invalid)
        with self.assertRaises(WorkflowError):
            upscale_options(DETAILER_WORKFLOW, {"pre": True, "post": True})


class V40SamplingTaskTests(unittest.TestCase):
    def test_sampling_and_upscale_combinations(self):
        data = profile(ADVANCED_V40_WORKFLOW)
        for pre, post, second, ultimate_pre, ultimate_post in product([False, True], repeat=5):
            options = sampling_options(ADVANCED_V40_WORKFLOW, {"hires_pre": pre, "hires_post": post, "second_sampler": second})
            options.update(upscale_options(ADVANCED_V40_WORKFLOW, {"pre": ultimate_pre, "post": ultimate_post}))
            w = v40_workflow(ADVANCED_V40_WORKFLOW, data["prompt"], data["astrbot"], options=options)
            for key, enabled in [("109", pre), ("110", post), ("81", second), ("126", ultimate_pre), ("130", ultimate_post)]:
                self.assertEqual(key in w.active, enabled, (key, options))
            for row in w.graph.values():
                for value in row["inputs"].values():
                    if isinstance(value, list) and len(value) == 2 and isinstance(value[0], str):
                        self.assertIn(value[0], w.graph)
        for invalid in ({}, {"hires_pre": 1, "hires_post": False, "second_sampler": True}):
            with self.assertRaises(WorkflowError):
                sampling_options(ADVANCED_V40_WORKFLOW, invalid)
