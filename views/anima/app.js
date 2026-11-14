import { mountImageReviews } from "./image_review.js";
import { mountPromptLibrary } from "./prompt_library.js";
import { mountVideos } from "./videos.js";

const remote = !window.AstrBotPluginView;
const bridge = window.AstrBotPluginView || (await import("./remote.js")).bridge;
const get = (id) => document.getElementById(id);
const kinds = { auto_image: "文生图 / 图生图", text_to_image: "文生图", image_to_image: "图生图", text_to_video: "文生视频", image_to_video: "图生视频", image_to_text: "图片反推" };
const loraCategories = { C: "人物", S: "风格", O: "其他" };
const waiWorkflow = "WAI-Illustrious_T2I_AstrBot";
const detailerWorkflow = "Detailer_V40_AstrBot";
const advancedV40 = "Advanced_Gemma_V40_AstrBot";
const sviWorkflow = "WAN22_SVI_I2V_AstrBot";
const lightningWorkflow = "WAN22_Lightning_Long_I2V_AstrBot";
const names = {
  Anima_T2I_AstrBot: "Anima T2I",
  [waiWorkflow]: "WAI-Illustrious T2I",
  [detailerWorkflow]: "Detailer V40",
  [advancedV40]: "Advanced Gemma V40",
  Anima_I2I_AIO_AstrBot: "Anima I2I AIO",
  Anima_Reverse_AstrBot: "Anima 反推流",
  WAN22_T2V_AstrBot: "WAN 2.2 · 文生视频",
  WAN22_I2V_AstrBot: "WAN 2.2 · 图生视频",
  [sviWorkflow]: "WAN 2.2 SVI · 分段图生视频",
  [lightningWorkflow]: "WAN 2.2 Lightning · 长视频",
  SDXL_Turbo_T2I_AstrBot: "SDXL Turbo",
};
let studio;
let persona;
let presets;
let presetIndex = -1;
let loraOrder;
let loraTagId;
let selected;
let unsaved = [];
let loading = false;
const workflowConfigRoute = "studio/workflow/configs";
const animaRoute = (name) => name === studio.anima ? "anima" : "";
const workflowTitle = (name) => names[name] || name;
const titles = {
  unet_name: "扩散模型", weight_dtype: "加载精度", clip_name: "文本编码器", vae_name: "VAE",
  seed: "种子", steps: "步数", cfg: "CFG", sampler: "采样器", scheduler: "调度器",
  sampler_name: "采样器", denoise: "降噪幅度", filename_prefix: "保存文件名前缀",
  text: "提示词", value: "数值", loras: "LoRA 列表", model_name: "模型", image: "参考素材",
  width: "宽度", height: "高度", length: "帧数", fps: "帧率", batch_size: "批量",
  desired_width: "目标宽度", desired_height: "目标高度", divisible_by: "尺寸对齐倍数",
  motion_latent_count: "继承动作潜帧", overlap: "重叠帧数", overlap_side: "重叠侧",
  overlap_mode: "重叠过渡方式", multiplier: "插帧倍数", ckpt_name: "模型权重",
  scale_by: "放大后缩放倍数", crf: "MP4 压缩质量（CRF）",
  save_metadata: "在视频中保留工作流元数据",
  lora_name: "LoRA 文件", strength_model: "模型强度", strength_clip: "文本编码器强度",
  aspect_ratio: "宽高比", megapixels: "百万像素", multiple: "尺寸倍数", grow_mask_by: "遮罩扩张",
  lllite_name: "LLLite 模型", strength: "强度", start_percent: "开始比例", end_percent: "结束比例",
  resolution: "预处理分辨率", upscale_by: "放大倍数", upscale: "放大倍数",
  tile_width: "分块宽度", tile_height: "分块高度", tile_size: "分块尺寸", tile_overlap: "分块重叠",
  artist_chain: "画师串", threshold: "置信度阈值",
  mode: "编码模式", "mode.text": "提示词", "mode.text_g": "CLIP G 提示词",
  "mode.text_l": "CLIP L 提示词", guide_size: "修复参考尺寸", max_size: "修复最大尺寸",
  noise_seed: "种子", shift: "Shift", start_at_step: "起始步", end_at_step: "结束步 / 切换步",
  model: "模型", device: "设备", config_override: "模型配置", threshold_mode: "阈值模式",
  general_threshold: "通用标签阈值", character_threshold: "角色标签阈值", copyright_threshold: "作品标签阈值",
  style_threshold: "风格标签阈值", meta_threshold: "元标签阈值", rating_threshold: "分级标签阈值",
  sort_by_confidence: "按置信度排序", character_first: "角色和作品优先", replace_underscore: "下划线转空格",
  include_style: "包含风格标签", include_meta: "包含元标签", include_rating: "包含分级标签",
  exclude_tags: "排除标签", tipo_model: "TIPO 模型", format: "扩写格式", nl_prompt: "扩写参考描述",
  ban_tags: "禁止扩写的标签", tag_length: "标签长度", nl_length: "描述长度", temperature: "温度",
  top_p: "Top P", min_p: "Min P", top_k: "Top K", delimiter: "标签与描述分隔符", expand_caption: "启用 TIPO 扩写",
};
const priority = ["aio", "22", "40", "48", "26", "67", "74", "77", "50", "507", "510"];
const parameterCategories = ["基础设置", "参考与构图", "局部修复", "采样与放大", "色彩与滤镜", "输出"];
const aioLayout = [
  ["基础设置", [
    ["扩散模型", ["aio.loader", "1758", "1077"]],
    ["文本编码器", ["1073"]],
    ["VAE", ["1074"]],
    ["负向提示词", ["1611"]],
  ]],
  ["参考与构图", [
    ["QQ 图片重绘", ["aio.latent", "118.denoise", "1424"]],
    ["文生图尺寸", ["aio.size", "1427", "1425", "1428"]],
    ["WD14 反推", ["aio.threshold"]],
  ]],
  ["LLLite 控制", [
    ["控制模式", ["aio.control"]],
    ["参考图与深度 LLLite", ["1038", "1370"]],
    ["Inpaint LLLite", ["1039"]],
  ]],
  ["LoRA", [
    ["人物 LoRA", ["aio.1846", "1846"]],
    ["画风质量 LoRA", ["aio.1850", "1850"]],
    ["动漫 LoRA", ["aio.1849", "1849"]],
    ["写实 LoRA", ["aio.1847", "1847"]],
    ["杂项 LoRA", ["aio.1848", "1848"]],
  ]],
  ["画师混合与加速", [
    ["画师混合", ["aio.artists", "1690", "1691"]],
    ["画师混合高级参数", ["1689"]],
    ["TeaCache", ["aio.teacache", "1076"]],
    ["SageAttention", ["aio.sage", "1687"]],
    ["生成后清理显存", ["aio.cleanup", "1011"]],
  ]],
  ["采样与放大", [
    ["主采样", ["118"]],
    ["放大方式", ["aio.upscale"]],
    ["Ultimate SD Upscale", ["279", "1665"]],
    ["RTX VSR", ["1818"]],
    ["VOSR2", ["1825", "1824"]],
  ]],
  ["输出", [["图片保存", ["1649"]]]],
];

function aioParameterGroups(fields) {
  const remaining = new Map(fields.map((field) => [`${field.node}.${field.name}`, field]));
  const categories = new Map();
  for (const [category, groups] of aioLayout) {
    const assigned = new Map();
    for (const [title, keys] of groups) {
      const members = [];
      for (const key of keys) {
        for (const [id, field] of remaining) {
          if (id !== key && field.node !== key) continue;
          members.push({ ...field, category, groupTitle: title });
          remaining.delete(id);
        }
      }
      if (members.length) assigned.set(title, members);
    }
    if (assigned.size) categories.set(category, assigned);
  }
  if (remaining.size) categories.set("其他参数", new Map([["", [...remaining.values()]]]));
  return categories;
}
let current;
let controls = new Map();
let switches = new Map();

const errorNotice = get("error-notice");
const successNotice = get("success-notice");
const unsavedActions = get("unsaved-actions");
let noticeTimer;
get("dismiss-error").addEventListener("click", () => { errorNotice.hidden = true; });

function setStatus(id, text, error) {
  const status = get(id);
  status.textContent = text;
  status.classList.toggle("error", error);
  if (error && text) {
    successNotice.hidden = true;
    errorNotice.dataset.source = id;
    errorNotice.hidden = false;
    unsavedActions.hidden = true;
    get("error-notice-text").textContent = text;
  } else if (errorNotice.dataset.source === id) {
    errorNotice.hidden = true;
    unsavedActions.hidden = true;
  }
}

function message(text, error = false) {
  setStatus("status", text, error);
}

function notify(text) {
  clearTimeout(noticeTimer);
  successNotice.textContent = text;
  successNotice.hidden = false;
  noticeTimer = setTimeout(() => { successNotice.hidden = true; }, 5500);
}

function completed(text) {
  message(text);
  notify(text);
}

