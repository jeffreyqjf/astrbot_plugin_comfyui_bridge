"""Check first-admission layout and ordinary workflow replacement."""

import io
import json
import unittest
import zipfile
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory

from bridge.workflows.parameter_layout import (
    default_parameter_layout,
    preserve_parameter_layout,
    read_parameter_layout,
    validate_parameter_layout,
)
from bridge.workflows.workflow import ANIMA_WORKFLOW, SDXL_WORKFLOW, WorkflowError, profile_parts
from bridge.workflows.workflow_archive import (
    CANVAS_ENTRY,
    export_archive,
    install_workflows,
    preserve_anima_layout,
)
from bridge.workflows.workflow_fields import editable_fields
from bridge.workflows.workflow_store import load_workflows, profile_bytes

ROOT = Path(__file__).resolve().parents[1]
LAYOUT = {"version": 1, "categories": ["高级", "基础"], "fields": ["13.filename_prefix", "2.text"]}


def node(class_type, **inputs):
    return {"class_type": class_type, "inputs": inputs}


def graph():
    return {
        "13": node("SaveImage", images=["1", 0], filename_prefix="first"),
        "1": node("ExampleSampler", positive=[2, 0], seed=4),
        "2": node("CLIPTextEncode", text="prompt"),
        "3": node("PreviewImage", images=["20:10", 0]),
        "20:10": node("InnerNode", switch="linked", upstream=["10", 0]),
        "504": node("MissingSchema", text="ignored until schema becomes available"),
        "10": node("Source", value=0.5),
    }


