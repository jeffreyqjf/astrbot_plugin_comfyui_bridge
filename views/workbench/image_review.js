const controlBranches = { openpose: "OpenPose", any: "Any", lllite: "LLLite" };
const controlTypes = { openpose: "OpenPose", canny: "Canny", depth: "Depth" };
const controlStates = { unevaluated: "待评价", favourite: "收藏", pass: "Pass" };
export const controlBranchTitle = (name) => controlBranches[name] ?? name;
export const controlTypeTitle = (name) => controlTypes[name] ?? name;
const controlAssetId = (asset) => asset.asset_id ?? asset.id;
const controlAssetTitle = (asset) => asset.name || `${controlBranchTitle(asset.branch)} · ${controlTypeTitle(asset.type)}`;

export function setTaskImagePreview(image, source) {
  const previous = image.getAttribute("src");
  if (previous?.startsWith("blob:")) URL.revokeObjectURL(previous);
  if (source) image.src = typeof source === "string" ? source : URL.createObjectURL(source);
  else image.removeAttribute("src");
  image.hidden = !source;
}

export function mountImageReviews({
  get, bridge, showPanel, message, notify, canOpen, workflowTitle, openPreset, onReferenceChange,
}) {
  const pending = get("image-review");
  const gallery = get("image-gallery");
  const dialog = get("image-original");
  const original = get("image-original-file");
  const originalStatus = get("image-original-status");
  const moveOriginal = get("image-original-move");
  const downloadOriginal = get("image-original-download");
  const favouriteOriginal = get("image-original-favourite");
  const passOriginal = get("image-original-pass");
  const originalNav = get("image-original-navigation");
  const originalPrev = get("image-original-prev");
  const originalNext = get("image-original-next");
  const originalControls = get("image-original-controls");
  const controlGallery = get("control-gallery");
  const controlPreview = get("control-preview");
  const controlPreviewAsset = get("control-preview-asset");
  const resourcePicker = get("task-resource-picker");
  const resourceList = get("task-resource-items");
  const resourcePreview = get("task-resource-preview");
  const resourceImage = get("task-resource-image");
  const resourceGallery = get("task-resource-gallery");
  const resourceChoose = get("task-resource-choose");
  const deleteDialog = get("image-delete-dialog");
  const deleteStatus = get("image-delete-status");
  const deleteConfirm = get("image-delete-confirm");
  const deleteCancel = get("image-delete-cancel");
  const referencePicker = get("queue-reference-picker");
  const referenceGrid = get("queue-reference-grid");
  const referenceFile = get("queue-reference-file");
  const referenceId = get("queue-reference-id");
  const referenceThumbnail = get("queue-reference-thumbnail");
  const editReference = get("queue-reference-edit");
  const removeMask = get("queue-reference-remove-mask");
  const referencePrev = get("queue-reference-prev");
  const referenceNext = get("queue-reference-next");
  const cards = new Map();
  const pendingList = imageList("unevaluate", pending, "image-review-pages");
  const galleryList = imageList("favourite", gallery, "image-gallery-pages");
  const originalPager = makePager("image-original-pages", (page) => browseOriginalPage(page, "first"), false);
  const controlPager = makePager("control-gallery-pages", loadControlGallery);
  const resourcePager = makePager("task-resource-pages", loadResources);
  const controlWrites = new Set();
  let controlGalleryVersion = 0;
  let controlPage = 1;
  let controlLastPage = 0;
  let resourceVersion = 0;
  let resourceRequest;
  let originalVersion = 0;
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
      const path = target.dataset.controlAsset ? "studio/control-assets/preview" : "studio/images/file";
      bridge.apiGet(path, { id: target.dataset.image, ...(target.dataset.state ? { state: target.dataset.state } : {}) })
        .then(({ src }) => { target.src = src; })
        .catch(() => { target.alt += "（缩略图不可用）"; });
    }
  }, { rootMargin: "120px" });

  function loraLabel(name) {
    return name.split("/").at(-1).replace(/\.safetensors$/i, "");
  }

  function mountFilters(filters, prefix, filterContext, reloadFiltered) {
    const getFilter = (id) => get(prefix + id);
    const filterOptions = getFilter("image-filter-options");
    const filterSearch = getFilter("image-filter-search");
    const loraMatch = getFilter("image-lora-match");
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
      return {
        ...(active.length ? { filters: JSON.stringify(Object.fromEntries(active)) } : {}),
        ...(loraMatch.checked ? { lora_match: "all" } : {}),
      };
    }

    function filterLabel(key, row) {
      if (!row.id) return row.label;
      if (key === "workflow") return workflowTitle(row.label);
      return key === "lora" ? loraLabel(row.label) : row.label;
    }

    function renderFilters() {
      const count = Object.values(selectedFilters).reduce((sum, values) => sum + values.size, 0);
      const badge = getFilter("image-filter-count");
      badge.textContent = count;
      badge.hidden = count === 0;
      getFilter("image-filter-clear").disabled = count === 0 && !loraMatch.checked;
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

    async function loadFacets() {
      const query = filterContext();
      if (!filters.open || !query) return;
      const version = ++facetRequest;
      const status = getFilter("image-filter-status");
      status.textContent = "正在读取筛选项…";
      status.hidden = false;
      try {
        const data = await bridge.apiGet("studio/images", { ...query, facets: "1" });
        if (version !== facetRequest || !filters.open || !filterContext()) return;
        facets = data.facets;
        status.hidden = true;
        renderFilters();
      } catch (error) {
        if (version === facetRequest) status.textContent = error.message;
      }
    }

    filters.addEventListener("toggle", () => {
      if (filters.open) loadFacets();
      else facetRequest++;
    });
    filterSearch.addEventListener("input", renderFilters);
    loraMatch.addEventListener("change", () => {
      renderFilters();
      reloadFiltered();
    });
    getFilter("image-filter-clear").addEventListener("click", () => {
      for (const values of Object.values(selectedFilters)) values.clear();
      selectedLabels.clear();
      filterSearch.value = "";
      loraMatch.checked = false;
      renderFilters();
      reloadFiltered();
    });

    return {
      query: filterQuery,
      load: loadFacets,
      resetOptions() {
        facetRequest++;
        facets = {};
        getFilter("image-filter-status").hidden = true;
        renderFilters();
        loadFacets();
      },
    };
  }

  const filters = get("image-filters");
  const pickerFilters = filters.cloneNode(true);
  pickerFilters.id = "picker-image-filters";
  for (const element of pickerFilters.querySelectorAll("[id]")) element.id = "picker-" + element.id;
  get("task-resource-filters").append(pickerFilters);

  const galleryFilters = mountFilters(filters, "", () => {
    if (!pending.hidden) return { state: "unevaluate" };
    if (!gallery.hidden) return { state: galleryList.state, rating: get("image-gallery-rating").value };
  }, () => {
    if (!pending.hidden) refreshList(pendingList, 1);
    else if (!gallery.hidden) refreshList(galleryList, 1);
  });
  const { query: filterQuery, load: loadFacets } = galleryFilters;
  const resourceFilters = mountFilters(pickerFilters, "picker-", () => {
    if (!resourcePicker.open || resourceRequest?.source === "input") return;
    const [kind, state] = resourceGallery.value.split("/");
    if (kind === "images") return { state, rating: resourceRating(state) };
  }, () => loadResources(1));

  function resourceRating(state) {
    return state === "unevaluate" ? "" : get("task-resource-rating").value;
  }

  function placeFilters(slot) {
    get(slot).append(filters);
    galleryFilters.resetOptions();
  }

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

  function updateReference(label, preview) {
    const version = ++sourceVersion;
    referenceLabel = label;
    mask = null;
    editReference.textContent = "编辑遮罩";
    editReference.disabled = !label;
    get("queue-reference-clear").hidden = !label;
    renderReferenceStatus();
    setTaskImagePreview(referenceThumbnail, preview || referenceFile.files[0]);
    if (!preview && referenceId.value) {
      bridge.apiGet("studio/images/file", { id: referenceId.value, state: "favourite" }).then(({ src }) => {
        if (version === sourceVersion) setTaskImagePreview(referenceThumbnail, src);
      }).catch(() => {});
    }
    onReferenceChange?.();
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
          chooseFavourite(item, image.getAttribute("src"));
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
    pickResource("gallery", async ({entry, kind, state, label}) => {
      const version = ++sourceVersion;
      const buttons = [get("queue-add"), get("remote-command-send"), get("queue-reference-open")];
      const disabled = buttons.map(button => button.disabled);
      buttons.forEach(button => { button.disabled = true; });
      try {
        const {src} = await bridge.apiGet(kind === "controls" ? "studio/control-assets/preview" : "studio/images/file", {
          id: kind === "controls" ? controlAssetId(entry) : entry.id,
          ...(kind === "controls" ? {} : {state}), original: "1",
        });
        if (version !== sourceVersion) return;
        const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(src);
        if (!match) throw new Error("图集原图格式无效。");
        const suffix = {"image/png":"png","image/jpeg":"jpg","image/webp":"webp","image/gif":"gif"}[match[1]];
        const bytes = Uint8Array.from(atob(match[2]), value => value.charCodeAt(0));
        const files = new DataTransfer();
        files.items.add(new File([bytes], `reference.${suffix}`, {type: match[1]}));
        referenceFile.files = files.files;
        referenceId.value = "";
        updateReference(`已选择图集图片 · ${label}`, src);
      } catch (error) { notify(error.message, true); }
      finally { buttons.forEach((button, index) => { button.disabled = disabled[index]; }); }
    }, {useControls: true, gallery: "images/favourite", title: "从图集选择参考图"});
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
      if (version !== sourceVersion || get("create-task").hidden || get("queue-reference").hidden) return;
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

  function makePager(id, selectPage, showSteps = true) {
    const nav = get(id);
    nav.append(get("image-page-controls").content.cloneNode(true));
    const previous = nav.querySelector('[data-page-step="-1"]');
    const next = nav.querySelector('[data-page-step="1"]');
    const numbers = nav.querySelector("[data-page-numbers]");
    const form = nav.querySelector("form");
    const input = form.querySelector("input");
    const jump = form.querySelector("button");
    let page = 0;
    let last = 0;
    previous.hidden = next.hidden = !showSteps;
    previous.addEventListener("click", () => selectPage(page - 1));
    next.addEventListener("click", () => selectPage(page + 1));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const requested = input.valueAsNumber;
      if (!jump.disabled && Number.isInteger(requested) && requested >= 1 && requested <= last && requested !== page) {
        selectPage(requested);
      }
    });
    return (current, total, loading) => {
      nav.hidden = !total;
      nav.setAttribute("aria-busy", String(loading));
      if (page !== current || last !== total) {
        page = current;
        last = total;
        const counter = document.createElement("small");
        counter.textContent = `第 ${page} / ${last} 页`;
        numbers.replaceChildren(counter);
        if (last > 1) {
          const start = Math.max(1, Math.min(page - 1, last - 2));
          for (let value = start; value <= Math.min(last, start + 2); value++) {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = value;
            button.setAttribute("aria-label", `第 ${value} 页`);
            if (value === page) button.setAttribute("aria-current", "page");
            button.addEventListener("click", () => selectPage(value));
            numbers.append(button);
          }
        }
        input.value = "";
        input.max = last;
        input.placeholder = page;
      }
      form.hidden = last <= 1;
      jump.disabled = input.disabled = loading;
      previous.disabled = loading || page <= 1;
      next.disabled = loading || page >= last;
      for (const button of numbers.querySelectorAll("button")) {
        button.disabled = loading || button.hasAttribute("aria-current");
      }
    };
  }

  function imageList(state, panel, pagerId) {
    const list = { state, panel, page: 1, last: 0, items: [], version: 0, loading: false, navigating: false, snapshot: "" };
    list.pager = makePager(pagerId, (page) => refreshList(list, page));
    return list;
  }

  function clearResourcePreview() {
    resourcePreview.hidden = true;
    resourceChoose.disabled = true;
    resourceImage.removeAttribute("src");
    resourceList.hidden = false;
  }

  function drawResourcePath() {
    const pathBar = get("task-resource-path");
    pathBar.hidden = resourceRequest.source !== "input";
    pathBar.replaceChildren();
    if (pathBar.hidden) return;
    for (const [index, step] of resourceRequest.path.entries()) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = step.name;
      if (index === resourceRequest.path.length - 1) button.setAttribute("aria-current", "location");
      button.addEventListener("click", () => {
        resourceRequest.path.splice(index + 1);
        loadResources(1);
      });
      pathBar.append(button);
    }
  }

  async function loadResources(page) {
    const version = ++resourceVersion;
    const request = resourceRequest;
    const isInput = request.source === "input";
    const status = get("task-resource-status");
    const [kind, state] = isInput ? ["input"] : resourceGallery.value.split("/");
    request.entry = null;
    clearResourcePreview();
    drawResourcePath();
    resourceList.replaceChildren();
    resourcePager(1, 0, true);
    status.textContent = "正在读取素材…";
    try {
      const data = isInput
        ? await bridge.apiGet("studio/input", { directory: request.path.at(-1).id, page })
        : await bridge.apiGet(kind === "controls" ? "studio/control-assets" : "studio/images", {
          state, page, ...(kind === "controls" ? { type: request.type } : {
            rating: resourceRating(state), ...resourceFilters.query(),
          }),
        });
      if (version !== resourceVersion || !resourcePicker.open) return;
      const entries = data.entries ?? data.assets ?? data.images ?? data.jobs.flatMap((job) => job.images);
      const thumbnails = [];
      for (const entry of entries) {
        if (isInput && entry.kind === "file") {
          const label = document.createElement("small");
          label.className = "resource-entry";
          label.textContent = `${entry.name} · 文件`;
          resourceList.append(label);
          continue;
        }
        const button = document.createElement("button");
        button.type = "button";
        button.className = "resource-entry";
        button.textContent = resourceLabel(entry, kind);
        if (isInput && entry.kind === "directory") button.textContent = `目录 · ${entry.name}`;
        button.addEventListener("click", () => {
          if (isInput && entry.kind === "directory") {
            request.path.push(entry);
            loadResources(1);
          } else previewResource(entry, kind, state);
        });
        resourceList.append(button);
        if (!isInput || entry.kind === "image") {
          const thumbnail = document.createElement("img");
          thumbnail.className = "resource-entry-thumbnail";
          thumbnail.alt = "";
          thumbnail.hidden = true;
          button.prepend(thumbnail);
          thumbnails.push({ entry, thumbnail });
        }
      }
      status.textContent = entries.length ? "" : {
        input: "此目录没有素材。", controls: "此图集没有匹配控制类型的图片。", images: "此图集暂无图片。",
      }[kind];
      request.page = data.page;
      request.last = Math.max(1, Math.ceil(data.total / data.page_size));
      resourcePager(request.page, request.last, false);
      for (let start = 0; start < thumbnails.length && version === resourceVersion && resourcePicker.open; start += 4) {
        await Promise.allSettled(thumbnails.slice(start, start + 4).map(async ({ entry, thumbnail }) => {
          const { src } = await readResourcePreview(entry, kind, state);
          if (version !== resourceVersion || !resourcePicker.open) return;
          thumbnail.src = src;
          thumbnail.hidden = false;
        }));
      }
    } catch (error) {
      if (version === resourceVersion && resourcePicker.open) status.textContent = error.message;
    }
  }

  function resourceLabel(entry, kind) {
    if (kind === "input") return entry.name;
    return kind === "controls" ? entry.source_label || controlAssetTitle(entry) : imageLabel(entry);
  }

  function readResourcePreview(entry, kind, state) {
    if (kind === "input") return bridge.apiGet("studio/input/preview", { id: entry.id });
    if (kind === "controls") return bridge.apiGet("studio/control-assets/preview", { id: controlAssetId(entry) });
    return bridge.apiGet("studio/images/file", { id: entry.id, state });
  }

  async function previewResource(entry, kind, state) {
    const version = ++resourceVersion;
    const request = resourceRequest;
    const status = get("task-resource-preview-status");
    resourceList.hidden = true;
    resourcePreview.hidden = false;
    resourceChoose.disabled = true;
    resourceImage.hidden = true;
    resourceImage.alt = resourceLabel(entry, kind);
    status.textContent = "正在读取预览…";
    resourcePager(1, 0, false);
    try {
      const { src } = await readResourcePreview(entry, kind, state);
      if (version !== resourceVersion || !resourcePicker.open) return;
      resourceImage.src = src;
      resourceImage.hidden = false;
      request.entry = { entry, kind, state, src, label: resourceImage.alt };
      resourceChoose.disabled = false;
      status.textContent = resourceImage.alt;
    } catch (error) {
      if (version === resourceVersion && resourcePicker.open) status.textContent = error.message;
    }
  }

  function pickResource(source, select, { type, useControls = false, title, gallery } = {}) {
    resourceRequest = { source, select, type, path: [{ name: "ComfyUI input", id: "" }] };
    get("task-resource-title").textContent = title || (source === "input" ? "浏览 ComfyUI input" : "从图集选择控制图");
    get("task-resource-gallery-field").hidden = source === "input";
    get("task-resource-control-galleries").disabled = !useControls;
    resourceGallery.value = gallery || (useControls ? "controls/favourite" : "images/favourite");
    resourcePicker.showModal();
    changeResourceGallery();
  }

  function changeResourceGallery() {
    const [kind, state] = resourceGallery.value.split("/");
    get("task-resource-filters").hidden = resourceRequest.source === "input" || kind !== "images";
    get("task-resource-rating-field").hidden = state === "unevaluate";
    resourceFilters.resetOptions();
    loadResources(1);
  }

  resourceGallery.addEventListener("change", changeResourceGallery);
  get("task-resource-rating").addEventListener("change", changeResourceGallery);
  get("task-resource-back").addEventListener("click", () => loadResources(resourceRequest.page));
  resourceChoose.addEventListener("click", () => {
    if (!resourceRequest?.entry) return;
    resourceRequest.select(resourceRequest.entry);
    resourcePicker.close();
  });
  resourcePicker.addEventListener("close", () => {
    if (!resourcePicker.open) {
      resourceVersion++;
      clearResourcePreview();
    }
  });

  async function loadControlGallery(page = controlPage) {
    const version = ++controlGalleryVersion;
    const state = get("control-gallery-state").value;
    const status = get("control-gallery-status");
    const grid = get("control-gallery-grid");
    for (const image of grid.querySelectorAll("img")) previews.unobserve(image);
    grid.replaceChildren();
    controlPager(page, controlLastPage, true);
    status.textContent = "正在读取控制图集…";
    try {
      const data = await bridge.apiGet("studio/control-assets", { state, page });
      if (version !== controlGalleryVersion || controlGallery.hidden) return;
      controlLastPage = Math.max(1, Math.ceil(data.total / data.page_size));
      if (page > controlLastPage) {
        await loadControlGallery(controlLastPage);
        return;
      }
      controlPage = data.page;
      for (const asset of data.assets) {
        const frame = document.createElement("article");
        frame.className = "review-card";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "review-preview";
        const image = document.createElement("img");
        image.alt = controlAssetTitle(asset);
        image.dataset.image = controlAssetId(asset);
        image.dataset.controlAsset = "1";
        image.decoding = "async";
        button.append(image);
        button.addEventListener("click", () => {
          controlPreviewAsset.replaceChildren();
          controlPreview.showModal();
          showControlAsset(asset, controlPreviewAsset, () => controlPreview.open);
        });
        const footer = document.createElement("div");
        footer.className = "review-card-footer";
        const label = document.createElement("small");
        label.textContent = [controlAssetTitle(asset), asset.source_label].filter(Boolean).join(" · ");
        footer.append(label);
        frame.append(button, footer);
        grid.append(frame);
        previews.observe(image);
      }
      status.textContent = data.assets.length ? "" : "该状态暂无控制图。";
    } catch (error) {
      if (version === controlGalleryVersion && !controlGallery.hidden) status.textContent = error.message;
    } finally {
      if (version === controlGalleryVersion) controlPager(controlPage, controlLastPage, false);
    }
  }

  function downloadImage(src, name, button) {
    const format = /^data:image\/(png|jpeg|webp|gif);base64,/.exec(src)?.[1];
    if (!format) return;
    const extension = format === "jpeg" ? "jpg" : format;
    const filename = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
    const stem = filename.replace(/\.(?:png|jpe?g|webp|gif)$/i, "").slice(0, 160);
    const link = document.createElement("a");
    link.href = src;
    link.download = `${stem || "image"}.${extension}`;
    button.closest("dialog").append(link);
    link.click();
    link.remove();
  }

  async function showControlAsset(link, container, isCurrent) {
    const id = controlAssetId(link);
    const frame = document.createElement("article");
    frame.className = "image-preview-card";
    const title = document.createElement("h3");
    title.textContent = controlAssetTitle(link);
    const heading = document.createElement("div");
    heading.className = "image-preview-heading";
    heading.append(title);
    const image = document.createElement("img");
    image.hidden = true;
    image.alt = title.textContent;
    const media = document.createElement("div");
    media.className = "image-preview-media";
    media.append(image);
    const state = document.createElement("small");
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    status.textContent = "正在读取控制图…";
    const actions = document.createElement("div");
    actions.className = "row-actions";
    frame.append(heading, media, state, status, actions);
    container.append(frame);
    const visible = () => isCurrent() && container.contains(frame);

    function renderState(value) {
      state.textContent = controlStates[value] || "";
      for (const button of actions.children) {
        const selected = button.value === value;
        button.setAttribute("aria-pressed", String(selected));
        button.disabled = selected;
      }
    }

    try {
      const { src, asset } = await bridge.apiGet("studio/control-assets/preview", { id, original: "1" });
      if (!visible()) return;
      image.src = src;
      image.hidden = false;
      const download = document.createElement("button");
      download.type = "button";
      download.className = "image-download";
      download.title = "下载控制图原图";
      download.setAttribute("aria-label", download.title);
      download.addEventListener("click", () => downloadImage(src, `control-${id}`, download));
      heading.append(download);
      status.textContent = "";
      for (const [target, label] of Object.entries(controlStates)) {
        const button = document.createElement("button");
        button.type = "button";
        button.value = target;
        button.textContent = target === "unevaluated" ? "移回待评价" : label;
        button.addEventListener("click", async () => {
          if (controlWrites.has(id)) return;
          controlWrites.add(id);
          for (const action of actions.children) action.disabled = true;
          status.textContent = "正在保存控制图评价…";
          try {
            await bridge.apiPost("studio/control-assets", { id, state: target });
            asset.state = target;
            if (visible()) status.textContent = "控制图评价已保存。";
            if (!controlGallery.hidden) loadControlGallery();
          } catch (error) {
            if (visible()) status.textContent = error.message;
          } finally {
            controlWrites.delete(id);
            if (visible()) renderState(asset.state);
          }
        });
        actions.append(button);
      }
      const name = document.createElement("input");
      name.value = asset.name || "";
      name.placeholder = "输入控制图名称";
      name.maxLength = 128;
      name.setAttribute("aria-label", "控制图名称");
      const nameField = document.createElement("label");
      nameField.className = "field";
      nameField.append("控制图名称", name);
      frame.insertBefore(nameField, actions);
      for (const [text, deleting] of [["重命名", false], ["删除", true]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = text;
        button.addEventListener("click", async () => {
          if (controlWrites.has(id)) return;
          if (deleting && !confirm("删除这张控制图原文件？关联的生成结果会保留。")) return;
          controlWrites.add(id);
          for (const action of actions.children) action.disabled = true;
          try {
            const result = await bridge.apiPost("studio/control-assets", deleting ? {id, delete: true} : {id, name: name.value});
            if (deleting) {
              frame.replaceChildren(document.createTextNode("控制图已删除。"));
            } else {
              Object.assign(asset, result.asset);
              name.value = asset.name;
              title.textContent = controlAssetTitle(asset);
              status.textContent = "控制图已重命名。";
            }
            if (!controlGallery.hidden) loadControlGallery();
          } catch (error) { status.textContent = error.message; }
          finally { controlWrites.delete(id); if (!deleting || frame.contains(actions)) renderState(asset.state); }
        });
        actions.append(button);
      }
      renderState(asset.state);
    } catch (error) {
      if (visible()) status.textContent = error.message;
    }
  }

  get("open-control-gallery").addEventListener("click", () => {
    if (!canOpen()) return;
    showPanel("control-gallery", get("open-control-gallery"));
    message("");
    loadControlGallery(1);
  });
  get("control-gallery-refresh").addEventListener("click", () => loadControlGallery());
  get("control-gallery-state").addEventListener("change", () => loadControlGallery(1));

  function renderOriginalControls() {
    if (!openedImage) return;
    const { item, state, list, loading, reviewing, readOnly } = openedImage;
    downloadOriginal.hidden = loading || original.hidden;
    moveOriginal.hidden = readOnly || state === "unevaluate";
    favouriteOriginal.hidden = passOriginal.hidden = readOnly || state !== "unevaluate";
    const busy = reviewing || Boolean(list?.navigating);
    moveOriginal.disabled = favouriteOriginal.disabled = passOriginal.disabled = busy || loading;
    originalNav.hidden = !list;
    if (!list) return;
    const index = list.items.findIndex(({ id }) => id === item.id);
    const position = index < 0 ? openedImage.removedIndex : index;
    originalPrev.disabled = busy || (list.page <= 1 && position <= 0);
    originalNext.disabled = busy || (list.page >= list.last && position >= list.items.length - (index >= 0));
    get("image-original-position").textContent = index < 0
      ? "当前图片已移出此列表"
      : `第 ${index + 1} / ${list.items.length} 张`;
    originalPager(list.page, list.last, busy);
  }

  function browseOriginalPage(page, pick) {
    if (dialog.open && openedImage?.list && !openedImage.reviewing) {
      refreshList(openedImage.list, page, { pick });
    }
  }

  function stepOriginal(direction) {
    if (!dialog.open || !openedImage?.list || openedImage.reviewing) return;
    const { item, list } = openedImage;
    if (list.navigating) return;
    const index = list.items.findIndex(({ id }) => id === item.id);
    const neighbor = index >= 0 ? index + direction : openedImage.removedIndex - (direction < 0 ? 1 : 0);
    const adjacent = list.items[neighbor];
    if (adjacent) openOriginal(adjacent, list.state, { list });
    else if (list.page + direction >= 1 && list.page + direction <= list.last) {
      browseOriginalPage(list.page + direction, direction < 0 ? "last" : "first");
    }
  }

  async function openOriginal(item, state, { readOnly = false, list = null } = {}) {
    const version = ++originalVersion;
    openedImage = { item, state, list, readOnly, loading: true, reviewing: false };
    moveOriginal.textContent = state === "pass" ? "移到收藏" : "移到 Pass";
    renderOriginalControls();
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
    if (!dialog.open) dialog.showModal();
    const controls = item.generation?.controlnets ?? [];
    originalControls.replaceChildren();
    originalControls.hidden = !controls.length;
    originalControls.parentElement.classList.toggle("has-control-pair", controls.length > 0);
    get("image-original-title").textContent = controls.length ? "生成图与控制图" : "原图";
    for (const link of controls) {
      showControlAsset(link, originalControls, () => dialog.open && version === originalVersion);
    }
    try {
      const { src } = await bridge.apiGet("studio/images/file", { id: item.id, original: "1", ...(state ? {state} : {}) });
      if (version !== originalVersion || !dialog.open) return;
      original.src = src;
      original.alt = imageLabel(item);
      original.hidden = false;
      if (originalStatus.textContent === "正在加载原图…") originalStatus.textContent = "";
    } catch (error) {
      if (version === originalVersion && dialog.open && originalStatus.textContent === "正在加载原图…") {
        originalStatus.textContent = error.message;
      }
    } finally {
      if (version === originalVersion && dialog.open) {
        openedImage.loading = false;
        renderOriginalControls();
      }
    }
  }

  function card(item, list) {
    const { state } = list;
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
    preview.addEventListener("click", () => openOriginal(item, state, { list }));
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
    const actions = document.createElement("div");
    actions.className = state === "unevaluate" ? "review-card-actions" : "row-actions";
    if (state === "unevaluate") {
      if (item.generation?.controlnets?.some(({ new: created }) => created)) {
        const badge = document.createElement("small");
        badge.className = "pill";
        badge.textContent = "新控制图";
        footer.append(badge);
      }
      for (const [state, title] of [["favourite", "收藏"], ["pass", "跳过"]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = title;
        button.classList.toggle("primary", state === "favourite");
        button.addEventListener("click", async () => {
          for (const action of actions.children) action.disabled = true;
          try {
            await bridge.apiPost("studio/images", { id: item.id, state });
            notify(state === "favourite" ? "图片已收藏。" : "图片已跳过。");
            await refreshAfterRemoval(item, "unevaluate");
          } catch (error) {
            message(error.message, true);
          } finally {
            for (const action of actions.children) action.disabled = false;
          }
        });
        actions.append(button);
      }
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
      actions.append(remove);
    }
    if (actions.children.length) footer.append(actions);
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

  function showList(list, data) {
    discardOldCards(list.items, list.state);
    if (list === galleryList) {
      get("image-gallery-grid").replaceChildren(...list.items.map((item) => card(item, list)));
      get("image-gallery-empty").hidden = list.items.length !== 0;
      return;
    }
    get("image-review-count").textContent = `${data.total ?? data.jobs.length} 项任务`;
    const groups = data.jobs.map((job) => {
      const group = document.createElement("section");
      const title = document.createElement("h3");
      title.textContent = job.id ? `${workflowTitle(job.workflow)} · ID ${job.id}` : job.workflow;
      const grid = document.createElement("div");
      grid.className = "review-grid";
      grid.append(...job.images.map((item) => card(item, list)));
      group.append(title, grid);
      return group;
    });
    get("image-review-jobs").replaceChildren(...groups);
    get("image-review-empty").hidden = groups.length !== 0;
  }

  async function refreshList(list, next = list.page, { background = false, pick, keepPreview = false } = {}) {
    const previewing = () => dialog.open && openedImage?.list === list;
    if (list.panel.hidden || (background && (list.loading || previewing()))) return false;
    const version = ++list.version;
    const preview = openedImage;
    const query = { state: list.state, ...filterQuery() };
    if (list === galleryList) query.rating = get("image-gallery-rating").value;
    list.loading = true;
    list.navigating = !background;
    list.pager(list.page, list.last, list.navigating);
    if (pick) originalStatus.textContent = `正在读取第 ${next} 页…`;
    if (preview?.list === list) renderOriginalControls();
    try {
      let data;
      let last;
      for (;;) {
        data = await bridge.apiGet("studio/images", { ...query, page: next });
        if (version !== list.version || list.panel.hidden || (background && previewing())) return false;
        last = data.page_size > 0
          ? Math.max(1, Math.ceil(data.total / data.page_size))
          : data.has_more ? next + 1 : next;
        if (next <= last) break;
        next = last;
      }
      const oldPage = list.page;
      const oldItems = list.items;
      list.page = data.page ?? next;
      list.last = last;
      const snapshot = JSON.stringify(data);
      if (snapshot !== list.snapshot) {
        list.snapshot = snapshot;
        list.items = data.images ?? data.jobs.flatMap((job) => job.images);
        showList(list, data);
      }

      if (!keepPreview && dialog.open && openedImage?.list === list) {
        const current = openedImage.item;
        const previousIndex = oldItems.findIndex(({ id }) => id === current.id);
        const staysOnPage = oldPage === list.page;
        const same = staysOnPage && list.items.find(({ id }) => id === current.id);
        const nearby = list.items[Math.min(Math.max(0, previousIndex), list.items.length - 1)];
        const item = pick && preview === openedImage
          ? (pick === "last" ? list.items.at(-1) : list.items[0])
          : same || (staysOnPage ? nearby : list.items.at(-1));
        if (!item) dialog.close();
        else if (pick || JSON.stringify(item) !== JSON.stringify(current)) {
          openOriginal(item, list.state, { list });
        }
      }
      if (!background) message("");
      return true;
    } catch (error) {
      if (version === list.version && !list.panel.hidden && !background) {
        if (pick && dialog.open && openedImage === preview) originalStatus.textContent = error.message;
        else message(error.message, true);
      }
      return false;
    } finally {
      if (version === list.version) {
        list.loading = list.navigating = false;
        list.pager(list.page, list.last, false);
        if (dialog.open && openedImage?.list === list) renderOriginalControls();
      }
    }
  }

  get("open-image-review").addEventListener("click", () => {
    if (!canOpen()) return;
    showPanel("image-review", get("open-image-review"));
    placeFilters("image-review-filter-slot");
    message("");
    pendingList.snapshot = "";
    refreshList(pendingList, 1);
  });
  for (const [id, state, title] of [
    ["open-image-gallery", "favourite", "收藏图集"],
    ["open-pass-gallery", "pass", "Pass 图集"],
  ]) {
    const tab = get(id);
    tab.addEventListener("click", () => {
      if (!canOpen()) return;
      if (galleryList.state !== state) {
        get("image-gallery-grid").replaceChildren();
        get("image-gallery-empty").hidden = true;
        get("image-gallery-thumbnail-status").textContent = "";
        galleryList.page = 1;
        galleryList.last = 0;
        galleryList.items = [];
      }
      galleryList.state = state;
      galleryList.snapshot = "";
      get("image-gallery-title").textContent = title;
      get("image-gallery-empty").textContent = state === "pass" ? "Pass 图集暂无图片。" : "暂无收藏图片。";
      showPanel("image-gallery", tab);
      placeFilters("image-gallery-filter-slot");
      message("");
      refreshList(galleryList, 1);
    });
  }
  get("image-review-refresh").addEventListener("click", () => {
    loadFacets();
    refreshList(pendingList);
  });
  get("image-gallery-thumbnails").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const status = get("image-gallery-thumbnail-status");
    const state = galleryList.state;
    button.disabled = true;
    status.textContent = "正在扫描图集并生成缺失缩略图…";
    try {
      const { created, existing, failed } = await bridge.apiPost("studio/images/thumbnails", { state });
      if (state !== galleryList.state) return;
      status.textContent = `新生成 ${created} 张，已有 ${existing} 张，失败 ${failed} 张。`;
      notify(status.textContent);
      if (!gallery.hidden) {
        discardOldCards([], state);
        galleryList.snapshot = "";
        await refreshList(galleryList);
      }
    } catch (error) {
      if (state !== galleryList.state) return;
      status.textContent = error.message;
      if (!gallery.hidden) message(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  get("image-gallery-rating").addEventListener("change", () => {
    loadFacets();
    refreshList(galleryList, 1);
  });
  async function refreshAfterRemoval(item, state) {
    const list = state === "unevaluate" ? pendingList : galleryList;
    if (list.panel.hidden || list.state !== state) return;
    const refreshed = await refreshList(list);
    if (!refreshed && !list.loading && !list.panel.hidden && list.state === state) {
      cards.get(`${state}:${item.id}`)?.remove();
      list.snapshot = "";
      if (dialog.open && openedImage?.list === list && openedImage.item.id === item.id) dialog.close();
    }
    loadFacets();
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
      await refreshAfterRemoval(item, state);
    } catch (error) {
      deleteStatus.textContent = error.message;
    } finally {
      deleteConfirm.disabled = deleteCancel.disabled = false;
    }
  });
  async function reviewOriginal(state) {
    const preview = openedImage;
    if (!dialog.open || !preview || preview.readOnly || preview.reviewing || preview.loading || preview.list?.navigating) return;
    const { item, state: source } = preview;
    preview.reviewing = true;
    renderOriginalControls();
    originalStatus.textContent = "正在更新图片…";
    try {
      await bridge.apiPost("studio/images", { id: item.id, state, ...(source !== "unevaluate" ? { source } : {}) });
      if (source === "unevaluate") notify(state === "favourite" ? "图片已收藏。" : "图片已跳过。");
      else notify(state === "favourite" ? "图片已移到收藏。" : "图片已移到 Pass 图集。");
      if (dialog.open && openedImage === preview && item.generation?.controlnets?.length) {
        preview.removedIndex ??= Math.max(0, preview.list?.items.findIndex(({ id }) => id === item.id) ?? 0);
        preview.state = state;
        moveOriginal.textContent = state === "pass" ? "移到收藏" : "移到 Pass";
        originalStatus.textContent = state === "favourite" ? "生成图已收藏。" : "生成图已移到 Pass。";
        if (preview.list) await refreshList(preview.list, preview.list.page, { keepPreview: true });
        loadFacets();
      } else await refreshAfterRemoval(item, source);
    } catch (error) {
      if (dialog.open && openedImage === preview) originalStatus.textContent = error.message;
      else if (preview.list && !preview.list.panel.hidden) message(error.message, true);
    } finally {
      if (dialog.open && openedImage === preview) {
        preview.reviewing = false;
        renderOriginalControls();
      }
    }
  }
  favouriteOriginal.addEventListener("click", () => reviewOriginal("favourite"));
  passOriginal.addEventListener("click", () => reviewOriginal("pass"));
  moveOriginal.addEventListener("click", () => reviewOriginal(openedImage?.state === "pass" ? "favourite" : "pass"));
  downloadOriginal.addEventListener("click", () => {
    if (openedImage && !original.hidden) {
      const { item } = openedImage;
      downloadImage(original.src, item.name || item.id, downloadOriginal);
    }
  });
  originalPrev.addEventListener("click", () => stepOriginal(-1));
  originalNext.addEventListener("click", () => stepOriginal(1));
  dialog.addEventListener("keydown", (event) => {
    if (!openedImage?.list || event.altKey || event.ctrlKey || event.metaKey || event.target.closest("input, select, textarea")) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    stepOriginal(event.key === "ArrowLeft" ? -1 : 1);
  });
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    originalVersion++;
    openedImage = undefined;
    original.removeAttribute("src");
    originalControls.replaceChildren();
  });
  controlPreview.addEventListener("close", () => {
    if (!controlPreview.open) controlPreviewAsset.replaceChildren();
  });
  setInterval(() => refreshList(pendingList, pendingList.page, { background: true }), 5000);
  return { mask: () => mask, pickFavourite, pickResource, openOriginal, previews };
}