function sviLoraEditor(field, container) {
  container.classList.add("wide");
  const input = document.createElement("input");
  input.type = "hidden";
  input.value = JSON.stringify(field.value);
  const rows = document.createElement("div");
  rows.className = "svi-lora-rows";
  const add = document.createElement("button");
  add.type = "button";
  add.textContent = "添加 LoRA";
  const sync = () => {
    input.value = JSON.stringify([...rows.children].map((row) => {
      const [phase, name, strength] = row.children;
      return { phase: phase.value, name: name.value, strength: strength.valueAsNumber };
    }));
    add.disabled = !field.choices.length || rows.children.length >= 16;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const addRow = ({ phase = "high", name = "", strength = 1 } = {}) => {
    const row = document.createElement("div");
    row.className = "svi-lora-row";
    const target = document.createElement("select");
    target.setAttribute("aria-label", "LoRA 作用阶段");
    target.add(new Option("高噪声", "high"));
    target.add(new Option("低噪声", "low"));
    target.add(new Option("高低噪声", "both"));
    if (field.node === "svi") {
      target.add(new Option("仅 SVI 高噪声", "svi-high"));
      target.add(new Option("仅 Lightning 高噪声", "lightning-high"));
    }
    target.value = phase;
    const file = document.createElement("select");
    file.setAttribute("aria-label", "LoRA 文件");
    file.add(new Option("选择视频 LoRA", ""));
    for (const choice of field.choices) file.add(new Option(choice.replaceAll("\\", "/"), choice));
    if (name && !field.choices.includes(name)) file.add(new Option(`${name}（当前不可用）`, name));
    file.value = name;
    const weight = document.createElement("input");
    weight.type = "number";
    weight.step = "any";
    weight.value = strength;
    weight.setAttribute("aria-label", "LoRA 强度");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "移除";
    remove.addEventListener("click", () => { row.remove(); sync(); });
    row.addEventListener("input", sync);
    row.append(target, file, weight, remove);
    rows.append(row);
  };
  for (const row of field.value) addRow(row);
  add.disabled = !field.choices.length || rows.children.length >= 16;
  add.addEventListener("click", () => { addRow(); sync(); });
  container.append(field.label, rows, add, input);
  controls.set(`${field.node}.${field.name}`, { field, input, original: input.value, name: field.label });
  return container;
}

function fieldControl(field) {
  const label = document.createElement(field.editor ? "div" : "label");
  label.className = "field";
  const name = field.label || (field.node === "aio" && field.kind === "BOOLEAN" ? "启用"
    : field.node === "aio" || field.name === "value" ? field.title : titles[field.name] || field.name);
  const source = document.createElement("small");
  source.textContent = ["aio", "svi", "lightning"].includes(field.node) ? "" :
    (name === field.title || field.title === field.groupTitle ? "" : field.title + " · ")
    + `#${field.node}` + (field.active ? "" : " · 旁路");
  source.hidden = !source.textContent;
  label.dataset.active = String(field.active);
  label.dataset.search = [field.category, name, field.title, field.name, `#${field.node}`]
    .join(" ").toLowerCase();
  if (field.editor === "svi-loras") return sviLoraEditor(field, label);
  const input = document.createElement(field.kind === "select" ? "select"
    : field.multiline || field.kind === "json" ? "textarea" : "input");
  if (field.kind === "select") {
    field.choices.forEach((value, index) => input.add(new Option(String(value), String(index))));
    const index = field.choices.indexOf(field.value);
    if (index < 0) input.add(new Option(String(field.value) + "（当前不可用）", "-1", true, true));
    else input.value = String(index);
  } else if (field.kind === "BOOLEAN") {
    input.type = "checkbox";
    input.checked = field.value;
    if (field.node === "aio") input.setAttribute("aria-label", `启用 ${field.title}`);
  } else if (field.kind === "json") {
    input.rows = 4;
    input.value = JSON.stringify(field.value, null, 2);
  } else {
    input.value = field.value ?? "";
    if (field.placeholder) input.placeholder = field.placeholder;
    if (field.kind === "FLOAT") {
      input.type = "number";
      input.step = "any";
      if (field.min != null) input.min = field.min;
      if (field.max != null) input.max = field.max;
    } else if (field.kind === "INT") {
      input.inputMode = "numeric";
      input.pattern = "-?[0-9]+";
    }
  }
  if (input.tagName === "TEXTAREA") label.classList.add("wide");
  if (field.kind === "BOOLEAN") {
    const toggle = document.createElement("span");
    toggle.className = "parameter-toggle";
    toggle.append(input, name);
    label.append(toggle, source);
  } else {
    label.append(name, source, input);
  }
  if (field.name === "loras") {
    const help = document.createElement("small");
    help.textContent = '例如 [{"name":"LoRA 文件名","strength":0.8,"active":true}]';
    label.append(help);
  }
  controls.set(`${field.node}.${field.name}`, { field, input, original: input.value, name });
  return label;
}

function parameterGroup(fields, title = "", branchId) {
  const group = document.createElement("div");
  group.className = title ? "parameter-group repair-group" : "parameter-group";
  group.dataset.search = (title ?? "").toLowerCase();
  if (title) {
    const heading = document.createElement("div");
    heading.className = "repair-heading";
    const label = document.createElement("h3");
    label.textContent = title;
    heading.append(label);
    if (branchId) {
      group.dataset.branch = branchId;
      const original = switches.get(branchId).input;
      const toggle = document.createElement("label");
      toggle.className = "toggle";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = original.checked;
      input.setAttribute("aria-label", `启用 ${title}`);
      input.addEventListener("change", () => {
        original.checked = input.checked;
        original.dispatchEvent(new Event("change", { bubbles: true }));
      });
      original.addEventListener("change", () => { input.checked = original.checked; });
      toggle.append(input, "启用");
      heading.append(toggle);
    }
    group.append(heading);
    if (branchId === "7") {
      const note = document.createElement("small");
      note.textContent = "控制局部检测与重绘。图片归档由归档规则决定。";
      group.append(note);
    }
  }
  const grid = document.createElement("div");
  grid.className = "grid parameter-grid";
  for (const field of fields) grid.append(fieldControl(field));
  group.append(grid);
  if (!title) {
    const empty = document.createElement("small");
    empty.className = "parameter-dormant";
    empty.textContent = "此分类当前只有旁路参数。";
    group.append(empty);
  }
  return group;
}

function renderFields(fields, repairBranches, order, retainOpen, isAio) {
  const container = get("nodes");
  const expanded = retainOpen ? new Map([...container.children].map((card) => [
    card.dataset.category, card.dataset.openBeforeSearch ?? String(card.open),
  ])) : new Map();
  const aioGroups = isAio ? aioParameterGroups(fields) : null;
  const categories = new Map();
  const rank = new Map(order.map((node, index) => [node, index]));
  const sorted = [...fields].sort((a, b) => (rank.get(a.node) ?? order.length) - (rank.get(b.node) ?? order.length));
  for (const field of sorted) {
    const name = field.category || "全部参数";
    if (!categories.has(name)) categories.set(name, []);
    categories.get(name).push(field);
  }
  if (repairBranches.length && !categories.has("局部修复")) categories.set("局部修复", []);
  container.replaceChildren();
  const categoryOrder = aioGroups ? aioGroups.keys() : new Set([...parameterCategories, ...categories.keys()]);
  for (const name of categoryOrder) {
    if (!(aioGroups || categories).has(name)) continue;
    const card = document.createElement("details");
    card.className = "parameter-card";
    card.dataset.category = name;
    card.open = expanded.has(name) ? expanded.get(name) === "true" : container.children.length === 0;
    const summary = document.createElement("summary");
    const count = document.createElement("span");
    count.className = "parameter-count";
    summary.append(name, count);
    card.append(summary);
    const categoryFields = categories.get(name);
    if (aioGroups) {
      for (const [title, members] of aioGroups.get(name)) {
        const group = parameterGroup(members, title);
        if (name === "LoRA") group.classList.add("lora-parameter-group");
        card.append(group);
      }
    } else if (name === "局部修复" && repairBranches.length) {
      const branchIds = new Set(repairBranches.map((branch) => branch.id));
      for (const branch of repairBranches) {
        card.append(parameterGroup(categoryFields.filter((field) => field.repair_group === branch.id),
          branch.title, branch.id));
      }
      const shared = categoryFields.filter((field) => !branchIds.has(field.repair_group));
      if (shared.length) card.append(parameterGroup(shared, "共用修复设置"));
    } else {
      const nodeGroups = new Map();
      for (const field of categoryFields) {
        if (!nodeGroups.has(field.node)) nodeGroups.set(field.node, []);
        nodeGroups.get(field.node).push(field);
      }
      if (nodeGroups.size === 1) {
        card.append(parameterGroup(categoryFields));
      } else {
        for (const members of nodeGroups.values()) {
          const title = members[0].title || members[0].class_type || `#${members[0].node}`;
          card.append(parameterGroup(members.map((field) => ({ ...field, groupTitle: title })), title));
        }
      }
    }
    container.append(card);
  }
}

function updateBranchSummary() {
  const entries = [...switches.values()];
  const count = entries.filter(({ input }) => input.checked).length;
  const unsaved = entries.some(({ input, enabled }) => input.checked !== enabled);
  get("branch-summary").textContent = `分支开关 · ${count} 项已选${unsaved ? " · 未保存" : ""}`;
}

function render(data, workflow = selected) {
  const sameWorkflow = current?.workflow === data.workflow;
  const anima = Boolean(animaRoute(data.workflow));
  const illustrious = data.workflow === waiWorkflow;
  const reverse = data.kind === "image_to_text";
  get("workflow-title").textContent = workflowTitle(data.workflow);
  get("workflow-kind").textContent = kinds[data.kind || workflow?.kind] || "工作流";
  const note = get("workflow-note");
  note.textContent = data.requires_image ? (anima && data.reference_source === "auto"
    ? "未设置可用的面板参考图，生成时请在 QQ 附图或引用图片。"
    : "需要 QQ 附图或引用图片。")
    : data.workflow.startsWith("WAN22_") ? "高、低噪声阶段的共享步数和切换步会同步保存。" : "";
  if (data.workflow === sviWorkflow) {
    note.textContent = "在 QQ 附图或引用图片后发送 /comfy gen --wf svi。段号顺序留空时使用前 N 段；每段可独立追加提示词和 LoRA。";
  }
  if (data.workflow === lightningWorkflow) {
    note.textContent = "在 QQ 附图或引用图片后发送 /comfy gen --wf lightning。最多四段，段号顺序留空时使用前 N 段。";
  }
  if (data.workflow === studio.anima_image) note.textContent = "QQ 附图或引用图后，用 /comfy gen --wf i2i 重绘。多张图可加 --image 2。遮罩重绘请发送保留透明通道的 PNG，透明区域为重绘区域。";
  if (reverse) {
    note.textContent = "在 QQ 附图或回复图片后发送 /comfy prompt，也可以说「帮我反推这张图的提示词」。默认使用 PixAI。";
    if (!data.fields.some((field) => field.node === "416" && field.name === "model")) {
      note.textContent += " 请先在本机 ComfyUI 安装 PixAITaggerPlus 和 PixAI 模型。";
    }
    if (!data.fields.some((field) => field.node === "400" && field.name === "tipo_model")) {
      note.textContent += " 启用 TIPO 扩写前需安装 TIPO 节点和本地 GGUF 模型。";
    }
  }
  note.textContent = note.textContent.trim();
  note.hidden = !note.textContent;
  for (const id of ["reference-settings", "sync", "branch-dependencies"]) {
    get(id).hidden = !anima;
  }
  get("anima-branches").hidden = !data.branches.length;
  const v40 = data.workflow === advancedV40 || data.workflow === detailerWorkflow;
  if (v40 && data.image_inputs) {
    const summary = studio.workflows.find((item) => item.name === data.workflow);
    if (summary) Object.assign(summary, { requires_image: data.requires_image, image_inputs: data.image_inputs });
  }
  get("dormant-control").hidden = !anima && !illustrious && !v40;
  if (!sameWorkflow) {
    get("show-dormant").checked = v40;
    get("filter").value = "";
  }
  get("reference-source").value = data.reference_source || "qq";
  get("reference-source").disabled = data.workflow === studio.anima_image;
  get("branch-report").hidden = true;
  get("branch-check-status").textContent = "";
  get("branch-models").textContent = "";
  controls = new Map();
  switches = new Map();
  get("prefix-setting").hidden = reverse;
  get("prompt-settings-title").textContent = reverse ? "TIPO 种子" : "提示词与种子";
  get("seed-note").textContent = reverse ? "仅在启用 TIPO 扩写时生效。随机模式每次使用新种子。"
    : "随机模式每次生成使用新种子。负向提示词与种子数值可在下方调整。";
  get("prefix").value = data.positive_prefix;
  get("fixed").checked = data.use_canvas_seed;
  get("sweep-lora-setting").hidden = !Object.hasOwn(data, "sweep_lora_family");
  const sweepFamily = get("sweep-lora-family");
  const directories = data.sweep_lora_directories ?? [];
  sweepFamily.replaceChildren(...directories.map((name) => new Option(name, name)));
  if (data.sweep_lora_optional) sweepFamily.prepend(new Option("未配置 LoRA 目录", ""));
  if (data.sweep_lora_family && !directories.includes(data.sweep_lora_family)) {
    const missing = new Option(data.sweep_lora_family + "（文件夹不可用）", data.sweep_lora_family);
    missing.disabled = true;
    sweepFamily.add(missing);
  }
  sweepFamily.value = data.sweep_lora_family || "";
  get("branches").replaceChildren();
  const categories = new Map();
  for (const branch of data.branches) {
    if (!categories.has(branch.category)) {
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = branch.category;
      const grid = document.createElement("div");
      grid.className = "grid";
      if (branch.category === "局部修复") grid.classList.add("repair-switches");
      details.append(summary, grid);
      get("branches").append(details);
      categories.set(branch.category, grid);
    }
    const label = document.createElement("label");
    label.className = "toggle";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = branch.enabled;
    switches.set(branch.id, { input, enabled: branch.enabled, title: branch.title });
    label.append(input, branch.title);
    categories.get(branch.category).append(label);
  }
  updateBranchSummary();
  const order = anima ? priority : reverse ? ["416", "caption", "400", "444"] : ["7", "13", "1", "2", "3", "6", "5", "10", "11"];
  renderFields(
    data.fields.map((field) => field.editor === "svi-loras" ? { ...field, choices: data.svi_lora_files } : field),
    data.branches.filter((branch) => branch.category === "局部修复"),
    order, sameWorkflow, data.workflow === studio.anima_image,
  );
  filterFields();
  current = data;
  if (!sameWorkflow) renderWorkflowAlias();
  updateUnsaved();
}

async function checkBranches() {
  const button = get("check-branches");
  const status = get("branch-check-status");
  button.disabled = true;
  get("branch-report").hidden = true;
  get("branch-models").textContent = "";
  status.textContent = "正在检查已保存的分支配置…";
  try {
    const result = await bridge.apiGet(animaRoute(current.workflow) + "/branches");
    if (result.revision !== current.revision) {
      status.textContent = "工作流有更新，请刷新页面后重新检查。";
      return;
    }
    const labels = { ready: "依赖检查通过", blocked: "暂不可用", idle: "需搭配其他分支" };
    const tbody = get("branch-rows");
    tbody.replaceChildren();
    for (const branch of result.branches) {
      const row = tbody.insertRow();
      row.insertCell().textContent = branch.title + (branch.enabled ? "（已启用）" : "（旁路）");
      const resultCell = row.insertCell();
      resultCell.textContent = labels[branch.status];
      resultCell.dataset.state = branch.status;
      if (branch.detail) {
        const detail = document.createElement("small");
        detail.textContent = branch.detail;
        resultCell.append(detail);
      }
      row.insertCell().textContent = branch.resources.join("、") || "无独立模型";
    }
    const count = result.branches.filter((branch) => branch.status === "ready").length;
    status.textContent = `${count} / ${result.branches.length} 项通过依赖检查。结果以当前保存的分支搭配为准。`;
    get("branch-models").textContent = "共享模型：" + (result.models.join("、") || "未识别");
    get("branch-report").hidden = false;
  } catch (error) {
    status.textContent = "检查失败：" + error.message;
  } finally {
    button.disabled = false;
  }
}

get("branches").addEventListener("change", () => {
  updateBranchSummary();
  filterFields();
});
get("check-branches").addEventListener("click", checkBranches);

function filterFields() {
  const query = get("filter").value.trim().toLowerCase();
  const dormant = get("show-dormant").checked;
  let total = 0;
  let found = false;
  for (const card of get("nodes").children) {
    let count = 0;
    let visible = false;
    for (const group of card.querySelectorAll(".parameter-group")) {
      const titleMatches = group.dataset.search.includes(query);
      const showDormant = dormant || switches.get(group.dataset.branch)?.input.checked;
      let fieldCount = 0;
      const grid = group.querySelector(".parameter-grid");
      for (const field of grid.children) {
        field.hidden = (!titleMatches && !field.dataset.search.includes(query))
          || (!showDormant && field.dataset.active === "false");
        if (!field.hidden) fieldCount++;
      }
      grid.hidden = fieldCount === 0;
      const empty = group.querySelector(".parameter-dormant");
      if (empty) empty.hidden = fieldCount !== 0;
      group.hidden = Boolean(query) && !titleMatches && fieldCount === 0;
      visible ||= !group.hidden;
      count += fieldCount;
    }
    card.querySelector(".parameter-count").textContent = `${count} 项`;
    card.hidden = !visible;
    if (query) {
      card.dataset.openBeforeSearch ??= String(card.open);
      card.open = visible;
    } else if ("openBeforeSearch" in card.dataset) {
      card.open = card.dataset.openBeforeSearch === "true";
      delete card.dataset.openBeforeSearch;
    }
    total += count;
    found ||= visible;
  }
  get("count").textContent = `· ${total} 项`;
  get("parameter-empty").hidden = found;
}

function fieldChanged({ field, input, original }) {
  return field.kind === "BOOLEAN" ? input.checked !== field.value : input.value !== original;
}

function workflowChanges() {
  const changes = [];
  const add = (label, input, before, after) => {
    changes.push({ label, input, before, after, target: input.closest(".field, .toggle") || input });
  };
  const prefix = get("prefix");
  const prefixBefore = current.positive_prefix.replace(/\r\n?/g, "\n");
  if (prefix.value !== prefixBefore) add("正向提示词前缀", prefix, prefixBefore, prefix.value);
  const fixed = get("fixed");
  if (fixed.checked !== current.use_canvas_seed) add("固定种子", fixed, current.use_canvas_seed, fixed.checked);
  const sweepFamily = get("sweep-lora-family");
  if (Object.hasOwn(current, "sweep_lora_family") && sweepFamily.value !== current.sweep_lora_family) {
    add("人物 LoRA 扫图目录", sweepFamily,
      [...sweepFamily.options].find((option) => option.value === current.sweep_lora_family)?.text,
      sweepFamily.selectedOptions[0]?.text);
  }
  const reference = get("reference-source");
  const referenceBefore = current.reference_source || "qq";
  if (!get("reference-settings").hidden && reference.value !== referenceBefore) {
    add("参考图来源", reference, [...reference.options].find((option) => option.value === referenceBefore)?.text,
      reference.selectedOptions[0]?.text);
  }

  for (const { input, enabled, title } of switches.values()) {
    if (input.checked !== enabled) add(`分支 · ${title}`, input, enabled, input.checked);
  }
  for (const control of controls.values()) {
    if (!fieldChanged(control)) continue;
    const { field, input, original, name } = control;
    const group = field.groupTitle || field.title;
    const node = ["aio", "svi", "lightning"].includes(field.node) ? "" : ` · #${field.node}`;
    const label = (group && group !== name ? `${group} · ${name}` : name) + node;
    add(label, input, field.kind === "json" || field.editor ? original : field.value,
      field.kind === "BOOLEAN" ? input.checked : field.kind === "select" ? input.selectedOptions[0]?.text : input.value);
  }
  return changes;
}

function describeChange(value) {
  if (typeof value === "boolean") return value ? "开启" : "关闭";
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > 72 ? text.slice(0, 72) + "…" : text || "（空）";
}

function workflowTab() {
  return [...get("workflow-list").children].find((item) => item.dataset.name === selected.name);
}

function locateChange({ input, target }) {
  showPanel("settings", workflowTab());
  if (target.closest("#nodes") && target.closest("[hidden]")) {
    get("filter").value = "";
    if (target.dataset.active === "false") get("show-dormant").checked = true;
    filterFields();
  }
  for (let group = target.closest("details"); group; group = group.parentElement.closest("details")) {
    group.open = true;
  }
  const control = input.type === "hidden" ? target.querySelector("select, button") : input;
  control?.focus({ preventScroll: true });
  const aboveNotice = errorNotice.getBoundingClientRect().top;
  const position = Math.min(window.innerHeight / 3, aboveNotice / 2);
  window.scrollBy(0, target.getBoundingClientRect().top - position);
}

function renderUnsavedNotice() {
  const list = get("unsaved-changes");
  list.replaceChildren();
  for (const change of unsaved) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = change.label;
    const values = document.createElement("small");
    values.textContent = `${describeChange(change.before)} → ${describeChange(change.after)}`;
    button.append(values);
    button.addEventListener("click", () => locateChange(change));
    item.append(button);
    list.append(item);
  }
  get("error-notice-text").textContent = `当前工作流有 ${unsaved.length} 项未保存的改动。`;
}