class WorkflowParameterLayoutTest(unittest.TestCase):
    def test_topology_is_stable_for_multiple_outputs_subgraph_and_bypass(self):
        original = graph()
        reordered = {
            key: {**node, "inputs": dict(reversed(list(node["inputs"].items())))}
            for key, node in reversed(list(original.items()))
        }
        layout = default_parameter_layout(original)
        self.assertEqual(layout, default_parameter_layout(reordered))
        self.assertEqual(layout, {
            "version": 1,
            "categories": [],
            "fields": ["2.text", "10.value", "504.text", "1.seed", "20:10.switch", "13.filename_prefix"],
        })
        self.assertEqual(original, graph())

    def test_generic_fields_use_schema_without_anima_fixed_labels_or_exclusions(self):
        prompt = {
            "22": node("GenericNode", text="title", input=["504", 0], selector="name", **{"selector.name": "choice"}),
            "504": node("GenericNode", text="shown in generic"),
            "3": node("MissingSchema", unknown="future"),
        }
        schema = {
            "display_name": "Generic schema title",
            "input": {
                "required": {
                    "text": ["STRING"],
                    "input": ["STRING"],
                    "selector": ["COMFY_DYNAMICCOMBO_V3", {"options": [{
                        "key": "name",
                        "inputs": {"required": {"name": [["choice", "other"]]}},
                    }]}],
                }
            },
        }
        fields = editable_fields(prompt, {"GenericNode": schema}, anima=False)
        self.assertEqual(fields["22.text"]["title"], "Generic schema title")
        self.assertEqual(fields["504.text"]["value"], "shown in generic")
        self.assertEqual(fields["22.selector.name"]["choices"], ["choice", "other"])
        self.assertNotIn("22.input", fields)
        self.assertNotIn("3.unknown", fields)

    def test_layout_validation_and_replace_policy(self):
        incoming = {"prompt": graph(), "astrbot": {"parameter_layout": LAYOUT}, "note": "wrapper metadata"}
        current = {"prompt": graph(), "astrbot": {"parameter_layout": {**LAYOUT, "version": 2}}}
        replaced = preserve_parameter_layout(incoming, current)
        self.assertEqual(replaced["astrbot"]["parameter_layout"]["version"], 2)
        self.assertEqual(replaced["note"], incoming["note"])
        self.assertIsNone(read_parameter_layout(replaced["astrbot"]))
        self.assertEqual(validate_parameter_layout(LAYOUT), LAYOUT)
        self.assertEqual(read_parameter_layout(incoming["astrbot"]), LAYOUT)
        for invalid in (["2.text"] * 2, ["unqualified"], ["node."], [1]):
            with self.assertRaises(WorkflowError):
                validate_parameter_layout({**LAYOUT, "fields": invalid})
        self.assertNotIn("parameter_layout", preserve_parameter_layout(incoming, graph())["astrbot"])

    def test_import_duplicate_replace_and_zip_round_trip(self):
        with TemporaryDirectory() as scratch:
            directory = Path(scratch)
            templates = directory / "templates"
            path = directory / "Example.json"
            raw = profile_bytes(graph())
            installed, _ = install_workflows(directory, templates, raw, {}, filename=path.name)
            parsed = json.loads(path.read_bytes())
            self.assertEqual(parsed["prompt"], graph())
            self.assertEqual(parsed["astrbot"]["parameter_layout"], default_parameter_layout(graph()))

            parsed["astrbot"]["parameter_layout"] = LAYOUT
            original = profile_bytes(parsed)
            path.write_bytes(original)
            _, skipped = install_workflows(directory, templates, raw, {}, filename=path.name)
            self.assertEqual(skipped, ["Example"])
            self.assertEqual(path.read_bytes(), original)

            changed = deepcopy(parsed)
            changed["prompt"]["13"]["inputs"]["filename_prefix"] = "new"
            changed["astrbot"]["parameter_layout"] = default_parameter_layout(graph())
            install_workflows(directory, templates, profile_bytes(changed), {}, filename=path.name, replace=True)
            replaced = json.loads(path.read_bytes())
            self.assertEqual(replaced["prompt"], changed["prompt"])
            self.assertEqual(replaced["astrbot"]["parameter_layout"], LAYOUT)

            archive = export_archive(directory, installed, templates / "missing.json")
            destination = directory / "destination"
            destination.mkdir()
            install_workflows(destination, templates, archive, {})
            restored, _ = load_workflows(destination, {})
            restored_profile = json.loads((destination / path.name).read_bytes())
            self.assertEqual(restored["Example"].graph, changed["prompt"])
            self.assertEqual(restored_profile["astrbot"]["parameter_layout"], LAYOUT)

    def test_explicit_reload_admits_only_new_valid_custom_workflow(self):
        with TemporaryDirectory() as scratch:
            directory = Path(scratch)
            raw = profile_bytes(graph())
            legacy = directory / "Legacy.json"
            builtin = directory / f"{SDXL_WORKFLOW}.json"
            custom = directory / "Custom.json"
            for path in (legacy, builtin):
                path.write_bytes(raw)
            previous, errors = load_workflows(directory, {})
            self.assertFalse(errors)
            self.assertEqual(legacy.read_bytes(), raw)
            custom.write_bytes(raw)

            loaded, errors = load_workflows(directory, {}, admit_custom=True, known_workflows=previous)
            self.assertFalse(errors)
            self.assertEqual(legacy.read_bytes(), raw)
            self.assertEqual(builtin.read_bytes(), raw)
            saved = custom.read_bytes()
            self.assertEqual(json.loads(saved)["astrbot"]["parameter_layout"], default_parameter_layout(graph()))

            load_workflows(directory, {}, admit_custom=True, known_workflows=loaded)
            self.assertEqual(custom.read_bytes(), saved)

    def test_anima_zip_preserves_effective_canvas_and_rejects_topology_change(self):
        with TemporaryDirectory() as scratch:
            directory = Path(scratch)
            templates = directory / "templates"
            name = f"{ANIMA_WORKFLOW}.json"
            mappings = {ANIMA_WORKFLOW: {"positive": ["504.text"], "negative": ["507.text"]}}
            template = directory / "custom-canvas.json"
            graph, settings = profile_parts(json.loads((ROOT / "workflows" / name).read_bytes()))
            profile = {"prompt": graph, "astrbot": {**settings, "parameter_layout": LAYOUT}}
            api_path = directory / name
            api_path.write_bytes(profile_bytes(profile))
            installed_canvas = (ROOT / "templates" / name).read_bytes()
            template.write_bytes(installed_canvas)
            payload = deepcopy(profile)
            payload["astrbot"]["parameter_layout"] = default_parameter_layout(payload["prompt"])
            payload["astrbot"]["positive_prefix"] = "Imported prefix"

            def bundle():
                data = io.BytesIO()
                with zipfile.ZipFile(data, "w", zipfile.ZIP_DEFLATED) as archive:
                    archive.writestr(f"workflows/{name}", profile_bytes(payload))
                    imported_canvas = json.loads(installed_canvas)
                    imported_canvas["nodes"][0]["pos"][0] += 1
                    archive.writestr(CANVAS_ENTRY, profile_bytes(imported_canvas))
                return data.getvalue()

            install_workflows(directory, templates, bundle(), mappings, replace=True, canvas_path=template)
            result = api_path.read_bytes()
            settings = json.loads(result)["astrbot"]
            self.assertEqual(settings["parameter_layout"], LAYOUT)
            self.assertEqual(settings["positive_prefix"], "Imported prefix")
            self.assertEqual(template.read_bytes(), installed_canvas)
            self.assertFalse(templates.exists())

            payload["prompt"]["510"]["class_type"] = "PreviewImage"
            with self.assertRaisesRegex(WorkflowError, "节点或连线已变化"):
                install_workflows(directory, templates, bundle(), mappings, replace=True, canvas_path=template)
            self.assertEqual(api_path.read_bytes(), result)
            self.assertEqual(template.read_bytes(), installed_canvas)


    def test_named_canvas_preserves_current_geometry(self):
        current = json.loads((ROOT / "templates" / f"{ANIMA_WORKFLOW}.json").read_bytes())
        incoming = deepcopy(current)
        original_pos = current["nodes"][0]["pos"]
        incoming["nodes"][0]["pos"][0] += 1
        incoming["nodes"][0]["mode"] = 4
        incoming["nodes"][0]["widgets_values"] = ["updated"]
        applied = preserve_anima_layout(incoming, current)
        self.assertEqual(applied["nodes"][0]["pos"], original_pos)
        self.assertEqual(applied["nodes"][0]["mode"], 4)
        self.assertEqual(applied["nodes"][0]["widgets_values"], ["updated"])
        self.assertEqual(applied["groups"], current["groups"])
        self.assertEqual(applied["links"], current["links"])

        incoming["definitions"]["subgraphs"][0]["links"][0]["origin_id"] = 999
        with self.assertRaisesRegex(WorkflowError, "连线"):
            preserve_anima_layout(incoming, current)


if __name__ == "__main__":
    unittest.main()
