export function mountModelCatalog({get, bridge, showPanel, workflowTitle, canOpen}) {
  const panel = get("model-catalog"), list = panel.querySelector(".model-catalog-list");
  const choice = panel.querySelector("[data-model-workflow]"), search = panel.querySelector("[data-model-search]");
  const scope = panel.querySelector("[data-model-scope]"), status = panel.querySelector("[data-model-status]");
  let catalog, version = 0;
  let pending, polling = false;
  const finished = new Set();
  const jobs = document.createElement("div"); jobs.className = "model-download-jobs"; list.before(jobs);
  const dialog = document.createElement("dialog"); dialog.className = "task-info-dialog";
  const heading = document.createElement("h2"); heading.textContent = "确认下载模型";
  const description = document.createElement("p"); description.className = "model-download-description";
  const confirmationError = document.createElement("p"); confirmationError.setAttribute("role", "alert");
  const actions = document.createElement("div"); actions.className = "row-actions";
  const back = document.createElement("button"); back.type = "button"; back.textContent = "暂不下载"; back.onclick = () => dialog.close();
  const confirm = document.createElement("button"); confirm.type = "button"; confirm.className = "primary"; confirm.textContent = "确认下载至 ComfyUI";
  actions.append(back, confirm); dialog.append(heading, description, confirmationError, actions); panel.append(dialog);
  confirm.onclick = async () => {
    confirm.disabled = back.disabled = true; confirmationError.textContent = "";
    try {
      await bridge.apiPost("studio/model-downloads", {...pending, confirmed: true});
      dialog.close(); await poll();
    } catch (error) { confirmationError.textContent = error.message; }
    finally { confirm.disabled = back.disabled = false; }
  };
  dialog.addEventListener("cancel", event => { if (confirm.disabled) event.preventDefault(); });
  function bytes(value) { return value == null ? "未知大小" : `${(value / 1024**2).toFixed(1)} MiB`; }
  async function poll() {
    if (polling || panel.hidden) return;
    polling = true;
    try {
      const {jobs: records} = await bridge.apiGet("studio/model-downloads");
      jobs.replaceChildren(); let refresh = false;
      for (const job of records.slice().reverse()) {
        const card = document.createElement("article"); card.className = "model-download-job";
        const label = document.createElement("strong"); label.textContent = job.name;
        const detail = document.createElement("p");
        const state = {queued:"等待下载",downloading:"下载中",completed:"下载完成",cancelled:"已取消",failed:"下载失败"}[job.state] || job.state;
        detail.textContent = `${state} · ${bytes(job.received)} / ${bytes(job.total)}${job.total ? ` · ${Math.min(100, job.received / job.total * 100).toFixed(1)}%` : ""}${job.error ? ` · ${job.error}` : ""}`;
        const progress = document.createElement("progress"); progress.max = job.total || 1;
        if (job.total) progress.value = job.received;
        else if (job.state === "completed") progress.value = 1;
        else if (!["queued", "downloading"].includes(job.state)) progress.value = 0;
        progress.setAttribute("aria-label", `${job.name} 下载进度`);
        card.append(label, detail, progress);
        if (["queued", "downloading"].includes(job.state)) {
          const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "取消下载";
          cancel.onclick = async () => {
            cancel.disabled = true;
            try { await bridge.apiPost("studio/model-downloads", {action:"cancel", id:job.id}); }
            catch (error) { status.textContent = error.message; }
            finally { cancel.disabled = false; await poll(); }
          };
          card.append(cancel);
        }
        if (job.state === "completed" && !finished.has(job.id)) { finished.add(job.id); refresh = true; }
        jobs.append(card);
      }
      if (refresh) await load();
    } catch (error) { status.textContent = `下载状态读取失败：${error.message}`; }
    finally { polling = false; }
  }
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
      const present = document.createElement("p"); present.className = `model-presence ${row.installed ? "installed" : ""}`;
      present.textContent = row.installed ? "✓ 已存在，请勿重复下载" : row.local_checked ? "未发现同名模型" : "本机文件状态未确认";
      card.append(present);
      if (row.locations?.length) { const paths = document.createElement("p"); paths.className = "model-locations"; paths.textContent = row.locations.join("\n"); card.append(paths); }
      const buttons = document.createElement("div"); buttons.className = "model-guide-actions"; card.append(buttons);
      if (row.url) {
        const url = new URL(row.url);
        if (url.protocol === "https:") {
          const link = document.createElement("a"); link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer";
          link.className = "model-source-link"; link.textContent = "打开发布页 ↗"; link.title = row.source; buttons.append(link);
        }
      } else { const missing = document.createElement("p"); missing.textContent = "下载来源待核实"; card.append(missing); }
      if (row.download_url) {
        const download = document.createElement("button"); download.type = "button"; download.className = "model-download-button";
        download.textContent = row.installed ? "已存在" : "↓ 下载模型";
        download.disabled = row.installed || !row.local_checked;
        download.onclick = () => {
          pending = {workflow: choice.value, name: row.name, folder: row.folder};
          description.textContent = `文件：${row.name}\n保存至 ComfyUI：${row.folder}\n来源：${row.download_url}\n下载在运行插件的电脑上进行，文件可能较大。确认后才开始，可随时取消，不覆盖已有模型。`;
          confirmationError.textContent = ""; dialog.showModal();
        };
        buttons.append(download);
      }
      const attribution = document.createElement("small"); attribution.textContent = row.source; card.append(attribution);
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
  get("open-model-catalog").onclick = () => { if (canOpen()) { showPanel("model-catalog", get("open-model-catalog")); load(); poll(); } };
  panel.querySelector("[data-model-refresh]").onclick = () => { load(); poll(); };
  choice.onchange = scope.onchange = search.oninput = render;
  setInterval(() => { if (catalog && !panel.hidden) poll(); }, 2000);
}
