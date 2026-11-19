export function mountTaskPresets({bridge, select, button}) {
  const dialog = document.createElement("dialog");
  dialog.className = "task-info-dialog preset-picker-dialog";
  dialog.setAttribute("aria-labelledby", "task-preset-title");
  dialog.innerHTML = `<div class="panel-heading"><h2 id="task-preset-title">选择提示词预设</h2><button type="button" data-close>关闭</button></div>
    <small id="task-preset-hint">点按选择，长按预览效果图；键盘可按住空格预览。</small>
    <div class="task-preset-options"></div><footer class="task-preset-pages"><button type="button" data-prev>上一页</button><span data-page></span><button type="button" data-next>下一页</button></footer>
    <div class="task-preset-preview" role="status" hidden><strong></strong><img alt="提示词预设效果图" hidden><small></small></div>`;
  document.body.append(dialog);
  const list = dialog.querySelector(".task-preset-options");
  const preview = dialog.querySelector(".task-preset-preview");
  const image = preview.querySelector("img"), note = preview.querySelector("small");
  const cache = new Map();
  let rows = [], page = 1, timer, request = 0, stopPress = () => {};

  function hidePreview() {
    clearTimeout(timer);
    request++;
    preview.hidden = true;
    image.hidden = true;
    image.removeAttribute("src");
  }
  function position(x, y) {
    const rect = preview.getBoundingClientRect();
    preview.style.left = `${Math.max(12, Math.min(innerWidth - rect.width - 12, x - rect.width / 2))}px`;
    preview.style.top = `${Math.max(12, Math.min(innerHeight - rect.height - 12, y - rect.height - 18))}px`;
  }
  async function showPreview(row, x, y) {
    const version = ++request;
    preview.querySelector("strong").textContent = row.name;
    note.textContent = row.preview ? "正在读取预览…" : "此预设尚未设置效果图。";
    preview.hidden = false;
    position(x, y);
    if (!row.preview) return;
    try {
      let src = cache.get(row.preview);
      if (!src) {
        ({src} = await bridge.apiGet("studio/images/file", {id: row.preview}));
        if (cache.size >= 24) cache.delete(cache.keys().next().value);
        cache.set(row.preview, src);
      }
      if (version !== request || !dialog.open) return;
      image.onload = () => { if (version === request) position(x, y); };
      image.onerror = () => { if (version === request) { image.hidden = true; note.textContent = "预览图已不可用。"; } };
      image.src = src;
      image.hidden = false;
      note.textContent = "松开返回列表";
      position(x, y);
    } catch {
      if (version === request) note.textContent = "预览图已不可用，可在预设管理中重新选择。";
    }
  }
  function render() {
    stopPress();
    hidePreview();
    list.replaceChildren();
    const entries = [{name: "不使用预设", value: ""}, ...rows.map((row, index) => ({...row, index: index + 1, value: row.name}))];
    const pages = Math.max(1, Math.ceil(entries.length / 12));
    page = Math.min(page, pages);
    entries.slice((page - 1) * 12, page * 12).forEach(row => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "task-preset-option";
      item.textContent = row.value ? `${row.index}. ${row.name}` : row.name;
      item.dataset.preset = row.value;
      item.setAttribute("aria-pressed", String(row.value === select.value));
      item.setAttribute("aria-describedby", "task-preset-hint");
      let consumed = false, origin;
      const cancel = () => { if (origin) { origin = null; hidePreview(); } };
      function start(x, y) {
        stopPress();
        consumed = false;
        origin = {x, y};
        stopPress = cancel;
        timer = setTimeout(() => { consumed = true; showPreview(row, x, y); }, 450);
      }
      item.addEventListener("pointerdown", event => { if (event.button === 0) start(event.clientX, event.clientY); });
      item.addEventListener("pointermove", event => {
        if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10) cancel();
      });
      for (const event of ["pointerup", "pointercancel", "pointerleave", "blur"]) item.addEventListener(event, cancel);
      item.addEventListener("contextmenu", event => event.preventDefault());
      item.addEventListener("keydown", event => {
        if (event.code === "Space" && !event.repeat) {
          const box = item.getBoundingClientRect(); start(box.x + box.width / 2, box.y);
        }
      });
      item.addEventListener("keyup", event => { if (event.code === "Space") cancel(); });
      item.addEventListener("click", event => {
        if (consumed) { event.preventDefault(); consumed = false; return; }
        select.value = row.value;
        select.dispatchEvent(new Event("change", {bubbles: true}));
        dialog.close();
      });
      list.append(item);
    });
    dialog.querySelector("[data-page]").textContent = `第 ${page} / ${pages} 页`;
    dialog.querySelector("[data-prev]").disabled = page === 1;
    dialog.querySelector("[data-next]").disabled = page === pages;
  }
  function updateButton() {
    button.textContent = select.selectedOptions[0]?.textContent || "不使用预设";
    button.disabled = !rows.length;
  }
  select.addEventListener("change", updateButton);
  button.addEventListener("click", () => {
    const index = rows.findIndex(row => row.name === select.value);
    page = index < 0 ? 1 : Math.floor((index + 1) / 12) + 1;
    render(); dialog.showModal(); button.setAttribute("aria-expanded", "true");
  });
  dialog.querySelector("[data-close]").onclick = () => dialog.close();
  dialog.querySelector("[data-prev]").onclick = () => { page--; render(); };
  dialog.querySelector("[data-next]").onclick = () => { page++; render(); };
  dialog.addEventListener("close", () => { stopPress(); hidePreview(); button.setAttribute("aria-expanded", "false"); });
  return {setRows(values) { rows = values; stopPress(); hidePreview(); updateButton(); if (dialog.open) render(); }};
}