function updateUnsaved() {
  for (const { target } of unsaved) target.classList.remove("unsaved-field");
  unsaved = workflowChanges();
  for (const { target } of unsaved) target.classList.add("unsaved-field");
  const summary = get("show-unsaved");
  summary.hidden = get("discard").hidden = unsaved.length === 0;
  summary.textContent = `未保存 · ${unsaved.length} 项`;
  if (unsavedActions.hidden) return;
  if (unsaved.length) renderUnsavedNotice();
  else message("");
}

function showUnsavedNotice() {
  if (!unsaved.length) return;
  message("当前工作流有未保存的改动，请先保存或放弃修改。", true);
  unsavedActions.hidden = false;
  renderUnsavedNotice();
  locateChange(unsaved[0]);
}

async function save(rebuild) {
  if (loading || get("save").disabled) return;
  const configName = get("workflow-config-name").value;
  get("save").disabled = get("sync").disabled = get("save-branches").disabled = true;
  const configSelect = get("workflow-config-name");
  configSelect.disabled = true;
  updateWorkflowConfigButtons();
  try {
    if (configName && !rebuild && !unsaved.length) {
      await bridge.apiPost(workflowConfigRoute, {
        action: "update", name: configName, workflow: current.workflow, revision: current.revision,
      });
      completed(`已保存配置「${configName}」。`);
      return;
    }
    const changes = {};
    for (const [key, control] of controls) {
      if (!fieldChanged(control)) continue;
      const { field, input } = control;
      changes[key] = field.kind === "BOOLEAN" ? input.checked
        : field.kind === "select" ? field.choices[Number(input.value)]
        : field.kind === "FLOAT" ? input.valueAsNumber
        : field.kind === "json" ? JSON.parse(input.value) : input.value;
    }
    const branches = {};
    for (const [id, { input, enabled }] of switches) {
      if (input.checked !== enabled) branches[id] = input.checked;
    }
    message(configName ? `正在更新「${configName}」…` : "正在保存设置…");
    const route = animaRoute(current.workflow);
    const endpoint = route ? route + "/settings" : "studio/workflow";
    render(await bridge.apiPost(endpoint, {
      workflow: current.workflow, revision: current.revision, changes, branches, rebuild,
      positive_prefix: get("prefix").value, use_canvas_seed: get("fixed").checked,
      reference_source: get("reference-source").value,
      ...(Object.hasOwn(current, "sweep_lora_family") ? { sweep_lora_family: get("sweep-lora-family").value } : {}),
      ...(configName ? { update_config: configName } : {}),
    }));
    if (configName) completed(`已保存参数并更新「${configName}」。`);
    else completed(current.kind === "image_to_text" ? "已保存。下一次反推会使用这些设置。" : "已保存。下一次生成会使用这些设置。");
  } catch (error) {
    message(error.message, true);
  } finally {
    get("save").disabled = get("sync").disabled = get("save-branches").disabled = false;
    configSelect.disabled = false;
    updateWorkflowConfigButtons();
  }
}

function activate(tab) {
  for (const button of document.querySelectorAll(".workflow-tab")) {
    button.setAttribute("aria-pressed", String(button === tab));
  }
}

function showPanel(id, tab) {
  activate(tab);
  for (const panel of ["settings", "archive", "persona", "lora-order", "presets", "queue", "exports", "image-review", "image-gallery", "videos"]) get(panel).hidden = panel !== id;
  if (remote) get("remote-workflow").value = id === "settings" ? selected.name : "";
}

const imageReviews = mountImageReviews({
  get, bridge, showPanel, message, notify, workflowTitle,
  openPreset: openImagePreset,
  canOpen: () => Boolean(studio && !loading && !get("save").disabled),
});
const queueMask = imageReviews.mask;
mountVideos({
  get, bridge, showPanel, message, notify,
  canOpen: () => Boolean(studio && !loading && !get("save").disabled),
});

