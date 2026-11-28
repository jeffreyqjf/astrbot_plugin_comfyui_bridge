import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { createSharedPrompts } from "./shared_prompt.js";

function reachesPH3(node) {
  const graph = node.graph;
  const pending = [node];
  const visited = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    for (const output of current.outputs ?? []) {
      for (const id of output.links ?? []) {
        const link = graph?.getLink?.(id) ?? graph?.links?.[id];
        const target = graph?.getNodeById(link?.target_id);
        if ((target?.comfyClass ?? target?.type) === "PH3ImageConditioning" &&
            target.inputs[link.target_slot]?.name === "prompt") return true;
        if (target && ["easy ifElse", "TextGenerateV2", "Reroute"].includes(target.type)) pending.push(target);
      }
    }
  }
  return false;
}

function mount(node) {
  if (node.astrbotSharedPrompts) return;
  const dual = (node.comfyClass ?? node.type) === "AmiaomiaoH3_Prompt";
  if (!dual && ((node.comfyClass ?? node.type) !== "PrimitiveStringMultiline" || !reachesPH3(node))) return;
  const widget = node.widgets?.find(item => item.name === (dual ? "text" : "value"));
  if (!widget || !node.addDOMWidget) return;
  node.astrbotSharedPrompts = true;
  const panel = createSharedPrompts({
    api, family: dual ? "h3-dual" : "ph3",
    read: () => widget.value,
    write(value) {
      widget.value = value;
      widget.callback?.(value);
      node.h3Prompt?.setValue(value);
      node.setDirtyCanvas?.(true, true);
    },
  });
  node.addDOMWidget("astrbot_shared_prompts", "astrbot-shared-prompts", panel, {
    serialize: false, hideOnZoom: false, getMinHeight: () => 112,
  }).serialize = false;
}

app.registerExtension({
  name: "AstrBot.H3.SharedPrompts",
  nodeCreated(node) {
    const type = node.comfyClass ?? node.type;
    if (type === "AmiaomiaoH3_Prompt") queueMicrotask(() => mount(node));
    if (type === "PrimitiveStringMultiline") {
      const connections = node.onConnectionsChange;
      node.onConnectionsChange = function (...args) {
        const result = connections?.apply(this, args);
        queueMicrotask(() => mount(this));
        return result;
      };
    }
  },
  afterConfigureGraph() {
    for (const node of app.graph._nodes ?? []) mount(node);
  },
});
