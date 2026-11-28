import { api } from "../../../scripts/api.js";
import { openLibraryBrowser, relativeTime, fullTime } from "../refs/library_browser.js";

const CARD_SCALE_MIN = 0.50;
const CARD_SCALE_MAX = 2.00;
const CARD_SCALE_STEP = 0.05;
const CARD_SCALE_DEFAULT = 1.00;

function normalizeCardScale(value, legacyDensity) {
    const raw = Number(value);
    if (Number.isFinite(raw) && raw > 0) {
        const normalized = raw > 10 ? raw / 100 : raw;
        const clamped = Math.min(CARD_SCALE_MAX, Math.max(CARD_SCALE_MIN, normalized));
        return Math.round(clamped / CARD_SCALE_STEP) * CARD_SCALE_STEP;
    }
    if (legacyDensity === "medium") return 0.80;
    if (legacyDensity === "xlarge" || legacyDensity === "extra") return 1.45;
    return CARD_SCALE_DEFAULT;
}
function scaleToLegacyDensity(scale) {
    if (scale <= 0.85) return "medium";
    if (scale >= 1.30) return "xlarge";
    return "large";
}
function scaleProgress(scale) {
    return `${((scale - CARD_SCALE_MIN) / (CARD_SCALE_MAX - CARD_SCALE_MIN)) * 100}%`;
}

export function el(tag, cls, text) {
    const element = document.createElement(tag);
    if (cls) element.className = cls;
    if (text != null) element.textContent = text;
    return element;
}

export function icon(name) {
    const mark = el("i", `pi pi-${name}`);
    mark.setAttribute("aria-hidden", "true");
    return mark;
}

export function button(label, name, action, compact = false) {
    const control = el("button", compact ? "ahv3-btn ahv3-ico" : "ahv3-btn");
    control.type = "button";
    control.title = label;
    control.setAttribute("aria-label", label);
    if (name) control.append(icon(name));
    if (!compact) control.append(el("span", "", label));
    control.addEventListener("click", action);
    return control;
}