function downloadJson(data, filename) {
  const file = new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function movedRows(rows, from, to) {
  const result = [...rows];
  result.splice(to, 0, result.splice(from, 1)[0]);
  return result;
}

function bindOrderDrag(rows, onMove, handle) {
  const sortable = new Set(rows);
  let dragging = null;
  let marker;
  function clearMarker() {
    marker?.classList.remove("drop-before", "drop-after");
    marker = null;
  }
  for (const row of rows) {
    const grip = handle(row);
    if (!grip.draggable) continue;
    grip.addEventListener("dragstart", (event) => {
      dragging = row;
      row.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", row.textContent);
      event.dataTransfer.setDragImage(row, 16, row.offsetHeight / 2);
    });
    grip.addEventListener("dragend", () => {
      dragging = null;
      row.classList.remove("dragging");
      clearMarker();
    });
    const isAfter = (event) => {
      const bounds = row.getBoundingClientRect();
      return event.clientY > bounds.top + bounds.height / 2;
    };
    row.addEventListener("dragover", (event) => {
      if (dragging === null) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      clearMarker();
      marker = row;
      row.classList.add(isAfter(event) ? "drop-after" : "drop-before");
    });
    row.addEventListener("dragleave", (event) => {
      if (marker === row && !row.contains(event.relatedTarget)) clearMarker();
    });
    row.addEventListener("drop", (event) => {
      if (dragging === null) return;
      event.preventDefault();
      const current = [...row.parentElement.children].filter((item) => sortable.has(item));
      const from = current.indexOf(dragging);
      const insertion = current.indexOf(row) + Number(isAfter(event));
      const to = insertion > from ? insertion - 1 : insertion;
      dragging.classList.remove("dragging");
      dragging = null;
      clearMarker();
      if (from !== -1 && from !== to) onMove(from, to, current);
    });
  }
}

function renderOrderList(list, items, { locked, onMove, onSelect, selectedIndex, empty }) {
  list.replaceChildren();
  if (!items.length) {
    const row = document.createElement("li");
    row.className = "order-empty";
    row.textContent = empty;
    list.append(row);
    return;
  }
  items.forEach(({ title, detail, id, number: code, preview }, index) => {
    const row = document.createElement("li");
    row.className = "order-row";
    if (id) row.dataset.id = id;
    row.classList.toggle("selected", selectedIndex === index);
    const grip = document.createElement("span");
    grip.className = "order-grip";
    grip.textContent = "⠿";
    grip.title = "拖动调整编号";
    grip.setAttribute("aria-hidden", "true");
    grip.draggable = !locked && items.length > 1;
    const number = document.createElement("span");
    number.className = "order-number";
    number.textContent = code ?? String(index + 1);
    const label = document.createElement(onSelect ? "button" : "div");
    label.className = "order-name";
    label.textContent = title;
    if (preview) {
      const image = document.createElement("img");
      image.className = "preset-list-preview";
      image.alt = "";
      image.dataset.image = preview;
      image.dataset.state = "favourite";
      image.decoding = "async";
      label.prepend(image);
      imageReviews.previews.observe(image);
    }
    if (onSelect) {
      label.type = "button";
      label.disabled = locked;
      label.setAttribute("aria-pressed", String(selectedIndex === index));
      label.addEventListener("click", () => onSelect(index));
    }
    if (detail) {
      const meta = document.createElement("small");
      meta.textContent = detail;
      label.append(meta);
    }
    const actions = document.createElement("div");
    actions.className = "order-actions";
    for (const [offset, symbol, verb] of [[-1, "↑", "上移"], [1, "↓", "下移"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = symbol;
      button.title = verb;
      button.setAttribute("aria-label", `${verb} ${title}`);
      const to = index + offset;
      button.disabled = locked || to < 0 || to >= items.length;
      button.addEventListener("click", () => onMove(index, to));
      actions.append(button);
    }
    row.append(grip, number, label, actions);
    list.append(row);
  });
  bindOrderDrag([...list.children], onMove, (row) => row.firstElementChild);
}

function loraOrderQuery() {
  return { family: get("lora-family").value };
}

function loraDirectoryOptions() {
  return studio.lora_directories ?? Object.keys(studio.lora_families ?? {});
}

function renderLoraOrder(locked = false) {
  const entries = loraOrder?.entries ?? [];
  get("lora-order-count").textContent = `${entries.length} 个 LoRA`;
  get("lora-order-refresh").disabled = get("lora-family").disabled = locked;
  const family = get("lora-family").value;
  const command = "/comfy lora " + (family === "illustrious" ? "wai" : family);
  get("lora-order-help").textContent =
    Object.hasOwn(studio.lora_families ?? {}, family)
      ? `QQ 查看编号用 ${command} list，预约用 ${command} use C1:0.85 S1。`
      : "人物 LoRA 扫图使用此处保存的分组、顺序、权重和附带词。";
  const groups = get("lora-order-list");
  groups.replaceChildren();
  for (const [code, title] of Object.entries(loraCategories)) {
    const indices = entries.flatMap((row, index) => row.category === code ? [index] : []);
    const heading = document.createElement("h3");
    heading.textContent = `${title}（${code}）`;
    const list = document.createElement("ol");
    list.className = "order-list";
    list.setAttribute("aria-label", heading.textContent);
    const items = indices.map((index) => {
      const row = entries[index];
      return { ...row, detail: `${row.filename} · 默认权重 ${row.default_strength ?? 1} · ${row.tag ? "已启用附带词" : "无附带词"}` };
    });
    renderOrderList(list, items, {
      locked, onMove: (from, to) => moveLora(indices, from, to),
      onSelect: (index) => editLoraTag(indices[index]), empty: "此分类暂无 LoRA。",
    });
    groups.append(heading, list);
  }
}

async function openLoraOrder() {
  if (!studio || loading || get("save").disabled) return;
  loading = true;
  showPanel("lora-order", get("open-lora-order"));
  loraOrder = null;
  renderLoraOrder(true);
  message("正在读取 LoRA 目录…");
  try {
    loraOrder = await bridge.apiGet("studio/lora-order", loraOrderQuery());
    message("");
  } catch (error) {
    message(error.message, true);
  } finally {
    loading = false;
    renderLoraOrder();
  }
}

async function moveLora(indices, from, to) {
  if (loading || !loraOrder) return;
  loading = true;
  renderLoraOrder(true);
  const { entries, revision } = loraOrder;
  const order = entries.map((row) => row.id);
  const reordered = movedRows(indices.map((index) => order[index]), from, to);
  indices.forEach((index, position) => { order[index] = reordered[position]; });
  message("正在保存 LoRA 编号…");
  try {
    loraOrder = await bridge.apiPost("studio/lora-order", { ...loraOrderQuery(), order, revision });
    const row = loraOrder.entries.find((entry) => entry.id === entries[indices[from]].id);
    completed(`已保存。QQ 中的 ${row.title} 现在是 ${row.number}。`);
  } catch (error) {
    message(error.message, true);
  } finally {
    loading = false;
    renderLoraOrder();
  }
}

function editLoraTag(index) {
  if (loading) return;
  const row = loraOrder.entries[index];
  loraTagId = row.id;
  get("lora-tag-name").textContent = `${row.number} · ${row.title}`;
  get("lora-category").value = row.category;
  get("lora-default-strength").value = row.default_strength ?? 1;
  get("lora-tag-hash").textContent = `SHA-256 · ${row.sha256}`;
  get("lora-tag-text").value = row.tag;
  get("lora-tag-default").textContent = row.default_tag ? `默认触发词 · ${row.default_tag}` : "这个 LoRA 没有默认触发词。";
  get("lora-tag-error").hidden = true;
  get("lora-tag-dialog").showModal();
  get("lora-tag-text").focus();
}

async function saveLoraTag(tag, category, defaultStrength) {
  if (loading) return;
  loading = true;
  const dialog = get("lora-tag-dialog");
  const errorText = get("lora-tag-error");
  const buttons = dialog.querySelectorAll("button");
  get("lora-category").disabled = true;
  get("lora-default-strength").readOnly = true;
  get("lora-tag-text").readOnly = true;
  buttons.forEach((button) => { button.disabled = true; });
  errorText.hidden = true;
  try {
    loraOrder = await bridge.apiPost("studio/lora-order", {
      ...loraOrderQuery(), id: loraTagId, tag, category, default_strength: defaultStrength, revision: loraOrder.revision,
    });
    dialog.close();
    renderLoraOrder();
    const row = [...get("lora-order-list").querySelectorAll(".order-row")].find((item) => item.dataset.id === loraTagId);
    row?.querySelector(".order-name")?.focus();
    completed(tag === null ? "已恢复 LoRA 的默认触发词。" : "已保存 LoRA 设置。");
  } catch (error) {
    errorText.textContent = error.message;
    errorText.hidden = false;
  } finally {
    loading = false;
    get("lora-category").disabled = false;
    get("lora-default-strength").readOnly = false;
    get("lora-tag-text").readOnly = false;
    buttons.forEach((button) => { button.disabled = false; });
  }
}

get("open-lora-order").addEventListener("click", openLoraOrder);
get("lora-order-refresh").addEventListener("click", openLoraOrder);
get("lora-family").addEventListener("change", openLoraOrder);
get("lora-tag-dialog").addEventListener("cancel", (event) => {
  if (loading) event.preventDefault();
});
get("lora-tag-cancel").addEventListener("click", () => get("lora-tag-dialog").close());
get("lora-tag-reset").addEventListener("click", () => saveLoraTag(null));
get("lora-tag-form").addEventListener("submit", (event) => {
  event.preventDefault();
  saveLoraTag(get("lora-tag-text").value, get("lora-category").value, get("lora-default-strength").valueAsNumber);
});

async function openWorkflow(workflow, tab, discard = false) {
  if (loading || get("save").disabled) return;
  if (unsaved.length && current.workflow !== workflow.name && !discard) {
    showUnsavedNotice();
    return;
  }
  loading = true;
  try {
    if (discard || current?.workflow !== workflow.name) {
      message("正在读取参数…");
      const route = animaRoute(workflow.name);
      const data = route ? await bridge.apiGet(route + "/settings")
        : await bridge.apiGet("studio/workflow", { name: workflow.name });
      render(data, workflow);
      selected = workflow;
    }
    showPanel("settings", tab);
    message("");
    await loadWorkflowConfigChoices(workflow.name);
  } catch (error) {
    message(error.message, true);
  } finally {
    loading = false;
    updateWorkflowConfigButtons();
  }
}

function renderConfigOptions(select, names, preferred) {
  const prompt = select.id === "workflow-config-name" ? "当前参数（未关联配置）" : "请选择配置";
  select.replaceChildren(new Option(names.length ? prompt : "暂无保存的配置", ""),
    ...names.map((name) => new Option(name, name)));
  if (names.includes(preferred)) select.value = preferred;
}

function updateWorkflowConfigButtons() {
  const disabled = !get("workflow-config-name").value || loading || get("save").disabled;
  for (const action of ["rename", "delete"]) {
    get(`${action}-workflow-config`).disabled = disabled;
  }
}

function renderWorkflowAlias() {
  const name = current.workflow;
  const alias = studio.workflow_aliases?.[name] ?? "";
  const fallback = current.short_name ?? name;
  get("workflow-alias").value = alias;
  get("workflow-alias").placeholder = fallback;
  get("workflow-alias-example").textContent = current.kind === "image_to_text"
    ? (alias ? `/comfy ${alias}` : "/comfy prompt")
    : `/comfy gen --wf "${alias || fallback}"`;
}

get("workflow-alias-save").addEventListener("click", async (event) => {
  if (!current || loading || get("save").disabled) return;
  const button = event.currentTarget;
  const input = get("workflow-alias");
  loading = button.disabled = input.readOnly = true;
  try {
    const { alias, short_name: short } = await bridge.apiPost("studio/workflow/alias", { workflow: current.workflow, alias: input.value });
    (studio.workflow_aliases ??= {})[current.workflow] = alias;
    current.short_name = short;
    renderWorkflowAlias();
    completed("工作流简称已保存。");
  } catch (error) {
    message(error.message, true);
  } finally {
    loading = button.disabled = input.readOnly = false;
  }
});
get("workflow-alias").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    get("workflow-alias-save").click();
  }
});

async function loadWorkflowConfigChoices(workflow) {
  const select = get("workflow-config-name");
  const preferred = activeConfigs.get(workflow);
  select.replaceChildren(new Option("正在读取配置…", ""));
  get("save-workflow-config").disabled = true;
  updateWorkflowConfigButtons();
  try {
    const { names } = await bridge.apiGet(workflowConfigRoute, { workflow });
    if (preferred && !names.includes(preferred)) activeConfigs.delete(workflow);
    renderConfigOptions(select, names, preferred);
    get("save-workflow-config").disabled = false;
  } catch (error) {
    select.replaceChildren(new Option("无法读取配置", ""));
    message(error.message, true);
  }
}

const configDialog = get("workflow-config-dialog");
const activeConfigs = new Map();
const configTitle = get("workflow-config-title");
const configOverwrite = get("workflow-config-overwrite");

function showWorkflowConfigDialog(action) {
  if (loading || get("save").disabled) return;
  if (action === "save" && unsaved.length) {
    showUnsavedNotice();
    return;
  }
  const name = get("workflow-config-name").value;
  const renaming = action === "rename";
  const naming = action !== "delete";
  configDialog.dataset.action = action;
  configDialog.returnValue = "";
  get("workflow-config-dialog-title").textContent = {
    save: "另存当前参数", rename: "重命名配置", delete: "删除工作流配置",
  }[action];
  get("workflow-config-title-field").hidden = !naming;
  configTitle.required = naming;
  configTitle.value = renaming ? name : "";
  configOverwrite.checked = false;
  get("workflow-config-overwrite-field").hidden = true;
  const note = get("workflow-config-dialog-note");
  note.hidden = naming;
  note.textContent = naming ? "" : `要删除「${name}」吗？`;
  get("workflow-config-confirm").textContent = naming ? "保存" : "删除";
  configDialog.showModal();
  if (renaming) configTitle.select();
}

configTitle.addEventListener("input", () => {
  if (configDialog.dataset.action !== "save") return;
  const name = configTitle.value.trim().toLowerCase();
  const duplicate = name && [...get("workflow-config-name").options].some((option) => option.value.toLowerCase() === name);
  get("workflow-config-overwrite-field").hidden = !duplicate;
  configOverwrite.required = Boolean(duplicate);
  configOverwrite.checked = false;
});

