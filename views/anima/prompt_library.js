export function mountPromptLibrary({ get, bridge, message, notify }) {
  const picker = get("prompt-tag-picker");
  const search = get("prompt-tag-search");
  const category = get("prompt-tag-category");
  const status = get("prompt-tag-status");
  const results = get("prompt-tag-results");
  const more = get("prompt-tag-more");
  const dialog = get("prompt-tag-preview");
  const image = get("prompt-tag-preview-image");
  const previewStatus = get("prompt-tag-preview-status");
  const sides = [["positive", "正向"], ["negative", "负向"]];
  let pageVersion = 0;
  let loaded = false;
  let loading = false;
  let previewVersion = 0;
  let offset = 0;
  let timer;
  let previewTag;

  const normalizeTag = (value) => value.toLowerCase().replaceAll("_", " ").trim().replace(/\s+/g, " ");

  function addTag(en, side) {
    const input = get(`preset-${side}`);
    const value = input.value.trimEnd();
    const name = side === "positive" ? "正向" : "负向";
    if (value.split(/[,，\n]/).some((part) => normalizeTag(part) === normalizeTag(en))) {
      status.textContent = `${en} 已在${name}提示词中。`;
      return;
    }
    const separator = value && (/[,，]$/.test(value) ? " " : ", ");
    const next = value + separator + en;
    if (next.length > input.maxLength) {
      message("提示词已达到长度上限。", true);
      return;
    }
    input.value = next;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    status.textContent = `已加入${name} · ${en}`;
    notify(status.textContent);
  }

  async function openPreview(tag) {
    if (dialog.open) return;
    const version = ++previewVersion;
    previewTag = tag.en;
    get("prompt-tag-preview-title").textContent = tag.en;
    get("prompt-tag-preview-label").textContent = tag.zh;
    image.hidden = true;
    image.removeAttribute("src");
    previewStatus.textContent = tag.preview ? "正在加载缩略图…" : "这个词条暂无示例图。";
    dialog.showModal();
    if (!tag.preview) return;
    try {
      const { src } = await bridge.apiGet("studio/prompt-tags/preview", { id: tag.preview });
      if (!dialog.open || version !== previewVersion) return;
      image.src = src;
      image.alt = `${tag.zh || tag.en} 的效果示例`;
      image.hidden = false;
      previewStatus.textContent = "";
    } catch (error) {
      if (dialog.open && version === previewVersion) previewStatus.textContent = error.message;
    }
  }

  function tagRow(tag) {
    const row = document.createElement("li");
    const label = document.createElement("button");
    const title = document.createElement("strong");
    const translation = document.createElement("small");
    label.type = "button";
    label.className = "prompt-tag-label";
    title.textContent = tag.en;
    translation.textContent = tag.zh;
    label.title = tag.preview ? "查看效果示例" : "暂无示例图";
    label.append(title, translation);
    label.addEventListener("click", () => openPreview(tag));
    row.append(label);
    for (const [side, name] of sides) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `＋${name}`;
      button.setAttribute("aria-label", `将 ${tag.en} 加入${name}提示词`);
      button.addEventListener("click", () => addTag(tag.en, side));
      row.append(button);
    }

    let hold;
    let origin;
    let held = false;
    const cancelHold = () => clearTimeout(hold);
    row.addEventListener("pointerdown", (event) => {
      if (!event.isPrimary || event.button !== 0) return;
      held = false;
      origin = [event.clientX, event.clientY];
      hold = setTimeout(() => {
        if (!row.isConnected) return;
        held = true;
        openPreview(tag);
      }, 500);
    });
    row.addEventListener("pointermove", (event) => {
      if (origin && Math.hypot(event.clientX - origin[0], event.clientY - origin[1]) > 10) cancelHold();
    });
    for (const type of ["pointerup", "pointercancel", "pointerleave"]) row.addEventListener(type, cancelHold);
    row.addEventListener("contextmenu", (event) => event.preventDefault());
    row.addEventListener("click", (event) => {
      if (!held || event.detail === 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    return row;
  }

  async function load({ append = false, reload = false } = {}) {
    clearTimeout(timer);
    const version = ++pageVersion;
    loading = true;
    const group = category.value;
    more.hidden = true;
    if (!append) {
      offset = 0;
      results.replaceChildren();
    }
    status.textContent = "正在读取词库…";
    try {
      const data = await bridge.apiGet("studio/prompt-tags", {
        q: search.value, group, offset, reload: reload ? "1" : "0",
      });
      if (version !== pageVersion) return;
      category.replaceChildren(new Option("全部分类", ""), ...data.groups.map(({ title, id }) => new Option(title, id)));
      if (group && !data.groups.some(({ id }) => id === group)) {
        await load();
        return;
      }
      category.value = group;
      get("prompt-tag-directory").replaceChildren(
        `主词库目录：${data.library_directory}`, document.createElement("br"), `补充词库目录：${data.directory}`,
      );
      const warning = get("prompt-tag-warnings");
      warning.hidden = !data.warnings.length;
      warning.textContent = data.warnings.join("；");
      results.append(...data.tags.map(tagRow));
      offset += data.tags.length;
      loaded = Boolean(data.groups.length || !data.warnings.length);
      status.textContent = data.total ? `找到 ${data.total.toLocaleString("zh-CN")} 个标签。`
        : loaded ? "没有匹配的标签。" : "词库未加载。请检查插件设置中的「词库与提示词 → 提示词词库路径」。";
      more.hidden = offset >= data.total;
      if (reload && loaded) notify("词库已重新读取。");
    } catch (error) {
      if (version === pageVersion) {
        loaded = false;
        status.textContent = error.message;
        more.hidden = !append;
      }
    } finally {
      if (version === pageVersion) loading = false;
    }
  }

  picker.addEventListener("toggle", () => {
    if (picker.open && !loaded && !loading) load({ reload: pageVersion > 0 });
  });
  search.addEventListener("input", () => {
    pageVersion += 1;
    clearTimeout(timer);
    more.hidden = true;
    timer = setTimeout(load, 180);
  });
  category.addEventListener("change", () => load());
  get("prompt-tag-reload").addEventListener("click", () => load({ reload: true }));
  more.addEventListener("click", () => load({ append: true }));
  get("prompt-tag-preview-close").addEventListener("click", () => dialog.close());
  for (const [side] of sides) {
    get(`prompt-tag-preview-${side}`).addEventListener("click", () => {
      dialog.close();
      addTag(previewTag, side);
    });
  }
}
