import { mountEditor } from "./h3_prompt_vendor.js";
import { H3_PROMPT_IDE_SETTING_DEFINITIONS } from "./h3_prompt_ide_settings_core.mjs";
import { app, readPromptSetting, writePromptSetting } from "./h3_prompt_transport.js";
import { api, configureH3Transport, prepareH3Files } from "./h3_media_transport.js";
import { computeTags } from "./h3_media_vendor.js";

const workflowName = "MiniMax_H3_Seed_Hunter_V3_AstrBot";
export function mountH3Prompt({ bridge, host, textarea, status }) {
  configureH3Transport(bridge);
  let active = false;
  let pending;
  let loaded = false;
  let failure = "";
  let text = "";
  let previousPlain = "";
  let commandText;
  let referenceVersion = 0;
  const node = {
    id: "h3-task-prompt", type: "H3PromptIDE", properties: {}, size: [700, 650],
    graph: app.graph, _h3BridgeReferences: [],
    widgets: [{
      name: "prompt",
      get value() { return text; },
      set value(value) {
        text = String(value);
        if (active) textarea.value = text;
      },
    }],
    addDOMWidget(name, type, element) {
      host.querySelector("[data-h3-prompt-editor]").replaceChildren(element);
      return {element};
    },
  };
  app.graph._nodes = [node];
  const preferenceLabels = ["默认显示", "自动补全", "补全后添加空格", "默认对白语言", "点击替换标记"];
  const preferences = host.querySelector("[data-h3-prompt-preferences]");
  for (const [index, setting] of H3_PROMPT_IDE_SETTING_DEFINITIONS.entries()) {
    const label = document.createElement("label");
    label.className = "field";
    label.append(preferenceLabels[index]);
    const input = document.createElement(setting.type === "combo" ? "select" : "input");
    const value = readPromptSetting(setting.id, setting.defaultValue);
    if (setting.type === "combo") {
      for (const option of setting.options) input.add(new Option(option.text, option.value));
      input.value = value;
    } else if (setting.type === "boolean") {
      input.type = "checkbox";
      input.checked = value;
    } else input.value = value;
    input.addEventListener("change", () => writePromptSetting(
      setting.id, setting.type === "boolean" ? input.checked : input.value,
    ));
    label.append(input);
    preferences.append(label);
  }

  async function load() {
    try {
      status("正在加载 H3 提示词编辑器…");
      const data = await bridge.apiGet("studio/h3/media");
      text = data.prompt || "";
      node.properties.h3_prompt_ide_mode = data.prompt_mode || "ref2va";
      mountEditor(node);
      loaded = true;
      if (active) textarea.value = text;
      failure = "";
      status("");
    } catch (error) {
      failure = error.message;
      status(failure, true);
    }
  }
  function updateText(value) {
    node.widgets[0].value = value;
    node._h3PromptIdeRefresh?.();
  }
  textarea.addEventListener("input", () => { if (active) updateText(textarea.value); });

  return {
    async show(name, positive) {
      const enabled = name === workflowName;
      if (enabled && !active) previousPlain = textarea.value;
      if (!enabled && active) {
        textarea.value = previousPlain;
        node._h3PromptIdeState?.completion?.hide();
      }
      active = enabled;
      host.hidden = !active;
      textarea.closest("label").hidden = active;
      if (!active) return;
      if (!loaded && !pending) pending = load().finally(() => { pending = null; });
      await pending;
      if (!active) return;
      if (typeof positive === "string" && positive !== commandText) {
        if (positive || commandText !== undefined) updateText(positive);
        commandText = positive;
      }
    },
    async ready() {
      if (!active) return;
      await pending;
      if (!active) return;
      if (failure) throw new Error(failure);
      if (active && !loaded) throw new Error("请等待 H3 提示词编辑器加载完成。");
    },
    async payload() {
      if (!active) return {};
      await this.ready();
      return { h3_prompt: text };
    },
    async references(items) {
      const version = ++referenceVersion;
      try {
        await prepareH3Files(items);
        if (version !== referenceVersion) return;
        const { tags, extra } = computeTags(items);
        const records = [];
        for (const item of items) {
          for (const token of [tags.get(item), extra.get(item)].filter(Boolean)) {
            const [, type, index] = /^<(Picture|Video|Audio) (\d+)>$/.exec(token);
            const kind = type.toLowerCase();
            const match = /^(.*?)(?: \[(input|output|temp)\])?$/.exec(item.file);
            const path = match[1].replaceAll("\\", "/"), slash = path.lastIndexOf("/");
            const preview = kind !== "audio" ? api.apiURL("/view?" + new URLSearchParams({
              filename: path.slice(slash + 1), subfolder: path.slice(0, Math.max(0, slash)), type: match[2] || "input",
            })) : null;
            records.push({token, kind, ordinal: Number(index), preview, source: {title: item.name || item.file}});
          }
        }
        node._h3BridgeReferences = records.sort((a, b) =>
          ["picture", "video", "audio"].indexOf(a.kind) - ["picture", "video", "audio"].indexOf(b.kind)
          || a.ordinal - b.ordinal);
        node._h3PromptIdeRefresh?.();
      } catch (error) { status(error.message, true); }
    },
  };
}