get("workflow-config-name").addEventListener("change", async (event) => {
  const select = event.target;
  const workflow = current.workflow;
  if (!select.value) {
    activeConfigs.delete(workflow);
    updateWorkflowConfigButtons();
    return;
  }
  if (select.value === activeConfigs.get(workflow)) return;
  await editWorkflowConfig("apply");
  select.value = activeConfigs.get(workflow) ?? "";
  updateWorkflowConfigButtons();
});
get("save-workflow-config").addEventListener("click", () => showWorkflowConfigDialog("save"));
get("rename-workflow-config").addEventListener("click", () => showWorkflowConfigDialog("rename"));
get("delete-workflow-config").addEventListener("click", () => showWorkflowConfigDialog("delete"));
configDialog.addEventListener("close", () => {
  configOverwrite.required = false;
  if (configDialog.returnValue === "confirm") editWorkflowConfig(configDialog.dataset.action);
});

async function editWorkflowConfig(action) {
  if (!current || loading || get("save").disabled) return;
  if ((action === "save" || action === "apply") && unsaved.length) {
    showUnsavedNotice();
    return;
  }
  const select = get("workflow-config-name");
  const name = action === "save" ? configTitle.value.trim() : select.value;
  if (!name) {
    message("请填写或选择配置名称。", true);
    return;
  }
  loading = true;
  const controls = [...get("settings").querySelectorAll("button, input, select, textarea")]
    .filter((control) => !control.disabled);
  controls.forEach((control) => { control.disabled = true; });
  message(action === "apply" ? `正在应用配置「${name}」…` : "");
  try {
    const result = await bridge.apiPost(workflowConfigRoute, {
      action, name, workflow: current.workflow, revision: current.revision, replace: configOverwrite.checked,
      ...(action === "rename" ? { new_name: configTitle.value.trim() } : {}),
    });
    if (action === "apply") {
      Object.assign(selected, result.workflow);
      render(result.settings);
      activeConfigs.set(current.workflow, result.name);
      clearQueueWorkflowOptions();
      completed(`已应用「${result.name}」。后续任务将使用这套参数。`);
    } else {
      if (result.name) activeConfigs.set(current.workflow, result.name);
      else activeConfigs.delete(current.workflow);
      renderConfigOptions(select, result.names, result.name);
      completed({
        save: `已保存「${result.name}」。`,
        rename: `已重命名为「${result.name}」。`,
        delete: `已删除「${name}」。`,
      }[action]);
    }
  } catch (error) {
    message(error.message, true);
  } finally {
    loading = false;
    controls.forEach((control) => { control.disabled = false; });
    updateWorkflowConfigButtons();
  }
}

function clearQueueWorkflowOptions() {
  get("queue-workflow").replaceChildren();
  get("queue-qq-workflow").replaceChildren();
  savedQQTimeout = undefined;
  queueSnapshot = "";
}

function archiveRow(rule = { tag: "", folder: "" }) {
  const row = document.createElement("div");
  row.className = "archive-row";
  for (const [key, title] of [["tag", "标签"], ["folder", "文件夹"]]) {
    const label = document.createElement("label");
    label.className = "field";
    label.append(title);
    const input = document.createElement("input");
    input.value = rule[key];
    input.required = true;
    input.maxLength = 64;
    input.dataset.key = key;
    label.append(input);
    row.append(label);
  }
  const actions = document.createElement("div");
  actions.className = "row-actions";
  const move = document.createElement("button");
  move.type = "button";
  move.textContent = "上移";
  move.addEventListener("click", () => {
    if (row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling);
  });
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "删除";
  remove.addEventListener("click", () => row.remove());
  actions.append(move, remove);
  row.append(actions);
  get("archive-rows").append(row);
}

function renderArchive(archive) {
  get("archive-default").value = archive.default_folder;
  get("archive-rows").replaceChildren();
  archive.rules.forEach(archiveRow);
}

get("open-archive").addEventListener("click", () => {
  if (!studio || loading || get("save").disabled) return;
  showPanel("archive", get("open-archive"));
  message("");
});
get("archive-add").addEventListener("click", () => archiveRow());
get("archive").addEventListener("submit", async (event) => {
  event.preventDefault();
  get("archive-save").disabled = true;
  try {
    const rules = [...get("archive-rows").children].map((row) => ({
      tag: row.querySelector('[data-key="tag"]').value.trim(),
      folder: row.querySelector('[data-key="folder"]').value.trim(),
    }));
    renderArchive(await bridge.apiPost("studio/archive", {
      default_folder: get("archive-default").value.trim(), rules,
    }));
    completed("归档规则已保存。下一次出图起生效。");
  } catch (error) {
    message(error.message, true);
  } finally {
    get("archive-save").disabled = false;
  }
});

function renderPersona(data) {
  persona = data;
  get("persona-text").value = data.text;
  get("persona-path").textContent = `外置文件 · ${data.path}`;
}

async function openPersona(reload = false) {
  if (!studio || loading || get("save").disabled) return;
  loading = true;
  try {
    if (reload || !persona || get("persona-text").value === persona.text) {
      renderPersona(await bridge.apiGet("studio/persona"));
    }
    showPanel("persona", get("open-persona"));
    message(persona.warning, Boolean(persona.warning));
  } catch (error) {
    message(error.message, true);
  } finally {
    loading = false;
  }
}

get("open-persona").addEventListener("click", () => openPersona());
get("persona-reload").addEventListener("click", () => openPersona(true));
get("persona-default").addEventListener("click", () => {
  get("persona-text").value = persona.default_text;
  message("已载入默认提示词。点「保存提示词」后生效。");
});
get("persona").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (loading || !persona) return;
  loading = true;
  const input = get("persona-text");
  input.readOnly = true;
  get("persona-save").disabled = get("persona-default").disabled = get("persona-reload").disabled = true;
  try {
    renderPersona(await bridge.apiPost("studio/persona", {
      text: input.value, revision: persona.revision,
    }));
    completed("绘图提示词已保存，下次 AI 对话生效。");
  } catch (error) {
    message(error.message, true);
  } finally {
    loading = false;
    input.readOnly = false;
    get("persona-save").disabled = get("persona-default").disabled = get("persona-reload").disabled = false;
  }
});

const presetFields = ["name", "positive", "negative"];
let presetPreview = "";
let presetPreviewRequest = 0;
const presetAccountLabel = (account) => account === "legacy" ? "旧版共享预设（仅后台）" : account;

async function loadPresetAccounts(select, placeholder, current = "") {
  const data = await bridge.apiGet("studio/presets/accounts");
  const accounts = data.legacy ? ["legacy", ...data.accounts] : data.accounts;
  if (current && !accounts.includes(current)) accounts.push(current);
  select.replaceChildren(new Option(placeholder, ""));
  for (const account of accounts) select.add(new Option(presetAccountLabel(account), account));
  select.value = current;
}

function renderPresetList(busy = loading) {
  const locked = busy || !get("preset-discard").hidden;
  get("preset-new").disabled = locked;
  const list = get("preset-list");
  for (const image of list.querySelectorAll("img")) imageReviews.previews.unobserve(image);
  renderOrderList(list, (presets?.presets ?? []).map((row) => ({
    title: row.name, preview: row.preview,
  })), {
    locked, onMove: movePreset, onSelect: selectPreset, selectedIndex: presetIndex,
    empty: "还没有预设。新建的第一条会成为 1 号。",
  });
}

function fillPreset() {
  const row = presets.presets[presetIndex];
  for (const key of presetFields) get(`preset-${key}`).value = row?.[key] ?? "";
  presetPreview = row?.preview ?? "";
  renderPresetPreview();
  const byNumber = `#${presetIndex + 1}`;
  const reference = !row ? "1" : presets.presets.some((entry) => entry.name === byNumber) ? `"${row.name}"` : byNumber;
  get("preset-command").textContent = `/comfy gen --preset ${reference}`;
  get("preset-discard").hidden = true;
  renderPresetList();
}

function selectPreset(index) {
  if (loading || !get("preset-discard").hidden) return;
  presetIndex = index;
  fillPreset();
  message("");
  get("preset-name").focus();
}

async function movePreset(from, to) {
  if (loading || !presets || !get("preset-discard").hidden) return;
  const { account, revision } = presets;
  const rows = movedRows(presets.presets, from, to);
  const active = presets.presets[presetIndex];
  loading = true;
  setPresetBusy(true);
  message("正在保存预设编号…");
  try {
    const saved = await bridge.apiPost("studio/presets", { account, revision, presets: rows });
    renderPresets(saved, rows.indexOf(active));
    completed(`已保存。${rows[to].name} 现在是 ${to + 1} 号。`);
  } catch (error) {
    message(error.message, true);
  } finally {
    loading = false;
    setPresetBusy(false);
  }
}

function renderPresets(data, index) {
  presets = data;
  const accounts = get("preset-account");
  if (![...accounts.options].some((option) => option.value === data.account)) {
    accounts.add(new Option(presetAccountLabel(data.account), data.account));
  }
  accounts.value = data.account;
  get("preset-account-title").textContent = presetAccountLabel(data.account);
  get("preset-usage").hidden = data.account === "legacy";
  get("preset-form").hidden = get("preset-reload").hidden = false;
  get("preset-path").textContent = `本地文件 · ${data.path}`;
  presetIndex = index;
  fillPreset();
}

async function openPresetAccount(account, reload = false, identity) {
  if (loading || !get("preset-discard").hidden) {
    get("preset-account").value = presets?.account ?? "";
    if (!loading) message("请先保存或放弃当前修改。", true);
    return;
  }
  if (!account) {
    presets = undefined;
    get("preset-form").hidden = get("preset-reload").hidden = true;
    message("");
    return;
  }
  loading = true;
  setPresetBusy(true);
  try {
    const [data] = await Promise.all([
      bridge.apiGet("studio/presets", { account }),
      ...(identity ? [loadPresetAccounts(get("preset-account"), "请选择用户", account)] : []),
    ]);
    const name = account === presets?.account ? presets.presets[presetIndex]?.name : "";
    const index = identity ? data.presets.findIndex((row) => row.id === identity)
      : name ? data.presets.findIndex((row) => row.name === name) : 0;
    renderPresets(data, data.presets.length ? index : -1);
    if (identity && index < 0) message("这条预设已删除。", true);
    else if (reload) completed("已重新读取提示词预设文件。");
    else message("");
  } catch (error) {
    get("preset-account").value = presets?.account ?? "";
    message(error.message, true);
  } finally {
    setPresetBusy(false);
    loading = false;
  }
}
function openImagePreset(account, identity) {
  if (!studio || loading || get("save").disabled) return;
  if (!get("preset-discard").hidden) {
    showPanel("presets", get("open-presets"));
    message("请先保存或放弃未保存的预设改动。", true);
    return;
  }
  showPanel("presets", get("open-presets"));
  openPresetAccount(account, false, identity);
}
get("open-presets").addEventListener("click", async () => {
  if (!studio || loading || get("save").disabled || !get("presets").hidden) return;
  loading = true;
  try {
    await loadPresetAccounts(get("preset-account"), "请选择用户", presets?.account);
    showPanel("presets", get("open-presets"));
    message("");
  } catch (error) {
    message(error.message, true);
  } finally {
    loading = false;
  }
});
get("preset-account").addEventListener("change", (event) => openPresetAccount(event.target.value));
get("preset-open-account").addEventListener("click", () => {
  const platform = get("preset-platform").value.trim();
  const user = get("preset-user").value.trim();
  if (!platform || platform.includes(":") || !user) {
    message("请填写有效的平台实例 ID 和用户 ID。", true);
    return;
  }
  openPresetAccount(`${platform}:${user}`);
});
get("preset-reload").addEventListener("click", () => openPresetAccount(presets.account, true));

function setPresetBusy(busy) {
  for (const key of presetFields) get(`preset-${key}`).readOnly = busy;
  for (const id of ["preset-save", "preset-discard", "preset-reload", "preset-account", "preset-open-account"]) get(id).disabled = busy;
  get("preset-preview-select").disabled = get("preset-preview-clear").disabled = busy;
  renderPresetList(busy);
}

function comparePresets(existing, incoming, index, total) {
  const dialog = get("preset-conflict");
  get("preset-conflict-progress").textContent = `第 ${index} / ${total} 个冲突 · ${incoming.name}`;
  const comparison = get("preset-comparison");
  comparison.replaceChildren();
  const columns = document.createElement("div");
  columns.className = "preset-pair";
  for (const title of ["现有版", "导入版"]) {
    const label = document.createElement("strong");
    label.textContent = title;
    columns.append(label);
  }
  comparison.append(columns);
  for (const [key, title] of [["name", "名称"], ["positive", "正向提示词"], ["negative", "负向提示词"]]) {
    const label = document.createElement("h3");
    const changed = existing[key] !== incoming[key];
    label.textContent = changed ? `${title} · 有差异` : title;
    const pair = document.createElement("div");
    pair.className = "preset-pair";
    pair.classList.toggle("changed", changed);
    for (const row of [existing, incoming]) {
      const content = document.createElement("pre");
      content.textContent = row[key] || "（空）";
      pair.append(content);
    }
    comparison.append(label, pair);
  }
  dialog.returnValue = "cancel";
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue), { once: true });
    dialog.showModal();
  });
}

