export function mountImageReviews({ get, bridge, showPanel, message, notify, canOpen, workflowTitle, openPreset }) {
  const pending = get("image-review");
  const gallery = get("image-gallery");
  const dialog = get("image-original");
  const original = get("image-original-file");
  const originalStatus = get("image-original-status");
  const moveOriginal = get("image-original-move");
  const deleteDialog = get("image-delete-dialog");
  const deleteStatus = get("image-delete-status");
  const deleteConfirm = get("image-delete-confirm");
  const deleteCancel = get("image-delete-cancel");
  const referencePicker = get("queue-reference-picker");
  const referenceGrid = get("queue-reference-grid");
  const referenceFile = get("queue-reference-file");
  const referenceId = get("queue-reference-id");
  const editReference = get("queue-reference-edit");
  const removeMask = get("queue-reference-remove-mask");
  const referencePrev = get("queue-reference-prev");
  const referenceNext = get("queue-reference-next");
  const cards = new Map();
  let pendingVersion = 0;
  let galleryVersion = 0;
  let originalVersion = 0;
  let pendingSnapshot = "";
  let pendingReading = false;
  let page = 1;
  let galleryState = "favourite";
  let openedImage;
  let imageToDelete;
  let referencePage = 1;
  let referenceVersion = 0;
  let sourceVersion = 0;
  let referenceLabel = "";
  let chooseFavourite;
  let mask = null;

  const previews = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting) continue;
      previews.unobserve(target);
      bridge.apiGet("studio/images/file", { id: target.dataset.image, ...(target.dataset.state ? { state: target.dataset.state } : {}) })
        .then(({ src }) => { target.src = src; })
        .catch(() => { target.alt += "（缩略图不可用）"; });
    }
  }, { rootMargin: "120px" });

  const filters = get("image-filters");
  const filterOptions = get("image-filter-options");
  const filterSearch = get("image-filter-search");
  const selectedFilters = { preset: new Set(), workflow: new Set(), lora: new Set() };
  const filterLabels = { preset: "提示词预设", workflow: "工作流", lora: "LoRA" };
  const selectedLabels = new Map();
  let facets = {};
  let facetRequest = 0;
  const filterMissing = { preset: "未使用预设 / 无记录", workflow: "未记录工作流", lora: "未使用 LoRA / 无记录" };

  function filterQuery() {
    const active = Object.entries(selectedFilters)
      .filter(([, values]) => values.size)
      .map(([key, values]) => [key, [...values]]);
    return active.length ? { filters: JSON.stringify(Object.fromEntries(active)) } : {};
  }

  function loraLabel(name) {
    return name.split("/").at(-1).replace(/\.safetensors$/i, "");
  }

  function filterLabel(key, row) {
    if (!row.id) return row.label;
    if (key === "workflow") return workflowTitle(row.label);
    return key === "lora" ? loraLabel(row.label) : row.label;
  }

  function renderFilters() {
    const count = Object.values(selectedFilters).reduce((sum, values) => sum + values.size, 0);
    const badge = get("image-filter-count");
    badge.textContent = count;
    badge.hidden = count === 0;
    get("image-filter-clear").disabled = count === 0;
    const query = filterSearch.value.trim().toLowerCase();
    const focused = document.activeElement?.dataset;
    const focusKey = focused?.filterKey;
    const focusValue = focused?.filterValue;
    const scroll = Array.from(filterOptions.querySelectorAll(".image-filter-values"), (group) => group.scrollTop);
    filterOptions.replaceChildren();
    for (const [key, title] of Object.entries(filterLabels)) {
      const options = new Map((facets[key] ?? [{ id: "", label: filterMissing[key] }]).map((row) => [row.id, row]));
      const labels = new Map();
      for (const row of options.values()) {
        const label = filterLabel(key, row);
        labels.set(label, (labels.get(label) ?? 0) + 1);
      }
      for (const id of selectedFilters[key]) {
        if (!options.has(id)) options.set(id, { id, label: selectedLabels.get(id) ?? id });
      }
      const section = document.createElement("fieldset");
      const legend = document.createElement("legend");
      legend.textContent = title;
      const group = document.createElement("div");
      group.className = "image-filter-values";
      for (const row of options.values()) {
        const title = filterLabel(key, row);
        const label = key === "lora" && labels.get(title) > 1 ? row.label : title;
        const selected = selectedFilters[key].has(row.id);
        if (query && !selected && !label.toLowerCase().includes(query) && !row.label.toLowerCase().includes(query)) continue;
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        if (key === "lora") button.title = row.label;
        button.dataset.filterKey = key;
        button.dataset.filterValue = row.id;
        button.setAttribute("aria-pressed", String(selected));
        button.addEventListener("click", () => {
          if (selected) selectedFilters[key].delete(row.id);
          else {
            selectedFilters[key].add(row.id);
            selectedLabels.set(row.id, row.label);
          }
          renderFilters();
          reloadFiltered();
        });
        group.append(button);
      }
      if (!group.children.length) group.textContent = "暂无匹配项";
      section.append(legend, group);
      filterOptions.append(section);
      group.scrollTop = scroll.shift() ?? 0;
      for (const button of group.children) {
        if (button.dataset.filterKey === focusKey && button.dataset.filterValue === focusValue) {
          button.focus({ preventScroll: true });
        }
      }
    }
  }

  function reloadFiltered() {
    if (!pending.hidden) refreshPending(true);
    else if (!gallery.hidden) refreshGallery(1);
  }

  async function loadFacets() {
    if (!filters.open || (pending.hidden && gallery.hidden)) return;
    const version = ++facetRequest;
    const status = get("image-filter-status");
    status.textContent = "正在读取筛选项…";
    status.hidden = false;
    try {
      const data = await bridge.apiGet("studio/images", {
        facets: "1", state: pending.hidden ? galleryState : "unevaluate",
        rating: pending.hidden ? get("image-gallery-rating").value : "",
      });
      if (version !== facetRequest || !filters.open) return;
      facets = data.facets;
      status.hidden = true;
      renderFilters();
    } catch (error) {
      if (version === facetRequest) status.textContent = error.message;
    }
  }

  function placeFilters(slot) {
    get(slot).append(filters);
    facets = {};
    renderFilters();
    loadFacets();
  }

  filters.addEventListener("toggle", () => {
    if (filters.open) loadFacets();
    else facetRequest++;
  });
  filterSearch.addEventListener("input", renderFilters);
  get("image-filter-clear").addEventListener("click", () => {
    for (const values of Object.values(selectedFilters)) values.clear();
    selectedLabels.clear();
    filterSearch.value = "";
    renderFilters();
    reloadFiltered();
  });

  function generationFields(item) {
    const info = item.generation;
    if (!info) return item.id.startsWith("manual:") ? [["生成信息", "无记录"]] : [];
    const loras = info.loras?.map((row) => (
      row.model === row.clip ? `${row.name} × ${row.model}` : `${row.name}（模型 ${row.model}，CLIP ${row.clip}）`
    ));
    return [
      ["工作流", info.workflow ? workflowTitle(info.workflow) : "无记录"],
      ["提示词预设", info.preset?.name ?? "未使用 / 无记录"],
      ["LoRA", loras?.length ? loras.join(" · ") : "未使用 / 无记录"],
      ...(info.seed == null ? [] : [["种子", info.seed]]),
    ];
  }

  function imageLabel(item) {
    return `${item.rating} · ${item.name || `图 ${item.index}`}`;
  }

  function renderReferenceStatus() {
    get("queue-reference-status").textContent = mask ? `${referenceLabel} · 已应用遮罩` : referenceLabel;
    removeMask.hidden = !mask;
  }

  function updateReference(label) {
    sourceVersion++;
    referenceLabel = label;
    mask = null;
    editReference.textContent = "编辑遮罩";
    editReference.disabled = !label;
    get("queue-reference-clear").hidden = !label;
    renderReferenceStatus();
    if (label) notify(label);
  }

  async function loadReferences(page) {
    const version = ++referenceVersion;
    const note = get("queue-reference-note");
    note.textContent = "正在读取收藏图集…";
    referencePrev.disabled = referenceNext.disabled = true;
    for (const image of referenceGrid.querySelectorAll("img")) previews.unobserve(image);
    referenceGrid.replaceChildren();
    try {
      const data = await bridge.apiGet("studio/images", {
        state: "favourite", rating: get("queue-reference-rating").value, page,
      });
      if (!referencePicker.open || version !== referenceVersion) return;
      for (const item of data.images) {
        const label = imageLabel(item);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "review-preview";
        button.setAttribute("aria-label", `选择图片 · ${label}`);
        const image = document.createElement("img");
        image.alt = label;
        image.dataset.image = item.id;
        image.decoding = "async";
        button.append(image);
        button.addEventListener("click", () => {
          referencePicker.close();
          chooseFavourite(item);
        });
        referenceGrid.append(button);
        previews.observe(image);
      }
      referencePage = page;
      note.textContent = data.images.length ? `第 ${page} 页 · 点击缩略图选择` : "这一页没有收藏图片。";
      referencePrev.disabled = page <= 1;
      referenceNext.disabled = !data.has_more;
    } catch (error) {
      if (referencePicker.open && version === referenceVersion) {
        note.textContent = error.message;
        referencePage = page;
        referencePrev.disabled = page <= 1;
      }
    }
  }

  function pickFavourite(title, onSelect) {
    chooseFavourite = onSelect;
    get("queue-reference-title").textContent = title;
    referencePicker.showModal();
    loadReferences(1);
  }

  get("queue-reference-open").addEventListener("click", () => {
    pickFavourite("从收藏选择参考图", (item) => {
      referenceId.value = item.id;
      referenceFile.value = "";
      updateReference(`已选择收藏图片 · ${imageLabel(item)}`);
    });
  });
  get("queue-reference-close").addEventListener("click", () => referencePicker.close());
  get("queue-reference-rating").addEventListener("change", () => loadReferences(1));
  referencePrev.addEventListener("click", () => loadReferences(referencePage - 1));
  referenceNext.addEventListener("click", () => loadReferences(referencePage + 1));
  get("queue-reference-upload").addEventListener("click", () => referenceFile.click());
  referenceFile.addEventListener("change", () => {
    if (!referenceFile.files.length) return;
    referenceId.value = "";
    updateReference(`已选择本地图片 · ${referenceFile.files[0].name}`);
  });
  get("queue-reference-clear").addEventListener("click", () => {
    referenceId.value = referenceFile.value = "";
    updateReference("");
    notify("参考图已清除。");
  });
  removeMask.addEventListener("click", () => {
    mask = null;
    renderReferenceStatus();
    notify("已移除本次遮罩编辑。");
  });
  editReference.addEventListener("click", async () => {
    const version = sourceVersion;
    editReference.disabled = true;
    editReference.textContent = "正在打开…";
    try {
      const file = referenceFile.files[0];
      const [{ editMask }, source] = await Promise.all([
        import("./mask_editor.js"),
        file || bridge.apiGet("studio/images/file", { id: referenceId.value, original: "1" }).then(({ src }) => src),
      ]);
      if (version !== sourceVersion || get("queue").hidden || get("queue-reference").hidden) return;
      const result = await editMask(source, mask);
      if (!result || version !== sourceVersion) return;
      mask = result;
      renderReferenceStatus();
      notify("已应用遮罩。");
    } catch (error) {
      if (version === sourceVersion) message(error.message, true);
    } finally {
      if (version === sourceVersion) {
        editReference.textContent = "编辑遮罩";
        editReference.disabled = false;
      }
    }
  });

  async function openOriginal(item, state, { readOnly = false } = {}) {
    const version = ++originalVersion;
    openedImage = { item, state };
    moveOriginal.hidden = readOnly || state === "unevaluate";
    moveOriginal.disabled = true;
    moveOriginal.textContent = state === "pass" ? "移到收藏" : "移到 Pass";
    original.hidden = true;
    original.removeAttribute("src");
    originalStatus.textContent = "正在加载原图…";
    const generation = get("image-generation-info");
    const fields = generationFields(item);
    generation.replaceChildren();
    generation.hidden = !fields.length;
    for (const [label, value] of fields) {
      const name = document.createElement("dt");
      name.textContent = label;
      const text = document.createElement("dd");
      const preset = item.generation?.preset;
      if (label === "提示词预设" && preset?.account && preset.id) {
        const link = document.createElement("button");
        link.type = "button";
        link.className = "image-preset-link";
        link.textContent = value;
        link.addEventListener("click", () => {
          dialog.close();
          openPreset(preset.account, preset.id);
        });
        text.append(link);
      } else text.textContent = value;
      generation.append(name, text);
    }
    dialog.showModal();
    try {
      const { src } = await bridge.apiGet("studio/images/file", { id: item.id, original: "1", state });
      if (version !== originalVersion) return;
      original.src = src;
      original.alt = imageLabel(item);
      original.hidden = false;
      originalStatus.textContent = "";
    } catch (error) {
      if (version === originalVersion) originalStatus.textContent = error.message;
    } finally {
      if (version === originalVersion) moveOriginal.disabled = false;
    }
  }

  function card(item, state) {
    const key = `${state}:${item.id}`;
    const existing = cards.get(key);
    if (existing && existing.dataset.generation === JSON.stringify(item.generation ?? null)) return existing;
    if (existing) previews.unobserve(existing.querySelector("img"));
    const frame = document.createElement("article");
    frame.className = "review-card";
    frame.dataset.generation = JSON.stringify(item.generation ?? null);
    const preview = document.createElement("button");
    preview.type = "button";
    preview.className = "review-preview";
    const image = document.createElement("img");
    image.alt = imageLabel(item);
    image.dataset.image = item.id;
    image.decoding = "async";
    preview.append(image);
    preview.addEventListener("click", () => openOriginal(item, state));
    const footer = document.createElement("div");
    footer.className = "review-card-footer";
    const label = document.createElement("small");
    label.textContent = imageLabel(item);
    footer.append(label);
    if (item.generation) {
      const summary = document.createElement("small");
      summary.className = "image-generation-summary";
      summary.textContent = [
        item.generation.preset?.name, item.generation.workflow && workflowTitle(item.generation.workflow),
        ...new Set((item.generation.loras ?? []).map((row) => loraLabel(row.name))),
      ].filter(Boolean).join(" · ");
      if (summary.textContent) footer.append(summary);
    }
    if (state === "unevaluate") {
      const actions = document.createElement("div");
      actions.className = "row-actions";
      for (const [state, title] of [["favourite", "收藏"], ["pass", "跳过"]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = title;
        button.classList.toggle("primary", state === "favourite");
        button.addEventListener("click", async () => {
          for (const action of actions.children) action.disabled = true;
          try {
            await bridge.apiPost("studio/images", { id: item.id, state });
            frame.remove();
            message("");
            notify(state === "favourite" ? "图片已收藏。" : "图片已跳过。");
            await refreshPending(true);
            loadFacets();
          } catch (error) {
            message(error.message, true);
          } finally {
            for (const action of actions.children) action.disabled = false;
          }
        });
        actions.append(button);
      }
      footer.append(actions);
    }
    if (state === "unevaluate" || state === "pass") {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "删除";
      remove.addEventListener("click", () => {
        imageToDelete = { item, state };
        get("image-delete-name").textContent = imageLabel(item);
        deleteStatus.textContent = "";
        deleteDialog.showModal();
      });
      footer.append(remove);
    }
    frame.append(preview, footer);
    cards.set(key, frame);
    previews.observe(image);
    return frame;
  }

  function discardOldCards(items, state) {
    const wanted = new Set(items.map((item) => `${state}:${item.id}`));
    for (const [key, frame] of cards) {
      if (wanted.has(key)) continue;
      previews.unobserve(frame.querySelector("img"));
      cards.delete(key);
    }
  }

  async function refreshPending(force = false) {
    if (pending.hidden || (!force && pendingReading)) return;
    const version = ++pendingVersion;
    pendingReading = true;
    try {
      const data = await bridge.apiGet("studio/images", { state: "unevaluate", ...filterQuery() });
      if (version !== pendingVersion || pending.hidden) return;
      const snapshot = JSON.stringify(data);
      if (snapshot === pendingSnapshot) return;
      pendingSnapshot = snapshot;
      discardOldCards(data.jobs.flatMap((job) => job.images), "unevaluate");
      get("image-review-count").textContent = `${data.jobs.length} / ${data.limit} 项任务`;
      const groups = data.jobs.map((job) => {
        const group = document.createElement("section");
        const title = document.createElement("h3");
        title.textContent = job.id ? `${workflowTitle(job.workflow)} · ID ${job.id}` : job.workflow;
        const grid = document.createElement("div");
        grid.className = "review-grid";
        grid.append(...job.images.map((item) => card(item, "unevaluate")));
        group.append(title, grid);
        return group;
      });
      get("image-review-jobs").replaceChildren(...groups);
      get("image-review-empty").hidden = groups.length !== 0;
    } catch (error) {
      if (version === pendingVersion && !pending.hidden && force) message(error.message, true);
    } finally {
      if (version === pendingVersion) pendingReading = false;
    }
  }

  async function refreshGallery(next) {
    const version = ++galleryVersion;
    const state = galleryState;
    const previous = get("image-gallery-prev");
    const more = get("image-gallery-next");
    previous.disabled = more.disabled = true;
    try {
      const rating = get("image-gallery-rating").value;
      const data = await bridge.apiGet("studio/images", { state, rating, page: next, ...filterQuery() });
      if (version !== galleryVersion || gallery.hidden) return;
      page = next;
      discardOldCards(data.images, state);
      get("image-gallery-grid").replaceChildren(...data.images.map((item) => card(item, state)));
      get("image-gallery-empty").hidden = data.images.length !== 0;
      get("image-gallery-page").textContent = `第 ${page} 页`;
      previous.disabled = page === 1;
      more.disabled = !data.has_more;
      message("");
    } catch (error) {
      if (version === galleryVersion && !gallery.hidden) {
        previous.disabled = page === 1;
        message(error.message, true);
      }
    }
  }

  get("open-image-review").addEventListener("click", () => {
    if (!canOpen()) return;
    showPanel("image-review", get("open-image-review"));
    placeFilters("image-review-filter-slot");
    message("");
    pendingSnapshot = "";
    refreshPending(true);
  });
  for (const [id, state, title] of [
    ["open-image-gallery", "favourite", "收藏图集"],
    ["open-pass-gallery", "pass", "Pass 图集"],
  ]) {
    const tab = get(id);
    tab.addEventListener("click", () => {
      if (!canOpen()) return;
      if (galleryState !== state) {
        get("image-gallery-grid").replaceChildren();
        get("image-gallery-empty").hidden = true;
        get("image-gallery-page").textContent = "";
        get("image-gallery-thumbnail-status").textContent = "";
      }
      galleryState = state;
      get("image-gallery-title").textContent = title;
      get("image-gallery-empty").textContent = state === "pass" ? "Pass 图集暂无图片。" : "暂无收藏图片。";
      showPanel("image-gallery", tab);
      placeFilters("image-gallery-filter-slot");
      message("");
      refreshGallery(1);
    });
  }
  get("image-review-refresh").addEventListener("click", () => {
    loadFacets();
    refreshPending(true);
  });
  get("image-gallery-thumbnails").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const status = get("image-gallery-thumbnail-status");
    const state = galleryState;
    button.disabled = true;
    status.textContent = "正在扫描图集并生成缺失缩略图…";
    try {
      const { created, existing, failed } = await bridge.apiPost("studio/images/thumbnails", { state });
      if (state !== galleryState) return;
      status.textContent = `新生成 ${created} 张，已有 ${existing} 张，失败 ${failed} 张。`;
      notify(status.textContent);
      if (!gallery.hidden) {
        discardOldCards([], state);
        await refreshGallery(page);
      }
    } catch (error) {
      if (state !== galleryState) return;
      status.textContent = error.message;
      if (!gallery.hidden) message(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  get("image-gallery-rating").addEventListener("change", () => {
    loadFacets();
    refreshGallery(1);
  });
  get("image-gallery-prev").addEventListener("click", () => refreshGallery(page - 1));
  get("image-gallery-next").addEventListener("click", () => refreshGallery(page + 1));
  function refreshGalleryAfterRemoval(state) {
    if (gallery.hidden || galleryState !== state) return;
    loadFacets();
    const next = page > 1 && get("image-gallery-grid").children.length === 1 ? page - 1 : page;
    return refreshGallery(next);
  }

  deleteDialog.addEventListener("cancel", (event) => {
    if (deleteConfirm.disabled) event.preventDefault();
  });
  deleteConfirm.addEventListener("click", async () => {
    if (deleteConfirm.disabled || !imageToDelete) return;
    const { item, state } = imageToDelete;
    deleteConfirm.disabled = deleteCancel.disabled = true;
    deleteStatus.textContent = "正在删除…";
    try {
      await bridge.apiPost("studio/images/delete", { id: item.id, state });
      deleteDialog.close();
      notify("图片已删除。");
      if (state === "unevaluate") {
        await refreshPending(true);
        loadFacets();
      }
      else await refreshGalleryAfterRemoval(state);
    } catch (error) {
      deleteStatus.textContent = error.message;
    } finally {
      deleteConfirm.disabled = deleteCancel.disabled = false;
    }
  });
  moveOriginal.addEventListener("click", async () => {
    if (!openedImage || openedImage.state === "unevaluate" || moveOriginal.disabled) return;
    const version = originalVersion;
    const { item, state: source } = openedImage;
    const state = source === "pass" ? "favourite" : "pass";
    moveOriginal.disabled = true;
    originalStatus.textContent = "正在移动图片…";
    try {
      await bridge.apiPost("studio/images", { id: item.id, state, source });
      if (version === originalVersion && dialog.open) dialog.close();
      notify(state === "favourite" ? "图片已移到收藏。" : "图片已移到 Pass 图集。");
      await refreshGalleryAfterRemoval(source);
    } catch (error) {
      if (version === originalVersion && dialog.open) originalStatus.textContent = error.message;
      else if (!gallery.hidden && galleryState === source) message(error.message, true);
    } finally {
      if (version === originalVersion) moveOriginal.disabled = false;
    }
  });
  dialog.addEventListener("close", () => {
    originalVersion++;
    openedImage = undefined;
    original.removeAttribute("src");
  });
  setInterval(refreshPending, 5000);
  return { mask: () => mask, pickFavourite, openOriginal, previews };
}
