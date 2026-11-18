import { mountEditor } from "./h3_prompt_vendor.js";
import { H3_PROMPT_IDE_SETTING_DEFINITIONS } from "./h3_prompt_ide_settings_core.mjs";
import { app, readPromptSetting, writePromptSetting } from "./h3_prompt_transport.js";
import { api, configureH3Transport, prepareH3Files } from "./h3_media_transport.js";
import { computeTags } from "./h3_media_vendor.js";

const workflowName = "MiniMax_H3_Seed_Hunter_V3_AstrBot";
export function mountH3Prompt({ bridge, host, textarea, status, download }) {
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
  const templateList = host.querySelector("[data-h3-template-list]");
  const templateName = host.querySelector("[data-h3-template-name]");
  const templateLoad = host.querySelector("[data-h3-template-load]");
  const templateSave = host.querySelector("[data-h3-template-save]");
  const templateDelete = host.querySelector("[data-h3-template-delete]");
  const templateRefresh = host.querySelector("[data-h3-template-refresh]");
  const templateMessage = host.querySelector("[data-h3-template-status]");
  const transfer = document.querySelector("[data-h3-transfer]");
  const transferMessage = transfer.querySelector("[data-h3-transfer-status]");
  const exportPrompt = transfer.querySelector("[data-h3-prompt-export]");
  const exportTemplates = transfer.querySelector("[data-h3-templates-export]");
  const importTemplates = transfer.querySelector("[data-h3-templates-import]");
  const importFile = transfer.querySelector("[data-h3-templates-file]");
  const templatePath = "studio/h3/prompt-templates";
  let templates = {};
  let revision;
  let templateBusy = false;
  function templateStatus(message, error = false) {
    for (const target of [templateMessage, transferMessage]) {
      target.textContent = message;
      target.hidden = !message;
      target.classList.toggle("error", error);
    }
  }
  function templateControls() {
    templateList.disabled = templateBusy;
    templateName.disabled = templateBusy;
    templateLoad.disabled = templateDelete.disabled = templateBusy || !loaded || !templateList.value;
    templateSave.disabled = templateBusy || !loaded || revision === undefined || !templateName.value.trim();
    templateSave.textContent = Object.hasOwn(templates, templateName.value.trim()) ? "更新模板" : "保存模板";
    templateRefresh.disabled = templateBusy;
    exportPrompt.disabled = templateBusy || !loaded;
    exportTemplates.disabled = importTemplates.disabled = templateBusy;
  }
  function templateCatalog(data, selected = templateList.value) {
    templates = data.templates;
    revision = data.revision;
    templateList.replaceChildren(new Option("选择模板", ""));
    for (const name of Object.keys(templates).sort((a, b) => a.localeCompare(b))) templateList.add(new Option(name, name));
    templateList.value = Object.hasOwn(templates, selected) ? selected : "";
  }
  async function templateAction(action) {
    if (templateBusy) return;
    templateBusy = true;
    templateControls();
    templateStatus("");
    try { await action(); }
    catch (error) { templateStatus(error.message, true); }
    finally { templateBusy = false; templateControls(); }
  }
  templateList.addEventListener("change", () => {
    templateName.value = templateList.value;
    templateControls();
  });
  templateName.addEventListener("input", templateControls);
  templateRefresh.addEventListener("click", () => templateAction(async () => {
    templateCatalog(await bridge.apiGet(templatePath));
    templateStatus("模板列表已刷新。");
  }));
  templateSave.addEventListener("click", () => templateAction(async () => {
    const name = templateName.value.trim();
    const mode = node._h3PromptIdeState.manualMode;
    templateCatalog(await bridge.apiPost(templatePath, {name, template: {prompt: text, mode}, revision}), name);
    templateName.value = name;
    templateStatus(`已保存模板「${name}」。`);
  }));
  templateLoad.addEventListener("click", () => {
    const template = templates[templateList.value];
    if (!template) return;
    updateText(template.prompt);
    const mode = host.querySelector(".h3ide-toolbar select");
    mode.value = template.mode;
    mode.dispatchEvent(new Event("change", {bubbles: true}));
    templateStatus(`已加载模板「${templateList.value}」。`);
  });
  templateDelete.addEventListener("click", () => templateAction(async () => {
    const name = templateList.value;
    templateCatalog(await bridge.apiPost(templatePath, {name, template: null, revision}));
    templateName.value = "";
    templateStatus(`已删除模板「${name}」。`);
  }));
  exportPrompt.addEventListener("click", () => templateAction(async () => {
    if (!text.trim() || text.length > 8000) throw new Error("请填写 1 到 8000 字符的提示词后导出。");
    const name = templateName.value.trim() || "H3 提示词";
    download({version: 1, templates: {[name]: {prompt: text, mode: node._h3PromptIdeState.manualMode}}}, "h3-prompt.json");
    templateStatus("已导出当前提示词及编辑模式。");
  }));
  exportTemplates.addEventListener("click", () => templateAction(async () => {
    templateCatalog(await bridge.apiGet(templatePath));
    download({version: 1, templates}, "h3-prompt-templates.json");
    templateStatus("已导出模板库。");
  }));
  importTemplates.addEventListener("click", () => { importFile.value = ""; importFile.click(); });
  importFile.addEventListener("change", () => {
    const file = importFile.files[0];
    if (!file) return;
    templateAction(async () => {
      if (file.size > 4 * 1024 * 1024) throw new Error("导入文件不能超过 4 MB。");
      if (revision === undefined) templateCatalog(await bridge.apiGet(templatePath));
      const content = (await file.text()).replace(/^\uFEFF/, "");
      if (file.name.toLowerCase().endsWith(".txt")) {
        if (!content.trim() || content.length > 8000) throw new Error("提示词须为 1 到 8000 字符。");
        if (loaded) {
          updateText(content);
          templateStatus("已载入提示词文本，可继续编辑或保存为模板。");
        } else {
          const name = file.name.replace(/\.txt$/i, "").trim().slice(0, 64) || "H3 提示词";
          const result = await bridge.apiPost(templatePath, {version: 1, templates: {[name]: {prompt: content, mode: "auto"}}, revision, replace: transfer.querySelector("[data-h3-templates-replace]").checked});
          templateCatalog(result);
          templateStatus(`已导入 ${result.imported} 项，跳过 ${result.skipped} 项。可在 H3 编辑器中选择模板加载。`);
        }
        return;
      }
      const data = JSON.parse(content);
      const result = await bridge.apiPost(templatePath, {
        version: data.version, templates: data.templates, revision,
        replace: transfer.querySelector("[data-h3-templates-replace]").checked,
      });
      templateCatalog(result);
      templateStatus(`已导入 ${result.imported} 项，跳过 ${result.skipped} 项。选择模板并点击加载即可使用。`);
    });
  });
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
      templateControls();
      if (revision === undefined) await templateAction(async () => {
        templateCatalog(await bridge.apiGet(templatePath));
      });
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

  templateControls();
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
      textarea.value = text;
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