get("preset-conflict").addEventListener("cancel", (event) => {
  event.preventDefault();
  event.currentTarget.close("cancel");
});

async function importPresets(file) {
  const account = get("export-preset-account").value;
  if (presets?.account === account && !get("preset-discard").hidden) {
    throw new Error("此用户有未保存的预设修改，请先保存或放弃修改。");
  }
  const incoming = await readImportJson(file);
  const data = await bridge.apiPost("studio/presets/import", {
    presets: Array.isArray(incoming) ? incoming : incoming?.presets, account,
  });
  const rows = [...data.presets];
  const reviewedPositions = new Set();
  const total = data.positions.filter((position) => position !== null).length;
  let added = 0;
  let replaced = 0;
  let reviewed = 0;
  let firstReplacement = -1;
  for (const [index, row] of data.incoming.entries()) {
    const position = data.positions[index];
    if (position === null) {
      rows.push(row);
      added++;
      continue;
    }
    if (reviewedPositions.has(position)) throw new Error("导入文件中有多条预设指向同一个现有预设。");
    reviewedPositions.add(position);
    const choice = await comparePresets(rows[position], row, ++reviewed, total);
    if (choice !== "existing" && choice !== "incoming") {
      message("已取消导入。");
      return;
    }
    if (choice === "incoming") {
      rows[position] = { ...row, id: rows[position].id };
      if (!replaced) firstReplacement = position;
      replaced++;
    }
  }
  if (!added && !replaced) {
    completed("已保留全部现有预设。");
    return;
  }
  const saved = await bridge.apiPost("studio/presets", { presets: rows, revision: data.revision, account });
  if (presets?.account === account) {
    renderPresets(saved, added ? data.presets.length : firstReplacement);
  }
  completed(`已导入 ${added} 项，覆盖 ${replaced} 项，保留 ${total - replaced} 项同名预设。`);
}

get("preset-new").addEventListener("click", () => selectPreset(-1));
function updatePresetDraft() {
  const row = presets.presets[presetIndex];
  const modified = presetPreview !== (row?.preview ?? "")
    || presetFields.some((key) => get(`preset-${key}`).value !== (row?.[key] ?? ""));
  if (get("preset-discard").hidden === !modified) return;
  get("preset-discard").hidden = !modified;
  renderPresetList();
}

async function renderPresetPreview() {
  const request = ++presetPreviewRequest;
  const open = get("preset-preview-open");
  const img = get("preset-preview-image");
  const status = get("preset-preview-status");
  open.hidden = true;
  img.removeAttribute("src");
  get("preset-preview-clear").hidden = !presetPreview;
  status.textContent = presetPreview ? "正在读取预览…" : "可以选一张收藏图作为效果参考。";
  if (!presetPreview) return;
  try {
    const { src } = await bridge.apiGet("studio/images/file", { id: presetPreview, state: "favourite" });
    if (request !== presetPreviewRequest) return;
    img.src = src;
    open.hidden = false;
    status.textContent = "";
  } catch {
    if (request === presetPreviewRequest) status.textContent = "预览图已不可用，可以重新选择。";
  }
}

get("preset-preview-select").addEventListener("click", () => {
  if (loading || !presets) return;
  imageReviews.pickFavourite("从收藏选择预设预览图", (item) => {
    presetPreview = item.id;
    renderPresetPreview();
    updatePresetDraft();
  });
});
get("preset-preview-clear").addEventListener("click", () => {
  presetPreview = "";
  renderPresetPreview();
  updatePresetDraft();
});
get("preset-preview-open").addEventListener("click", () => {
  if (presetPreview) imageReviews.openOriginal({
    id: presetPreview, name: get("preset-name").value || "预设效果图", rating: "预览",
  }, "favourite", { readOnly: true });
});
get("preset-form").addEventListener("input", updatePresetDraft);
get("preset-discard").addEventListener("click", () => {
  fillPreset();
  message("");
});
get("preset-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (loading || !presets) return;
  loading = true;
  const saved = presets.presets[presetIndex];
  const row = saved ? { id: saved.id } : {};
  for (const key of presetFields) {
    const input = get(`preset-${key}`);
    row[key] = input.value;
  }
  if (presetPreview) row.preview = presetPreview;
  const rows = [...presets.presets];
  const index = presetIndex === -1 ? rows.length : presetIndex;
  rows[index] = row;
  setPresetBusy(true);
  try {
    const data = await bridge.apiPost("studio/presets", { presets: rows, revision: presets.revision, account: presets.account });
    renderPresets(data, index);
    completed("提示词预设已保存。");
  } catch (error) {
    message(error.message, true);
  } finally {
    setPresetBusy(false);
    loading = false;
  }
});

mountPromptLibrary({ get, bridge, message, notify });

const queueStates = { queued: "等待中", running: "处理中", completed: "已完成", failed: "失败", cancelled: "已取消" };
let queueSnapshot = "";
let queueReading = false;
let queueWriting = false;
let queueTimeouts;
let qqTimeouts;
let savedQQTimeout;

function renderQQTimeout(reset = false) {
  const name = get("queue-qq-workflow").value;
  const workflow = studio.workflows.find((item) => item.name === name);
  if (!qqTimeouts || !workflow) return;
  const seconds = qqTimeouts.get(name) ?? null;
  const limits = queueTimeouts[workflow.output_type === "video" ? "video" : "image"];
  const input = get("queue-qq-timeout");
  if (reset || savedQQTimeout === undefined || input.value === String(savedQQTimeout ?? "")) {
    input.value = seconds ?? "";
  }
  savedQQTimeout = seconds;
  input.min = queueTimeouts.min;
  input.max = limits.max;
  input.placeholder = `默认 ${limits.default} 秒`;
  input.disabled = get("queue-qq-timeout-save").disabled = false;
  get("queue-qq-timeout-note").textContent = seconds === null
    ? `当前使用默认值 ${limits.default} 秒。`
    : `当前使用 ${seconds} 秒。`;
}

function queueMessage(text, error = false) {
  setStatus("queue-status", text, error);
}

function renderQueueJobs(id, jobs, empty) {
  const list = get(id);
  list.replaceChildren();
  if (!jobs.length) {
    const note = document.createElement("p");
    note.textContent = empty;
    list.append(note);
    return;
  }
  for (const job of jobs) {
    const row = document.createElement("article");
    row.className = "queue-row";
    const heading = document.createElement("div");
    heading.className = "queue-heading";
    const title = document.createElement("strong");
    title.textContent = workflowTitle(job.workflow);
    const state = document.createElement("span");
    state.className = "pill";
    state.textContent = queueStates[job.state] ?? job.state;
    heading.append(title, state);
    if (job.can_cancel) {
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "取消任务";
      cancel.addEventListener("click", () => changeQueue(
        "studio/queue/cancel", { id: job.id }, cancel,
        (result) => result.state === "cancelled" ? "任务已取消。" : "任务已结束。",
      ));
      heading.append(cancel);
    }
    const details = document.createElement("small");
    details.textContent = `任务 ${job.id}${job.seed ? ` · 种子 ${job.seed}` : ""} · 超时 ${job.timeout_seconds} 秒`;
    row.append(heading, details);
    const outputs = remote ? job.outputs.map((path) => path.split(/[\\/]/).at(-1)) : job.outputs;
    for (const text of [job.error, ...outputs].filter(Boolean)) {
      const detail = document.createElement("small");
      detail.textContent = text;
      row.append(detail);
    }
    list.append(row);
  }
}

async function refreshQueue(reportError = false) {
  if (get("queue").hidden) return;
  if (queueReading || queueWriting) {
    if (reportError) notify("队列正在更新。");
    return;
  }
  queueReading = true;
  try {
    const data = await bridge.apiGet("studio/queue");
    if (get("queue").hidden || queueWriting) return;
    if (reportError) notify("队列已刷新。");
    get("queue-cancel-all").disabled = !data.jobs.some((job) => job.state === "queued" || job.state === "running");
    const snapshot = JSON.stringify(data);
    if (snapshot === queueSnapshot) return;
    queueSnapshot = snapshot;
    get("queue-count").max = data.limit;
    queueTimeouts = data.timeouts;
    qqTimeouts = new Map(Object.entries(data.qq_timeouts));
    renderQQTimeout();
    get("queue-summary").textContent = `当前队列 · ${data.active} / ${data.limit}`;
    const active = (job) => job.state === "queued" || job.state === "running";
    renderQueueJobs("queue-active", data.jobs.filter(active), "当前没有等待或处理中的任务。");
    renderQueueJobs("queue-recent", data.jobs.filter((job) => !active(job)).reverse().slice(0, 30), "暂无最近任务。");
  } catch (error) {
    if (!get("queue").hidden && (reportError || (!queueSnapshot && !get("queue-status").textContent))) {
      queueMessage(error.message, true);
    }
  } finally {
    queueReading = false;
  }
}

async function changeQueue(endpoint, data, button, successMessage) {
  if (queueWriting) {
    notify("正在处理上一项操作。");
    return;
  }
  queueWriting = button.disabled = true;
  queueMessage("正在处理…");
  notify("正在处理…");
  try {
    const result = await bridge.apiPost(endpoint, typeof data === "function" ? await data() : data);
    const text = successMessage(result);
    queueMessage(text);
    notify(text);
  } catch (error) {
    queueMessage(error.message, true);
  } finally {
    queueWriting = button.disabled = false;
    await refreshQueue();
  }
}

async function loadQueuePresets(keep = false) {
  const scope = get("queue-preset-account");
  const account = scope.value;
  const select = get("queue-preset");
  const selectedPreset = keep ? select.value : "";
  select.replaceChildren(new Option("不使用预设", ""));
  if (!account) return;
  try {
    const data = await bridge.apiGet("studio/presets", { account });
    if (scope.value !== account) return;
    for (const [index, row] of data.presets.entries()) select.add(new Option(`${index + 1}. ${row.name}`, row.name));
    if (data.presets.some((row) => row.name === selectedPreset)) select.value = selectedPreset;
  } catch (error) {
    if (!get("queue").hidden && scope.value === account) queueMessage(error.message, true);
  }
}

const builtinQueueCommands = [
  ["遍历人物 LoRA", "/comfy sweep lora --wf wai --preset 1"],
  ["Advanced Gemma V40 人物 LoRA 扫图", "/comfy sweep lora --wf v40 --preset 1 --seed 42"],
  ["遍历提示词预设", "/comfy sweep presets --wf wai --lora C1"],
  ["选择下次 LoRA", "/comfy lora wai use C1"],
  ["生成图片", "/comfy gen --wf wai watercolor landscape"],
  ["Detailer V40 局部修复", "/comfy gen --wf detailer detailed face"],
  ["Advanced Gemma V40", "/comfy gen --wf v40 --feet on 1girl, full body --raw"],
];
const commandTemplateSelect = get("queue-command-template");
const commandTemplateSave = get("queue-command-template-save");
const commandTemplateDelete = get("queue-command-template-delete");
let savedQueueCommands = new Map();

function renderCommandTemplates(templates, selection = commandTemplateSelect.value) {
  savedQueueCommands = new Map(Object.entries(templates));
  commandTemplateSelect.replaceChildren(new Option("选择模板", ""));
  for (const [index, [title]] of builtinQueueCommands.entries()) {
    commandTemplateSelect.add(new Option(title, `builtin:${index}`));
  }
  for (const name of savedQueueCommands.keys()) {
    commandTemplateSelect.add(new Option(name, `saved:${name}`));
  }
  if ([...commandTemplateSelect.options].some((option) => option.value === selection)) {
    commandTemplateSelect.value = selection;
  }
  commandTemplateDelete.disabled = !commandTemplateSelect.value.startsWith("saved:");
}