export async function fetchJson(path, options = {}) {
    const response = await api.fetchApi(path, { cache: "no-store", ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
    return data;
}

export function post(path, body, signal) {
    return fetchJson(path, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

export function mediaUrl(path) {
    return typeof api.apiURL === "function" ? api.apiURL(path) : path;
}

export function outputUrl({ filename, subfolder, type = "output" }) {
    return mediaUrl(`/view?${new URLSearchParams({ filename, subfolder, type })}`);
}

export function createShell(node, title, subtitle, symbol, accentKind, signal) {
    const root = el("div", "ahr ahv3");
    const head = el("header", "ahv3-head");
    const brand = el("div", "ahv3-brand");
    const badge = el("span", `ahv3-badge-icon ${accentKind === "accent" ? "is-accent" : "is-video"}`);
    badge.append(icon(symbol));
    const titleEl = el("span", "ahv3-title", title);
    const subtitleEl = el("span", "ahv3-subtitle", subtitle || "");
    subtitleEl.hidden = !subtitle;
    brand.append(badge, titleEl, subtitleEl);

    head.append(brand);

    const split = el("div", "ahv3-split");
    const rail = el("aside", "ahv3-rail");
    const railScroll = el("div", "ahv3-rail-scroll");

    // Unified Bottom-Left Free Card-Size Slider (consistent with H3 参考素材)
    const railFoot = el("div", "ahv3-rail-foot");
    const scaleRow = el("div", "ahv3-scale-row");
    const scaleLabel = el("span", "ahv3-scale-lbl", "卡片大小");
    scaleLabel.title = "拖动自由调节右侧卡片显示比例（双击恢复 100%）";
    const scaleSlider = el("input", "ahv3-scale-slider");
    scaleSlider.type = "range";
    scaleSlider.min = String(CARD_SCALE_MIN);
    scaleSlider.max = String(CARD_SCALE_MAX);
    scaleSlider.step = String(CARD_SCALE_STEP);
    scaleSlider.setAttribute("aria-label", "卡片显示大小");
    scaleSlider.title = "左右拖动自由调节卡片大小（双击恢复 100%）";
    const scaleVal = el("button", "ahv3-scale-val", "100%");
    scaleVal.type = "button";
    scaleVal.title = "点击恢复默认 100%";

    function applyScaleUi(scale) {
        root.dataset.density = "custom";
        root.dataset.compactCards = scale <= 0.75 ? "1" : "0";
        root.style.setProperty("--h3-card-scale", scale.toFixed(2));
        scaleSlider.value = scale.toFixed(2);
        scaleSlider.style.setProperty("--slider-pct", scaleProgress(scale));
        scaleVal.textContent = `${Math.round(scale * 100)}%`;
        scaleVal.classList.toggle("is-default", Math.abs(scale - CARD_SCALE_DEFAULT) < 0.001);
    }

    function refreshDensity() {
        const scale = normalizeCardScale(node.properties?.h3VideoCardScale, node.properties?.h3VideoDensity);
        applyScaleUi(scale);
    }

    function commitScale(nextRaw, dirty = false) {
        const next = normalizeCardScale(nextRaw);
        node.properties ??= {};
        node.properties.h3VideoCardScale = Number(next.toFixed(2));
        node.properties.h3VideoDensity = scaleToLegacyDensity(next);
        applyScaleUi(next);
        if (dirty) node.setDirtyCanvas?.(true, true);
    }

    scaleSlider.addEventListener("pointerdown", event => event.stopPropagation());
    scaleSlider.addEventListener("input", () => commitScale(scaleSlider.value, false));
    scaleSlider.addEventListener("change", () => commitScale(scaleSlider.value, true));
    scaleSlider.addEventListener("dblclick", () => commitScale(CARD_SCALE_DEFAULT, true));
    scaleLabel.addEventListener("dblclick", () => commitScale(CARD_SCALE_DEFAULT, true));
    scaleVal.addEventListener("click", () => commitScale(CARD_SCALE_DEFAULT, true));

    scaleRow.append(scaleLabel, scaleSlider, scaleVal);
    railFoot.append(scaleRow);
    rail.append(railScroll, railFoot);

    const stage = el("main", "ahv3-stage");
    split.append(rail, stage);

    const hint = el("div", "ahr-toast");
    hint.setAttribute("role", "status");
    hint.setAttribute("aria-live", "polite");

    root.append(head, split, hint);

    let timer;
    signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
    function toast(message, error = false) {
        if (signal.aborted) return;
        clearTimeout(timer);
        hint.textContent = message;
        hint.classList.toggle("is-error", error);
        hint.classList.add("is-visible");
        timer = setTimeout(() => hint.classList.remove("is-visible"), 3700);
    }
    refreshDensity();
    return { root, head, subtitleEl, split, rail, railScroll, railFoot, stage, toast, refreshDensity };
}

export function railGroup(parent, title, metaText = "") {
    const group = el("section", "ahv3-rail-group");
    const head = el("div", "ahv3-rail-label");
    const titleEl = el("span", "", title);
    const metaEl = el("span", "ahv3-rail-meta", metaText);
    metaEl.hidden = !metaText;
    head.append(titleEl, metaEl);
    group.append(head);
    parent.append(group);
    return { group, head, metaEl };
}

let optionMeasure;
function trackSelectedText(select, display, signal) {
    function update() {
        const text = select.selectedOptions[0]?.textContent || "";
        select.title = text;
        display.textContent = text;
        const css = getComputedStyle(select);
        optionMeasure ??= document.createElement("canvas").getContext("2d");
        if (optionMeasure) {
            optionMeasure.font = `${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
            const space = select.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight) - 22;
            display.hidden = !text || select.clientWidth === 0 || optionMeasure.measureText(text).width <= space;
        } else {
            display.hidden = true;
        }
    }
    if (typeof ResizeObserver === "function") {
        const observer = new ResizeObserver(update);
        observer.observe(select);
        signal.addEventListener("abort", () => observer.disconnect(), { once: true });
    }
    return update;
}

export function createFields(node, signal) {
    const controls = [];
    const widget = name => node.widgets?.find(candidate => candidate.name === name);
    const read = name => widget(name)?.value;
    function write(name, value) {
        const target = widget(name);
        if (!target || target.value === value) return;
        target.value = value;
        target.callback?.(value);
        node.setDirtyCanvas?.(true, true);
    }
    function isLocked(name, spec) {
        const socket = node.inputs?.find(port => port.name === name);
        return (spec.enabled ? !spec.enabled() : false) || socket?.link != null || !widget(name);
    }

    function fieldRow(parent, name, title, spec = {}) {
        const row = el("div", `ahv3-param-row${spec.stack ? " is-stack" : ""}`);
        if (spec.rowClass) row.classList.add(spec.rowClass);

        // Segmented capsule control bound directly to a combo widget
        if (spec.segments) {
            const caption = el("span", "ahv3-param-lbl", title);
            const seg = el("div", `ahv3-seg${spec.fullSeg ? " is-full" : ""}`);
            seg.setAttribute("role", "group");
            seg.setAttribute("aria-label", title);
            const entries = spec.segments.map(opt => (Array.isArray(opt) ? opt : [opt, opt]));
            const buttons = entries.map(([val, text]) => {
                const btn = el("button", "", text);
                btn.type = "button";
                btn.dataset.segKey = String(val);
                btn.addEventListener("click", () => {
                    if (btn.disabled) return;
                    write(name, val);
                    spec.change?.(val);
                    refresh();
                });
                seg.append(btn);
                return { btn, val };
            });
            row.append(caption, seg);
            controls.push(() => {
                const current = String(read(name) ?? "");
                const disabled = isLocked(name, spec);
                row.hidden = spec.show ? !spec.show() : false;
                for (const { btn, val } of buttons) {
                    btn.setAttribute("aria-pressed", String(String(val) === current));
                    btn.disabled = disabled;
                }
            });
            parent.append(row);
            return seg;
        }

        // Boolean toggle switch row
        if (spec.toggle) {
            const label = el("label", "ahv3-sw-row");
            const input = el("input", "ahv3-sw-input");
            input.type = "checkbox";
            input.setAttribute("role", "switch");
            const caption = el("span", "ahv3-sw-text", title);
            const track = el("span", "ahv3-sw-track");
            label.append(caption, input, track);
            input.addEventListener("change", () => {
                write(name, input.checked);
                spec.change?.(input.checked);
                refresh();
            });
            controls.push(() => {
                input.checked = Boolean(read(name));
                label.classList.toggle("is-on", input.checked);
                row.hidden = spec.show ? !spec.show() : false;
                input.disabled = isLocked(name, spec);
                label.classList.toggle("is-disabled", input.disabled);
            });
            row.append(label);
            parent.append(row);
            return input;
        }

        // Standard input / select / auto-wrap textarea
        const label = el("label", "ahv3-param-label-wrap");
        const caption = el("span", "ahv3-param-lbl", title);
        const input = el(
            spec.options ? "select" : spec.wrap ? "textarea" : "input",
            spec.options ? "ahv3-ctl is-select" : spec.wrap ? "ahv3-ctl is-wrap" : spec.numeric ? "ahv3-ctl is-num" : "ahv3-ctl is-text",
        );
        if (spec.stack) input.classList.add("is-full");
        const fullValue = spec.fullValue ? el("div", "ahv3-full-value") : null;
        const updateFullValue = fullValue && trackSelectedText(input, fullValue, signal);

        if (spec.options) {
            for (const option of spec.options) {
                const [val, text] = Array.isArray(option) ? option : [option, option];
                const item = el("option", "", text);
                item.value = val;
                input.append(item);
            }
        } else if (spec.wrap) {
            input.rows = 1;
            input.addEventListener("keydown", event => {
                if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); input.blur(); }
            });
            input.addEventListener("input", () => {
                if (/[\r\n]/.test(input.value)) input.value = input.value.replace(/[\r\n]+/g, "");
            });
        } else {
            input.type = spec.numeric ? "number" : "text";
            if (spec.numeric) Object.assign(input, spec.numeric);
        }
        if (spec.placeholder) input.placeholder = spec.placeholder;
        input.addEventListener("change", () => {
            if (spec.numeric && typeof input.reportValidity === "function" && !input.reportValidity()) {
                input.value = read(name) ?? "";
                return;
            }
            const value = spec.numeric ? input.valueAsNumber : input.value;
            if (spec.numeric && !Number.isFinite(value)) return;
            write(name, value);
            spec.change?.(value);
            refresh();
        });
        controls.push(() => {
            const value = read(name);
            if (document.activeElement !== input) input.value = value ?? "";
            updateFullValue?.();
            row.hidden = spec.show ? !spec.show() : false;
            input.disabled = isLocked(name, spec);
        });
        label.append(caption, input);
        row.append(label);
        if (fullValue) row.append(fullValue);
        parent.append(row);
        return input;
    }

    function refresh() { controls.forEach(update => update()); }
    return { read, write, field: fieldRow, fieldRow, refresh, widget, isLocked };
}

export function createProjectBar({ parent, fields, cut, signal, toast, onSelect, onRefresh, kind, headerRight = null }) {
    const scope = cut ? "segments" : "clips";
    const base = cut ? "/amiaomiao_h3/lvm" : "/amiaomiao_h3/clip_bin";
    const current = () => fields.read("project_name") || (cut ? "H3_LVM" : "Default_Project");

    const block = el("section", "ahv3-lib-block");

    // Eyebrow row matching H3 片段选择 v2 (dot + title + optional right-side dual/single switch)
    const eyebrow = el("div", "ahv3-eyebrow");
    const eyebrowLeft = el("span", "ahv3-eyebrow-title");
    const eyebrowDot = el("span", `ahv3-eyebrow-dot${cut ? " is-video" : ""}`);
    const eyebrowText = el("span", "", cut ? "裁切项目库" : "双采项目库");
    eyebrowLeft.append(eyebrowDot, eyebrowText);
    eyebrow.append(eyebrowLeft);
    if (headerRight) eyebrow.append(headerRight);
    block.append(eyebrow);

    // Visual Project Library Card Button (exact sibling of H3 片段选择 v2 .ahc-lib-card)
    const card = el("button", "ahv3-lib-card");
    card.type = "button";
    const openBrowser = () => {
        browser = openLibraryBrowser({
            scope,
            current: current(),
            clipAssetKind: cut ? undefined : kind(),
            fetchJson: (url, options) => fetchJson(url, { ...options, signal }),
            url: mediaUrl,
            onUse: use,
            onRenamed: (oldName, newName) => (oldName === current() ? use(newName, false) : refresh()),
            onDeleted: (oldName, next) => (oldName === current() ? use(next || (cut ? "H3_LVM" : "Default_Project")) : refresh()),
        });
    };
    card.addEventListener("click", openBrowser);

    const thumb = el("div", "ahv3-lib-thumb");
    const thumbPlaceholder = () => {
        const box = el("div", "ahv3-lib-thumb-empty");
        box.append(icon(cut ? "clone" : "video"));
        return box;
    };
    thumb.append(thumbPlaceholder());

    const info = el("div", "ahv3-lib-info");
    const nameEl = el("strong", "ahv3-lib-name", current());
    const metaBox = el("div", "ahv3-lib-meta");
    metaBox.append(el("span", "ahv3-lib-time", "读取中…"));
    info.append(nameEl, metaBox);

    const chev = el("span", "ahv3-lib-chevron");
    chev.setAttribute("aria-hidden", "true");
    chev.append(icon("chevron-down"));
    card.append(thumb, info, chev);
    block.append(card);

    // Action row underneath: 浏览库 | + 新建 | ↻ (replaces with inline create form on click)
    const actionsWrap = el("div", "ahv3-lib-actions-wrap");
    const actions = el("div", "ahv3-lib-actions");
    const browseBtn = button("浏览库", "folder-open", openBrowser);
    browseBtn.title = "打开项目库弹窗（封面、内容预览、切换、重命名、删除）";
    const createBtn = button("新建", "plus", () => showCreate(true));
    createBtn.title = cut ? "新建裁切项目" : "新建片段项目";
    const refreshBtn = button("刷新", "refresh", () => {
        void refresh();
        onRefresh?.();
    }, true);
    actions.append(browseBtn, createBtn, refreshBtn);

    const form = el("form", "ahv3-create-form");
    const nameInput = el("input", "ahv3-create-input");
    nameInput.placeholder = "新项目名称…";
    nameInput.maxLength = 80;
    nameInput.setAttribute("aria-label", "新项目名称");
    nameInput.required = true;
    const submitBtn = el("button", "ahv3-btn is-primary", "建立");
    submitBtn.type = "submit";
    const cancelBtn = button("取消", null, () => showCreate(false));
    const errorEl = el("div", "ahv3-create-error");
    errorEl.setAttribute("role", "alert");
    form.append(nameInput, submitBtn, cancelBtn, errorEl);
    form.hidden = true;

    actionsWrap.append(actions, form);
    block.append(actionsWrap);

    let browser, projects = [], request = 0;
    let deckState = { loaded: false, count: 0, coverUrl: "", updatedAt: "" };

    function setEyebrowLabel(text) {
        eyebrowText.textContent = text;
    }

    function renderCard() {
        const selected = current();
        if (!cut) eyebrowText.textContent = kind() === "single" ? "单采项目库" : "双采项目库";
        nameEl.textContent = selected;
        card.setAttribute("aria-label", `切换项目库：${selected}`);

        const row = projects.find(r => r.name === selected) || null;
        const rowCount = row ? (row.count ?? row.segments ?? row.clips ?? row.segment_count ?? row.clip_count) : undefined;
        const count = deckState.loaded ? deckState.count : (Number.isFinite(rowCount) ? rowCount : null);
        const coverRaw = deckState.coverUrl || row?.cover_url || row?.thumbnail_url || "";
        const coverSrc = coverRaw ? mediaUrl(coverRaw) : "";
        const updatedAt = deckState.updatedAt || row?.updated_at || "";

        if (coverSrc && thumb.dataset.src !== coverSrc) {
            thumb.dataset.src = coverSrc;
            const img = el("img");
            img.alt = "";
            img.draggable = false;
            img.src = coverSrc;
            img.addEventListener("error", () => {
                thumb.dataset.src = "";
                thumb.replaceChildren(thumbPlaceholder());
            }, { once: true });
            thumb.replaceChildren(img);
        } else if (!coverSrc && thumb.dataset.src !== "") {
            thumb.dataset.src = "";
            thumb.replaceChildren(thumbPlaceholder());
        }

        metaBox.classList.remove("is-empty");
        metaBox.replaceChildren();
        if (count === null) {
            metaBox.append(el("span", "ahv3-lib-time", "读取中…"));
        } else if (count > 0) {
            const unit = cut ? "段" : "片段";
            const when = relativeTime(updatedAt);
            metaBox.append(el("span", "ahv3-lib-count", `${count} ${unit}`));
            if (when) metaBox.append(el("span", "ahv3-lib-dot", "·"), el("span", "ahv3-lib-time", when));
        } else {
            metaBox.classList.add("is-empty");
            metaBox.append(
                el("span", "ahv3-lib-count", "空库"),
                el("span", "ahv3-lib-dot", "·"),
                el("span", "ahv3-lib-time", cut ? "暂无裁切片段" : "暂无归档片段"),
            );
        }

        const full = fullTime(updatedAt);
        card.title = full
            ? `${selected} · 点击打开项目库（最近更新：${full}）`
            : `${selected} · 点击打开项目库（切换、搜索、新建、重命名或删除）`;
    }

    async function refresh() {
        const ticket = ++request;
        const query = cut ? "scope=segments" : `asset_kind=${encodeURIComponent(kind())}`;
        renderCard();
        try {
            const data = await fetchJson(`${base}/projects?${query}`, { signal });
            if (ticket !== request || signal.aborted) return;
            projects = (data.projects || []).map(row => (typeof row === "string" ? { name: row } : row));
            renderCard();
        } catch (err) {
            toast(err.message, true);
        }
    }

    function syncDeck({ count = 0, coverUrl = "", updatedAt = "", loaded = true } = {}) {
        deckState = { loaded, count, coverUrl, updatedAt };
        renderCard();
    }

    function use(project, reset = true) {
        if (!project || signal.aborted) return;
        const changed = current() !== project;
        fields.write("project_name", project);
        if (changed) deckState = { loaded: false, count: 0, coverUrl: "", updatedAt: "" };
        onSelect(changed && reset);
        void refresh();
    }

    function showCreate(open) {
        actionsWrap.classList.toggle("is-creating", open);
        actions.hidden = open;
        form.hidden = !open;
        errorEl.textContent = "";
        if (open) {
            nameInput.value = "";
            nameInput.focus();
        } else {
            createBtn.focus();
        }
    }

    form.addEventListener("submit", async event => {
        event.preventDefault();
        const value = nameInput.value.trim();
        if (!value || submitBtn.disabled) return;
        submitBtn.disabled = cancelBtn.disabled = true;
        try {
            const data = await post(`${base}/project`, cut ? { project: value, scope } : { project: value }, signal);
            if (signal.aborted) return;
            showCreate(false);
            use(data.name || data.project || value);
        } catch (err) {
            if (!signal.aborted) errorEl.textContent = err.message;
        } finally {
            submitBtn.disabled = cancelBtn.disabled = false;
        }
    });
    form.addEventListener("keydown", event => {
        if (event.key === "Escape" && !submitBtn.disabled) showCreate(false);
    });

    parent.append(block);
    signal.addEventListener("abort", () => browser?.close(), { once: true });
    return { current, refresh, syncDeck, setEyebrowLabel };
}

export function createPreview(signal) {
    let modal;
    function close() { modal?.close(); }
    signal.addEventListener("abort", close, { once: true });
    function open(title, source, proxy, { autoplay = false } = {}) {
        if (signal.aborted) return;
        close();
        const dialog = el("dialog", "ahr ahv3-modal");
        const head = el("header", "ahv3-modal-head");
        dialog.setAttribute("aria-label", title);
        const request = new AbortController();
        const actions = el("div", "ahv3-preview-actions");
        const status = el("div", "ahv3-preview-status", "正在载入视频…");
        status.setAttribute("role", "status");
        const video = el("video", "ahv3-player");
        video.controls = video.playsInline = true;
        video.autoplay = autoplay;
        video.preload = "metadata";
        let attempted = false;
        const retry = button("重试", "refresh", () => {
            if (attempted || !source) void loadCompatible();
            else loadSource(source);
        });
        retry.hidden = true;
        function loading(text) {
            status.textContent = text;
            status.hidden = false;
            status.classList.remove("is-error");
            retry.hidden = true;
        }
        function error(text) {
            status.textContent = text;
            status.hidden = false;
            status.classList.add("is-error");
            retry.hidden = false;
        }
        async function loadSource(url) {
            loading("正在载入视频…");
            try {
                const src = api.resolveMedia ? await api.resolveMedia(url) : mediaUrl(url);
                if (request.signal.aborted) return;
                video.src = src;
                video.load();
            } catch (failure) {
                if (!request.signal.aborted) error(failure.message);
            }
        }
        async function loadCompatible() {
            if (!proxy || compatible.disabled) return;
            attempted = true;
            compatible.disabled = true;
            loading("正在生成兼容预览…");
            try {
                const result = await post(proxy, {}, request.signal);
                if (dialog.open) loadSource(result.url);
            } catch (failure) {
                if (dialog.open) error(failure.message);
            } finally {
                compatible.disabled = false;
            }
        }
        const compatible = proxy && button("兼容预览", "refresh", loadCompatible);
        if (compatible) actions.append(compatible);
        const dismiss = button("关闭", "times", () => dialog.close());
        dismiss.autofocus = true;
        actions.append(dismiss);
        const heading = el("strong", "ahv3-modal-title", title);
        heading.title = title;
        head.append(heading, actions);
        dialog.append(head, video, status, retry);
        video.addEventListener("loadedmetadata", () => {
            if (!dialog.open) return;
            if (video.videoWidth && video.videoHeight) {
                dialog.style.setProperty("--ahv3-preview-ratio", video.videoWidth / video.videoHeight);
            }
            status.hidden = true;
            retry.hidden = true;
        });
        video.addEventListener("error", () => {
            if (!dialog.open) return;
            if (compatible && !attempted) void loadCompatible();
            else error("无法播放这段视频。请重试，或检查原文件是否仍在。");
        });
        dialog.addEventListener("keydown", event => {
            event.stopPropagation();
            if (event.key === "Escape") {
                event.preventDefault();
                dialog.close();
            }
        });
        dialog.addEventListener("close", () => {
            request.abort();
            video.pause();
            video.removeAttribute("src");
            video.load();
            dialog.remove();
            if (modal === dialog) modal = null;
        }, { once: true });
        document.body.append(dialog);
        modal = dialog;
        dialog.showModal();
        if (source) loadSource(source);
        else if (compatible) void loadCompatible();
        return dialog;
    }
    return { open, close };
}
