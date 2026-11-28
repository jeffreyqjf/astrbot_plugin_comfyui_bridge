// Standalone DOM host for the original H3 Toolbox widgets.
// SPDX-License-Identifier: GPL-3.0-only
import { app, extensions } from "./scripts/app.js";
import { api, connect } from "./scripts/api.js";
import "./extensions/ximiao/refs/hub.js";
import "./extensions/ximiao/long_video/ref_loader.js";
import "./extensions/ximiao/long_video/video_v3.js";

const icons = document.createElement("link");
icons.rel = "stylesheet";
icons.href = new URL("./primeicons.css", import.meta.url);
document.head.append(icons);

const roles = {
  references: ["H3 参考素材", 680],
  images: ["H3 图片参考", 680],
  settings: ["生成设置（时长／画幅／二采放大）", 515],
  picker: ["接续控制台", 640],
  prompt: ["提示词", 420],
  cut: ["视频裁切处理", 680],
  join: ["成片拼接", 680],
};

function section(host, role, folded) {
  const [title] = roles[role];
  const row = document.createElement("details");
  row.className = "toolbox-widget";
  row.dataset.h3Role = role;
  row.open = !folded;
  const heading = document.createElement("summary");
  heading.textContent = title;
  const body = document.createElement("div");
  body.className = "toolbox-widget-body";
  row.append(heading, body);
  host.append(row);
  return {row, body};
}

async function bindNode(spec, role, host, onChange) {
  class NodeAdapter {
    constructor() {
      this.id = Number(spec.node);
      this.type = spec.class_type;
      this.title = roles[role][0];
      this.size = [900, roles[role][1]];
      this.graph = app.graph;
      this.properties = {};
      this.outputs = [];
      const fromHub = role === "settings" || role === "prompt";
      this.inputs = fromHub ? [{name:"refs", type:"H3_REFS", link: this.id}] : [];
      if (fromHub) this.graph.links.set(this.id, {origin_id:5994, origin_slot:0});
      this.widgets = Object.entries(spec.values).map(([name, initial]) => {
        let value = initial;
        return {
          name, options:{values:spec.options?.[name]},
          get value() { return value; },
          set value(next) { value = next; onChange(name, next); },
        };
      });
      if (role === "picker") this.widgets.push({name:"stage_plan", value:"", options:{}});
    }
    addDOMWidget(_name, _type, element, _options) {
      host.append(element);
      const widget = {};
      (this.domWidgets ??= []).push(widget);
      return widget;
    }
    setDirtyCanvas() {}
    setSize(value) { this.size = value; }
    getInputNode(index) {
      const link = this.graph.getLink(this.inputs[index]?.link);
      return link ? this.graph.getNodeById(link.origin_id) : null;
    }
  }
  for (const extension of extensions) await extension.beforeRegisterNodeDef?.(NodeAdapter, {name:spec.class_type});
  const node = new NodeAdapter();
  app.graph._nodes.push(node);
  node.onNodeCreated?.();
  node.onConfigure?.({widgets_values:Object.values(spec.values)});
  if (!host.firstElementChild) throw Error(`无法挂载原版「${roles[role][0]}」。`);
  return node;
}

export async function mountPanels({bridge, host, panels, run, initialPrompt, isImage, onPromptChange}) {
  connect(bridge);
  const nodes = new Map();
  async function mount(role, spec) {
    const tool = role === "cut" || role === "join";
    const {row, body} = section(host, role, tool);
    if (role === "cut") {
      const response = await api.fetchApi("/object_info/" + spec.class_type);
      const schema = (await response.json())[spec.class_type];
      const video = schema?.input?.required?.video?.[1]?.options;
      if (Array.isArray(video)) spec = {...spec, options:{video}};
    }
    const node = await bindNode(spec, role, body, (name, value) => {
      if (role === "prompt" && name === "text") onPromptChange(value);
    });
    nodes.set(role, node);
    if (tool) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "primary";
      button.textContent = role === "cut" ? "运行裁切" : "运行拼接";
      button.onclick = () => run(role, button);
      const actions = document.createElement("footer");
      actions.append(button);
      row.append(actions);
    }
  }
  for (const role of ["references", "images", "settings", "picker"]) {
    if (panels[role]) await mount(role, panels[role]);
  }
  if (isImage) {
    const {body} = section(host, "prompt", false);
    const title = body.previousElementSibling;
    title.textContent = "输入提示词";
    body.classList.add("toolbox-ph3-prompt");
    const textarea = document.createElement("textarea");
    textarea.setAttribute("aria-label", "输入提示词");
    textarea.maxLength = 32000;
    textarea.spellcheck = false;
    textarea.rows = 12;
    textarea.value = initialPrompt;
    textarea.addEventListener("input", () => onPromptChange(textarea.value));
    body.append(textarea);
    nodes.set("prompt", {textarea});
  } else {
    await mount("prompt", {node:"27", class_type:"AmiaomiaoH3_Prompt", values:{text:initialPrompt}});
  }
  for (const role of ["cut", "join"]) if (panels[role]) await mount(role, panels[role]);
  return {
    values(action) {
      return Object.fromEntries(Object.entries(panels).filter(([role]) =>
        action ? action === role : role !== "cut" && role !== "join",
      ).map(([role, spec]) => [role, Object.fromEntries(Object.keys(spec.values).map(name =>
        [name, nodes.get(role).widgets.find(widget => widget.name === name).value],
      ))]));
    },
    setPrompt(value) {
      const node = nodes.get("prompt");
      if (node.textarea) node.textarea.value = value;
      else if (node.widgets[0].value !== value) {
        node.widgets[0].value = value;
        node.h3Prompt.setValue(value);
      }
    },
    result(outputs) {
      const saved = outputs["50"]?.h3_clip_v2?.[0];
      if (saved) {
        nodes.get("picker")?.h3ClipPicker.saved(saved);
        api.dispatchEvent(new CustomEvent("amiaomiao_h3/clip_bin/changed", {detail:saved}));
      }
      if (outputs["6103"]) nodes.get("cut")?.onExecuted(outputs["6103"]);
      if (outputs["6104"]) nodes.get("join")?.onExecuted(outputs["6104"]);
    },
    dispose() {
      for (const node of nodes.values()) {
        node.onRemoved?.();
        for (const widget of node.domWidgets ?? []) widget.onRemove?.();
      }
      app.graph._nodes = [];
      app.graph.links.clear();
    },
  };
}