async function refreshCommandTemplates() {
  if (commandTemplateSave.disabled) return;
  commandTemplateSave.disabled = commandTemplateDelete.disabled = true;
  try {
    const { templates } = await bridge.apiGet("studio/queue/templates");
    renderCommandTemplates(templates);
  } catch (error) {
    if (!get("queue").hidden) queueMessage(error.message, true);
  } finally {
    commandTemplateSave.disabled = false;
    commandTemplateDelete.disabled = !commandTemplateSelect.value.startsWith("saved:");
  }
}

async function changeCommandTemplate(name, command) {
  if (commandTemplateSave.disabled) return;
  commandTemplateSave.disabled = commandTemplateDelete.disabled = true;
  try {
    const { templates } = await bridge.apiPost("studio/queue/templates", { name, command });
    renderCommandTemplates(templates, command === null ? "" : `saved:${name.trim()}`);
    if (command === null) get("queue-command-template-name").value = "";
    const text = command === null ? "已删除常用命令。" : "已保存常用命令。";
    queueMessage(text);
    notify(text);
  } catch (error) {
    queueMessage(error.message, true);
  } finally {
    commandTemplateSave.disabled = false;
    commandTemplateDelete.disabled = !commandTemplateSelect.value.startsWith("saved:");
  }
}

renderCommandTemplates({});
commandTemplateSelect.addEventListener("change", () => {
  const value = commandTemplateSelect.value;
  const saved = value.startsWith("saved:");
  commandTemplateDelete.disabled = !saved || commandTemplateSave.disabled;
  if (!value) return;
  const name = saved ? value.slice(6) : "";
  get("queue-command-template-name").value = name;
  get("queue-command-text").value = saved ? savedQueueCommands.get(name) : builtinQueueCommands[Number(value.slice(8))][1];
});
commandTemplateSave.addEventListener("click", () =>
  changeCommandTemplate(get("queue-command-template-name").value, get("queue-command-text").value));
commandTemplateDelete.addEventListener("click", () =>
  changeCommandTemplate(commandTemplateSelect.value.slice(6), null));

const queueMode = get("queue-create-mode");
const queueWorkflow = get("queue-workflow");
function queueUsesReference(name) {
  return name === detailerWorkflow
    || (name === advancedV40 && studio?.workflows.find((workflow) => workflow.name === name)?.image_inputs?.length);
}

function showQueueReference() {
  const reference = get("queue-reference");
  reference.hidden = queueMode.value !== "command"
    && !(queueMode.value === "simple" && queueUsesReference(queueWorkflow.value));
  if (!reference.hidden) {
    const form = get(queueMode.value === "command" ? "remote-command-form" : "queue-form");
    form.querySelector("footer").before(reference);
  }
}
queueWorkflow.addEventListener("change", showQueueReference);
queueMode.addEventListener("change", async () => {
  const mode = queueMode.value;
  get("remote-command-form").hidden = mode !== "command";
  get("queue-form").hidden = mode !== "simple";
  showQueueReference();
  if (!mode) return;
  if (mode === "command") refreshCommandTemplates();
  const accounts = get(mode === "command" ? "remote-command-account" : "queue-preset-account");
  if (accounts.disabled) return;
  accounts.disabled = true;
  try {
    await loadPresetAccounts(accounts, "不使用预设", accounts.value);
    if (mode === "simple") await loadQueuePresets(true);
  } catch (error) {
    if (!get("queue").hidden && queueMode.value === mode) queueMessage(error.message, true);
  } finally {
    accounts.disabled = false;
  }
});

get("open-queue").addEventListener("click", () => {
  if (!studio || loading || get("save").disabled || !get("queue").hidden) return;
  showPanel("queue", get("open-queue"));
  message("");
  queueMessage("");
  get("queue-create").open = false;
  queueMode.value = "";
  get("remote-command-form").hidden = get("queue-form").hidden = true;
  showQueueReference();
  const workflows = queueWorkflow;
  if (!workflows.options.length) {
    for (const workflow of studio.workflows.filter((item) => !item.requires_image || item.name === detailerWorkflow || item.name === advancedV40)) {
      workflows.add(new Option(workflowTitle(workflow.name), workflow.name));
    }
    if ([...workflows.options].some((item) => item.value === studio.default)) workflows.value = studio.default;
    get("queue-add").disabled = !workflows.options.length;
  }
  const qqWorkflows = get("queue-qq-workflow");
  if (!qqWorkflows.options.length) {
    for (const workflow of studio.workflows.filter((item) => item.output_type !== "text")) {
      qqWorkflows.add(new Option(workflowTitle(workflow.name), workflow.name));
    }
    if ([...qqWorkflows.options].some((item) => item.value === studio.default)) qqWorkflows.value = studio.default;
  }
  refreshQueue();
});
get("queue-preset-account").addEventListener("change", () => loadQueuePresets());
get("queue-refresh").addEventListener("click", () => refreshQueue(true));
const cancelQueueDialog = get("queue-cancel-dialog");
get("queue-cancel-all").addEventListener("click", () => {
  cancelQueueDialog.returnValue = "";
  cancelQueueDialog.showModal();
});
cancelQueueDialog.addEventListener("close", () => {
  if (cancelQueueDialog.returnValue !== "cancel-all") return;
  changeQueue("studio/queue/cancel-all", {}, get("queue-cancel-all"), ({ cancelled, finished, failed }) =>
    [`已取消 ${cancelled} 项 · 已结束 ${finished} 项 · 未确认取消 ${failed.length} 项`,
      ...failed.map((job) => `ID ${job.id} · ${job.message}`)].join("\n"));
});
get("queue-qq-workflow").addEventListener("change", () => renderQQTimeout(true));
get("queue-qq-timeout-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = get("queue-qq-timeout");
  changeQueue("studio/queue/qq-timeout", {
    workflow: get("queue-qq-workflow").value,
    timeout_seconds: input.value ? input.valueAsNumber : null,
  }, get("queue-qq-timeout-save"), (result) => {
    if (result.qq_timeout_seconds === null) qqTimeouts.delete(result.workflow);
    else qqTimeouts.set(result.workflow, result.qq_timeout_seconds);
    renderQQTimeout();
    const title = workflowTitle(result.workflow);
    return result.qq_timeout_seconds === null
      ? `${title} 已恢复 QQ 超时默认值。`
      : `${title} 已保存 QQ 等待超时。`;
  });
});
get("queue-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const preset = get("queue-preset").value;
  const positive = get("queue-positive").value.trim();
  const workflow = queueWorkflow.value;
  if (!preset && !positive && workflow !== advancedV40 && workflow !== detailerWorkflow) {
    queueMessage("请填写正向提示词或选择预设。", true);
    return;
  }
  const requiresImage = studio.workflows.find((item) => item.name === workflow)?.requires_image;
  if (queueUsesReference(workflow) && requiresImage
      && !get("queue-reference-id").value && !get("queue-reference-file").files.length) {
    queueMessage("请先选择一张参考图。", true);
    return;
  }
  changeQueue("studio/queue", async () => ({
    workflow,
    preset,
    preset_account: get("queue-preset-account").value,
    positive,
    negative: get("queue-negative").value,
    count: get("queue-count").valueAsNumber,
    ...(queueUsesReference(workflow) ? await queueReferencePayload() : {}),
  }), get("queue-add"), (result) => `已加入 ${result.jobs.length} 项生成任务。`);
});
setInterval(refreshQueue, 2500);

if (remote) {
  get("remote-workflow").hidden = false;
  get("remote-logout").hidden = false;
  get("remote-workflow").addEventListener("change", async (event) => {
    const select = event.target;
    const workflow = studio.workflows.find((item) => item.name === select.value);
    const tab = [...get("workflow-list").children].find((item) => item.dataset.name === select.value);
    if (workflow && tab) await openWorkflow(workflow, tab);
    select.value = get("settings").hidden ? "" : selected?.name ?? "";
  });
}

function encodeReference(file) {
  if (!file?.size) return "";
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",", 2)[1]);
    reader.onerror = () => reject(new Error("无法读取参考图或遮罩。"));
    reader.readAsDataURL(file);
  });
}

async function queueReferencePayload() {
  const referenceId = get("queue-reference-id").value;
  const [image, mask] = await Promise.all([
    encodeReference(get("queue-reference-file").files[0]),
    encodeReference(queueMask()),
  ]);
  return { reference_id: referenceId, image, mask };
}

get("remote-command-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const button = get("remote-command-send");
  const form = new FormData(event.target);
  const file = get("queue-reference-file").files[0];
  if (remote && file?.size && !queueMask()) {
    form.set("image", file);
    changeQueue("command", form, button, (result) => result.message);
    return;
  }
  changeQueue("studio/queue/command", async () => ({
    command: form.get("command"),
    account: form.get("account") ?? "",
    ...await queueReferencePayload(),
  }), button, (result) => result.message);
});

function workflowEdited(event) {
  if (event.target.matches("input, select, textarea") && !["filter", "show-dormant"].includes(event.target.id)) {
    updateUnsaved();
  }
}

get("settings").addEventListener("input", workflowEdited);
get("settings").addEventListener("change", workflowEdited);
get("show-unsaved").addEventListener("click", showUnsavedNotice);
for (const id of ["discard", "discard-unsaved"]) {
  get(id).addEventListener("click", () => openWorkflow(selected, workflowTab(), true));
}
get("filter").addEventListener("input", filterFields);
get("show-dormant").addEventListener("change", filterFields);
get("settings").addEventListener("submit", (event) => { event.preventDefault(); save(false); });
get("sync").addEventListener("click", () => save(true));

function syncRemoteWorkflowList() {
  if (!remote) return;
  const select = get("remote-workflow");
  const value = select.value;
  select.replaceChildren(new Option("选择工作流参数", ""));
  for (const { dataset: { name } } of get("workflow-list").children) {
    select.add(new Option(workflowTitle(name), name));
  }
  select.value = [...select.options].some((option) => option.value === value) ? value : "";
}