export function mountJobDetails({bridge, workflowTitle, states}) {
  const dialog = document.createElement("dialog");
  dialog.className = "task-info-dialog job-details-dialog";
  dialog.setAttribute("aria-labelledby", "job-details-title");
  dialog.innerHTML = `<div class="panel-heading"><h2 id="job-details-title">任务配置</h2><button type="button" data-close>关闭</button></div><p data-status role="status"></p><div data-content></div>`;
  document.body.append(dialog);
  const status = dialog.querySelector("[data-status]"), content = dialog.querySelector("[data-content]");
  let request = 0;
  dialog.querySelector("[data-close]").onclick = () => dialog.close();
  dialog.addEventListener("close", () => request++);
  const text = (tag, value, parent) => {
    const item = document.createElement(tag); item.textContent = value; parent.append(item); return item;
  };
  const valueText = value => typeof value === "object" ? JSON.stringify(value, null, 2) : String(value ?? "");
  function fields(rows, parent) {
    const list = document.createElement("dl"); list.className = "job-detail-fields";
    for (const [key, value] of rows) { text("dt", key, list); text("dd", valueText(value), list); }
    parent.append(list);
  }
  function section(title) { const block = document.createElement("section"); text("h3", title, block); content.append(block); return block; }
  return {async open(identity) {
    const version = ++request;
    content.replaceChildren(); status.textContent = "正在读取任务配置…";
    if (!dialog.open) dialog.showModal();
    try {
      const {job, preset, configuration} = await bridge.apiGet("studio/queue/details", {id: identity});
      if (version !== request || !dialog.open) return;
      fields([["工作流", workflowTitle(job.workflow)], ["任务", job.id], ["状态", states[job.state] || job.state],
        ["种子", job.seed], ["超时", `${job.timeout_seconds} 秒`], ["提示词预设", preset?.name || "未使用"]], content);
      if (!configuration) { status.textContent = "此任务没有可用的配置记录。"; return; }
      status.textContent = "本次任务实际使用的配置";
      const prompts = section("提示词");
      for (const [key, title] of [["positive", "正向"], ["negative", "负向"]]) {
        for (const row of configuration[key]) { text("h4", `${title} · #${row.node}`, prompts); text("pre", row.text, prompts); }
      }
      const loras = section("LoRA 与强度");
      let count = 0;
      for (const [output, rows] of Object.entries(configuration.loras)) {
        if (!rows.length) continue;
        text("h4", `输出 #${output}`, loras);
        const table = document.createElement("table");
        const head = table.createTHead().insertRow();
        for (const title of ["LoRA 文件", "模型强度", "CLIP 强度"]) text("th", title, head);
        for (const row of rows) { const tr = table.insertRow(); for (const value of [row.name, row.model, row.clip]) text("td", valueText(value), tr); count++; }
        loras.append(table);
      }
      if (!count) text("p", "未使用 LoRA。", loras);
      if (configuration.models.length) fields(configuration.models.map(row => [`#${row.node} · ${row.field}`, row.name]), section("模型"));
      const nodes = section("全部节点参数");
      for (const row of configuration.nodes) {
        const detail = document.createElement("details");
        text("summary", `#${row.id} · ${row.title}`, detail); fields(Object.entries(row.parameters), detail); nodes.append(detail);
      }
    } catch (error) { if (version === request) status.textContent = error.message; }
  }};
}
