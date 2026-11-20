export function mountReverseHistory({get, bridge, showPanel, canOpen, notify}) {
  const panel = get("reverse-history"), list = panel.querySelector(".reverse-history-list");
  const status = panel.querySelector("[data-history-status]");
  const previous = panel.querySelector("[data-history-prev]"), next = panel.querySelector("[data-history-next]");
  const imageDialog = get("reverse-history-image"), image = imageDialog.querySelector("img");
  const deletion = get("reverse-history-delete"), confirm = deletion.querySelector("[data-delete-confirm]");
  let page = 1, version = 0, pictureVersion = 0, deleteId;
  const previews = new IntersectionObserver(entries => {
    for (const {target, isIntersecting} of entries) {
      if (!isIntersecting) continue;
      previews.unobserve(target);
      bridge.apiGet("studio/reverse-history/image", {id: target.dataset.id}).then(({src}) => {
        if (target.isConnected) target.src = src;
      }).catch(() => { target.alt = "图片副本不可用"; });
    }
  }, {rootMargin: "120px"});
  async function openImage(id) {
    const request = ++pictureVersion;
    image.hidden = true; image.removeAttribute("src");
    imageDialog.querySelector("p").textContent = "正在读取原图…";
    imageDialog.showModal();
    try {
      const {src} = await bridge.apiGet("studio/reverse-history/image", {id, original: "1"});
      if (request !== pictureVersion || !imageDialog.open) return;
      image.src = src; image.hidden = false; imageDialog.querySelector("p").textContent = "";
    } catch (error) { if (request === pictureVersion) imageDialog.querySelector("p").textContent = error.message; }
  }
  imageDialog.querySelector("[data-history-close]").onclick = () => imageDialog.close();
  imageDialog.addEventListener("close", () => { pictureVersion++; image.removeAttribute("src"); });
  async function copy(prompt, textarea) {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(prompt);
      else { textarea.focus(); textarea.select(); if (!document.execCommand("copy")) throw Error("请长按文本手动复制。"); }
      notify("反推提示词已复制。");
    } catch { textarea.focus(); textarea.select(); notify("已选中提示词，请手动复制。"); }
  }
  async function load(requested = page) {
    const request = ++version;
    previews.disconnect(); list.replaceChildren();
    previous.disabled = next.disabled = true;
    status.textContent = "正在读取反推记录…";
    try {
      const data = await bridge.apiGet("studio/reverse-history", {page: requested});
      if (request !== version) return;
      page = data.page;
      const pages = Math.max(1, Math.ceil(data.total / data.page_size));
      panel.querySelector("[data-history-page]").textContent = `第 ${page} / ${pages} 页`;
      previous.disabled = page <= 1; next.disabled = page >= pages;
      status.textContent = data.total ? `共 ${data.total} 条 · 不自动清理` : "暂无反推记录，成功反推后会自动保存。";
      for (const record of data.records) {
        const card = document.createElement("article"); card.className = "reverse-history-card";
        const preview = document.createElement("button"); preview.type = "button"; preview.className = "reverse-history-preview";
        preview.setAttribute("aria-label", "查看反推原图");
        const thumbnail = document.createElement("img"); thumbnail.dataset.id = record.id; thumbnail.alt = "反推图片缩略图";
        preview.append(thumbnail); preview.onclick = () => openImage(record.id);
        const detail = document.createElement("div"), heading = document.createElement("p");
        heading.textContent = `${new Date(record.created_at * 1000).toLocaleString()} · ${record.source}`;
        const prompt = document.createElement("textarea"); prompt.readOnly = true; prompt.value = record.prompt;
        prompt.setAttribute("aria-label", "已保存的反推提示词"); prompt.rows = 7;
        const actions = document.createElement("div"); actions.className = "row-actions";
        const copyButton = document.createElement("button"); copyButton.type = "button"; copyButton.textContent = "复制提示词";
        copyButton.onclick = () => copy(record.prompt, prompt);
        const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "删除";
        remove.onclick = () => { deleteId = record.id; deletion.querySelector("[data-delete-error]").textContent = ""; deletion.showModal(); };
        actions.append(copyButton, remove); detail.append(heading, prompt, actions); card.append(preview, detail); list.append(card);
        previews.observe(thumbnail);
      }
    } catch (error) { if (request === version) status.textContent = error.message; }
  }
  deletion.querySelector("[data-delete-cancel]").onclick = () => deletion.close();
  deletion.addEventListener("cancel", event => { if (confirm.disabled) event.preventDefault(); });
  confirm.onclick = async () => {
    confirm.disabled = true;
    deletion.querySelector("[data-delete-cancel]").disabled = true;
    try {
      await bridge.apiPost("studio/reverse-history/delete", {id: deleteId});
      deletion.close(); notify("反推记录及保存的图片副本已删除。"); await load();
    } catch (error) { deletion.querySelector("[data-delete-error]").textContent = error.message; }
    finally { confirm.disabled = false; deletion.querySelector("[data-delete-cancel]").disabled = false; }
  };
  get("open-reverse-history").onclick = () => {
    if (!canOpen()) return;
    showPanel("reverse-history", get("open-reverse-history")); load(1);
  };
  panel.querySelector("[data-history-refresh]").onclick = () => load();
  previous.onclick = () => load(page - 1); next.onclick = () => load(page + 1);
}
