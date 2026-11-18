"""Add before/after viewers without moving nodes or changing processing links."""

import json
from argparse import ArgumentParser
from copy import deepcopy
from pathlib import Path

COMPARER = "Image Comparer (rgthree)"
MAIN_STAGES = {
    "FaceDetailerPipe",
    "MaskDetailerPipe",
    "DetailerForEachPipe",
    "DetailerForEach",
    "UltimateSDUpscale",
}


def image_stages(canvas):
    links = {link[0]: link for link in canvas["links"]}

    def input_source(node, names):
        for name in names:
            port = next((item for item in node.get("inputs", []) if item["name"] == name), None)
            if port and port.get("link") in links:
                link = links[port["link"]]
                return [link[1], link[2]]
        raise ValueError(f"Cannot identify the comparison input for #{node['id']} ({node['type']})")

    result = []
    for node in canvas["nodes"]:
        if node["type"] not in MAIN_STAGES:
            continue
        slot = next(
            (
                slot
                for slot, port in enumerate(node.get("outputs", []))
                if port.get("type") == "IMAGE"
            ),
            None,
        )
        if slot is not None:
            before = input_source(node, ("image",))
            after = [node["id"], slot]
            # Follow the result switch so a viewer cannot force a disabled feet repair.
            for switch in canvas["nodes"]:
                if switch["type"] == "ComfySwitchNode" and (
                    input_source(switch, ("on_true",)) == after
                    and input_source(switch, ("on_false",)) == before
                ):
                    after = [switch["id"], 0]
                    break
            result.append((node, before, after))
    return result


def rectangle(node):
    x, y = node["pos"]
    width, height = node["size"]
    return x - 12, y - 38, x + width + 12, y + height + 12


def overlaps(left, right):
    return left[0] < right[2] and right[0] < left[2] and left[1] < right[3] and right[1] < left[3]


def add_comparisons(source, example):
    canvas = deepcopy(source)
    nodes = {node["id"]: node for node in canvas["nodes"]}
    links = {link[0]: link for link in canvas["links"]}
    node_id = max(canvas.get("last_node_id", 0), *nodes)
    link_id = max(canvas.get("last_link_id", 0), *links)
    order = max(node.get("order", 0) for node in canvas["nodes"])
    occupied = [rectangle(node) for node in canvas["nodes"]]
    # Viewers stay outside existing groups so group bypass membership is preserved.
    occupied.extend(
        (x - 12, y - 38, x + width + 12, y + height + 12)
        for x, y, width, height in (group["bounding"] for group in canvas.get("groups", []))
    )
    added, reused = 0, 0
    stages = image_stages(source)
    repair_types = {
        "FaceDetailerPipe",
        "MaskDetailerPipe",
        "DetailerForEachPipe",
        "DetailerForEach",
    }
    stages.sort(
        key=lambda item: (item[0]["type"] not in repair_types, item[0]["pos"][1], item[0]["pos"][0])
    )
    for stage, before, after in stages:
        candidates = []
        for node in canvas["nodes"]:
            if node["type"] != COMPARER:
                continue
            pair = [
                links[port["link"]][1:3] for port in node["inputs"] if port.get("link") in links
            ]
            if pair in ([before, after], [after, before]):
                candidates.append(node)
        groups = [
            group
            for group in canvas.get("groups", [])
            if group["bounding"][0] <= stage["pos"][0] < group["bounding"][0] + group["bounding"][2]
            and group["bounding"][1]
            <= stage["pos"][1]
            < group["bounding"][1] + group["bounding"][3]
        ]
        label = (
            min(groups, key=lambda group: group["bounding"][2] * group["bounding"][3])["title"]
            if groups
            else stage.get("title", stage["type"])
        )
        title = f"Image {label} #{stage['id']}"
        if candidates:
            reused += 1
            continue
        node_id += 1
        order += 1
        viewer = deepcopy(example)
        viewer.update(
            id=node_id,
            order=order,
            title=title,
            mode=0,
            flags={},
            size=[320, 360],
            inputs=[],
            outputs=[{"dir": 4, "name": "images", "shape": 3, "type": "IMAGE", "links": None}],
            widgets_values=[[]],
            widgets_values_named={"rgthree_comparer": {"images": []}},
        )
        x, y = stage["pos"][0], stage["pos"][1] + stage["size"][1] + 60
        while True:
            viewer["pos"] = [x, y]
            hits = [box for box in occupied if overlaps(rectangle(viewer), box)]
            if not hits:
                break
            y = max(box[3] for box in hits) + 50
        occupied.append(rectangle(viewer))
        for slot, (name, origin) in enumerate(
            zip(("image_a", "image_b"), (after, before), strict=True)
        ):
            link_id += 1
            viewer["inputs"].append({"dir": 3, "name": name, "type": "IMAGE", "link": link_id})
            link = [link_id, origin[0], origin[1], node_id, slot, "IMAGE"]
            canvas["links"].append(link)
            links[link_id] = link
            port = nodes[origin[0]]["outputs"][origin[1]]
            port["links"] = [*(port.get("links") or []), link_id]
        canvas["nodes"].append(viewer)
        nodes[node_id] = viewer
        added += 1
    canvas.update(last_node_id=node_id, last_link_id=link_id)
    return canvas, added, reused


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--backup-dir", type=Path, required=True)
    args = parser.parse_args()
    directory = args.workspace / "user/default/workflows"
    reference = json.loads((directory / "ILV40/Advanced_Gemma_V40.json").read_bytes())
    example = next(node for node in reference["nodes"] if node["type"] == COMPARER)
    paths = [
        directory / name
        for name in (
            "ILV40/Detailer_V40.json",
            "AstrBot/Detailer_V40_AstrBot.json",
            "main/AnimaDetailer.json",
            "AstrBot/Anima_Detailer_AstrBot.json",
        )
    ]
    paths.extend(
        Path(__file__).resolve().parents[1] / "templates" / name
        for name in ("Anima_Detailer_AstrBot.json", "Detailer_V40_AstrBot.json")
    )
    changes = []
    for index, path in enumerate(paths):
        raw = path.read_bytes()
        canvas, added, reused = add_comparisons(json.loads(raw), example)
        changes.append((index, path, raw, canvas, added, reused))
    args.backup_dir.mkdir(parents=True, exist_ok=False)
    for index, path, raw, *_ in changes:
        (args.backup_dir / f"{index}-{path.name}").write_bytes(raw)
    for _, path, _, canvas, added, reused in changes:
        if added:
            path.write_text(
                json.dumps(canvas, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
        print(
            f"{path}: {added} added, {reused} existing pairs reused; {len(image_stages(canvas))} main stages covered"
        )


if __name__ == "__main__":
    main()