function bindNavigationDrag(list, tab, anchor, onDrop) {
  let press;
  let marker;
  let suppressClick = false;

  function clearMarker() {
    marker?.tab.classList.remove("drop-before", "drop-after");
    marker = null;
  }

  function markTarget(event) {
    clearMarker();
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    if (!hit || !list.contains(hit) || (anchor && anchor.contains(hit))) return;
    let target = hit.closest(".nav-sortable");
    if (!target) {
      const visible = [...list.querySelectorAll(".nav-sortable")].filter((item) => item.getClientRects().length);
      target = visible.find((item) => event.clientY < item.getBoundingClientRect().bottom) ?? visible.at(-1);
    }
    if (!target) return;
    const bounds = target.getBoundingClientRect();
    const after = event.clientY > bounds.top + bounds.height / 2;
    target.classList.add(after ? "drop-after" : "drop-before");
    marker = { tab: target, after };
  }

  function reset() {
    press?.listeners.abort();
    press = null;
    tab.classList.remove("dragging");
    clearMarker();
  }

  function move(event) {
    if (event.pointerId !== press?.id) return;
    if (!suppressClick && Math.hypot(event.clientX - press.x, event.clientY - press.y) < 5) return;
    suppressClick = true;
    tab.classList.add("dragging");
    markTarget(event);
  }

  function drop(event) {
    if (event.pointerId !== press?.id) return;
    if (suppressClick) markTarget(event);
    const target = marker;
    reset();
    if (target) onDrop(tab, target.tab, target.after);
  }

  tab.addEventListener("pointerdown", (event) => {
    if (press || event.button !== 0 || !event.isPrimary) return;
    suppressClick = false;
    if (event.pointerType === "touch") return;
    const listeners = new AbortController();
    press = { id: event.pointerId, x: event.clientX, y: event.clientY, listeners };
    const options = { signal: listeners.signal };
    tab.setPointerCapture(event.pointerId);
    document.addEventListener("pointermove", move, options);
    document.addEventListener("pointerup", drop, options);
    document.addEventListener("pointercancel", (event) => {
      if (event.pointerId === press?.id) reset();
    }, options);
    tab.addEventListener("lostpointercapture", reset, options);
    window.addEventListener("blur", reset, options);
  });
  tab.addEventListener("click", (event) => {
    if (!suppressClick || !event.detail) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}

function mountNavigationOrder(list, section, key, anchor = null) {
  const tabs = [...list.children].filter((tab) => tab !== anchor);
  const saved = studio.navigation_order?.[section];
  const ranks = new Map((Array.isArray(saved) ? saved : []).map((name, index) => [name, index]));
  const rank = (tab) => ranks.get(key(tab)) ?? ranks.size;
  for (const tab of tabs.sort((a, b) => rank(a) - rank(b))) {
    list.insertBefore(tab, anchor);
  }
  if (tabs.length < 2) return;
  let saving = false;
  async function move(moved, target, after) {
    if (saving || loading) return;
    const current = [...list.children].filter((tab) => tab !== anchor);
    const from = current.indexOf(moved);
    const targetIndex = current.indexOf(target);
    if (from < 0 || targetIndex < 0) return;
    const insertion = targetIndex + Number(after);
    const to = insertion > from ? insertion - 1 : insertion;
    if (from === to) return;
    const next = movedRows(current, from, to);
    const order = next.map(key);
    saving = true;
    try {
      await bridge.apiPost("studio/navigation-order", { section, order });
      (studio.navigation_order ??= {})[section] = order;
      if (moved.parentElement !== list) return;
      list.insertBefore(moved, next[to + 1] ?? anchor);
      if (section === "workflows") syncRemoteWorkflowList();
      notify("导航顺序已保存。");
    } catch (error) {
      message(`保存导航顺序失败：${error.message}`, true);
    } finally {
      saving = false;
    }
  }
  for (const tab of tabs) {
    tab.classList.add("nav-sortable");
    tab.title = "上下拖动排序";
    const grip = document.createElement("span");
    grip.className = "nav-grip";
    grip.textContent = "⠿";
    grip.setAttribute("aria-hidden", "true");
    tab.append(grip);
    bindNavigationDrag(list, tab, anchor, move);
  }
}

function renderWorkflowTabs() {
  const list = get("workflow-list");
  list.replaceChildren();
  let first;
  for (const workflow of studio.workflows) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "workflow-tab";
    tab.dataset.name = workflow.name;
    tab.setAttribute("aria-controls", "settings");
    tab.setAttribute("aria-pressed", "false");
    const title = document.createElement("strong");
    title.textContent = workflowTitle(workflow.name);
    const type = document.createElement("small");
    type.textContent = kinds[workflow.kind] || "工作流";
    tab.append(title, type);
    tab.addEventListener("click", () => openWorkflow(workflow, tab));
    list.append(tab);
    if (!first || workflow.name === studio.default) first = [workflow, tab];
  }
  mountNavigationOrder(list, "workflows", (tab) => tab.dataset.name);
  syncRemoteWorkflowList();
  return first;
}

function renderTransferWorkflows(preferred) {
  const names = get("export-workflow-name");
  names.replaceChildren(...studio.workflows.map(({ name }) => new Option(workflowTitle(name), name)));
  if (studio.workflows.some(({ name }) => name === preferred)) names.value = preferred;
  get("export-workflow").disabled = !names.value;
  get("export-workflows").disabled = !names.options.length;
  const configWorkflows = get("transfer-config-workflow");
  const configWorkflow = configWorkflows.value || preferred;
  configWorkflows.replaceChildren(...Array.from(names.options, (option) => new Option(option.text, option.value)));
  if (studio.workflows.some(({ name }) => name === configWorkflow)) configWorkflows.value = configWorkflow;
  loadTransferConfigs();
}

let transferConfigRequest = 0;

async function loadTransferConfigs(preferred) {
  const request = ++transferConfigRequest;
  const workflow = get("transfer-config-workflow").value;
  const select = get("transfer-config-name");
  const button = get("export-workflow-config");
  button.disabled = true;
  select.replaceChildren(new Option(workflow ? "正在读取配置…" : "暂无可用的工作流", ""));
  if (!workflow) return;
  try {
    const { names } = await bridge.apiGet(workflowConfigRoute, { workflow });
    if (request !== transferConfigRequest) return;
    renderConfigOptions(select, names, preferred ?? names[0]);
    button.disabled = !select.value;
  } catch (error) {
    if (request !== transferConfigRequest) return;
    select.replaceChildren(new Option("无法读取配置", ""));
    if (!get("exports").hidden) message(error.message, true);
  }
}

get("transfer-config-workflow").addEventListener("change", () => loadTransferConfigs());
get("transfer-config-name").addEventListener("change", (event) => {
  get("export-workflow-config").disabled = !event.target.value;
});
get("export-workflow-config").addEventListener("click", async () => {
  if (loading) return;
  const workflow = get("transfer-config-workflow").value;
  const select = get("transfer-config-name");
  const name = select.value;
  const button = get("export-workflow-config");
  button.disabled = true;
  try {
    await bridge.download(workflowConfigRoute + "/export", { workflow, name }, `${workflow}-${name}.json`);
    completed(`已导出配置「${name}」。`);
  } catch (error) {
    message(error.message, true);
  } finally {
    button.disabled = !select.value;
  }
});

function renderTransferPresetButtons() {
  get("preset-import").disabled = get("export-presets").disabled = !get("export-preset-account").value;
}

get("open-exports").addEventListener("click", async () => {
  if (!studio || loading || get("save").disabled || !get("exports").hidden) return;
  if (unsaved.length) {
    showUnsavedNotice();
    return;
  }
  get("open-workflow-directory").hidden = !studio.local_workflow_files;
  renderTransferWorkflows(get("export-workflow-name").value || selected?.name);
  const families = get("export-lora-family");
  const previousFamily = families.value;
  families.replaceChildren(...loraDirectoryOptions().map((family) => new Option(family, family)));
  if (loraDirectoryOptions().includes(previousFamily)) families.value = previousFamily;
  get("lora-tags-import").disabled = get("export-lora-tags").disabled = !families.value;
  showPanel("exports", get("open-exports"));
  message("");
  const account = get("export-preset-account");
  const previousAccount = account.value || presets?.account;
  account.replaceChildren(new Option("正在读取用户…", ""));
  renderTransferPresetButtons();
  get("transfer-preset-account").disabled = true;
  try {
    await loadPresetAccounts(account, "请选择用户", previousAccount);
  } catch (error) {
    account.replaceChildren(new Option("无法读取用户", ""));
    if (!get("exports").hidden) message(error.message, true);
  } finally {
    get("transfer-preset-account").disabled = false;
    renderTransferPresetButtons();
  }
});

get("export-preset-account").addEventListener("change", renderTransferPresetButtons);
get("transfer-preset-account").addEventListener("click", () => {
  if (loading) return;
  const platform = get("transfer-preset-platform").value.trim();
  const user = get("transfer-preset-user").value.trim();
  if (!platform || platform.includes(":") || !user) {
    message("请填写有效的平台实例 ID 和用户 ID。", true);
    return;
  }
  const account = `${platform}:${user}`;
  const accounts = get("export-preset-account");
  if (![...accounts.options].some((option) => option.value === account)) {
    accounts.add(new Option(presetAccountLabel(account), account));
  }
  accounts.value = account;
  renderTransferPresetButtons();
  get("transfer-preset-account").closest("details").open = false;
  message("");
});

function exportJson(id, getFile) {
  const button = get(id);
  button.addEventListener("click", async () => {
    if (loading) return;
    button.disabled = true;
    try {
      const [data, filename] = await getFile();
      downloadJson(data, filename);
      completed(`已导出 ${filename}。`);
    } catch (error) {
      message(error.message, true);
    } finally {
      button.disabled = id === "export-presets" && !get("export-preset-account").value;
    }
  });
}

exportJson("export-workflow", async () => {
  const name = get("export-workflow-name").value;
  return [await bridge.apiGet("studio/workflow/export", { name }), `${name}.json`];
});
exportJson("export-presets", async () => {
  const account = get("export-preset-account").value;
  const { presets } = await bridge.apiGet("studio/presets", { account });
  return [presets, "presets.json"];
});
exportJson("export-commands", async () => {
  const { templates } = await bridge.apiGet("studio/queue/templates");
  return [templates, "command_templates.json"];
});
exportJson("export-lora-tags", async () => {
  const family = get("export-lora-family").value;
  return [await bridge.apiGet("studio/lora-tags", { family }), `lora_tags_${family}.json`];
});

get("export-workflows").addEventListener("click", async () => {
  if (loading) return;
  const button = get("export-workflows");
  button.disabled = true;
  message(studio.local_workflow_files ? "请在 Windows 另存为窗口选择保存位置…" : "正在导出工作流…");
  try {
    if (studio.local_workflow_files) {
      const { cancelled, path } = await bridge.apiPost("studio/workflows/save", {});
      completed(cancelled ? "已取消导出。" : `工作流 ZIP 已保存到 ${path}`);
    } else {
      await bridge.download("studio/workflows/export", {}, "astrbot-comfyui-workflows.zip");
      completed("已交给浏览器下载工作流 ZIP。");
    }
  } catch (error) {
    message(error.message, true);
  } finally {
    button.disabled = false;
  }
});

get("open-workflow-directory").addEventListener("click", async () => {
  const button = get("open-workflow-directory");
  button.disabled = true;
  try {
    await bridge.apiPost("studio/workflows/open", {});
    completed("已打开插件的工作流目录。");
  } catch (error) {
    message(error.message, true);
  } finally {
    button.disabled = false;
  }
});

function bindImport(buttonId, inputId, maxMB, run) {
  const button = get(buttonId);
  const input = get(inputId);
  button.addEventListener("click", () => {
    if (!loading) input.click();
  });
  input.addEventListener("change", async () => {
    const file = input.files[0];
    input.value = "";
    if (!file || loading || get("exports").hidden) return;
    if (file.size > maxMB * 1024 * 1024) {
      message(`导入文件不能超过 ${maxMB} MB。`, true);
      return;
    }
    loading = true;
    const controls = [...get("exports").querySelectorAll("button, input, select")].filter((control) => !control.disabled);
    controls.forEach((control) => { control.disabled = true; });
    message("正在校验导入文件…");
    try {
      await run(file);
    } catch (error) {
      message(error.message, true);
    } finally {
      loading = false;
      controls.forEach((control) => { control.disabled = false; });
      renderTransferPresetButtons();
    }
  });
}

async function readImportJson(file) {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()));
  } catch {
    throw new Error("请选择有效的 UTF-8 JSON 文件。");
  }
}

bindImport("import-workflows", "workflow-import-file", 16, async (file) => {
  const replace = get("replace-workflows");
  const route = replace.checked ? "replace" : "import";
  const { imported, skipped } = await bridge.upload("studio/workflows/" + route, file);
  if (imported.length) {
    studio = await bridge.apiGet("studio");
    renderWorkflowTabs();
    current = selected = undefined;
    clearQueueWorkflowOptions();
    renderTransferWorkflows(imported[0]);
  }
  replace.checked = false;
  completed(`已导入 ${imported.length} 项，跳过 ${skipped.length} 项。`);
});
bindImport("import-workflow-config", "workflow-config-file", 9, async (file) => {
  const { workflow, name } = await bridge.upload(workflowConfigRoute + "/import", file);
  get("transfer-config-workflow").value = workflow;
  await loadTransferConfigs(name);
  completed(`已导入「${workflowTitle(workflow)}」的配置「${name}」。`);
});
bindImport("preset-import", "preset-file", 1, importPresets);
bindImport("import-commands", "commands-import-file", 6, async (file) => {
  const replace = get("replace-commands");
  const { templates, imported, skipped } = await bridge.apiPost("studio/queue/templates/import", {
    templates: await readImportJson(file), replace: replace.checked,
  });
  renderCommandTemplates(templates);
  replace.checked = false;
  completed(`已导入 ${imported} 条常用命令，跳过 ${skipped} 条。`);
});
bindImport("lora-tags-import", "lora-tags-file", 2, async (file) => {
  const { matched, missing } = await bridge.apiPost("studio/lora-tags", {
    family: get("export-lora-family").value, tags: await readImportJson(file),
  });
  completed(`已匹配 ${matched} 条附带词，${missing} 条等待对应模型。`);
});

try {
  await bridge.ready();
  studio = await bridge.apiGet("studio");
  mountNavigationOrder(get("management-list"), "management", (tab) => tab.id, get("remote-logout"));
  renderArchive(studio.archive);
  for (const family of loraDirectoryOptions()) {
    get("lora-family").add(new Option(studio.lora_families?.[family] ?? family, family));
  }
  const first = renderWorkflowTabs();
  if (first) await openWorkflow(...first);
  else message("暂无可用工作流。", true);
} catch (error) {
  message(error.message, true);
}
