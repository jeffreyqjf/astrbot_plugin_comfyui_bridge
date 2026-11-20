export function mountModelCatalog({get, bridge, showPanel, workflowTitle, canOpen}) {
  const panel = get("model-catalog"), list = panel.querySelector(".model-catalog-list");
  const choice = panel.querySelector("[data-model-workflow]"), search = panel.querySelector("[data-model-search]");
  const scope = panel.querySelector("[data-model-scope]"), status = panel.querySelector("[data-model-status]");
  let catalog, version = 0;
  function render() {
    list.replaceChildren();
    const models = catalog?.workflows.find(row => row.name === choice.value)?.models || [];
    const needle = search.value.trim().toLowerCase();
    const rows = models.filter(row => (!needle || [row.name, row.folder, row.purpose, row.note].join(" ").toLowerCase().includes(needle))
      && (!scope.value || (scope.value === "unknown" ? !row.url : scope.value === "required" ? row.required : !row.required)));
    status.textContent = `${rows.length} / ${models.length} 项 · 来源核对日期 ${catalog?.checked_at || "—"}`;
    for (const row of rows) {
      const card = document.createElement("article"); card.className = "model-guide-card";
      const badge = document.createElement("small"); badge.className = "pill";
      badge.textContent = row.required ? "基础必需" : row.connected ? "当前分支依赖" : "可选／备用";
      const title = document.createElement("h3"); title.textContent = row.name;
      const purpose = document.createElement("p"); purpose.textContent = row.purpose;
      const folder = document.createElement("code"); folder.textContent = row.folder;
      const note = document.createElement("p"); note.className = "section-note"; note.textContent = row.note;
      const nodes = document.createElement("details"), summary = document.createElement("summary");
      summary.textContent = `对应加载节点 · ${row.nodes.length} 处`; nodes.append(summary);
      const names = document.createElement("p"); names.textContent = row.nodes.join("；"); nodes.append(names);
      card.append(badge, title, purpose, folder, note);
      if (row.url) {
        const url = new URL(row.url);
        if (url.protocol === "https:") {
          const link = document.createElement("a"); link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer";
          link.className = "model-source-link"; link.textContent = `下载／发布页 ↗ · ${row.source}`; card.append(link);
        }
      } else { const missing = document.createElement("p"); missing.textContent = "下载来源待核实"; card.append(missing); }
      card.append(nodes); list.append(card);
    }
    if (!rows.length) list.textContent = "没有符合条件的模型。自定义加载器未识别时，请查看工作流节点和作者说明。";
  }
  async function load() {
    const token = ++version; status.textContent = "正在读取工作流模型…";
    try {
      const data = await bridge.apiGet("studio/model-catalog");
      if (token !== version) return;
      catalog = data; const previous = choice.value;
      choice.replaceChildren(...data.workflows.map(row => new Option(workflowTitle(row.name), row.name)));
      if (data.workflows.some(row => row.name === previous)) choice.value = previous;
      render();
    } catch (error) { if (token === version) status.textContent = error.message; }
  }
  get("open-model-catalog").onclick = () => { if (canOpen()) { showPanel("model-catalog", get("open-model-catalog")); load(); } };
  panel.querySelector("[data-model-refresh]").onclick = load;
  choice.onchange = scope.onchange = search.oninput = render;
}
