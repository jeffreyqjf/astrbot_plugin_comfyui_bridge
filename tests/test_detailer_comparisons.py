import unittest
from copy import deepcopy

from scripts.add_detailer_comparisons import (
    COMPARER,
    add_comparisons,
    image_stages,
    overlaps,
    rectangle,
)


def node(key, kind, input_name=None, link=None):
    return {
        "id": key,
        "type": kind,
        "mode": 0,
        "order": key,
        "pos": [key * 400, 100],
        "size": [300, 200],
        "inputs": [{"name": input_name, "type": "IMAGE", "link": link}] if input_name else [],
        "outputs": [{"name": "IMAGE", "type": "IMAGE", "links": []}],
    }


def fixture():
    nodes = [
        node(1, "LoadImage"),
        node(2, "FaceDetailerPipe", "image", 1),
        node(3, "MaskDetailerPipe", "image", 2),
        node(4, "UltimateSDUpscale", "image", 3),
        node(5, "VAEDecode"),
        node(6, "Canny"),
        node(7, "ImageResizeKJv2"),
        node(8, "GLSLShader"),
    ]
    links = [[1, 1, 0, 2, 0, "IMAGE"], [2, 2, 0, 3, 0, "IMAGE"], [3, 3, 0, 4, 0, "IMAGE"]]
    for link in links:
        nodes[link[1] - 1]["outputs"][link[2]]["links"].append(link[0])
    return {
        "nodes": nodes,
        "links": links,
        "last_node_id": 8,
        "last_link_id": 3,
        "groups": [{"id": 1, "title": "Repairs", "bounding": [0, 0, 4000, 400]}],
    }


EXAMPLE = {
    "type": COMPARER,
    "properties": {"comparer_mode": "Slide"},
    "widgets_values": [[{"url": "old.png"}]],
}


class DetailerComparisonTests(unittest.TestCase):
    def assert_links(self, canvas):
        nodes = {row["id"]: row for row in canvas["nodes"]}
        links = {row[0]: row for row in canvas["links"]}
        self.assertEqual(len(nodes), len(canvas["nodes"]))
        self.assertEqual(len(links), len(canvas["links"]))
        for key, origin, slot, target, input_slot, _ in canvas["links"]:
            self.assertIn(key, nodes[origin]["outputs"][slot]["links"])
            self.assertEqual(nodes[target]["inputs"][input_slot]["link"], key)
        for row in canvas["nodes"]:
            for slot, port in enumerate(row["outputs"]):
                for key in port["links"] or []:
                    self.assertEqual(links[key][1:3], [row["id"], slot])

    def test_only_major_stages_are_compared_with_reference_orientation(self):
        source = fixture()
        original = deepcopy(source)
        stages = {row[0]["id"]: row[1:] for row in image_stages(source)}
        self.assertEqual(stages, {2: ([1, 0], [2, 0]), 3: ([2, 0], [3, 0]), 4: ([3, 0], [4, 0])})
        canvas, added, reused = add_comparisons(source, EXAMPLE)
        self.assertEqual((added, reused), (3, 0))
        self.assertEqual(source, original)
        self.assertEqual(canvas["groups"], source["groups"])
        viewers = canvas["nodes"][len(source["nodes"]) :]
        links = {row[0]: row for row in canvas["links"]}
        for index, viewer in enumerate(viewers):
            self.assertEqual(viewer["widgets_values"], [[]])
            stage = links[viewer["inputs"][0]["link"]][1]
            self.assertEqual(links[viewer["inputs"][1]["link"]][1:3], stages[stage][0])
            for other in canvas["nodes"][: len(source["nodes"])] + viewers[:index]:
                self.assertFalse(overlaps(rectangle(viewer), rectangle(other)))
            self.assertGreater(viewer["pos"][1], 400)
        self.assertEqual(canvas["links"][: len(source["links"])], source["links"])
        self.assert_links(canvas)
        repeated, added, reused = add_comparisons(canvas, EXAMPLE)
        self.assertEqual((added, reused), (0, 3))
        self.assertEqual(repeated, canvas)

    def test_existing_comparison_is_preserved_in_either_orientation(self):
        for left, right in ((1, 2), (2, 1)):
            source = fixture()
            viewer = node(9, COMPARER)
            viewer["inputs"] = [
                {"name": "image_a", "type": "IMAGE", "link": 4},
                {"name": "image_b", "type": "IMAGE", "link": 5},
            ]
            source["nodes"].append(viewer)
            source["links"].extend([[4, left, 0, 9, 0, "IMAGE"], [5, right, 0, 9, 1, "IMAGE"]])
            source["nodes"][left - 1]["outputs"][0]["links"].append(4)
            source["nodes"][right - 1]["outputs"][0]["links"].append(5)
            canvas, added, reused = add_comparisons(source, EXAMPLE)
            self.assertEqual((added, reused), (2, 1))
            self.assertEqual(canvas["nodes"][8], viewer)
            self.assertEqual(canvas["links"][:5], source["links"])
            self.assert_links(canvas)

    def test_feet_viewer_respects_the_existing_result_switch(self):
        source = fixture()
        switch = node(9, "ComfySwitchNode")
        switch["inputs"] = [
            {"name": "on_true", "type": "IMAGE", "link": 4},
            {"name": "on_false", "type": "IMAGE", "link": 5},
        ]
        switch["widgets_values"] = [False]
        source["nodes"].append(switch)
        source["links"].extend([[4, 2, 0, 9, 0, "IMAGE"], [5, 1, 0, 9, 1, "IMAGE"]])
        source["nodes"][1]["outputs"][0]["links"].append(4)
        source["nodes"][0]["outputs"][0]["links"].append(5)
        stages = {stage[0]["id"]: stage[1:] for stage in image_stages(source)}
        self.assertEqual(stages[2], ([1, 0], [9, 0]))
        canvas, _, _ = add_comparisons(source, EXAMPLE)
        links = {row[0]: row for row in canvas["links"]}
        viewer = next(
            row for row in canvas["nodes"] if row["type"] == COMPARER and "#2" in row["title"]
        )
        self.assertEqual(links[viewer["inputs"][0]["link"]][1:3], [9, 0])
        self.assert_links(canvas)
