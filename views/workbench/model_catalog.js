export function mountModelCatalog({get, bridge, showPanel, workflowTitle, canOpen}) {
  const panel = get("model-catalog"), list = panel.querySelector(".model-catalog-list");
  const choice = panel.querySelector("[data-model-workflow]"), search = panel.querySelector("[data-model-search]");
  const scope = panel.querySelector("[data-model-scope]"), status = panel.querySelector("[data-model-status]");
  let catalog, version = 0;
  const editor = document.createElement("dialog"); editor.className = "task-info-dialog model-links-editor";
  const editorTitle = document.createElement("h2"); editorTitle.textContent = "编辑模型信息";
  const modelName = document.createElement("p"); modelName.className = "model-download-description";
  const label = document.createElement("div"); label.className = "field"; label.textContent = "发布／下载链接（首选链接作为发布页入口）";
  const linkLayout = document.createElement("div"); linkLayout.className = "model-link-layout";
  const linkRows = document.createElement("div"); linkRows.className = "model-link-list"; linkRows.setAttribute("role", "listbox"); linkRows.setAttribute("aria-label", "模型链接");
  const linkTools = document.createElement("div"); linkTools.className = "model-link-tools";
  linkLayout.append(linkRows, linkTools); label.append(linkLayout);
  let draftLinks = [], selectedLink = -1, editingLink = -1, originalLink = "", linkBusy = false;
  const tools = {};
  for (const [action, text] of [["add","新建"],["edit","编辑"],["delete","删除"],["up","上移"],["down","下移"]]) {
    const button = document.createElement("button"); button.type = "button"; button.textContent = text; button.dataset.linkAction = action;
    tools[action] = button; linkTools.append(button);
  }
  const descriptionLabel = document.createElement("label"); descriptionLabel.className = "field"; descriptionLabel.textContent = "模型简介";
  const descriptionInput = document.createElement("textarea"); descriptionInput.dataset.modelDescription = ""; descriptionInput.rows = 3; descriptionInput.maxLength = 4000; descriptionInput.placeholder = "填写作用、适用场景或注意事项，可留空"; descriptionLabel.append(descriptionInput);
  const editorNote = document.createElement("p"); editorNote.textContent = "选中一项后编辑或调整顺序，双击／F2 也可编辑，Enter 完成。第一项为首选，最多 10 项；删除所有项可移除入口。链接用于浏览器打开。";
  const linkList = document.createElement("div"); linkList.className = "model-guide-actions";
  const editorError = document.createElement("p"); editorError.setAttribute("role", "status");
  const editorActions = document.createElement("div"); editorActions.className = "row-actions";
  const closeEditor = document.createElement("button"); closeEditor.type = "button"; closeEditor.textContent = "关闭"; closeEditor.onclick = () => editor.close();
  const saveLinks = document.createElement("button"); saveLinks.type = "button"; saveLinks.className = "primary"; saveLinks.textContent = "保存信息";
  editorActions.append(closeEditor, saveLinks); editor.append(editorTitle, modelName, descriptionLabel, label, editorNote, linkList, editorError, editorActions); panel.append(editor);
  const copyDialog = document.createElement("dialog"); copyDialog.className = "task-info-dialog";
  const copyHint = document.createElement("p"); const copyInput = document.createElement("input"); copyInput.readOnly = true;
  const copyClose = document.createElement("button"); copyClose.textContent = "关闭"; copyClose.onclick = () => copyDialog.close();
  copyDialog.append(copyHint, copyInput, copyClose); panel.append(copyDialog);
  async function openOnHost(url) {
    try { await bridge.apiPost("studio/model-links/open", {url}); }
    catch (error) { copyHint.textContent = `${error.message} 可复制下方地址到浏览器打开。`; copyInput.value = url; copyDialog.showModal(); copyInput.select(); }
  }
  function pageLink(url, title) {
    const link = document.createElement("a"); link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer";
    link.className = "model-source-link"; link.textContent = title;
    if (window.AstrBotPluginView) {
      link.title = "在插件电脑的默认浏览器打开";
      link.onclick = event => { event.preventDefault(); openOnHost(url); };
    }
    return link;
  }
  function renderLinkOpen() {
    linkList.replaceChildren();
    const value = draftLinks[selectedLink]?.trim();
    if (!value || linkBusy) return;
    try {
      const url = new URL(value);
      if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) linkList.append(pageLink(value, "打开所选链接 ↗"));
    } catch { /* Incomplete drafts are editable, but cannot be opened. */ }
  }
  function renderLinkRows(focus = false) {
    linkRows.replaceChildren();
    draftLinks.forEach((value, index) => {
      const row = document.createElement("div"); row.className = "model-link-row"; row.classList.toggle("selected", index === selectedLink);
      row.dataset.linkIndex = index; row.setAttribute("role", "option"); row.setAttribute("aria-selected", String(index === selectedLink)); row.tabIndex = index === selectedLink ? 0 : -1;
      const number = document.createElement("small"); number.textContent = index === 0 ? "首选" : String(index + 1);
      const input = document.createElement("input"); input.type = "text"; input.inputMode = "url"; input.maxLength = 4096; input.spellcheck = false;
      input.dataset.linkValue = index; input.value = value; input.readOnly = editingLink !== index; input.disabled = linkBusy;
      input.tabIndex = editingLink === index ? 0 : -1; input.setAttribute("aria-label", `链接 ${index + 1}`); input.title = value;
      input.oninput = () => { draftLinks[index] = input.value; input.title = input.value; editorError.textContent = ""; renderLinkOpen(); };
      row.onclick = () => { if (!linkBusy && selectedLink !== index) { selectedLink = index; editingLink = -1; renderLinkRows(true); } };
      row.ondblclick = () => { if (!linkBusy) { selectedLink = index; beginLinkEdit(); } };
      row.onkeydown = event => {
        if (linkBusy) return;
        if (editingLink === index) {
          if (event.key === "Enter" || event.key === "Escape") {
            event.preventDefault(); event.stopPropagation();
            if (event.key === "Escape") draftLinks[index] = originalLink;
            editingLink = -1; renderLinkRows(true);
          }
        } else if (["ArrowUp", "ArrowDown", "F2", "Enter", "Delete"].includes(event.key)) {
          event.preventDefault();
          if (event.key === "Delete") tools.delete.click();
          else if (event.key === "F2" || event.key === "Enter") beginLinkEdit();
          else { selectedLink = Math.max(0, Math.min(draftLinks.length - 1, index + (event.key === "ArrowUp" ? -1 : 1))); renderLinkRows(true); }
        }
      };
      row.append(number, input); linkRows.append(row);
    });
    if (!draftLinks.length) { const empty = document.createElement("p"); empty.className = "model-link-empty"; empty.textContent = "暂无链接，点击新建添加"; linkRows.append(empty); }
    tools.add.disabled = linkBusy || draftLinks.length >= 10;
    tools.edit.disabled = tools.delete.disabled = linkBusy || selectedLink < 0;
    tools.up.disabled = linkBusy || selectedLink <= 0;
    tools.down.disabled = linkBusy || selectedLink < 0 || selectedLink >= draftLinks.length - 1;
    renderLinkOpen();
    if (focus) {
      const row = linkRows.querySelector(`[data-link-index="${selectedLink}"]`);
      const field = editingLink === selectedLink ? row?.querySelector("input") : row;
      field?.focus(); if (editingLink === selectedLink) field?.select();
    }
  }
  function beginLinkEdit() { if (selectedLink < 0 || linkBusy) return; editingLink = selectedLink; originalLink = draftLinks[selectedLink]; renderLinkRows(true); }
  tools.add.onclick = () => { draftLinks.push(""); selectedLink = draftLinks.length - 1; beginLinkEdit(); };
  tools.edit.onclick = beginLinkEdit;
  tools.delete.onclick = () => { draftLinks.splice(selectedLink, 1); selectedLink = Math.min(selectedLink, draftLinks.length - 1); editingLink = -1; editorError.textContent = ""; renderLinkRows(true); };
  function moveLink(delta) {
    const next = selectedLink + delta;
    [draftLinks[selectedLink], draftLinks[next]] = [draftLinks[next], draftLinks[selectedLink]];
    selectedLink = next; editingLink = -1; renderLinkRows(true);
  }
  tools.up.onclick = () => moveLink(-1); tools.down.onclick = () => moveLink(1);
  editor.addEventListener("cancel", event => { if (linkBusy) event.preventDefault(); });
  let editing;
  function showEditor(row) {
    editing = {workflow: choice.value, name: row.name, folder: row.folder};
    modelName.textContent = row.name; descriptionInput.value = row.note ?? ""; draftLinks = [...(row.links ?? (row.url ? [row.url] : []))]; selectedLink = draftLinks.length ? 0 : -1; editingLink = -1; editorError.textContent = "";
    renderLinkRows();
    editor.showModal();
  }
  saveLinks.onclick = async () => {
    const blank = draftLinks.findIndex(value => !value.trim());
    if (blank >= 0) { editorError.textContent = `链接 ${blank + 1} 为空，请填写或删除该项。`; selectedLink = blank; beginLinkEdit(); return; }
    saveLinks.disabled = closeEditor.disabled = true; editorError.textContent = "";
    linkBusy = descriptionInput.disabled = true; renderLinkRows();
    try {
      await bridge.apiPost("studio/model-links", {...editing, action:"save", note: descriptionInput.value, links: draftLinks.map(value => value.trim()), revision: catalog.links_revision});
      editor.close(); await load();
    } catch (error) { editorError.textContent = error.message; }
    finally { saveLinks.disabled = closeEditor.disabled = linkBusy = descriptionInput.disabled = false; renderLinkRows(); }
  };
  let pending, polling = false;
  const finished = new Set();
  const jobs = document.createElement("div"); jobs.className = "model-download-jobs"; list.before(jobs);
  const dialog = document.createElement("dialog"); dialog.className = "task-info-dialog model-download-confirm";
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
      if (!row.installed) {
        const present = document.createElement("p"); present.className = "model-presence";
        present.textContent = row.local_checked ? "未发现同名模型" : "本机文件状态未确认"; card.append(present);
      }
      if (row.locations?.length) { const paths = document.createElement("p"); paths.className = "model-locations"; paths.textContent = row.locations.join("\n"); card.append(paths); }
      const buttons = document.createElement("div"); buttons.className = "model-guide-actions"; card.append(buttons);
      const primary = row.links?.[0] ?? row.url;
      if (primary) {
        const url = new URL(primary);
        if (["https:", "http:"].includes(url.protocol)) {
          buttons.append(pageLink(url.href, "打开发布页 ↗"));
        }
      } else { const missing = document.createElement("p"); missing.textContent = row.custom_links ? "未设置链接，可点击编辑模型信息补充" : "下载来源待核实"; card.append(missing); }
      if (row.download_url || row.installed) {
        const download = document.createElement("button"); download.type = "button"; download.className = "model-download-button";
        download.textContent = row.installed ? "已存在" : "↓ 下载模型";
        download.disabled = row.installed || !row.local_checked;
        if (row.installed) download.title = "模型已存在，请勿重复下载";
        download.onclick = () => {
          pending = {workflow: choice.value, name: row.name, folder: row.folder};
          description.textContent = `文件：${row.name}\n保存至 ComfyUI：${row.folder}\n来源：${row.download_url}\n下载在运行插件的电脑上进行，文件可能较大。确认后才开始，可随时取消，不覆盖已有模型。`;
          confirmationError.textContent = ""; dialog.showModal();
        };
        buttons.append(download);
      }
      const edit = document.createElement("button"); edit.type = "button"; edit.textContent = "编辑模型信息"; edit.onclick = () => showEditor(row); buttons.append(edit);
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
