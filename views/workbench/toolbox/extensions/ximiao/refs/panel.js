import {
    LIMITS, KIND_NAMES, PURPOSES, VIDEO_SIZES, UPLOAD_ROOT, customVideoSide, decodedVideoSize, planImageSize, parseDocument, serializeDocument,
    assignLabels, soundtrackLabels, manifestText, addCards, removeCard, placeCard, splitCards, activeCount, setAllSkip, clearCards,
    nameFromFile, mediaKind, projectFolder, formatSeconds, trimWindow, newId, libraryKey, matchLibrary,
    toPresetEntries, fromPresetEntries,
} from "./refs_state.js";
import { openLibraryBrowser } from "./library_browser.js";

const DEFAULT_PROJECT = "H3_LVM";
const DRAG_TYPE = "application/x-amiaomiao-ref-card";
const FILTER_ALL = "all";
const FILTER_NONE = "__none__";
// Node inputs that only affect images; the hub hides them and shows them on the image page.
export const IMAGE_SETTINGS = ["target_megapixels", "resampling_method", "upscale_small_images"];
const RESAMPLE_OPTIONS = ["Lanczos", "Bicubic", "Bilinear", "Nearest"];
const CARD_SCALE_MIN = 0.50;
const CARD_SCALE_MAX = 2.00;
const CARD_SCALE_STEP = 0.05;
const CARD_SCALE_DEFAULT = 1.00;
const SHOW_NOTES_KEY = "amiaomiao-h3.hub.show-notes";
const peakCache = new Map();

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
function scalePercent(scale) {
    return `${Math.round(scale * 100)}%`;
}
function scaleProgress(scale) {
    return `${((scale - CARD_SCALE_MIN) / (CARD_SCALE_MAX - CARD_SCALE_MIN)) * 100}%`;
}

function readShowNotes() {
    try {
        const stored = localStorage.getItem(SHOW_NOTES_KEY);
        if (stored === "0") return false;
        if (stored === "1") return true;
    } catch { /* display preference is optional */ }
    return true;
}
function writeShowNotes(enabled) {
    try { localStorage.setItem(SHOW_NOTES_KEY, enabled ? "1" : "0"); } catch { /* optional */ }
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}
function icon(name) {
    const node = el("i", `pi pi-${name}`);
    node.setAttribute("aria-hidden", "true");
    return node;
}
function iconButton(name, title, onClick, className = "") {
    const button = el("button", `ahr-icon-btn ${className}`.trim());
    button.type = "button";
    button.title = title;
    button.setAttribute("aria-label", title);
    button.append(icon(name));
    button.addEventListener("click", event => { event.stopPropagation(); onClick(event); });
    return button;
}
function textButton(label, iconName, onClick, className = "") {
    const button = el("button", `ahr-btn ${className}`.trim());
    button.type = "button";
    if (iconName) button.append(icon(iconName));
    button.append(el("span", "", label));
    button.addEventListener("click", event => { event.stopPropagation(); onClick(event); });
    return button;
}
function select(options, value, onChange, label) {
    const control = el("select", "ahr-select");
    control.setAttribute("aria-label", label);
    for (const [optionValue, text] of options) {
        const option = el("option", "", text);
        option.value = String(optionValue);
        control.append(option);
    }
    control.value = String(value ?? "");
    control.addEventListener("change", () => onChange(control.value));
    return control;
}

function purposeLabel(kind, key) {
    if (key === FILTER_ALL) return "全部";
    if (key === FILTER_NONE) return "未打标";
    return PURPOSES[kind]?.find(([val]) => val === key)?.[1] || key;
}

function matchesPurposeFilter(card, filterKey) {
    if (!filterKey || filterKey === FILTER_ALL) return true;
    if (filterKey === FILTER_NONE) return !card.purpose;
    return card.purpose === filterKey;
}

export class RefHubPanel {
    constructor({ api, value, onChange, settings }) {
        this.api = api;
        this.onChange = onChange;
        // { get(name), set(name, value) } bound to the node's own widgets, so the values keep
        // their saved position in widgets_values and the backend reads them unchanged.
        this.settings = settings || null;
        this.doc = parseDocument(value);
        this.projectBaselines = new Map();
        this.restoreProjectBaselines();
        this.pendingImports = 0;
        this.results = new Map();
        this.imageSizes = new Map();
        this.libraries = new Map();
        this.customVideoSides = new Set();
        this.expandedVideoDrawers = new Set();
        this.expandedAudioDrawers = new Set();
        this.audioDurations = new Map();
        this.projects = new Map();
        this.purposeFilters = { image: FILTER_ALL, audio: FILTER_ALL, video: FILTER_ALL };
        this.pointerDragCleanup = null;
        this.audioPlayRaf = 0;
        this.suppressPreviewUntil = 0;
        this.flashCardId = null;
        this.showNotes = readShowNotes();
        this.flashTimer = null;
        this.root = el("div", "ahr ahr-hub");
        this.root.tabIndex = -1;
        // A run finishing while the user types must not rebuild the field under the cursor.
        this.root.addEventListener("focusout", event => {
            if (this.pendingRender && !this.isTyping(event.relatedTarget)) {
                this.pendingRender = false;
                requestAnimationFrame(() => this.render());
            }
        });
        this.bindDrop();
        this.render();
    }

    isTyping(target = document.activeElement) {
        return !!target && this.root.contains(target) && target.matches?.("input:not([type=checkbox]), textarea");
    }

    load(value) {
        this.doc = parseDocument(value);
        this.projectOperation = null;
        this.projectChoice = null;
        this.purposeFilters = { image: FILTER_ALL, audio: FILTER_ALL, video: FILTER_ALL };
        this.restoreProjectBaselines();
        this.render();
    }

    dispose() {
        this.disposed = true;
        this.projectOperation = null;
        this.cancelPointerDrag();
        this.closePreview();
        this.stopAudio();
        clearTimeout(this.toastTimer);
        clearTimeout(this.flashTimer);
    }

    save(rerender = false) {
        for (const kind of ["image", "audio"]) {
            const binding = this.projectBinding(kind);
            if (binding) binding.dirty = this.projectBaselines.get(kind) !== this.projectSignature(kind);
        }
        this.onChange(serializeDocument(this.doc));
        if (rerender) this.render();
        else {
            this.updateCounts();
            this.syncProjectDirtyUi();
            this.syncTagFilterUi(this.doc.ui.page);
        }
    }

    url(path) {
        return typeof this.api.apiURL === "function" ? this.api.apiURL(path) : path;
    }

    fileUrl(card, endpoint = "/view") {
        const query = new URLSearchParams({ filename: card.filename, subfolder: card.subfolder || "",
            type: card.type || "input" });
        return this.url(`${endpoint}?${query}`);
    }

    toast(message, error = false) {
        if (!this.status) return;
        this.status.textContent = message;
        this.status.classList.toggle("is-error", error);
        this.status.classList.add("is-visible");
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => this.status?.classList.remove("is-visible"), 2600);
    }

    // ---------- Scheme B Studio Layout: Left Channel Control Rail + Right Pure Asset Stage ----------
    render() {
        const railScrollTop = this.railScroll?.scrollTop ?? 0;
        const stageScrollTop = this.body?.scrollTop ?? 0;
        this.cancelPointerDrag();
        // A drop re-renders the card that started the drag, so its dragend never fires.
        this.dragKind = null;
        delete this.root.dataset.dragging;
        this.setFileHover();
        this.root.replaceChildren();
        this.labels = assignLabels(this.doc);

        const page = this.doc.ui.page;
        const cardScale = normalizeCardScale(this.doc.ui.card_scale, this.doc.ui.density);
        this.root.dataset.page = page;
        this.root.dataset.density = "custom";
        this.root.dataset.compactCards = cardScale <= 0.75 ? "1" : "0";
        this.root.style.setProperty("--h3-card-scale", cardScale.toFixed(2));
        this.root.dataset.imageView = this.imageViewMode();
        this.root.dataset.audioLayout = this.audioLayoutMode();
        this.root.dataset.hideNotes = this.showNotes ? "0" : "1";

        const split = el("div", "hub-split");

        // ===== Left Control Rail =====
        const rail = el("aside", "hub-rail");
        const railHead = el("div", "hub-rail-head");
        const brand = el("span", "hub-brand");
        brand.append(el("span", "hub-brand-dot"), el("span", "", "H3 参考素材"));
        railHead.append(brand, el("span", "hub-brand-tag", "三合一"));

        this.railScroll = el("div", "hub-rail-scroll");
        this.railScroll.append(this.buildChannelBlock());

        // Channel-specific controls tightly bonded to the active channel
        if (page === "image" || page === "audio") {
            this.railScroll.append(this.buildProjectCardBlock(page));
            if (page === "image" && this.settings) {
                this.railScroll.append(this.buildImageSettingsBlock());
            }
            if (page === "audio") {
                const notice = this.buildAudioSoundtrackNotice();
                if (notice) this.railScroll.append(notice);
            }
        } else {
            this.railScroll.append(this.buildVideoOverviewBlock());
        }

        // Left-rail Tag Filter (for any channel that has cards)
        this.tagFilterHost = el("div", "hub-tag-filter-host");
        this.renderTagFilterInto(this.tagFilterHost, page);
        this.railScroll.append(this.tagFilterHost);

        // Left Rail Footer: Show-Notes Switch + Copy Manifest + Unified Free Card-Size Slider
        const railFoot = el("div", "hub-rail-foot");

        const footTools = el("div", "hub-rail-foot-tools");
        const notesRow = el("label", "hub-rail-notes-row");
        notesRow.title = "开启或关闭所有素材卡片的描述/备注输入框（不影响用途标签，也不会删除已写的备注内容）";
        const notesToggle = el("span", "hub-toggle hub-notes-toggle");
        const notesCheck = el("input");
        notesCheck.type = "checkbox";
        notesCheck.checked = this.showNotes;
        notesCheck.setAttribute("aria-label", "显示备注输入");
        notesCheck.addEventListener("change", () => {
            this.showNotes = notesCheck.checked;
            writeShowNotes(this.showNotes);
            this.root.dataset.hideNotes = this.showNotes ? "0" : "1";
            requestAnimationFrame(() => this.drawWaveforms());
        });
        notesToggle.append(notesCheck, el("span", "hub-switch"));
        notesRow.append(notesToggle, el("span", "hub-rail-notes-lbl", "显示备注"));

        const copyBtn = textButton("清单", "copy", () => this.copyManifest(), "hub-btn hub-copy-btn");
        copyBtn.title = "复制当前启用的素材清单";
        footTools.append(notesRow, copyBtn);

        const scaleRow = el("div", "hub-scale-row");
        const scaleLabel = el("span", "hub-scale-lbl", "卡片大小");
        scaleLabel.title = "拖动自由调节右侧卡片显示比例（双击恢复 100%）";
        const scaleSlider = el("input", "hub-scale-slider");
        scaleSlider.type = "range";
        scaleSlider.min = String(CARD_SCALE_MIN);
        scaleSlider.max = String(CARD_SCALE_MAX);
        scaleSlider.step = String(CARD_SCALE_STEP);
        scaleSlider.value = cardScale.toFixed(2);
        scaleSlider.style.setProperty("--slider-pct", scaleProgress(cardScale));
        scaleSlider.setAttribute("aria-label", "卡片显示大小");
        scaleSlider.title = "左右拖动自由调节卡片大小（双击恢复 100%）";
        const scaleVal = el("button", "hub-scale-val", scalePercent(cardScale));
        scaleVal.type = "button";
        scaleVal.title = "点击恢复默认 100%";

        const applyScale = (nextRaw, commit = false) => {
            const next = normalizeCardScale(nextRaw);
            this.doc.ui.card_scale = Number(next.toFixed(2));
            this.doc.ui.density = scaleToLegacyDensity(next);
            scaleSlider.value = next.toFixed(2);
            scaleSlider.style.setProperty("--slider-pct", scaleProgress(next));
            scaleVal.textContent = scalePercent(next);
            scaleVal.classList.toggle("is-default", Math.abs(next - CARD_SCALE_DEFAULT) < 0.001);
            this.root.style.setProperty("--h3-card-scale", next.toFixed(2));
            this.root.dataset.compactCards = next <= 0.75 ? "1" : "0";
            requestAnimationFrame(() => this.drawWaveforms());
            if (commit) this.save();
        };
        scaleVal.classList.toggle("is-default", Math.abs(cardScale - CARD_SCALE_DEFAULT) < 0.001);
        scaleSlider.addEventListener("pointerdown", event => event.stopPropagation());
        scaleSlider.addEventListener("input", () => applyScale(scaleSlider.value, false));
        scaleSlider.addEventListener("change", () => applyScale(scaleSlider.value, true));
        scaleSlider.addEventListener("dblclick", () => applyScale(CARD_SCALE_DEFAULT, true));
        scaleLabel.addEventListener("dblclick", () => applyScale(CARD_SCALE_DEFAULT, true));
        scaleVal.addEventListener("click", () => applyScale(CARD_SCALE_DEFAULT, true));

        scaleRow.append(scaleLabel, scaleSlider, scaleVal);
        railFoot.append(footTools, scaleRow);

        rail.append(railHead, this.railScroll, railFoot);

        // ===== Right Pure Asset Stage =====
        const main = el("div", "hub-main");
        main.append(this.buildStageBar(page));

        this.body = el("div", "hub-stage-scroll");
        this.body.inert = !!this.projectOperation;
        this.body.setAttribute("aria-busy", String(!!this.projectOperation));
        if (this.projectChoice?.kind === page) this.body.append(this.renderProjectChoice());
        if (page === "video") this.renderVideoPage(this.body);
        else if (page === "audio") this.renderAudioPage(this.body);
        else this.renderImagePage(this.body);

        main.append(this.body);

        split.append(rail, main);
        this.status = el("div", "ahr-toast");
        this.status.setAttribute("role", "status");
        this.root.append(split, this.status);

        this.updateCounts();
        this.railScroll.scrollTop = railScrollTop;
        this.body.scrollTop = stageScrollTop;
        requestAnimationFrame(() => this.drawWaveforms());
    }

    eyebrow(titleText, rightText = "", withDot = true) {
        const row = el("div", "hub-eyebrow");
        const left = el("span", "hub-eyebrow-l");
        if (withDot) left.append(el("span", "hub-eyebrow-dot"));
        left.append(el("span", "", titleText));
        row.append(left);
        if (rightText) row.append(el("span", "hub-eyebrow-r", rightText));
        return row;
    }

    buildChannelBlock() {
        const block = el("div", "hub-rail-block");
        block.append(this.eyebrow("素材频道", "单线打包", false));
        this.tabs = el("div", "hub-channels");
        this.tabs.setAttribute("role", "tablist");
        const soundtracks = soundtrackLabels(this.doc);
        const channels = [
            ["image", "图片参考", "image", this.refProject("image")],
            ["audio", "音频参考", "volume-up", soundtracks.length ? `含 ${soundtracks.length} 路视频原声` : this.refProject("audio")],
            ["video", "视频参考", "video", soundtracks.length ? `${activeCount(this.doc, "video")} 视频 · ${soundtracks.length} 原声` : "裁切池 / 投放池"],
        ];
        for (const [page, label, iconName, subText] of channels) {
            const tab = el("button", `hub-ch is-${page}`);
            tab.type = "button";
            tab.dataset.page = page;
            tab.dataset.kind = page;
            tab.setAttribute("role", "tab");
            tab.setAttribute("aria-selected", String(this.doc.ui.page === page));
            const ico = el("span", "hub-ch-ico");
            ico.append(icon(iconName));
            const meta = el("span", "hub-ch-meta");
            meta.append(el("strong", "", label), el("small", "", subText));
            const count = el("span", "hub-ch-count");
            tab.append(ico, meta, count);
            tab.addEventListener("click", () => {
                if (this.doc.ui.page === page) return;
                this.doc.ui.page = page;
                this.save(true);
            });
            this.tabs.append(tab);
        }
        block.append(this.tabs);
        return block;
    }

    // Visual project library card (matching H3 片段选择 v2) + Save / New / Refresh
    buildProjectCardBlock(kind) {
        const noun = KIND_NAMES[kind];
        const project = this.refProject(kind);
        const cards = this.doc[`${kind}s`];
        const { dirty, bound } = this.projectDirtyState(kind);

        const block = el("div", "hub-rail-block");
        const statusText = bound ? (dirty ? "有未保存改动" : "已同步") : (cards.length ? "未绑定库" : "空项目");
        const headRow = this.eyebrow(`${noun}项目库`, statusText, true);
        this.projectStatusEl = headRow.querySelector(".hub-eyebrow-r");
        block.append(headRow);

        const cardBtn = el("button", "hub-lib-card");
        cardBtn.type = "button";
        cardBtn.title = `点击打开${noun}项目库（切换、封面预览、重命名、删除）`;
        const thumb = el("span", "hub-lib-thumb");
        const firstImg = kind === "image" ? (cards.find(c => !c.skip) || cards[0]) : null;
        if (firstImg?.filename) {
            const img = el("img");
            img.src = this.fileUrl(firstImg, "/amiaomiao_h3/lvm/image_thumbnail");
            img.alt = "";
            img.draggable = false;
            img.addEventListener("error", () => { thumb.replaceChildren(icon("image")); });
            thumb.append(img);
        } else {
            thumb.append(icon(kind === "image" ? "image" : "volume-up"));
        }

        const info = el("span", "hub-lib-info");
        info.append(el("span", "hub-lib-name", project));
        const sub = el("span", "hub-lib-sub");
        sub.append(el("span", "", `${cards.length} 张卡片`));
        this.projectDirtyPill = el("span", "hub-dirty-pill", bound ? "未保存" : "未存库");
        this.projectDirtyPill.hidden = !dirty;
        sub.append(this.projectDirtyPill);
        info.append(sub);

        const chev = el("span", "hub-lib-chev");
        chev.append(icon("chevron-right"));
        cardBtn.append(thumb, info, chev);
        cardBtn.addEventListener("click", () => this.openRefLibrary(kind));
        block.append(cardBtn);

        const actsWrap = el("div", "hub-lib-acts-wrap");
        const acts = el("div", "hub-lib-acts");
        const saveBtn = textButton(dirty && bound ? "保存改动" : "保存库", "save", () => this.saveRefProject(kind),
            `hub-btn${dirty ? " is-warn-pulse" : ""}`);
        saveBtn.title = `把当前${noun}卡片保存到「${project}」，旧的${noun}参考载入器也能读取`;
        this.projectSaveBtn = saveBtn;
        const createBtn = iconButton("plus", `新建${noun}项目`, () => this.showCreateProject(actsWrap, kind), "hub-icon-btn");
        const refreshBtn = iconButton("refresh", "刷新当前项目", () => this.switchRefProject(kind, project, { refresh: true }), "hub-icon-btn");
        acts.append(saveBtn, createBtn, refreshBtn);
        actsWrap.append(acts);
        block.append(actsWrap);
        return block;
    }

    projectDirtyState(kind) {
        const binding = this.projectBinding(kind);
        const bound = !!binding;
        const dirty = bound
            ? this.projectBaselines.get(kind) !== this.projectSignature(kind)
            : this.doc[`${kind}s`].length > 0;
        return { bound, dirty };
    }

    syncProjectDirtyUi() {
        const page = this.doc.ui.page;
        if (page !== "image" && page !== "audio") return;
        const { bound, dirty } = this.projectDirtyState(page);
        if (this.projectStatusEl) {
            this.projectStatusEl.textContent = bound ? (dirty ? "有未保存改动" : "已同步") : (this.doc[`${page}s`].length ? "未绑定库" : "空项目");
        }
        if (this.projectDirtyPill) {
            this.projectDirtyPill.textContent = bound ? "未保存" : "未存库";
            this.projectDirtyPill.hidden = !dirty;
        }
        if (this.projectSaveBtn) {
            this.projectSaveBtn.classList.toggle("is-warn-pulse", dirty);
            const span = this.projectSaveBtn.querySelector("span");
            if (span) span.textContent = dirty && bound ? "保存改动" : "保存库";
        }
    }

    buildImageSettingsBlock() {
        const block = el("div", "hub-rail-block");
        block.append(this.eyebrow("图片输出设置", "自动 32 对齐", true));
        const box = el("div", "hub-param-box");
        box.setAttribute("role", "group");
        box.setAttribute("aria-label", "图片输出设置");

        // Row 1: Target Megapixels
        const rowMp = el("div", "hub-param-row");
        rowMp.title = "每张图的目标像素量（百万像素），按各自比例缩放并对齐 32 像素";
        const unit = el("span", "hub-unit");
        const number = el("input");
        number.type = "number";
        number.min = "0.02";
        number.max = "8";
        number.step = "0.01";
        number.value = String(this.settings.get("target_megapixels") ?? 0.25);
        number.setAttribute("aria-label", "图片目标像素量（MP）");
        number.addEventListener("change", () => {
            const value = Math.min(8, Math.max(0.02, Math.round((Number(number.value) || 0.25) * 100) / 100));
            number.value = String(value);
            this.settings.set("target_megapixels", value);
            this.refreshImageSizes();
        });
        unit.append(number);
        unit.classList.add("is-bare");
        rowMp.append(el("span", "hub-param-lbl", "目标像素 (MP)"), unit);

        // Row 2: Resampling method
        const rowMethod = el("div", "hub-param-row");
        const method = select(RESAMPLE_OPTIONS.map(name => [name, name]), this.settings.get("resampling_method") || "Lanczos",
            value => this.settings.set("resampling_method", value), "图片重采样");
        method.title = "图片重采样算法";
        method.classList.add("hub-param-select");
        rowMethod.append(el("span", "hub-param-lbl", "重采样"), method);

        // Row 3: Upscale small images
        const rowUp = el("div", "hub-param-row");
        rowUp.title = "开启：比目标像素小的图片放大到目标像素\n关闭：小图保持原尺寸，只微调到 32 的倍数";
        const toggle = el("label", "hub-toggle");
        const checkbox = el("input");
        checkbox.type = "checkbox";
        checkbox.checked = !!this.settings.get("upscale_small_images");
        checkbox.setAttribute("aria-label", "小于目标时放大");
        checkbox.addEventListener("change", () => {
            this.settings.set("upscale_small_images", checkbox.checked);
            this.refreshImageSizes();
        });
        toggle.append(checkbox, el("span", "hub-switch"));
        rowUp.append(el("span", "hub-param-lbl", "小图放大"), toggle);

        box.append(rowMp, rowMethod, rowUp);
        block.append(box);
        return block;
    }

    buildAudioSoundtrackNotice() {
        const tracks = soundtrackLabels(this.doc);
        if (!tracks.length) return null;
        const box = el("div", "hub-notice-box");
        const head = el("strong", "", `编号联动 · 视频原声占 ${tracks.length} 路`);
        const lines = tracks.map(t => `${t.video} → ${t.display}`).join("、");
        const nextNum = tracks.length + 1;
        box.append(head, el("p", "", `${lines}；本页启用音频自动从 Audio ${nextNum} 起编。`));
        return box;
    }

    buildVideoOverviewBlock() {
        const block = el("div", "hub-rail-block");
        const activeV = activeCount(this.doc, "video");
        const tracks = soundtrackLabels(this.doc);
        block.append(this.eyebrow("视频参考概览", `上限 ${LIMITS.video}`, true));
        const box = el("div", "hub-param-box");
        const r1 = el("div", "hub-param-row");
        r1.append(el("span", "hub-param-lbl", "已启用视频"), el("strong", "hub-val-video", `${activeV} / ${LIMITS.video}`));
        const r2 = el("div", "hub-param-row");
        r2.append(el("span", "hub-param-lbl", "携带原声"), el("strong", "hub-val-audio", `${tracks.length} 路`));
        const r3 = el("div", "hub-param-row is-note", "每张卡可独立切换「裁切片段池」或「投放视频池」，点项目按钮可打开大库正/倒序选片。");
        box.append(r1, r2, r3);
        block.append(box);
        return block;
    }

    // ---------- Left-Rail Purpose Tag Filter (Pure UI Filter, Zero Numbering/Backend Impact) ----------
    computePurposeStats(kind) {
        const cards = this.doc[`${kind}s`] || [];
        const counts = new Map();
        for (const card of cards) {
            const key = card.purpose || FILTER_NONE;
            counts.set(key, (counts.get(key) || 0) + 1);
        }
        const entries = [[FILTER_ALL, "全部", cards.length]];
        for (const [val, label] of PURPOSES[kind] || []) {
            if (!val) continue;
            const n = counts.get(val) || 0;
            if (n > 0 || this.purposeFilters[kind] === val) entries.push([val, label, n]);
        }
        const noneCount = counts.get(FILTER_NONE) || 0;
        if (noneCount > 0 || this.purposeFilters[kind] === FILTER_NONE) {
            entries.push([FILTER_NONE, "未打标", noneCount]);
        }
        return { total: cards.length, entries };
    }

    renderTagFilterInto(host, kind) {
        host.replaceChildren();
        const { total, entries } = this.computePurposeStats(kind);
        if (!total) {
            host.hidden = true;
            return;
        }
        host.hidden = false;
        const current = this.purposeFilters[kind] || FILTER_ALL;
        const block = el("div", "hub-rail-block");
        const head = this.eyebrow("按标签筛选", current === FILTER_ALL ? `${total} 张` : purposeLabel(kind, current), true);
        if (current !== FILTER_ALL) {
            const reset = el("button", "hub-filter-reset", "重置");
            reset.type = "button";
            reset.addEventListener("click", () => {
                this.purposeFilters[kind] = FILTER_ALL;
                this.render();
            });
            head.querySelector(".hub-eyebrow-r")?.replaceWith(reset);
        }
        block.append(head);

        const list = el("div", "hub-tag-list");
        list.setAttribute("role", "group");
        list.setAttribute("aria-label", "按用途标签筛选素材");
        for (const [key, label, count] of entries) {
            const chip = el("button", "hub-tag-chip");
            chip.type = "button";
            chip.dataset.tagFilter = key;
            chip.setAttribute("aria-pressed", String(current === key));
            chip.append(el("span", "hub-tag-name", label), el("span", "hub-tag-num", String(count)));
            chip.addEventListener("click", () => {
                this.purposeFilters[kind] = (current === key && key !== FILTER_ALL) ? FILTER_ALL : key;
                this.render();
            });
            list.append(chip);
        }
        block.append(list);
        host.append(block);
    }

    syncTagFilterUi(kind) {
        if (this.tagFilterHost?.isConnected) this.renderTagFilterInto(this.tagFilterHost, kind);
    }

    buildStageBar(kind) {
        const noun = KIND_NAMES[kind];
        const bar = el("div", "hub-stage-bar");
        const left = el("div", "hub-stage-left");
        const title = el("span", "hub-stage-title");
        title.append(el("span", "", `${noun}素材墙`));
        this.stageCountBadge = el("span", "hub-stage-badge", `${activeCount(this.doc, kind)} / ${LIMITS[kind]}`);
        title.append(this.stageCountBadge);
        left.append(title);
        if (kind === "audio") {
            const tip = el("span", "hub-stage-tip", "划选裁切 · 拖两边滑块微调 · 双击重置");
            tip.title = "在波形上按住拖选裁切区间；裁切后可拖动左右两边滑块微调或拖动选区平移，双击重置全长";
            left.append(tip);
        }

        const activeFilter = this.purposeFilters[kind] || FILTER_ALL;
        if (activeFilter !== FILTER_ALL) {
            const matched = (this.doc[`${kind}s`] || []).filter(c => matchesPurposeFilter(c, activeFilter)).length;
            const pill = el("button", "hub-active-filter");
            pill.type = "button";
            pill.title = "点击清除标签筛选";
            pill.append(icon("filter"), el("span", "", `${purposeLabel(kind, activeFilter)} (${matched})`), icon("times"));
            pill.addEventListener("click", () => {
                this.purposeFilters[kind] = FILTER_ALL;
                this.render();
            });
            left.append(pill);
        }

        const right = el("div", "hub-stage-actions");
        if (kind === "image") {
            const viewMode = this.imageViewMode();
            const viewSeg = el("div", "hub-seg hub-view-seg");
            viewSeg.setAttribute("role", "group");
            viewSeg.setAttribute("aria-label", "图片视图模式");
            for (const [mode, iconName, label, tip] of [
                ["grid", "th-large", "网格", "紧凑图墙视图（默认 3~4 列一屏看全）"],
                ["list", "list", "列表", "横向条带列表视图（描述常显，一维上下排序）"],
            ]) {
                const btn = el("button", "hub-view-btn");
                btn.type = "button";
                btn.title = tip;
                btn.dataset.viewMode = mode;
                btn.setAttribute("aria-pressed", String(viewMode === mode));
                btn.append(icon(iconName), el("span", "", label));
                btn.addEventListener("click", () => {
                    if (this.imageViewMode() === mode) return;
                    this.doc.ui.image_view = mode;
                    this.save(true);
                });
                viewSeg.append(btn);
            }
            right.append(viewSeg);
        } else if (kind === "audio") {
            const layoutMode = this.audioLayoutMode();
            const viewSeg = el("div", "hub-seg hub-view-seg");
            viewSeg.setAttribute("role", "group");
            viewSeg.setAttribute("aria-label", "音频视图模式");
            for (const [mode, iconName, label, tip] of [
                ["card", "th-list", "标准", "紧凑双层音频卡（波形与裁切同行，描述折叠）"],
                ["strip", "bars", "极简", "极简 DAW 音轨条（60px 超薄单行，裁切备注按需展开）"],
            ]) {
                const btn = el("button", "hub-view-btn");
                btn.type = "button";
                btn.title = tip;
                btn.dataset.audioLayout = mode;
                btn.setAttribute("aria-pressed", String(layoutMode === mode));
                btn.append(icon(iconName), el("span", "", label));
                btn.addEventListener("click", () => {
                    if (this.audioLayoutMode() === mode) return;
                    this.doc.ui.audio_layout = mode;
                    this.save(true);
                });
                viewSeg.append(btn);
            }
            right.append(viewSeg);
        }
        right.append(
            this.clearButton(kind),
            textButton(`添加${noun}`, "plus", () => {
                this.purposeFilters[kind] = FILTER_ALL;
                if (kind === "video") this.addVideo();
                else this.pickFiles(kind);
            }, "hub-btn is-primary")
        );
        bar.append(left, right);
        return bar;
    }

    updateCounts() {
        if (!this.tabs) return;
        const counts = {
            image: `${activeCount(this.doc, "image")}/${LIMITS.image}`,
            video: `${activeCount(this.doc, "video")}/${LIMITS.video}`,
            audio: `${activeCount(this.doc, "audio")}/${LIMITS.audio}`,
        };
        for (const tab of this.tabs.children) {
            const badge = tab.querySelector(".hub-ch-count");
            if (badge) badge.textContent = counts[tab.dataset.page];
        }
        const page = this.doc.ui.page;
        if (this.stageCountBadge) this.stageCountBadge.textContent = `${activeCount(this.doc, page)} / ${LIMITS[page]}`;
    }

    // Remove every card of one kind, with an inline confirm (files on disk are kept).
    clearButton(kind) {
        const noun = KIND_NAMES[kind];
        const total = this.doc[`${kind}s`].length;
        const button = iconButton("trash", `清空全部${noun}卡片`, () => {
            const confirm = el("div", "ahr-clear-confirm");
            confirm.setAttribute("role", "group");
            confirm.setAttribute("aria-label", `确认清空${noun}`);
            const yes = textButton(`清空 ${total} 个`, "trash", () => {
                clearCards(this.doc, kind);
                this.purposeFilters[kind] = FILTER_ALL;
                this.save(true);
                this.toast(`已清空${noun}卡片（文件仍保留）`);
            }, "is-danger-solid");
            const no = textButton("取消", "", () => confirm.replaceWith(button));
            confirm.append(el("span", "ahr-clear-text", `清空全部${noun}？`), yes, no);
            button.replaceWith(confirm);
            no.focus();
            confirm.addEventListener("keydown", event => {
                if (event.key === "Escape") { event.stopPropagation(); confirm.replaceWith(button); button.focus(); }
            });
        }, "hub-icon-btn is-danger");
        button.disabled = !total;
        return button;
    }

    batchSkip(kind, skip) {
        const noun = KIND_NAMES[kind];
        const { changed, left } = setAllSkip(this.doc, kind, skip);
        if (!changed && !left) return;
        this.save(true);
        if (skip) this.toast(`已停用全部${noun}（${changed} 个）`);
        else if (left) this.toast(`已启用 ${changed} 个，${noun}最多启用 ${LIMITS[kind]} 个，其余 ${left} 个仍停用`, !changed);
        else this.toast(`已启用全部${noun}（${changed} 个）`);
    }

    imageViewMode() {
        return this.doc.ui.image_view === "list" ? "list" : "grid";
    }

    shortImageBadge(card) {
        const info = this.labels.get(card.id);
        return info ? `P${info.slot + 1}` : "停用";
    }

    // ---------- page 1: images ----------
    renderImagePage(body) {
        const isList = this.imageViewMode() === "list";
        const { active } = splitCards(this.doc, "image");
        body.append(...this.zones("image", isList ? "hub-img-list" : "ahr-image-grid",
            card => isList ? this.imageRow(card, active) : this.imageCard(card, active),
            () => this.addTile("image", "添加图片", "image", isList)));
    }

    audioLayoutMode() {
        return this.doc.ui.audio_layout === "strip" ? "strip" : "card";
    }

    // ---------- page 2: audio ----------
    renderAudioPage(body) {
        const isStrip = this.audioLayoutMode() === "strip";
        const { active } = splitCards(this.doc, "audio");
        body.append(...this.zones("audio", `hub-aud-list${isStrip ? " is-strip" : ""}`,
            card => isStrip ? this.audioStrip(card, active) : this.audioCard(card, active),
            () => this.addTile("audio", "添加音频", "volume-up", true)));
    }

    // ---------- page 3: video ----------
    renderVideoPage(body) {
        const { active } = splitCards(this.doc, "video");
        body.append(...this.zones("video", "hub-vid-list", card => this.videoCard(card, active),
            () => this.addTile("video", "添加视频", "video", true)));
    }

    // Active cards (numbered, sent to H3) and parked cards (kept, not sent) in two zones.
    zones(kind, listClass, render, addTile) {
        const { active, parked } = splitCards(this.doc, kind);
        const filterKey = this.purposeFilters[kind] || FILTER_ALL;
        const filtered = filterKey !== FILTER_ALL;
        const visibleActive = filtered ? active.filter(c => matchesPurposeFilter(c, filterKey)) : active;
        const visibleParked = filtered ? parked.filter(c => matchesPurposeFilter(c, filterKey)) : parked;

        const out = [];
        if (filtered && !visibleActive.length && !visibleParked.length) {
            const empty = el("div", "hub-filter-empty");
            empty.append(
                icon("filter"),
                el("strong", "", `标签「${purposeLabel(kind, filterKey)}」下暂无素材`),
                el("small", "", "可以给卡片切换用途标签，或清除筛选查看全部素材"),
                textButton("显示全部素材", "times", () => {
                    this.purposeFilters[kind] = FILTER_ALL;
                    this.render();
                }, "hub-btn is-accent")
            );
            out.push(empty);
            return out;
        }

        const activeZone = el("div", "ahr-zone is-active");
        const activeHead = el("div", "ahr-zone-head");
        const activeCountText = filtered
            ? `筛选 ${visibleActive.length} · 共 ${active.length} / ${LIMITS[kind]}`
            : `${active.length} / ${LIMITS[kind]}`;
        activeHead.append(el("span", "ahr-zone-dot"), el("span", "ahr-zone-title", "启用 · 会输出"),
            el("span", "ahr-zone-count", activeCountText));
        if (active.length) {
            const off = textButton("全部停用", "pause", () => this.batchSkip(kind, true), "ahr-zone-action is-disable");
            off.title = `把启用区的全部${KIND_NAMES[kind]}移到停用区`;
            activeHead.append(off);
        }
        const activeList = el("div", listClass);
        for (const card of visibleActive) activeList.append(render(card));
        if (!filtered && active.length < LIMITS[kind]) activeList.append(addTile());
        if (filtered && !visibleActive.length) {
            activeList.append(el("div", "hub-zone-filter-none", `启用区没有「${purposeLabel(kind, filterKey)}」标签的素材`));
        }
        activeZone.append(activeHead, activeList);
        this.makeZoneDrop(activeZone, kind, false);
        out.push(activeZone);

        // Always present so it can receive a drag; collapses to one line when empty.
        const parkedZone = el("div", `ahr-zone is-parked${visibleParked.length ? "" : " is-empty"}`);
        const parkedHead = el("div", "ahr-zone-head");
        const parkedCountText = filtered
            ? (visibleParked.length ? `筛选 ${visibleParked.length} / 共 ${parked.length}` : "无匹配停用卡")
            : (parked.length ? `${parked.length} 项` : "拖卡片到这里停用");
        parkedHead.append(el("span", "ahr-zone-dot"), el("span", "ahr-zone-title", "停用 · 不输出，卡片保留"),
            el("span", "ahr-zone-count", parkedCountText));
        if (parked.length) {
            const on = textButton("全部启用", "play", () => this.batchSkip(kind, false), "ahr-zone-action is-enable");
            on.title = `按顺序启用停用区的${KIND_NAMES[kind]}，最多 ${LIMITS[kind]} 个`;
            on.disabled = active.length >= LIMITS[kind];
            if (on.disabled) on.title = `启用区已满 ${LIMITS[kind]} 个`;
            parkedHead.append(on);
        }
        parkedZone.append(parkedHead);
        if (visibleParked.length) {
            const parkedList = el("div", listClass);
            for (const card of visibleParked) parkedList.append(render(card));
            parkedZone.append(parkedList);
        }
        this.makeZoneDrop(parkedZone, kind, true);
        out.push(parkedZone);
        return out;
    }

    makeZoneDrop(zone, kind, skip) {
        zone.addEventListener("dragover", event => {
            if (!event.dataTransfer.types.includes(DRAG_TYPE) || this.dragKind !== kind) return;
            event.preventDefault();
            zone.classList.add("is-drop");
        });
        zone.addEventListener("dragleave", event => {
            if (!zone.contains(event.relatedTarget)) zone.classList.remove("is-drop");
        });
        zone.addEventListener("drop", event => {
            zone.classList.remove("is-drop");
            const raw = event.dataTransfer.getData(DRAG_TYPE);
            if (!raw) return;
            event.preventDefault();
            const moving = JSON.parse(raw);
            if (moving.kind !== kind) return;
            this.applyPlace(kind, moving.id, skip, Infinity);
        });
    }

    applyPlace(kind, id, skip, index) {
        const result = placeCard(this.doc, kind, id, skip, index);
        if (!result.ok && result.reason === "full") {
            this.toast(`${KIND_NAMES[kind]}最多启用 ${LIMITS[kind]} 个，先停用一个再启用`, true);
            return;
        }
        this.save(true);
    }

    // ---------- reference projects: separate image and audio libraries ----------
    refProject(kind) {
        return this.doc.ui[`${kind}_project`] || DEFAULT_PROJECT;
    }

    projectBinding(kind) {
        const binding = this.doc.ui[`${kind}_project_binding`];
        return binding?.project === this.refProject(kind) && typeof binding.revision === "string" ? binding : null;
    }

    projectSignature(kind, doc = this.doc) {
        return JSON.stringify(toPresetEntries(doc, kind));
    }

    restoreProjectBaselines() {
        this.projectBaselines.clear();
        for (const kind of ["image", "audio"]) {
            if (this.projectBinding(kind)?.dirty === false) this.projectBaselines.set(kind, this.projectSignature(kind));
        }
    }

    bindProject(kind, project, revision) {
        this.doc.ui[`${kind}_project`] = project;
        this.doc.ui[`${kind}_project_binding`] = { project, revision, dirty: false };
        this.projectBaselines.set(kind, this.projectSignature(kind));
    }

    detachProject(kind) {
        delete this.doc.ui[`${kind}_project_binding`];
        this.projectBaselines.delete(kind);
    }

    // Project library browser: image / audio projects.
    openRefLibrary(kind) {
        const doc = this.doc;
        const current = () => !this.disposed && this.doc === doc;
        openLibraryBrowser({
            scope: kind, current: this.refProject(kind), url: path => this.url(path),
            fetchJson: (path, options) => this.fetchJson(path, options),
            directReferenceSwitch: true,
            onUse: name => current() && this.switchRefProject(kind, name),
            onRenamed: (from, to) => {
                if (!current()) return;
                if (this.refProject(kind) === from) {
                    this.doc.ui[`${kind}_project`] = to;
                    this.detachProject(kind);
                }
                this.projects.delete(kind);
                this.save(true);
            },
            onDeleted: name => {
                if (!current()) return;
                if (this.refProject(kind) === name) this.detachProject(kind);
                this.projects.delete(kind);
                this.save(true);
                if (this.refProject(kind) === name) this.toast("项目已删除，当前卡片仍保留在工作流里。");
            },
        });
    }

    // Project library browser: the video pools, with direct clip picking.
    openVideoLibrary(card) {
        const reset = name => Object.assign(card, { project: name, segment_id: null, key: "", view: null });
        openLibraryBrowser({
            scope: card.source, current: card.project, url: path => this.url(path),
            fetchJson: (path, options) => this.fetchJson(path, options),
            onUse: name => { if (name !== card.project) reset(name); this.save(true); },
            onPickClip: (name, record) => {
                Object.assign(card, { project: name, segment_id: record.segment_id, key: libraryKey(card.source, record) });
                card.view = this.viewFor(card, record);
                if (!card.name) card.name = card.view.title.replace(/\.[^.]+$/, "").slice(0, 60);
                this.libraries.delete(`${card.source}:${name}`);
                this.save(true);
            },
            onRenamed: (from, to) => {
                for (const item of this.doc.videos) if (item.source === card.source && item.project === from) item.project = to;
                this.projects.clear();
                this.libraries.clear();
                this.save(true);
            },
            onDeleted: (name, next) => { if (card.project === name) reset(next || DEFAULT_PROJECT); this.projects.delete(card.source); this.save(true); },
        });
    }

    // Inline create right inside the left rail action slot, no browser dialog.
    showCreateProject(container, kind) {
        if (container.classList.contains("is-creating")) return container.querySelector(".hub-create-input")?.focus();
        const noun = KIND_NAMES[kind];
        const saved = [...container.children];
        const form = el("form", "hub-create-form");
        const input = el("input", "ahr-name hub-create-input");
        input.placeholder = `新${noun}项目名…`;
        input.maxLength = 80;
        input.setAttribute("aria-label", `新${noun}项目名称`);
        const confirm = textButton("建立", "check", () => {}, "hub-btn is-accent");
        confirm.type = "submit";
        confirm.disabled = true;
        const error = el("span", "hub-create-error");
        const restore = () => {
            container.classList.remove("is-creating");
            container.replaceChildren(...saved);
            container.querySelector(".ahr-icon-btn[aria-label^='新建']")?.focus();
        };
        const cancel = iconButton("times", "取消", () => restore(), "hub-icon-btn");
        input.addEventListener("input", () => { confirm.disabled = !input.value.trim(); error.textContent = ""; });
        input.addEventListener("keydown", event => {
            event.stopPropagation();
            if (event.key === "Escape") { event.preventDefault(); restore(); }
        });
        form.addEventListener("submit", async event => {
            event.preventDefault();
            const typed = input.value.trim();
            if (!typed) return;
            confirm.disabled = true;
            const ok = await this.switchRefProject(kind, projectFolder(typed), { create: true });
            if (!ok && input.isConnected) {
                error.textContent = this.status.textContent;
                confirm.disabled = false;
                input.focus();
            }
        });
        form.append(input, confirm, cancel);
        container.classList.add("is-creating");
        container.replaceChildren(form, error);
        input.focus();
    }

    chooseProjectAction(kind, message, actions) {
        this.projectChoice = { kind, message, actions };
        this.render();
        this.body.querySelector(".ahr-project-choice button:last-child")?.focus();
    }

    renderProjectChoice() {
        const choice = this.projectChoice;
        const box = el("div", "ahr-clear-confirm ahr-project-choice");
        box.setAttribute("role", "group");
        box.setAttribute("aria-label", choice.message);
        const close = () => {
            this.projectChoice = null;
            this.render();
        };
        box.append(el("span", "ahr-clear-text", choice.message));
        const actions = el("div", "hub-choice-actions");
        for (const [label, action, extraClass = ""] of choice.actions) {
            actions.append(textButton(label, "", () => { close(); action(); }, `hub-btn ${extraClass}`.trim()));
        }
        actions.append(textButton("取消", "", close, "hub-btn"));
        box.append(actions);
        box.addEventListener("keydown", event => {
            if (event.key === "Escape") { event.stopPropagation(); close(); }
        });
        return box;
    }

    async readRefProject(kind, project) {
        const data = await this.fetchJson(`/amiaomiao_h3/lvm/ref_presets?strict=1&kind=${kind}&project=${encodeURIComponent(project)}`);
        if (!(data.revision === null || typeof data.revision === "string") || !Array.isArray(data.references)) {
            throw new Error("无法读取项目，请重启 ComfyUI 后重试。");
        }
        return data;
    }

    async writeRefProject(kind, project, revision) {
        const result = await this.fetchJson("/amiaomiao_h3/lvm/ref_presets", { method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind, project, expected_revision: revision, entries: toPresetEntries(this.doc, kind) }) });
        if (typeof result.revision !== "string") throw new Error("保存响应无效，请重启 ComfyUI 后重试。");
        return result;
    }

    async runProjectAction(action) {
        if (this.projectOperation || this.disposed) return false;
        if (this.pendingImports) {
            this.toast("正在添加素材，请等上传完成后再操作项目。", true);
            return false;
        }
        const operation = {};
        const current = () => this.projectOperation === operation;
        this.projectChoice = null;
        this.body.querySelector(".ahr-project-choice")?.remove();
        this.projectOperation = operation;
        this.body.inert = true;
        this.body.setAttribute("aria-busy", "true");
        let result;
        try {
            result = await action(current);
        } catch (error) {
            if (current()) {
                this.projectOperation = null;
                this.body.inert = false;
                this.body.setAttribute("aria-busy", "false");
                this.toast(error.message, true);
            }
            return false;
        }
        if (!current()) return false;
        this.projectOperation = null;
        this.render();
        if (typeof result === "function") result();
        else if (result) this.toast(result);
        return true;
    }

    switchRefProject(kind, target, { refresh = false, create = false, decision, forceRevision } = {}) {
        if (this.projectOperation || this.disposed) return false;
        const source = this.refProject(kind);
        const binding = this.projectBinding(kind);
        const dirty = binding ? this.projectBaselines.get(kind) !== this.projectSignature(kind) :
            !!this.doc[`${kind}s`].length;
        if (!refresh && !create && target === source && binding) return false;
        if (dirty && !decision && (refresh || !binding)) {
            const proceed = choice => this.switchRefProject(kind, target, { refresh, create, decision: choice });
            const message = refresh ? "刷新会替换当前卡片和未保存的改动。" :
                `当前卡片尚未绑定项目。保存并切换会替换「${source}」中的卡片。`;
            this.chooseProjectAction(kind, message, refresh ? [
                ["放弃改动并刷新", () => proceed("discard"), "is-danger-solid"],
            ] : [
                ["保存并切换", () => proceed("save"), "is-accent"],
                ["不保存，切换", () => proceed("discard")],
            ]);
            return true;
        }
        return this.runProjectAction(async current => {
            let data;
            if (!create) {
                data = await this.readRefProject(kind, target);
                if (!current()) return;
                if (!data.revision) {
                    if (refresh && target === source && binding) {
                        this.detachProject(kind);
                        this.save();
                        return () => this.toast(`项目「${target}」在磁盘上已不存在，已解除旧绑定（当前卡片已保留）`, true);
                    }
                    throw new Error(`项目「${target}」不存在，当前卡片未更改。`);
                }
            }
            const shouldSaveOld = !refresh && (decision === "save" || decision === "force_save"
                || (binding && dirty && decision !== "discard"));
            if (shouldSaveOld) {
                const revision = decision === "force_save"
                    ? forceRevision
                    : (binding ? binding.revision : (await this.readRefProject(kind, source)).revision);
                if (!current()) return;
                try {
                    const saved = await this.writeRefProject(kind, source, revision);
                    if (!current()) return;
                    this.bindProject(kind, saved.name, saved.revision);
                    this.projects.delete(kind);
                    this.save();
                    if (!create && target === source) data = await this.readRefProject(kind, target);
                } catch (err) {
                    if (err.status !== 409) throw err;
                    const latest = await this.readRefProject(kind, source);
                    if (!current()) return;
                    const targetLabel = create ? `新建「${target}」` : `切换到「${target}」`;
                    if (latest.revision === null) {
                        return () => this.chooseProjectAction(kind,
                            `原项目「${source}」在磁盘上已不存在（可能已被删除或重命名），无法自动保存。`, [
                                [`不保存，直接${targetLabel}`, () => this.switchRefProject(kind, target, { refresh, create, decision: "discard" }), "is-accent"],
                                [`重建「${source}」保存后再切换`, () => this.switchRefProject(kind, target, { refresh, create, decision: "force_save", forceRevision: null })],
                            ]);
                    }
                    return () => this.chooseProjectAction(kind,
                        `原项目「${source}」在磁盘上已有更新（磁盘 ${latest.references.length} 张），切换前要如何处理？`, [
                            [`覆盖保存「${source}」并切换`, () => this.switchRefProject(kind, target, { refresh, create, decision: "force_save", forceRevision: latest.revision }), "is-accent"],
                            [`不保存，直接${targetLabel}`, () => this.switchRefProject(kind, target, { refresh, create, decision: "discard" })],
                        ]);
                }
            }
            if (create) {
                const project = await this.fetchJson("/amiaomiao_h3/lvm/project", { method: "POST",
                    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: target, scope: kind }) });
                if (!current()) return;
                target = project.name || target;
                data = await this.readRefProject(kind, target);
            }
            if (!current()) return;
            if (!data.revision) throw new Error(`项目「${target}」不存在，当前卡片未更改。`);
            this.closePreview();
            this.stopAudio();
            this.results.clear();
            fromPresetEntries(this.doc, kind, data.references, target === source && !!binding);
            this.purposeFilters[kind] = FILTER_ALL;
            this.bindProject(kind, data.project_name || target, data.revision);
            this.projects.delete(kind);
            this.save();
            return `${refresh ? "已刷新" : "已切换到"}${KIND_NAMES[kind]}项目「${target}」：${data.references.length} 个`;
        });
    }

    saveRefProject(kind, expectedRevision) {
        const project = this.refProject(kind);
        const binding = this.projectBinding(kind);
        return this.runProjectAction(async current => {
            let revision = expectedRevision !== undefined ? expectedRevision : binding?.revision;
            if (revision === undefined) {
                const data = await this.readRefProject(kind, project);
                if (!current()) return;
                revision = data.revision;
                if (data.references.length) {
                    const savedDoc = { [`${kind}s`]: this.doc[`${kind}s`] };
                    fromPresetEntries(savedDoc, kind, data.references, true);
                    if (this.projectSignature(kind, savedDoc) !== this.projectSignature(kind)) {
                        return () => this.chooseProjectAction(kind, `用当前卡片替换「${project}」里已保存的素材？`, [
                            ["确认保存", () => this.saveRefProject(kind, revision), "is-accent"],
                        ]);
                    }
                }
            }
            try {
                const saved = await this.writeRefProject(kind, project, revision);
                if (!current()) return;
                this.bindProject(kind, saved.name, saved.revision);
                this.projects.delete(kind);
                this.save();
                return `已保存到${KIND_NAMES[kind]}项目「${project}」`;
            } catch (err) {
                if (err.status !== 409) throw err;
                const latest = await this.readRefProject(kind, project);
                if (!current()) return;
                if (latest.revision === null) {
                    return () => this.chooseProjectAction(kind,
                        `项目「${project}」在磁盘上已不存在（可能已被删除或重命名）。要如何处理当前卡片？`, [
                            ["重新创建并保存当前卡片", () => this.saveRefProject(kind, null), "is-accent"],
                            ["解除旧绑定（保留卡片）", () => { this.detachProject(kind); this.save(true); this.toast("已解除旧项目绑定，当前卡片已保留"); }],
                        ]);
                }
                return () => this.chooseProjectAction(kind,
                    `项目「${project}」在磁盘上已有更新（磁盘 ${latest.references.length} 张，可能是另一窗口保存过或刷新前未保存工作流）。`, [
                        ["用当前卡片覆盖保存", () => this.saveRefProject(kind, latest.revision), "is-accent"],
                        ["放弃改动，加载磁盘最新版", () => this.switchRefProject(kind, project, { refresh: true, decision: "discard" }), "is-danger-solid"],
                    ]);
            }
        });
    }

    addTile(kind, label, iconName, wide = false) {
        const tile = el("button", `ahr-add-tile${wide ? " is-wide" : ""}`);
        tile.type = "button";
        tile.append(icon(iconName), el("span", "ahr-add-label", label));
        if (kind !== "video") {
            tile.dataset.fileDrop = "";
            tile.append(el("span", "ahr-add-hint", "或拖入文件"));
        }
        tile.addEventListener("click", () => {
            this.purposeFilters[kind] = FILTER_ALL;
            if (kind === "video") this.addVideo();
            else this.pickFiles(kind);
        });
        return tile;
    }

    badge(card, kind) {
        const info = this.labels.get(card.id);
        const badge = el("span", `ahr-badge is-${kind}`, info ? info.display : "已停用");
        if (!info) badge.classList.add("is-off");
        return badge;
    }

    cardTools(card, kind, preview = null) {
        const tools = el("div", "ahr-card-tools");
        const toggle = textButton(card.skip ? "启用" : "停用", card.skip ? "play" : "pause",
            () => this.applyPlace(kind, card.id, !card.skip, Infinity), card.skip ? "is-enable" : "is-disable");
        toggle.title = card.skip ? "启用：加入输出并分配编号" : "停用：保留卡片，但不输出、不占编号";
        const remove = iconButton("trash", "移除卡片（文件不会被删除）", () => {
            removeCard(this.doc, kind, card.id);
            this.save(true);
        }, "is-danger");
        if (preview && this.root.dataset.density === "xlarge") {
            tools.append(iconButton(kind === "video" ? "play" : "expand", kind === "video" ? "播放视频" : "放大预览", preview));
        }
        tools.append(toggle, remove);
        return tools;
    }

    describeFields(card, kind) {
        const fields = el("div", "ahr-fields");
        const name = el("input", "ahr-name");
        name.value = card.name;
        name.placeholder = "名称";
        name.maxLength = 60;
        name.setAttribute("aria-label", "名称");
        name.addEventListener("input", () => { card.name = name.value; this.save(); });
        const purpose = select(PURPOSES[kind], card.purpose, value => {
            card.purpose = value;
            const activeFilter = this.purposeFilters[kind] || FILTER_ALL;
            this.save(activeFilter !== FILTER_ALL);
        }, "用途标签");
        const note = el("textarea", "ahr-note");
        note.value = card.note;
        note.rows = 2;
        note.placeholder = "描述（选填）";
        note.setAttribute("aria-label", "描述");
        note.addEventListener("input", () => { card.note = note.value; this.save(); });
        const row = el("div", "ahr-field-row");
        row.append(name, purpose);
        fields.append(row, note);
        return fields;
    }

    makeDraggable(node, card, kind) {
        const NO_DRAG = "input, textarea, select, button, label, [contenteditable]";
        node.draggable = false;
        node.dataset.id = card.id;
        node.addEventListener("pointerdown", event => {
            node.draggable = event.button === 0 && !event.target.closest(NO_DRAG);
        });
        node.addEventListener("pointerup", () => { node.draggable = false; });
        node.addEventListener("dragstart", event => {
            if (!node.draggable || event.target.closest?.(NO_DRAG)) return event.preventDefault();
            event.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ kind, id: card.id }));
            event.dataTransfer.effectAllowed = "move";
            node.classList.add("is-dragging");
            this.dragKind = kind;
            this.root.dataset.dragging = kind;
        });
        node.addEventListener("dragend", () => {
            node.draggable = false;
            node.classList.remove("is-dragging");
            this.dragKind = null;
            delete this.root.dataset.dragging;
        });
        node.addEventListener("dragover", event => {
            if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
            event.preventDefault();
            event.stopPropagation();
            const rect = node.getBoundingClientRect();
            const after = kind === "image" ? event.clientX > rect.left + rect.width / 2
                : event.clientY > rect.top + rect.height / 2;
            node.dataset.drop = after ? "after" : "before";
        });
        node.addEventListener("dragleave", () => delete node.dataset.drop);
        node.addEventListener("drop", event => {
            const raw = event.dataTransfer.getData(DRAG_TYPE);
            const after = node.dataset.drop === "after";
            delete node.dataset.drop;
            if (!raw) return;
            event.preventDefault();
            event.stopPropagation();
            const moving = JSON.parse(raw);
            if (moving.kind !== kind || moving.id === card.id) return;
            const group = splitCards(this.doc, kind)[card.skip ? "parked" : "active"].filter(item => item.id !== moving.id);
            const index = group.findIndex(item => item.id === card.id) + (after ? 1 : 0);
            this.applyPlace(kind, moving.id, card.skip, index);
        });
    }

    cancelPointerDrag() {
        if (!this.pointerDragCleanup) return;
        const cleanup = this.pointerDragCleanup;
        this.pointerDragCleanup = null;
        cleanup();
    }

    placeImageWithFeedback(card, skip, index) {
        const result = placeCard(this.doc, "image", card.id, skip, index);
        if (!result.ok && result.reason === "full") {
            this.toast(`图片最多启用 ${LIMITS.image} 个，先停用一个再启用`, true);
            return false;
        }
        this.flashCardId = card.id;
        this.save(true);
        clearTimeout(this.flashTimer);
        this.flashTimer = setTimeout(() => {
            this.flashCardId = null;
            this.root?.querySelector(".is-flash")?.classList.remove("is-flash");
        }, 760);
        const info = this.labels.get(card.id);
        const label = card.name || card.filename || "图片";
        this.toast(`已将「${label}」移至 ${info ? info.display : "停用区"}`);
        return true;
    }

    nudgeImageCard(card, delta) {
        const { active } = splitCards(this.doc, "image");
        const idx = active.findIndex(item => item.id === card.id);
        const next = idx + delta;
        if (idx < 0 || next < 0 || next >= active.length) return;
        this.placeImageWithFeedback(card, false, next);
    }

    // Precision pointer-based drag sorting for images (immune to ComfyUI canvas CSS zoom & huge HTML5 ghosts).
    bindImagePointerDrag(handleEl, cardEl, card, axis) {
        const NO_DRAG = "button, input, textarea, select, label, [contenteditable]";
        handleEl.addEventListener("pointerdown", event => {
            if (event.button !== 0 || event.target.closest(NO_DRAG)) return;
            event.preventDefault();
            this.cancelPointerDrag();

            const startX = event.clientX;
            const startY = event.clientY;
            let started = false;
            let ghost = null;
            let dropTarget = null;
            let scrollRaf = 0;
            let lastY = startY;

            const clearIndicators = () => {
                this.root?.querySelectorAll(".is-drop-before, .is-drop-after, .is-drop-full").forEach(node => {
                    node.classList.remove("is-drop-before", "is-drop-after", "is-drop-full");
                    node.removeAttribute("data-drop-hint");
                });
                this.root?.querySelectorAll(".ahr-zone.is-drop").forEach(node => node.classList.remove("is-drop"));
            };

            const stopAutoScroll = () => {
                if (scrollRaf) { cancelAnimationFrame(scrollRaf); scrollRaf = 0; }
            };

            const tickAutoScroll = () => {
                scrollRaf = 0;
                if (!started || !this.body?.isConnected) return;
                const rect = this.body.getBoundingClientRect();
                const edge = 38;
                let delta = 0;
                if (lastY < rect.top + edge) delta = -Math.ceil((rect.top + edge - lastY) / 4);
                else if (lastY > rect.bottom - edge) delta = Math.ceil((lastY - (rect.bottom - edge)) / 4);
                if (delta !== 0) {
                    this.body.scrollTop += delta;
                    scrollRaf = requestAnimationFrame(tickAutoScroll);
                }
            };

            const teardown = () => {
                window.removeEventListener("pointermove", onMove, true);
                window.removeEventListener("pointerup", onUp, true);
                window.removeEventListener("pointercancel", onCancel, true);
                window.removeEventListener("keydown", onKeyDown, true);
                stopAutoScroll();
                ghost?.remove();
                ghost = null;
                clearIndicators();
                cardEl.classList.remove("is-dragging");
                if (this.root) delete this.root.dataset.dragging;
                this.pointerDragCleanup = null;
            };

            const onMove = e2 => {
                lastY = e2.clientY;
                if (!started) {
                    if (Math.hypot(e2.clientX - startX, e2.clientY - startY) < 5) return;
                    started = true;
                    cardEl.classList.add("is-dragging");
                    this.root.dataset.dragging = "image";
                    ghost = el("div", "hub-drag-ghost");
                    const thumb = el("img");
                    thumb.src = this.fileUrl(card, "/amiaomiao_h3/lvm/image_thumbnail");
                    thumb.alt = "";
                    thumb.addEventListener("error", () => { if (!thumb.dataset.fb) { thumb.dataset.fb = "1"; thumb.src = this.fileUrl(card); } });
                    const code = el("code", "", this.shortImageBadge(card));
                    const title = el("span", "", card.name || card.filename || "图片");
                    ghost.append(thumb, code, title);
                    document.body.append(ghost);
                }
                e2.preventDefault();
                e2.stopPropagation();
                ghost.style.left = `${e2.clientX}px`;
                ghost.style.top = `${e2.clientY}px`;
                if (!scrollRaf) scrollRaf = requestAnimationFrame(tickAutoScroll);

                clearIndicators();
                dropTarget = null;
                const under = document.elementFromPoint(e2.clientX, e2.clientY);
                const hit = under?.closest?.(".hub-img-card, .hub-img-row");
                if (hit && this.root.contains(hit) && hit.dataset.cardId !== card.id) {
                    const rect = hit.getBoundingClientRect();
                    const after = axis === "vertical"
                        ? e2.clientY > rect.top + rect.height / 2
                        : e2.clientX > rect.left + rect.width / 2;
                    const hitSkip = hit.dataset.skip === "true";
                    if (!hitSkip && card.skip && activeCount(this.doc, "image") >= LIMITS.image) {
                        hit.classList.add("is-drop-full");
                        hit.setAttribute("data-drop-hint", `启用区已满 (${LIMITS.image}/${LIMITS.image})`);
                    } else {
                        hit.classList.add(after ? "is-drop-after" : "is-drop-before");
                        if (!hitSkip) {
                            const act = splitCards(this.doc, "image").active.filter(item => item.id !== card.id);
                            const tIdx = act.findIndex(item => item.id === hit.dataset.cardId);
                            const pos = tIdx < 0 ? act.length + 1 : tIdx + (after ? 2 : 1);
                            hit.setAttribute("data-drop-hint", `→ Picture ${pos}`);
                        } else {
                            hit.setAttribute("data-drop-hint", "→ 停用区");
                        }
                    }
                    dropTarget = { targetId: hit.dataset.cardId, after, skip: hitSkip };
                } else {
                    const zone = under?.closest?.(".ahr-zone");
                    if (zone && this.root.contains(zone)) {
                        const zoneSkip = zone.classList.contains("is-parked");
                        if (zoneSkip !== card.skip) {
                            zone.classList.add("is-drop");
                            dropTarget = { targetId: null, after: true, skip: zoneSkip };
                        }
                    }
                }
            };

            const onUp = e2 => {
                const wasStarted = started;
                const target = dropTarget;
                teardown();
                if (!wasStarted) return;
                e2.preventDefault();
                e2.stopPropagation();
                this.suppressPreviewUntil = Date.now() + 260;
                if (!target) return;
                if (target.targetId) {
                    const group = splitCards(this.doc, "image")[target.skip ? "parked" : "active"].filter(item => item.id !== card.id);
                    const tIdx = group.findIndex(item => item.id === target.targetId);
                    const index = tIdx < 0 ? group.length : tIdx + (target.after ? 1 : 0);
                    this.placeImageWithFeedback(card, target.skip, index);
                } else if (target.skip !== card.skip) {
                    this.placeImageWithFeedback(card, target.skip, Infinity);
                }
            };

            const onCancel = () => {
                const wasStarted = started;
                teardown();
                if (wasStarted) this.suppressPreviewUntil = Date.now() + 260;
            };

            const onKeyDown = e2 => {
                if (e2.key === "Escape") {
                    e2.preventDefault();
                    e2.stopPropagation();
                    onCancel();
                }
            };

            this.pointerDragCleanup = teardown;
            window.addEventListener("pointermove", onMove, true);
            window.addEventListener("pointerup", onUp, true);
            window.addEventListener("pointercancel", onCancel, true);
            window.addEventListener("keydown", onKeyDown, true);
        });
    }

    // Zero-Overlay 3-Band Image Card: Top nameplate (badge + name) -> Pure unobstructed image -> Bottom dim + purpose + actions
    imageCard(card, activeCards) {
        const node = el("article", `ahr-card ahr-image-card hub-img-card${card.skip ? " is-skipped" : ""}${this.flashCardId === card.id ? " is-flash" : ""}`);
        node.dataset.id = card.id;
        node.dataset.cardId = card.id;
        node.dataset.skip = String(!!card.skip);

        const info = this.labels.get(card.id);
        const preview = () => {
            if (Date.now() < this.suppressPreviewUntil) return;
            this.openPreview("image", this.fileUrl(card), card.name || card.filename);
        };

        // Band 1: Top Nameplate Bar (Drag Badge + Full-Width Name Input)
        const head = el("div", "hub-img-head");
        const dragBadge = el("span", `hub-img-badge${info ? "" : " is-off"}`);
        dragBadge.append(el("span", "hub-drag-dots", "⋮⋮"), el("span", "", this.shortImageBadge(card)));
        dragBadge.title = info ? `${info.display}（${info.label}）· 按住拖动排序` : "已停用 · 按住拖到启用区可启用";
        this.bindImagePointerDrag(dragBadge, node, card, "grid");

        const name = el("input", "ahr-name hub-img-name");
        name.value = card.name;
        name.placeholder = card.filename || "名称";
        name.title = card.filename || "";
        name.maxLength = 60;
        name.setAttribute("aria-label", "名称");
        name.addEventListener("input", () => { card.name = name.value; this.save(); });
        head.append(dragBadge, name);

        // Band 2: Pure Unobstructed Image (Zero overlays, drag anywhere to reorder, click to preview)
        const media = el("div", "ahr-image-media hub-img-media");
        media.title = `${card.name || card.filename}（按住拖动排序 / 点击放大预览）`;
        const image = el("img");
        image.alt = card.name || card.filename;
        image.loading = "lazy";
        image.draggable = false;
        image.src = this.fileUrl(card, "/amiaomiao_h3/lvm/image_thumbnail");
        image.addEventListener("error", () => { if (!image.dataset.fallback) { image.dataset.fallback = "1"; image.src = this.fileUrl(card); } });
        media.append(image);
        media.addEventListener("click", preview);
        this.bindImagePointerDrag(media, node, card, "grid");

        // Band 3: Footer Body (Always-Visible Resolution + Purpose & Independent Actions + Collapsible Note)
        const body = el("div", "hub-img-body");

        const dim = el("div", "hub-img-dim ahr-image-size");
        dim.dataset.cardId = card.id;
        this.updateImageSize(dim, card);

        const foot = el("div", "hub-img-foot");
        const purpose = select(PURPOSES.image, card.purpose, value => {
            card.purpose = value;
            const activeFilter = this.purposeFilters.image || FILTER_ALL;
            this.save(activeFilter !== FILTER_ALL);
        }, "用途标签");
        purpose.classList.add("hub-img-purpose");

        const acts = el("div", "hub-img-acts");
        const toggleBtn = el("button", `hub-tbtn ${card.skip ? "is-enable" : "is-pause"}`, card.skip ? "启用" : "停");
        toggleBtn.type = "button";
        toggleBtn.title = card.skip ? "启用：加入输出并分配编号" : "停用：保留卡片，但不输出、不占编号";
        toggleBtn.setAttribute("aria-label", card.skip ? "启用" : "停用");
        toggleBtn.addEventListener("click", event => { event.stopPropagation(); this.applyPlace("image", card.id, !card.skip, Infinity); });

        const delBtn = el("button", "hub-tbtn is-del", "×");
        delBtn.type = "button";
        delBtn.title = "移除卡片（文件不会被删除）";
        delBtn.setAttribute("aria-label", "移除卡片");
        delBtn.addEventListener("click", event => {
            event.stopPropagation();
            removeCard(this.doc, "image", card.id);
            this.save(true);
        });
        acts.append(toggleBtn, delBtn);
        foot.append(purpose, acts);

        const noteSlot = el("div", "hub-note-slot");
        const mountNoteBar = () => {
            const btn = el("button", `hub-note-bar${card.note ? " has-note" : ""}`);
            btn.type = "button";
            btn.title = card.note ? `${card.note}\n（点击编辑描述）` : "点击添加描述（选填）";
            btn.append(el("span", "", card.note || "+ 添加描述（选填）"));
            btn.addEventListener("click", () => {
                const ta = el("textarea", "ahr-note hub-note-edit");
                ta.value = card.note;
                ta.rows = 2;
                ta.maxLength = 400;
                ta.placeholder = "描述（选填）";
                ta.setAttribute("aria-label", "描述");
                ta.addEventListener("input", () => { card.note = ta.value; this.save(); });
                ta.addEventListener("keydown", e2 => {
                    if (e2.key === "Escape") { e2.stopPropagation(); ta.blur(); }
                });
                ta.addEventListener("blur", () => { mountNoteBar(); });
                noteSlot.replaceChildren(ta);
                ta.focus();
                ta.setSelectionRange(ta.value.length, ta.value.length);
            });
            noteSlot.replaceChildren(btn);
        };
        mountNoteBar();

        body.append(dim, foot, noteSlot);
        node.append(head, media, body);
        return node;
    }

    // Scheme 3: Horizontal Image Strip Row (1D vertical drag sorting + inline visible note)
    imageRow(card, activeCards) {
        const node = el("article", `ahr-card hub-img-row${card.skip ? " is-skipped" : ""}${this.flashCardId === card.id ? " is-flash" : ""}`);
        node.dataset.id = card.id;
        node.dataset.cardId = card.id;
        node.dataset.skip = String(!!card.skip);

        const info = this.labels.get(card.id);
        const idxInAct = card.skip ? -1 : activeCards.findIndex(item => item.id === card.id);
        const preview = () => {
            if (Date.now() < this.suppressPreviewUntil) return;
            this.openPreview("image", this.fileUrl(card), card.name || card.filename);
        };

        const grip = el("div", "hub-row-grip", "⋮⋮");
        grip.title = "按住上下拖动排序，或拖入停用区";
        grip.setAttribute("aria-label", "拖动排序");

        const thumb = el("div", "hub-row-thumb");
        thumb.title = `${card.name || card.filename}（点击放大预览 / 按住拖动排序）`;
        const image = el("img");
        image.alt = card.name || card.filename;
        image.loading = "lazy";
        image.draggable = false;
        image.src = this.fileUrl(card, "/amiaomiao_h3/lvm/image_thumbnail");
        image.addEventListener("error", () => { if (!image.dataset.fallback) { image.dataset.fallback = "1"; image.src = this.fileUrl(card); } });
        const badge = el("span", `hub-row-badge${info ? "" : " is-off"}`, this.shortImageBadge(card));
        thumb.append(image, badge);
        thumb.addEventListener("click", preview);

        const fields = el("div", "hub-row-fields");
        const top = el("div", "hub-row-top");
        const name = el("input", "ahr-name hub-img-name");
        name.value = card.name;
        name.placeholder = card.filename || "名称";
        name.title = card.filename || "";
        name.maxLength = 60;
        name.setAttribute("aria-label", "名称");
        name.addEventListener("input", () => { card.name = name.value; this.save(); });

        const purpose = select(PURPOSES.image, card.purpose, value => {
            card.purpose = value;
            const activeFilter = this.purposeFilters.image || FILTER_ALL;
            this.save(activeFilter !== FILTER_ALL);
        }, "用途标签");
        purpose.classList.add("hub-row-purpose");

        const dim = el("span", "hub-row-dim ahr-image-size");
        dim.dataset.cardId = card.id;
        this.updateImageSize(dim, card);
        top.append(name, purpose, dim);

        const note = el("input", "hub-row-note");
        note.value = card.note;
        note.maxLength = 400;
        note.placeholder = "描述（选填，直接单行输入）";
        note.setAttribute("aria-label", "描述");
        note.addEventListener("input", () => { card.note = note.value; this.save(); });
        fields.append(top, note);

        const acts = el("div", "hub-row-acts");
        const toggleBtn = el("button", `ahr-btn hub-btn${card.skip ? " is-accent" : ""}`, card.skip ? "启用" : "停用");
        toggleBtn.type = "button";
        toggleBtn.title = card.skip ? "启用：加入输出并分配编号" : "停用：保留卡片，但不输出、不占编号";
        toggleBtn.addEventListener("click", event => { event.stopPropagation(); this.applyPlace("image", card.id, !card.skip, Infinity); });

        const delBtn = el("button", "ahr-icon-btn hub-icon-btn is-danger hub-row-del", "×");
        delBtn.type = "button";
        delBtn.title = "移除卡片（文件不会被删除）";
        delBtn.setAttribute("aria-label", "移除卡片");
        delBtn.addEventListener("click", event => {
            event.stopPropagation();
            removeCard(this.doc, "image", card.id);
            this.save(true);
        });
        acts.append(toggleBtn, delBtn);

        node.append(grip, thumb, fields, acts);
        this.bindImagePointerDrag(grip, node, card, "vertical");
        this.bindImagePointerDrag(thumb, node, card, "vertical");
        return node;
    }

    updateImageSize(dim, card) {
        if (!this.settings) { dim.textContent = ""; return; }
        const url = this.fileUrl(card);
        const source = this.imageSizes.get(url);
        if (!source) {
            dim.textContent = "";
            if (!this.imageSizes.has(url)) {
                this.imageSizes.set(url, null);
                const probe = new Image();
                probe.onload = () => {
                    this.imageSizes.set(url, [probe.naturalWidth, probe.naturalHeight]);
                    this.refreshImageSizes();
                };
                Promise.resolve(this.api.resolveMedia?.(url) ?? url)
                    .then(src => { probe.src = src; }, () => this.imageSizes.delete(url));
            }
            return;
        }
        const out = planImageSize(source[0], source[1], this.settings.get("target_megapixels") ?? 0.25,
            !!this.settings.get("upscale_small_images"));
        const same = out && out[0] === source[0] && out[1] === source[1];
        dim.textContent = !out ? "" : same ? `${out[0]}×${out[1]}` : `${source[0]}×${source[1]} → ${out[0]}×${out[1]}`;
        dim.title = out ? `文件：${card.filename}\n原图：${source[0]}×${source[1]}\n输出：${out[0]}×${out[1]}（${(out[0] * out[1] / 1e6).toFixed(2)} MP）` : card.filename;
    }

    refreshImageSizes() {
        const cards = new Map(splitCards(this.doc, "image").active.concat(splitCards(this.doc, "image").parked).map(card => [card.id, card]));
        this.root?.querySelectorAll(".ahr-image-size").forEach(dim => {
            const card = cards.get(dim.dataset.cardId);
            if (card) this.updateImageSize(dim, card);
        });
    }

    audioCardKey(card) {
        return `${card.type || "input"}/${card.subfolder || ""}/${card.filename}`;
    }

    isAudioTrimmed(card) {
        return Number(card.start) !== 0 || Number(card.duration) > 0;
    }

    placeAudioWithFeedback(card, skip, index) {
        const result = placeCard(this.doc, "audio", card.id, skip, index);
        if (!result.ok && result.reason === "full") {
            this.toast(`音频最多启用 ${LIMITS.audio} 个，先停用一个再启用`, true);
            return false;
        }
        this.flashCardId = card.id;
        this.save(true);
        clearTimeout(this.flashTimer);
        this.flashTimer = setTimeout(() => {
            this.flashCardId = null;
            this.root?.querySelector(".is-flash")?.classList.remove("is-flash");
        }, 760);
        const info = this.labels.get(card.id);
        const label = card.name || card.filename || "音频";
        this.toast(`已将「${label}」移至 ${info ? info.display : "停用区"}`);
        return true;
    }

    nudgeAudioCard(card, delta) {
        const { active } = splitCards(this.doc, "audio");
        const idx = active.findIndex(item => item.id === card.id);
        const next = idx + delta;
        if (idx < 0 || next < 0 || next >= active.length) return;
        this.placeAudioWithFeedback(card, false, next);
    }

    // 1D vertical pointer drag sorting for Audio tracks (same zoom-immune UX as Images).
    bindAudioPointerDrag(handleEl, cardEl, card) {
        handleEl.addEventListener("pointerdown", event => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            this.cancelPointerDrag();

            const startX = event.clientX;
            const startY = event.clientY;
            let started = false;
            let ghost = null;
            let dropTarget = null;
            let scrollRaf = 0;
            let lastY = startY;

            const clearIndicators = () => {
                this.root?.querySelectorAll(".is-drop-before, .is-drop-after, .is-drop-full").forEach(node => {
                    node.classList.remove("is-drop-before", "is-drop-after", "is-drop-full");
                    node.removeAttribute("data-drop-hint");
                });
                this.root?.querySelectorAll(".ahr-zone.is-drop").forEach(node => node.classList.remove("is-drop"));
            };

            const stopAutoScroll = () => {
                if (scrollRaf) { cancelAnimationFrame(scrollRaf); scrollRaf = 0; }
            };

            const tickAutoScroll = () => {
                scrollRaf = 0;
                if (!started || !this.body?.isConnected) return;
                const rect = this.body.getBoundingClientRect();
                const edge = 36;
                let delta = 0;
                if (lastY < rect.top + edge) delta = -Math.ceil((rect.top + edge - lastY) / 4);
                else if (lastY > rect.bottom - edge) delta = Math.ceil((lastY - (rect.bottom - edge)) / 4);
                if (delta !== 0) {
                    this.body.scrollTop += delta;
                    scrollRaf = requestAnimationFrame(tickAutoScroll);
                }
            };

            const teardown = () => {
                window.removeEventListener("pointermove", onMove, true);
                window.removeEventListener("pointerup", onUp, true);
                window.removeEventListener("pointercancel", onCancel, true);
                window.removeEventListener("keydown", onKeyDown, true);
                stopAutoScroll();
                ghost?.remove();
                ghost = null;
                clearIndicators();
                cardEl.classList.remove("is-dragging");
                if (this.root) delete this.root.dataset.dragging;
                this.pointerDragCleanup = null;
            };

            const onMove = e2 => {
                lastY = e2.clientY;
                if (!started) {
                    if (Math.hypot(e2.clientX - startX, e2.clientY - startY) < 5) return;
                    started = true;
                    cardEl.classList.add("is-dragging");
                    this.root.dataset.dragging = "audio";
                    const info = this.labels.get(card.id);
                    ghost = el("div", "hub-drag-ghost is-audio");
                    ghost.append(icon("volume-up"), el("code", "", info ? info.display : "停用"), el("span", "", card.name || card.filename || "音频"));
                    document.body.append(ghost);
                }
                e2.preventDefault();
                e2.stopPropagation();
                ghost.style.left = `${e2.clientX}px`;
                ghost.style.top = `${e2.clientY}px`;
                if (!scrollRaf) scrollRaf = requestAnimationFrame(tickAutoScroll);

                clearIndicators();
                dropTarget = null;
                const under = document.elementFromPoint(e2.clientX, e2.clientY);
                const hit = under?.closest?.(".hub-aud-card");
                if (hit && this.root.contains(hit) && hit.dataset.cardId !== card.id) {
                    const rect = hit.getBoundingClientRect();
                    const after = e2.clientY > rect.top + rect.height / 2;
                    const hitSkip = hit.dataset.skip === "true";
                    if (!hitSkip && card.skip && activeCount(this.doc, "audio") >= LIMITS.audio) {
                        hit.classList.add("is-drop-full");
                        hit.setAttribute("data-drop-hint", `启用区已满 (${LIMITS.audio}/${LIMITS.audio})`);
                    } else {
                        hit.classList.add(after ? "is-drop-after" : "is-drop-before");
                        if (!hitSkip) {
                            const act = splitCards(this.doc, "audio").active.filter(item => item.id !== card.id);
                            const tIdx = act.findIndex(item => item.id === hit.dataset.cardId);
                            const pos = tIdx < 0 ? act.length + 1 : tIdx + (after ? 2 : 1);
                            hit.setAttribute("data-drop-hint", `→ Audio ${pos}`);
                        } else {
                            hit.setAttribute("data-drop-hint", "→ 停用区");
                        }
                    }
                    dropTarget = { targetId: hit.dataset.cardId, after, skip: hitSkip };
                } else {
                    const zone = under?.closest?.(".ahr-zone");
                    if (zone && this.root.contains(zone)) {
                        const zoneSkip = zone.classList.contains("is-parked");
                        if (zoneSkip !== card.skip) {
                            zone.classList.add("is-drop");
                            dropTarget = { targetId: null, after: true, skip: zoneSkip };
                        }
                    }
                }
            };

            const onUp = e2 => {
                const wasStarted = started;
                const target = dropTarget;
                teardown();
                if (!wasStarted) return;
                e2.preventDefault();
                e2.stopPropagation();
                if (!target) return;
                if (target.targetId) {
                    const group = splitCards(this.doc, "audio")[target.skip ? "parked" : "active"].filter(item => item.id !== card.id);
                    const tIdx = group.findIndex(item => item.id === target.targetId);
                    const index = tIdx < 0 ? group.length : tIdx + (target.after ? 1 : 0);
                    this.placeAudioWithFeedback(card, target.skip, index);
                } else if (target.skip !== card.skip) {
                    this.placeAudioWithFeedback(card, target.skip, Infinity);
                }
            };

            const onCancel = () => teardown();
            const onKeyDown = e2 => {
                if (e2.key === "Escape") { e2.preventDefault(); e2.stopPropagation(); teardown(); }
            };

            this.pointerDragCleanup = teardown;
            window.addEventListener("pointermove", onMove, true);
            window.addEventListener("pointerup", onUp, true);
            window.addEventListener("pointercancel", onCancel, true);
            window.addEventListener("keydown", onKeyDown, true);
        });
    }

    syncWaveSelection(waveWrap, total, card) {
        const sel = waveWrap?.querySelector(".hub-wave-sel");
        if (!sel) return;
        if (!(total > 0)) {
            sel.hidden = true;
            waveWrap.classList.remove("is-trimmed");
            return;
        }
        const { start, end } = trimWindow(total, card.start, card.duration);
        const trimmed = start > 0.01 || end < total - 0.01;
        const leftPct = Math.max(0, Math.min(100, (start / total) * 100));
        const rightPct = Math.max(leftPct, Math.min(100, (end / total) * 100));
        sel.hidden = false;
        sel.style.left = `${leftPct}%`;
        sel.style.width = `${Math.max(0.5, rightPct - leftPct)}%`;
        sel.classList.toggle("is-trimmed", trimmed);
        waveWrap.classList.toggle("is-trimmed", trimmed);
    }

    buildAudioWaveBox(card, strip = false) {
        const waveWrap = el("div", strip ? "hub-wave-wrap is-strip" : "hub-wave-wrap");
        const wave = el("canvas", "ahr-wave");
        wave.dataset.id = card.id;

        const sel = el("div", "hub-wave-sel");
        sel.hidden = true;
        const leftHandle = el("span", "hub-wave-handle is-left");
        leftHandle.dataset.trimEdge = "start";
        leftHandle.title = "拖动微调起点";
        const rightHandle = el("span", "hub-wave-handle is-right");
        rightHandle.dataset.trimEdge = "end";
        rightHandle.title = "拖动微调终点";
        sel.append(leftHandle, rightHandle);

        const timePill = el("span", "hub-wave-time ahr-audio-info");
        timePill.dataset.info = card.id;
        waveWrap.append(wave, sel, timePill);
        return { waveWrap, wave };
    }

    // Drag waveform edges to fine-tune start/end, drag inside trimmed range to slide, drag outside to select new range, dblclick to reset.
    bindWaveScrubTrim(waveWrap, canvas, card, onSyncUi) {
        const key = this.audioCardKey(card);
        const EDGE_HIT_PX = 12;
        const MIN_TRIM_SEC = 0.1;
        const round1 = value => Math.round(value * 10) / 10;

        const detectMode = (clientX, target) => {
            const total = this.audioDurations.get(key);
            if (!total || !(total > 0)) return "scrub";
            const rect = waveWrap.getBoundingClientRect();
            if (!rect.width) return "scrub";
            const { start, end } = trimWindow(total, card.start, card.duration);
            const trimmed = start > 0.01 || end < total - 0.01;
            const leftPx = rect.left + (start / total) * rect.width;
            const rightPx = rect.left + (end / total) * rect.width;
            const distL = Math.abs(clientX - leftPx);
            const distR = Math.abs(clientX - rightPx);

            const edgeEl = target?.closest?.(".hub-wave-handle[data-trim-edge]");
            if (edgeEl) {
                if (distL <= EDGE_HIT_PX && distR <= EDGE_HIT_PX) {
                    return distL <= distR ? "start" : "end";
                }
                return edgeEl.dataset.trimEdge === "start" ? "start" : "end";
            }
            if (distL <= EDGE_HIT_PX && distL <= distR) return "start";
            if (distR <= EDGE_HIT_PX) return "end";
            if (trimmed && clientX > leftPx && clientX < rightPx) return "move";
            return "scrub";
        };

        waveWrap.addEventListener("pointermove", event => {
            if (waveWrap.classList.contains("is-scrubbing")) return;
            const hoverMode = detectMode(event.clientX, event.target);
            waveWrap.dataset.hoverMode = hoverMode;
        });
        waveWrap.addEventListener("pointerleave", () => {
            if (!waveWrap.classList.contains("is-scrubbing")) delete waveWrap.dataset.hoverMode;
        });

        waveWrap.addEventListener("dblclick", event => {
            event.preventDefault();
            event.stopPropagation();
            if (Number(card.start) === 0 && Number(card.duration) === 0) return;
            card.start = 0;
            card.duration = 0;
            onSyncUi?.();
            this.save();
            this.drawWaveform(canvas, card);
            this.toast(`已重置「${card.name || card.filename}」裁切为全长`);
        });

        waveWrap.addEventListener("pointerdown", event => {
            if (event.button !== 0) return;
            const total = this.audioDurations.get(key);
            if (!total || !(total > 0)) return;
            event.preventDefault();
            event.stopPropagation();
            this.cancelPointerDrag();

            const rect = waveWrap.getBoundingClientRect();
            if (!rect.width) return;
            const secAt = cx => Math.max(0, Math.min(total, ((cx - rect.left) / rect.width) * total));
            const startX = event.clientX;
            const t0 = secAt(startX);
            const mode = detectMode(startX, event.target);
            const orig = trimWindow(total, card.start, card.duration);
            const origOpenEnd = Number(card.duration) === 0 && orig.end >= total - 0.05;
            const windowLen = Math.max(MIN_TRIM_SEC, orig.end - orig.start);
            const moveThreshold = mode === "scrub" ? 4 : 1;
            let moved = false;

            const teardown = () => {
                window.removeEventListener("pointermove", onMove, true);
                window.removeEventListener("pointerup", onUp, true);
                window.removeEventListener("pointercancel", onCancel, true);
                waveWrap.classList.remove("is-scrubbing");
                delete waveWrap.dataset.dragMode;
                this.pointerDragCleanup = null;
            };

            const applyAt = cx => {
                const t = secAt(cx);
                if (mode === "start") {
                    const maxStart = Math.max(0, orig.end - MIN_TRIM_SEC);
                    let nextStart = Math.max(0, Math.min(maxStart, t));
                    if (nextStart <= 0.05) nextStart = 0;
                    nextStart = round1(nextStart);
                    card.start = nextStart;
                    card.duration = origOpenEnd ? 0 : Math.max(MIN_TRIM_SEC, round1(orig.end - nextStart));
                } else if (mode === "end") {
                    const minEnd = Math.min(total, orig.start + MIN_TRIM_SEC);
                    const nextEnd = Math.max(minEnd, Math.min(total, t));
                    card.start = round1(orig.start);
                    card.duration = nextEnd >= total - 0.05 ? 0 : Math.max(MIN_TRIM_SEC, round1(nextEnd - orig.start));
                } else if (mode === "move") {
                    const deltaSec = ((cx - startX) / rect.width) * total;
                    const maxStart = Math.max(0, total - windowLen);
                    let nextStart = Math.max(0, Math.min(maxStart, orig.start + deltaSec));
                    if (nextStart <= 0.05) nextStart = 0;
                    const nextEnd = Math.min(total, nextStart + windowLen);
                    card.start = round1(nextStart);
                    card.duration = nextEnd >= total - 0.05 && nextStart <= 0.05 ? 0 : Math.max(MIN_TRIM_SEC, round1(windowLen));
                } else {
                    const a = Math.min(t0, t);
                    const b = Math.max(t0, t);
                    const nextStart = a <= 0.05 ? 0 : round1(a);
                    card.start = nextStart;
                    card.duration = b >= total - 0.05 && nextStart === 0 ? 0 : Math.max(MIN_TRIM_SEC, round1(b - nextStart));
                }
                onSyncUi?.();
                this.syncWaveSelection(waveWrap, total, card);
                this.drawWaveform(canvas, card);
            };

            const onMove = e2 => {
                if (!moved) {
                    if (Math.abs(e2.clientX - startX) < moveThreshold) return;
                    moved = true;
                    waveWrap.classList.add("is-scrubbing");
                    waveWrap.dataset.dragMode = mode;
                }
                e2.preventDefault();
                e2.stopPropagation();
                applyAt(e2.clientX);
            };

            const onUp = () => {
                const didMove = moved;
                teardown();
                if (!didMove) return;
                this.save();
                this.drawWaveform(canvas, card);
                const { start, end } = trimWindow(total, card.start, card.duration);
                const verb = mode === "start" ? "已微调起点" : mode === "end" ? "已微调终点" : mode === "move" ? "已平移选区" : "已框选裁切";
                this.toast(`${verb} ${formatSeconds(start)}–${formatSeconds(end)}`);
            };

            const onCancel = () => teardown();

            this.pointerDragCleanup = teardown;
            window.addEventListener("pointermove", onMove, true);
            window.addEventListener("pointerup", onUp, true);
            window.addEventListener("pointercancel", onCancel, true);
        });
    }

    buildAudioTrimInput(card, field, label, tip, canvas, onSyncUi) {
        const wrap = el("label", "hub-aud-unit");
        wrap.title = tip;
        const input = el("input");
        input.type = "number";
        input.step = "0.1";
        if (field === "duration") input.min = "0";
        input.value = String(card[field] || 0);
        input.dataset.trimField = field;
        input.setAttribute("aria-label", label);
        input.addEventListener("change", () => {
            const value = Number(input.value);
            card[field] = Number.isFinite(value) && (field === "start" || value >= 0) ? value : 0;
            input.value = String(card[field]);
            onSyncUi?.();
            this.save();
            this.drawWaveform(canvas, card);
        });
        wrap.append(el("span", "hub-aud-unit-lbl", label), input, el("span", "hub-aud-unit-s", "s"));
        return { wrap, input };
    }

    // Scheme 1: Compact 2-Tier Audio Card (~112px tall: Row 1 controls, Row 2 waveform + inline trim, Row 3 collapsible note)
    audioCard(card, activeCards) {
        const node = el("article", `ahr-card hub-aud-card hub-aud-s1${card.skip ? " is-skipped" : ""}${this.flashCardId === card.id ? " is-flash" : ""}`);
        node.dataset.id = card.id;
        node.dataset.cardId = card.id;
        node.dataset.skip = String(!!card.skip);

        const info = this.labels.get(card.id);
        const idxInAct = card.skip ? -1 : activeCards.findIndex(item => item.id === card.id);
        const shiftedPrompt = info && info.label !== `<Audio ${info.slot + 1}>`;

        // Row 1: Grip + Play + Audio Badge + Name + Purpose + Actions
        const r1 = el("div", "hub-aud-r1");
        const grip = el("div", "hub-row-grip hub-aud-grip", "⋮⋮");
        grip.title = "按住上下拖动排序，或拖入停用区";
        grip.setAttribute("aria-label", "拖动排序");

        const play = this.audioPreviewButton(card);

        const badge = el("span", `hub-aud-badge${info ? "" : " is-off"}`);
        badge.append(el("span", "", info ? info.display : "停用"));
        if (shiftedPrompt) badge.append(el("span", "hub-aud-badge-sub", `→ ${info.label}`));
        badge.title = info ? `文件：${card.filename}\n接入 ${info.port}，提示词写 ${info.label}` : `文件：${card.filename}\n已停用`;

        const name = el("input", "ahr-name hub-img-name");
        name.value = card.name;
        name.placeholder = card.filename || "名称";
        name.title = card.filename || "";
        name.maxLength = 60;
        name.setAttribute("aria-label", "名称");
        name.addEventListener("input", () => { card.name = name.value; this.save(); });

        const purpose = select(PURPOSES.audio, card.purpose, value => {
            card.purpose = value;
            const activeFilter = this.purposeFilters.audio || FILTER_ALL;
            this.save(activeFilter !== FILTER_ALL);
        }, "用途标签");
        purpose.classList.add("hub-row-purpose");

        const acts = el("div", "hub-row-acts");
        if (!card.skip) {
            const upBtn = el("button", "ahr-btn hub-btn hub-row-nudge", "↑");
            upBtn.type = "button";
            upBtn.title = "上移一位";
            upBtn.setAttribute("aria-label", "上移一位");
            upBtn.disabled = idxInAct <= 0;
            upBtn.addEventListener("click", event => { event.stopPropagation(); this.nudgeAudioCard(card, -1); });

            const downBtn = el("button", "ahr-btn hub-btn hub-row-nudge", "↓");
            downBtn.type = "button";
            downBtn.title = "下移一位";
            downBtn.setAttribute("aria-label", "下移一位");
            downBtn.disabled = idxInAct < 0 || idxInAct >= activeCards.length - 1;
            downBtn.addEventListener("click", event => { event.stopPropagation(); this.nudgeAudioCard(card, 1); });
            acts.append(upBtn, downBtn);
        }
        const toggleBtn = el("button", `ahr-btn hub-btn${card.skip ? " is-accent" : ""}`, card.skip ? "启用" : "停用");
        toggleBtn.type = "button";
        toggleBtn.title = card.skip ? "启用：加入输出并分配编号" : "停用：保留卡片，但不输出、不占编号";
        toggleBtn.addEventListener("click", event => { event.stopPropagation(); this.applyPlace("audio", card.id, !card.skip, Infinity); });

        const delBtn = el("button", "ahr-icon-btn hub-icon-btn is-danger hub-row-del", "×");
        delBtn.type = "button";
        delBtn.title = "移除卡片（文件不会被删除）";
        delBtn.setAttribute("aria-label", "移除卡片");
        delBtn.addEventListener("click", event => {
            event.stopPropagation();
            if (this.previewAudioId === card.id) this.stopAudio();
            removeCard(this.doc, "audio", card.id);
            this.save(true);
        });
        acts.append(toggleBtn, delBtn);
        r1.append(grip, play, badge, name, purpose, acts);

        // Row 2: Interactive Scrub Waveform + Left/Right Trim Handles + Inline Start/Duration Trim
        const r2 = el("div", "hub-aud-r2");
        const { waveWrap, wave } = this.buildAudioWaveBox(card, false);

        const trimGroup = el("div", "hub-aud-trim");
        const startCtl = this.buildAudioTrimInput(card, "start", "起", "截取起始时间（秒，负数表示从结尾倒数）", wave);
        const durCtl = this.buildAudioTrimInput(card, "duration", "长", "截取时长（秒，0 表示截到结尾）", wave);
        trimGroup.append(startCtl.wrap, durCtl.wrap);
        r2.append(waveWrap, trimGroup);

        this.bindWaveScrubTrim(waveWrap, wave, card, () => {
            startCtl.input.value = String(card.start || 0);
            durCtl.input.value = String(card.duration || 0);
        });

        // Row 3: Collapsible 1-line Note Bar (click expands in-place, blur collapses)
        const r3 = el("div", "hub-aud-r3");
        const noteSlot = el("div", "hub-note-slot");
        const mountNoteBar = () => {
            const btn = el("button", `hub-note-bar${card.note ? " has-note" : ""}`);
            btn.type = "button";
            btn.title = card.note ? `${card.note}\n（点击编辑描述）` : "点击添加描述（选填）";
            btn.append(el("span", "", card.note || "+ 添加描述（选填）"));
            btn.addEventListener("click", () => {
                const ta = el("textarea", "ahr-note hub-note-edit is-audio");
                ta.value = card.note;
                ta.rows = 2;
                ta.maxLength = 400;
                ta.placeholder = "描述（选填）";
                ta.setAttribute("aria-label", "描述");
                ta.addEventListener("input", () => { card.note = ta.value; this.save(); });
                ta.addEventListener("keydown", e2 => { if (e2.key === "Escape") { e2.stopPropagation(); ta.blur(); } });
                ta.addEventListener("blur", () => mountNoteBar());
                noteSlot.replaceChildren(ta);
                ta.focus();
                ta.setSelectionRange(ta.value.length, ta.value.length);
            });
            noteSlot.replaceChildren(btn);
        };
        mountNoteBar();
        r3.append(noteSlot);

        node.append(r1, r2, r3);
        this.bindAudioPointerDrag(grip, node, card);
        return node;
    }

    // Scheme 2: Ultra-Slim DAW Track Strip (~60px collapsed; on-demand expandable Trim & Note drawer)
    audioStrip(card, activeCards) {
        const open = this.expandedAudioDrawers.has(card.id);
        const node = el("article", `ahr-card hub-aud-card hub-aud-s2${card.skip ? " is-skipped" : ""}${this.flashCardId === card.id ? " is-flash" : ""}`);
        node.dataset.id = card.id;
        node.dataset.cardId = card.id;
        node.dataset.skip = String(!!card.skip);

        const info = this.labels.get(card.id);
        const idxInAct = card.skip ? -1 : activeCards.findIndex(item => item.id === card.id);

        const strip = el("div", "hub-aud-strip");
        const grip = el("div", "hub-row-grip hub-aud-grip", "⋮⋮");
        grip.title = "按住上下拖动排序，或拖入停用区";
        grip.setAttribute("aria-label", "拖动排序");

        const play = this.audioPreviewButton(card);

        const idCol = el("div", "hub-aud-idcol");
        const idTop = el("div", "hub-aud-idtop");
        const miniBadge = el("span", `hub-aud-badge is-mini${info ? "" : " is-off"}`, info ? `A${info.slot + 1}` : "停");
        miniBadge.title = info ? `${info.display}（提示词写 ${info.label}）\n文件：${card.filename}` : `已停用\n文件：${card.filename}`;

        const name = el("input", "ahr-name hub-aud-mini-name");
        name.value = card.name;
        name.placeholder = card.filename || "名称";
        name.title = card.filename || "";
        name.maxLength = 60;
        name.setAttribute("aria-label", "名称");
        name.addEventListener("input", () => { card.name = name.value; this.save(); });
        idTop.append(miniBadge, name);

        const purpose = select(PURPOSES.audio, card.purpose, value => {
            card.purpose = value;
            const activeFilter = this.purposeFilters.audio || FILTER_ALL;
            this.save(activeFilter !== FILTER_ALL);
        }, "用途标签");
        purpose.classList.add("hub-aud-mini-purpose");
        idCol.append(idTop, purpose);

        const { waveWrap, wave } = this.buildAudioWaveBox(card, true);

        const acts = el("div", "hub-row-acts");
        const drawerBtn = el("button", "ahr-btn hub-btn hub-aud-drawer-btn");
        drawerBtn.type = "button";
        drawerBtn.title = "展开或收起精确裁切与描述设置";
        const syncDrawerBtn = () => {
            const lit = open || this.isAudioTrimmed(card) || !!card.note;
            drawerBtn.classList.toggle("is-lit", lit);
            drawerBtn.textContent = open ? "收起" : "设置";
        };
        syncDrawerBtn();
        drawerBtn.addEventListener("click", event => {
            event.stopPropagation();
            if (this.expandedAudioDrawers.has(card.id)) this.expandedAudioDrawers.delete(card.id);
            else this.expandedAudioDrawers.add(card.id);
            this.render();
        });
        acts.append(drawerBtn);

        if (!card.skip) {
            const upBtn = el("button", "ahr-btn hub-btn hub-row-nudge", "↑");
            upBtn.type = "button";
            upBtn.title = "上移一位";
            upBtn.setAttribute("aria-label", "上移一位");
            upBtn.disabled = idxInAct <= 0;
            upBtn.addEventListener("click", event => { event.stopPropagation(); this.nudgeAudioCard(card, -1); });

            const downBtn = el("button", "ahr-btn hub-btn hub-row-nudge", "↓");
            downBtn.type = "button";
            downBtn.title = "下移一位";
            downBtn.setAttribute("aria-label", "下移一位");
            downBtn.disabled = idxInAct < 0 || idxInAct >= activeCards.length - 1;
            downBtn.addEventListener("click", event => { event.stopPropagation(); this.nudgeAudioCard(card, 1); });
            acts.append(upBtn, downBtn);
        }
        const toggleBtn = el("button", `ahr-btn hub-btn${card.skip ? " is-accent" : ""}`, card.skip ? "启用" : "停");
        toggleBtn.type = "button";
        toggleBtn.title = card.skip ? "启用：加入输出并分配编号" : "停用：保留卡片，但不输出、不占编号";
        toggleBtn.addEventListener("click", event => { event.stopPropagation(); this.applyPlace("audio", card.id, !card.skip, Infinity); });

        const delBtn = el("button", "ahr-icon-btn hub-icon-btn is-danger hub-row-del", "×");
        delBtn.type = "button";
        delBtn.title = "移除卡片（文件不会被删除）";
        delBtn.setAttribute("aria-label", "移除卡片");
        delBtn.addEventListener("click", event => {
            event.stopPropagation();
            if (this.previewAudioId === card.id) this.stopAudio();
            removeCard(this.doc, "audio", card.id);
            this.save(true);
        });
        acts.append(toggleBtn, delBtn);

        strip.append(grip, play, idCol, waveWrap, acts);
        node.append(strip);

        let startCtl = null, durCtl = null;
        if (open) {
            const drawer = el("div", "hub-aud-drawer");
            startCtl = this.buildAudioTrimInput(card, "start", "起点", "截取起始时间（秒，负数表示从结尾倒数）", wave, syncDrawerBtn);
            durCtl = this.buildAudioTrimInput(card, "duration", "时长", "截取时长（秒，0 表示截到结尾）", wave, syncDrawerBtn);
            const resetBtn = el("button", "ahr-btn hub-btn hub-aud-reset", "重置全长");
            resetBtn.type = "button";
            resetBtn.title = "恢复起点 0s、时长 0s（使用整条音频）";
            resetBtn.addEventListener("click", () => {
                card.start = 0;
                card.duration = 0;
                startCtl.input.value = "0";
                durCtl.input.value = "0";
                syncDrawerBtn();
                this.save();
                this.drawWaveform(wave, card);
            });
            const note = el("input", "hub-row-note hub-aud-drawer-note");
            note.value = card.note;
            note.maxLength = 400;
            note.placeholder = "描述（选填，直接单行输入）";
            note.setAttribute("aria-label", "描述");
            note.addEventListener("input", () => { card.note = note.value; syncDrawerBtn(); this.save(); });
            drawer.append(startCtl.wrap, durCtl.wrap, resetBtn, note);
            node.append(drawer);
        }

        this.bindWaveScrubTrim(waveWrap, wave, card, () => {
            if (startCtl) startCtl.input.value = String(card.start || 0);
            if (durCtl) durCtl.input.value = String(card.duration || 0);
            syncDrawerBtn();
        });
        this.bindAudioPointerDrag(grip, node, card);
        return node;
    }

    addVideo() {
        if (activeCount(this.doc, "video") >= LIMITS.video) return this.toast(`视频已达上限 ${LIMITS.video} 个`, true);
        const beforeIds = new Set(this.doc.videos.map(v => v.id));
        addCards(this.doc, "video", [{ source: "segments", project: DEFAULT_PROJECT, segment_id: null,
            use_audio: false, max_side: 0 }]);
        const added = this.doc.videos.find(v => !beforeIds.has(v.id));
        if (added) this.expandedVideoDrawers.add(added.id);
        this.doc.ui.page = "video";
        this.purposeFilters.video = FILTER_ALL;
        this.save(true);
    }

    placeVideoWithFeedback(card, skip, index) {
        const result = placeCard(this.doc, "video", card.id, skip, index);
        if (!result.ok && result.reason === "full") {
            this.toast(`视频最多启用 ${LIMITS.video} 个，先停用一个再启用`, true);
            return false;
        }
        this.flashCardId = card.id;
        this.save(true);
        clearTimeout(this.flashTimer);
        this.flashTimer = setTimeout(() => {
            this.flashCardId = null;
            this.root?.querySelector(".is-flash")?.classList.remove("is-flash");
        }, 760);
        const info = this.labels.get(card.id);
        const label = card.name || card.view?.title || "视频";
        this.toast(`已将「${label}」移至 ${info ? info.display : "停用区"}`);
        return true;
    }

    nudgeVideoCard(card, delta) {
        const { active } = splitCards(this.doc, "video");
        const idx = active.findIndex(item => item.id === card.id);
        const next = idx + delta;
        if (idx < 0 || next < 0 || next >= active.length) return;
        this.placeVideoWithFeedback(card, false, next);
    }

    // 1D vertical pointer drag sorting for Video tracks (unified with Image & Audio).
    bindVideoPointerDrag(handleEl, cardEl, card) {
        handleEl.addEventListener("pointerdown", event => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            this.cancelPointerDrag();

            const startX = event.clientX;
            const startY = event.clientY;
            let started = false;
            let ghost = null;
            let dropTarget = null;
            let scrollRaf = 0;
            let lastY = startY;

            const clearIndicators = () => {
                this.root?.querySelectorAll(".is-drop-before, .is-drop-after, .is-drop-full").forEach(node => {
                    node.classList.remove("is-drop-before", "is-drop-after", "is-drop-full");
                    node.removeAttribute("data-drop-hint");
                });
                this.root?.querySelectorAll(".ahr-zone.is-drop").forEach(node => node.classList.remove("is-drop"));
            };

            const stopAutoScroll = () => {
                if (scrollRaf) { cancelAnimationFrame(scrollRaf); scrollRaf = 0; }
            };

            const tickAutoScroll = () => {
                scrollRaf = 0;
                if (!started || !this.body?.isConnected) return;
                const rect = this.body.getBoundingClientRect();
                const edge = 36;
                let delta = 0;
                if (lastY < rect.top + edge) delta = -Math.ceil((rect.top + edge - lastY) / 4);
                else if (lastY > rect.bottom - edge) delta = Math.ceil((lastY - (rect.bottom - edge)) / 4);
                if (delta !== 0) {
                    this.body.scrollTop += delta;
                    scrollRaf = requestAnimationFrame(tickAutoScroll);
                }
            };

            const teardown = () => {
                window.removeEventListener("pointermove", onMove, true);
                window.removeEventListener("pointerup", onUp, true);
                window.removeEventListener("pointercancel", onCancel, true);
                window.removeEventListener("keydown", onKeyDown, true);
                stopAutoScroll();
                ghost?.remove();
                ghost = null;
                clearIndicators();
                cardEl.classList.remove("is-dragging");
                if (this.root) delete this.root.dataset.dragging;
                this.pointerDragCleanup = null;
            };

            const onMove = e2 => {
                lastY = e2.clientY;
                if (!started) {
                    if (Math.hypot(e2.clientX - startX, e2.clientY - startY) < 5) return;
                    started = true;
                    cardEl.classList.add("is-dragging");
                    this.root.dataset.dragging = "video";
                    const info = this.labels.get(card.id);
                    ghost = el("div", "hub-drag-ghost is-video");
                    if (card.view?.cover_url) {
                        const thumb = el("img");
                        thumb.src = this.url(card.view.cover_url);
                        thumb.alt = "";
                        ghost.append(thumb);
                    } else {
                        ghost.append(icon("video"));
                    }
                    ghost.append(el("code", "", info ? info.display : "停用"), el("span", "", card.name || card.view?.title || "视频"));
                    document.body.append(ghost);
                }
                e2.preventDefault();
                e2.stopPropagation();
                ghost.style.left = `${e2.clientX}px`;
                ghost.style.top = `${e2.clientY}px`;
                if (!scrollRaf) scrollRaf = requestAnimationFrame(tickAutoScroll);

                clearIndicators();
                dropTarget = null;
                const under = document.elementFromPoint(e2.clientX, e2.clientY);
                const hit = under?.closest?.(".hub-vid-card");
                if (hit && this.root.contains(hit) && hit.dataset.cardId !== card.id) {
                    const rect = hit.getBoundingClientRect();
                    const after = e2.clientY > rect.top + rect.height / 2;
                    const hitSkip = hit.dataset.skip === "true";
                    if (!hitSkip && card.skip && activeCount(this.doc, "video") >= LIMITS.video) {
                        hit.classList.add("is-drop-full");
                        hit.setAttribute("data-drop-hint", `启用区已满 (${LIMITS.video}/${LIMITS.video})`);
                    } else {
                        hit.classList.add(after ? "is-drop-after" : "is-drop-before");
                        if (!hitSkip) {
                            const act = splitCards(this.doc, "video").active.filter(item => item.id !== card.id);
                            const tIdx = act.findIndex(item => item.id === hit.dataset.cardId);
                            const pos = tIdx < 0 ? act.length + 1 : tIdx + (after ? 2 : 1);
                            hit.setAttribute("data-drop-hint", `→ Video ${pos}`);
                        } else {
                            hit.setAttribute("data-drop-hint", "→ 停用区");
                        }
                    }
                    dropTarget = { targetId: hit.dataset.cardId, after, skip: hitSkip };
                } else {
                    const zone = under?.closest?.(".ahr-zone");
                    if (zone && this.root.contains(zone)) {
                        const zoneSkip = zone.classList.contains("is-parked");
                        if (zoneSkip !== card.skip) {
                            zone.classList.add("is-drop");
                            dropTarget = { targetId: null, after: true, skip: zoneSkip };
                        }
                    }
                }
            };

            const onUp = e2 => {
                const wasStarted = started;
                const target = dropTarget;
                teardown();
                if (!wasStarted) return;
                e2.preventDefault();
                e2.stopPropagation();
                if (!target) return;
                if (target.targetId) {
                    const group = splitCards(this.doc, "video")[target.skip ? "parked" : "active"].filter(item => item.id !== card.id);
                    const tIdx = group.findIndex(item => item.id === target.targetId);
                    const index = tIdx < 0 ? group.length : tIdx + (target.after ? 1 : 0);
                    this.placeVideoWithFeedback(card, target.skip, index);
                } else if (target.skip !== card.skip) {
                    this.placeVideoWithFeedback(card, target.skip, Infinity);
                }
            };

            const onCancel = () => teardown();
            const onKeyDown = e2 => {
                if (e2.key === "Escape") { e2.preventDefault(); e2.stopPropagation(); teardown(); }
            };

            this.pointerDragCleanup = teardown;
            window.addEventListener("pointermove", onMove, true);
            window.addEventListener("pointerup", onUp, true);
            window.addEventListener("pointercancel", onCancel, true);
            window.addEventListener("keydown", onKeyDown, true);
        });
    }

    async ensureVideoView(card) {
        if (!card.segment_id || (card.view?.cover_url && card.view?.has_audio !== undefined)) return;
        const guardKey = `${card.id}:${card.source}:${card.project}:${card.segment_id}`;
        this.hydratingVideos ||= new Set();
        if (this.hydratingVideos.has(guardKey)) return;
        this.hydratingVideos.add(guardKey);
        try {
            const items = await this.library(card);
            if (this.disposed) return;
            const { record } = matchLibrary(card, items);
            if (record) {
                card.segment_id = record.segment_id;
                card.key = libraryKey(card.source, record);
                card.view = this.viewFor(card, record);
                this.save(true);
            }
        } catch {
            // Leave card untouched; user can open drawer to inspect error or refresh.
        } finally {
            this.hydratingVideos.delete(guardKey);
        }
    }

    // ---------- Scheme 2: Ultra-Slim Video Track Strip (~82px) + On-Demand Pick & Settings Drawer ----------
    videoCard(card, activeCards = splitCards(this.doc, "video").active) {
        const open = this.expandedVideoDrawers.has(card.id);
        const node = el("article", `ahr-card hub-vid-card${card.skip ? " is-skipped" : ""}${this.flashCardId === card.id ? " is-flash" : ""}`);
        node.dataset.id = card.id;
        node.dataset.cardId = card.id;
        node.dataset.skip = String(!!card.skip);

        const uploading = this.uploading?.get(card.id);
        const canPreview = !uploading && card.view?.video_url;
        const preview = () => this.openPreview("video", this.url(card.view.video_url), card.view.title);
        const labelInfo = this.labels.get(card.id);
        const idxInAct = card.skip ? -1 : activeCards.findIndex(item => item.id === card.id);
        const silent = card.view?.has_audio === false;

        if (!open && card.segment_id && !card.view?.cover_url) {
            this.ensureVideoView(card);
        }

        // Main Ultra-Slim Track Strip (~80px)
        const stripRow = el("div", "hub-vid-strip");

        const grip = el("div", "hub-row-grip hub-vid-grip", "⋮⋮");
        grip.title = "按住上下拖动排序，或拖入停用区";
        grip.setAttribute("aria-label", "拖动排序");

        // Compact 16:9 Thumbnail Cover (supports click-to-play & drag-drop video upload when in uploads pool)
        const cover = el("div", "ahr-video-cover hub-vid-cover");
        if (card.view?.cover_url) {
            const image = el("img");
            image.src = this.url(card.view.cover_url);
            image.alt = card.view.title || "";
            image.loading = "lazy";
            image.draggable = false;
            cover.append(image, el("div", "hub-media-scrim"));
        } else if (card.source !== "uploads") {
            const emptyCover = el("div", "hub-vid-empty");
            emptyCover.append(icon("video"), el("span", "", "未选片"));
            cover.append(emptyCover);
        }
        if (uploading) {
            cover.classList.add("is-uploading");
            const busy = el("div", "ahr-upload-busy");
            busy.append(icon("spin pi-spinner"), el("span", "", uploading));
            cover.append(busy);
        } else if (card.source === "uploads") {
            this.makeUploadTarget(cover, card, !card.view?.cover_url);
        }
        if (canPreview) {
            const play = el("span", "hub-vid-play");
            play.append(icon("play"));
            cover.append(play);
            cover.addEventListener("click", preview);
            cover.title = `点击播放 ${card.view.title || ""}`;
        } else if (card.source !== "uploads" && !card.segment_id) {
            cover.addEventListener("click", () => {
                this.expandedVideoDrawers.add(card.id);
                this.render();
            });
            cover.title = "点击展开选片胶片条";
        }

        const miniBadge = el("span", `hub-vid-badge${labelInfo ? "" : " is-off"}`, labelInfo ? `V${labelInfo.slot + 1}` : "停");
        miniBadge.title = labelInfo ? `${labelInfo.display}（提示词写 ${labelInfo.label}）` : "已停用";
        cover.append(miniBadge);

        const result = this.results.get(card.id);
        const shortDur = card.view?.facts ? card.view.facts.split(" · ")[0] : "";
        const coverTag = result?.frames ? `${result.frames}帧` : shortDur;
        if (coverTag) cover.append(el("span", "hub-vid-dur", coverTag));

        // Middle Info Column: Top (Name + Purpose + 1-click Audio Toggle), Bottom (Source/Clip/Note Summary)
        const mid = el("div", "hub-vid-mid");
        const topRow = el("div", "hub-vid-top");

        const name = el("input", "ahr-name hub-img-name");
        name.value = card.name;
        name.placeholder = card.view?.title || "视频名称";
        name.title = card.view?.title || "";
        name.maxLength = 60;
        name.setAttribute("aria-label", "名称");
        name.addEventListener("input", () => { card.name = name.value; this.save(); });

        const purpose = select(PURPOSES.video, card.purpose, value => {
            card.purpose = value;
            const activeFilter = this.purposeFilters.video || FILTER_ALL;
            this.save(activeFilter !== FILTER_ALL);
        }, "用途标签");
        purpose.classList.add("hub-row-purpose");

        topRow.append(name, purpose);

        const subRow = el("div", "hub-vid-sub");
        const poolShort = card.source === "uploads" ? "投放池" : "裁切池";
        subRow.append(el("span", "hub-vid-src", `${poolShort} · ${card.project}`));
        if (card.use_audio) {
            const audioTag = silent
                ? "静音原声"
                : (labelInfo?.audioLabel ? `原声 → ${labelInfo.audioLabel.replace(/[<>]/g, "")}` : "携带原声");
            const pill = el("span", `hub-vid-audio-pill${silent ? " is-warn" : ""}`);
            pill.append(icon(silent ? "exclamation-triangle" : "volume-up"), el("span", "", audioTag));
            subRow.append(pill);
        }
        const factsFull = [
            card.segment_id ? `#${card.segment_id}` : "待选片",
            card.view?.facts || "",
            result?.frames ? `${result.frames} 帧 · ${result.size[0]}×${result.size[1]}` : "",
        ].filter(Boolean).join(" · ");
        subRow.append(el("span", "hub-vid-facts", factsFull));
        if (card.note) subRow.append(el("span", "hub-vid-note-preview", card.note));
        mid.append(topRow, subRow);

        // Right Actions: Compact fixed-width Pick/Collapse + Pause/Enable + Remove (zero wrapping/jumping)
        const acts = el("div", "hub-row-acts");
        const drawerBtn = el("button", `ahr-btn hub-btn hub-vid-drawer-btn${open || !card.segment_id ? " is-lit" : ""}`);
        drawerBtn.type = "button";
        drawerBtn.title = open ? "收起选片与设置抽屉" : "展开选片、原声开关、来源池与描述";
        drawerBtn.append(el("span", "", open ? "收起" : "选片"), icon(open ? "chevron-up" : "chevron-down"));
        drawerBtn.addEventListener("click", event => {
            event.stopPropagation();
            if (this.expandedVideoDrawers.has(card.id)) this.expandedVideoDrawers.delete(card.id);
            else this.expandedVideoDrawers.add(card.id);
            this.render();
        });
        acts.append(drawerBtn);

        const toggleBtn = el("button", `ahr-btn hub-btn${card.skip ? " is-accent" : ""}`, card.skip ? "启用" : "停");
        toggleBtn.type = "button";
        toggleBtn.title = card.skip ? "启用：加入输出并分配编号" : "停用：保留卡片，但不输出、不占编号";
        toggleBtn.addEventListener("click", event => { event.stopPropagation(); this.applyPlace("video", card.id, !card.skip, Infinity); });

        const delBtn = el("button", "ahr-icon-btn hub-icon-btn is-danger hub-row-del", "×");
        delBtn.type = "button";
        delBtn.title = "移除卡片（文件不会被删除）";
        delBtn.setAttribute("aria-label", "移除卡片");
        delBtn.addEventListener("click", event => {
            event.stopPropagation();
            this.expandedVideoDrawers.delete(card.id);
            removeCard(this.doc, "video", card.id);
            this.save(true);
        });
        acts.append(toggleBtn, delBtn);

        topRow.append(acts);
        stripRow.append(grip, cover, mid);
        node.append(stripRow);

        // Expandable Drawer: Source Pool + Project Library + Independent Audio Button + Upload/Size + Note + Filmstrip
        if (open) {
            const drawer = el("div", "hub-vid-drawer");

            const srcRow = el("div", "hub-vid-drawer-row");
            const poolSeg = el("div", "hub-seg");
            poolSeg.setAttribute("role", "radiogroup");
            poolSeg.setAttribute("aria-label", "视频来源池");
            for (const [value, text, tip] of [
                ["segments", "裁切片段池", "来自 Long Video / Smart Split 的裁切片段库"],
                ["uploads", "投放视频池", "自己上传投放的完整参考视频"],
            ]) {
                const btn = el("button", "", text);
                btn.type = "button";
                btn.title = tip;
                btn.setAttribute("role", "radio");
                btn.setAttribute("aria-checked", String(card.source === value));
                btn.addEventListener("click", () => {
                    if (card.source === value) return;
                    Object.assign(card, { source: value, segment_id: null, key: "", view: null });
                    this.expandedVideoDrawers.add(card.id);
                    this.save(true);
                });
                poolSeg.append(btn);
            }
            srcRow.append(poolSeg);

            const poolName = card.source === "uploads" ? "投放视频" : "裁切片段";
            const browse = el("button", "ahr-btn hub-btn hub-vlib-btn hub-vid-drawer-ctl");
            browse.type = "button";
            browse.title = `打开${poolName}库（封面、正/倒序内容预览、重命名、删除）`;
            browse.setAttribute("aria-label", `打开${poolName}库`);
            browse.append(icon("folder-open"), el("span", "", card.project), icon("chevron-right"));
            browse.addEventListener("click", event => { event.stopPropagation(); this.openVideoLibrary(card); });
            srcRow.append(browse);

            srcRow.append(iconButton("refresh", "刷新素材库", () => {
                this.libraries.delete(`${card.source}:${card.project}`);
                this.projects.delete(card.source);
                this.render();
            }, "hub-icon-btn hub-vid-drawer-ico"));

            const audioBtn = el("button", `ahr-btn hub-btn hub-vid-drawer-ctl hub-vid-audio-btn${card.use_audio ? (silent ? " is-warn" : " is-on") : ""}`);
            audioBtn.type = "button";
            audioBtn.setAttribute("aria-pressed", String(!!card.use_audio));
            if (silent && !card.use_audio) {
                audioBtn.disabled = true;
                audioBtn.title = "这段视频没有音轨";
                audioBtn.append(icon("volume-off"), el("span", "", "无音轨"));
            } else if (silent && card.use_audio) {
                audioBtn.title = "这段视频没有音轨，开启只会送入静音，点击关闭";
                audioBtn.append(icon("exclamation-triangle"), el("span", "", "静音原声（关闭）"));
            } else if (card.use_audio) {
                const audioLbl = labelInfo?.audioLabel ? ` → ${labelInfo.audioLabel.replace(/[<>]/g, "")}` : "";
                audioBtn.title = `已携带视频原声（${labelInfo?.audioDisplay || "Video Audio"}，提示词写 ${labelInfo?.audioLabel || "<Audio>"}）· 点击关闭`;
                audioBtn.append(icon("volume-up"), el("span", "", `携带原声${audioLbl}`));
            } else {
                audioBtn.title = "点击携带视频原声（将占用一个 Audio 编号）";
                audioBtn.append(icon("volume-off"), el("span", "", "携带原声"));
            }
            audioBtn.addEventListener("click", event => {
                event.stopPropagation();
                if (silent && !card.use_audio) return;
                card.use_audio = !card.use_audio;
                this.save(true);
            });
            srcRow.append(audioBtn);

            if (card.source === "uploads") {
                srcRow.append(textButton("投放视频", "upload", () => this.uploadVideo(card), "hub-btn hub-vid-drawer-ctl"));
                const current = card.max_side || 0;
                const known = VIDEO_SIZES.some(([value]) => value === current);
                const preset = this.customVideoSides.has(card.id) || !known ? "custom" : current;
                const sizeSel = select(VIDEO_SIZES, preset, value => {
                    if (value === "custom") {
                        this.customVideoSides.add(card.id);
                        card.max_side = customVideoSide(current || 1024);
                    } else {
                        this.customVideoSides.delete(card.id);
                        card.max_side = Number(value);
                    }
                    this.save(true);
                }, "输出尺寸");
                sizeSel.classList.add("hub-vsize-sel");
                srcRow.append(sizeSel);
                if (preset === "custom") {
                    const unit = el("span", "hub-unit hub-vid-unit");
                    const custom = el("input");
                    Object.assign(custom, { type: "number", min: "64", max: "8192", step: "32", value: String(card.max_side) });
                    custom.setAttribute("aria-label", "自定义最长边");
                    custom.title = "最长边（像素），按 32 对齐";
                    custom.addEventListener("change", () => {
                        card.max_side = customVideoSide(custom.value);
                        this.save(true);
                    });
                    unit.append(custom, el("span", "", "px"));
                    const [width, height] = decodedVideoSize(card.view?.width, card.view?.height, card.max_side);
                    const output = width && height ? `输出 ${width}×${height}` : "选片后显示尺寸";
                    srcRow.append(unit, el("span", "ahr-video-output-size", output));
                }
            }

            const noteRow = el("div", "hub-vid-drawer-row");
            const noteInput = el("input", "hub-row-note hub-vid-drawer-note");
            noteInput.value = card.note;
            noteInput.maxLength = 400;
            noteInput.placeholder = "描述（选填，直接单行输入）";
            noteInput.setAttribute("aria-label", "描述");
            noteInput.addEventListener("input", () => {
                card.note = noteInput.value;
                const previewSpan = subRow.querySelector(".hub-vid-note-preview");
                if (card.note) {
                    if (previewSpan) previewSpan.textContent = card.note;
                    else subRow.append(el("span", "hub-vid-note-preview", card.note));
                } else {
                    previewSpan?.remove();
                }
                this.save();
            });
            noteRow.append(noteInput);

            const stripHead = el("div", "hub-vstrip-head");
            const stripLabel = el("span", "", `快捷选片 · ${card.project}`);
            stripHead.append(stripLabel, el("span", "hub-vid-strip-tip", "点击缩略图直接装配"));
            const strip = el("div", "ahr-strip");
            this.fillStrip(strip, card, stripLabel);

            drawer.append(srcRow, noteRow, stripHead, strip);
            node.append(drawer);
        }

        this.bindVideoPointerDrag(grip, node, card);
        return node;
    }

    async fetchJson(path, options) {
        const response = await this.api.fetchApi(path, { cache: "no-store", ...options });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const err = new Error(data.error || `请求失败（${response.status}）`);
            err.status = response.status;
            throw err;
        }
        return data;
    }

    library(card) {
        const key = `${card.source}:${card.project}`;
        if (!this.libraries.has(key)) {
            const path = card.source === "uploads"
                ? `/amiaomiao_h3/lvm/uploads?project=${encodeURIComponent(card.project)}`
                : `/amiaomiao_h3/lvm/segments?project=${encodeURIComponent(card.project)}`;
            const request = this.fetchJson(path).then(data => (card.source === "uploads" ? data.videos : data.segments) || []);
            request.catch(() => this.libraries.delete(key));
            this.libraries.set(key, request);
        }
        return this.libraries.get(key);
    }

    viewFor(card, item) {
        const seconds = Number(item.duration_sec) || (item.frames ? item.frames / (item.fps || 24) : 0);
        const size = item.width && item.height ? `${item.width}×${item.height}` : "";
        return {
            title: item.original_name || item.label || item.tag || `#${item.segment_id}`,
            cover_url: item.cover_url || item.thumbnail_url || "",
            video_url: card.source === "uploads" ? (item.browser_preview ? item.video_url : "") : (item.mp4_url || ""),
            has_audio: item.has_audio == null ? null : !!item.has_audio,
            width: Number(item.width) || 0,
            height: Number(item.height) || 0,
            facts: [seconds ? `${seconds.toFixed(1)} 秒` : "", size, item.has_audio ? "有声" : "无声"].filter(Boolean).join(" · "),
        };
    }

    async fillStrip(strip, card, countLabel = null) {
        strip.append(el("div", "ahr-strip-note", "读取中…"));
        let items;
        try {
            items = await this.library(card);
        } catch (error) {
            strip.replaceChildren(el("div", "ahr-strip-note is-error", error.message));
            return;
        }
        if (countLabel?.isConnected) countLabel.textContent = `快捷选片 · ${card.project}（${items.length} 项）`;
        let lost = false;
        if (card.segment_id) {
            const { record, moved } = matchLibrary(card, items);
            if (!record) {
                lost = true;
            } else if (moved || !card.key || !card.view || card.view.has_audio === undefined
                    || !card.view.width || !card.view.height) {
                const note = record.segment_id !== card.segment_id
                    ? `素材库编号已变化，已找回原视频（#${card.segment_id} → #${record.segment_id}）` : "";
                card.segment_id = record.segment_id;
                card.key = libraryKey(card.source, record);
                card.view = this.viewFor(card, record);
                this.save(true);
                if (note) this.toast(note);
                return;
            }
        }
        if (!items.length) {
            strip.replaceChildren(el("div", "ahr-strip-note", card.source === "uploads" ? "这个素材库还没有视频" : "这个素材库还没有裁切片段"));
            return;
        }
        const options = items.map(item => {
            const option = el("div", "ahr-strip-item");
            option.setAttribute("role", "button");
            option.tabIndex = 0;
            option.title = this.viewFor(card, item).title;
            option.setAttribute("aria-pressed", String(!lost && item.segment_id === card.segment_id));
            const cover = item.cover_url || item.thumbnail_url;
            if (cover) {
                const image = el("img");
                image.src = this.url(cover);
                image.alt = "";
                image.loading = "lazy";
                image.draggable = false;
                option.append(image);
            }
            option.append(el("span", "ahr-strip-id", `#${item.segment_id}`));
            const choose = () => {
                card.segment_id = item.segment_id;
                card.key = libraryKey(card.source, item);
                card.view = this.viewFor(card, item);
                if (!card.name) card.name = card.view.title.replace(/\.[^.]+$/, "").slice(0, 60);
                this.save(true);
            };
            option.addEventListener("click", choose);
            option.addEventListener("keydown", event => {
                if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(); }
            });
            if (card.source === "uploads") {
                const remove = iconButton("trash", "从投放视频库删除", () => this.confirmDeleteUpload(option, card, item), "is-danger ahr-strip-delete");
                option.append(remove);
            }
            return option;
        });
        strip.replaceChildren(...(lost ? [el("div", "ahr-strip-note is-error", "原来选的视频已不在库中，请重新选择")] : []), ...options);
        const chosen = strip.querySelector('[aria-pressed="true"]');
        if (chosen) strip.scrollLeft = Math.max(0, chosen.offsetLeft - (strip.clientWidth - chosen.offsetWidth) / 2);
    }

    confirmDeleteUpload(option, card, item) {
        const confirm = el("div", "ahr-strip-confirm");
        confirm.setAttribute("role", "group");
        confirm.setAttribute("aria-label", "确认删除投放视频");
        const yes = textButton("删除", "trash", () => this.deleteUpload(card, item), "is-danger-solid");
        const no = textButton("取消", "", () => confirm.remove());
        confirm.append(yes, no);
        confirm.addEventListener("click", event => event.stopPropagation());
        confirm.addEventListener("keydown", event => {
            event.stopPropagation();
            if (event.key === "Escape") confirm.remove();
        });
        option.querySelector(".ahr-strip-confirm")?.remove();
        option.append(confirm);
        no.focus();
    }

    async deleteUpload(card, item) {
        try {
            await this.fetchJson("/amiaomiao_h3/lvm/uploads/delete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ project: card.project, segment_id: item.segment_id }),
            });
            const deletedKey = libraryKey("uploads", item);
            for (const video of this.doc.videos) {
                if (video.source !== "uploads" || video.project !== card.project) continue;
                if (video.key === deletedKey || (!video.key && video.segment_id === item.segment_id)) {
                    Object.assign(video, { segment_id: 0, key: "", view: null });
                }
            }
            this.libraries.delete(`uploads:${card.project}`);
            this.projects.delete("uploads");
            this.save(true);
            this.toast("已从投放视频库删除");
        } catch (error) {
            this.toast(`删除失败：${error.message}`, true);
        }
    }

    uploadVideo(card) {
        const input = el("input");
        input.type = "file";
        input.accept = "video/*,.mp4,.mov,.mkv,.webm,.avi,.m4v";
        input.addEventListener("change", () => { if (input.files?.[0]) this.importVideo(card, input.files[0]); });
        input.click();
    }

    // The cover of an upload-pool card is where a video goes: click to pick, or drop a file.
    makeUploadTarget(cover, card, empty) {
        cover.classList.add("is-upload-target");
        if (empty) {
            const hint = el("div", "ahr-upload-hint");
            hint.append(icon("upload"), el("strong", "", "投放视频"), el("small", "", "点击选择，或把视频拖到这里"));
            cover.append(hint);
            cover.addEventListener("click", () => this.uploadVideo(card));
            cover.setAttribute("role", "button");
            cover.tabIndex = 0;
            cover.setAttribute("aria-label", "投放视频");
            cover.addEventListener("keydown", event => {
                if (event.target === cover && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); this.uploadVideo(card); }
            });
        } else {
            const replace = el("div", "ahr-upload-replace");
            replace.append(icon("upload"), el("span", "", "松开即投放并替换"));
            cover.append(replace);
        }
        cover.dataset.fileDrop = "";
        cover.addEventListener("dragover", event => {
            if (!event.dataTransfer?.types.includes("Files")) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "copy";
        });
        cover.addEventListener("drop", event => {
            if (!event.dataTransfer?.types.includes("Files")) return;
            event.preventDefault();
            event.stopPropagation();
            const file = [...event.dataTransfer.files].find(item => mediaKind(item.name) === "video");
            if (!file) return this.toast("这里只能放视频文件（mp4 / mov / mkv / webm / avi / m4v）", true);
            this.importVideo(card, file);
        });
    }

    async importVideo(card, file) {
        if (this.uploading?.has(card.id)) return;
        this.uploading ||= new Map();
        this.uploading.set(card.id, `正在投放 ${file.name}`);
        this.render();
        let message = "已投放", failed = false;
        try {
            const form = new FormData();
            form.append("project", card.project);
            form.append("file", file);
            const record = await this.fetchJson("/amiaomiao_h3/lvm/uploads/import", { method: "POST", body: form });
            this.libraries.delete(`uploads:${card.project}`);
            this.projects.delete("uploads");
            const items = await this.library(card);
            const item = items.find(row => row.segment_id === record.segment_id) || record;
            card.segment_id = record.segment_id;
            card.key = libraryKey(card.source, item);
            card.view = this.viewFor(card, item);
            if (!card.name) card.name = nameFromFile(file.name);
        } catch (error) {
            message = error.message;
            failed = true;
        } finally {
            this.uploading.delete(card.id);
            this.save(true);
            this.toast(message, failed);
        }
    }

    // ---------- files ----------
    pickFiles(kind) {
        const input = el("input");
        input.type = "file";
        input.multiple = true;
        input.accept = kind === "image" ? "image/*" : "audio/*,.wav,.mp3,.m4a,.flac,.ogg,.opus";
        input.addEventListener("change", () => this.importFiles([...input.files], kind));
        input.click();
    }

    async importFiles(files, forcedKind) {
        if (this.projectOperation || this.disposed) {
            this.toast("项目正在切换，请稍后再添加素材。", true);
            return;
        }
        this.pendingImports += 1;
        try {
            await this.importReferenceFiles(files, forcedKind, this.doc);
        } finally {
            this.pendingImports -= 1;
        }
    }

    async importReferenceFiles(files, forcedKind, doc) {
        const groups = { image: [], audio: [] };
        let ignored = 0;
        for (const file of files) {
            const kind = forcedKind || mediaKind(file.name);
            if (groups[kind]) groups[kind].push(file); else ignored += 1;
        }
        let added = 0, parked = 0;
        for (const kind of ["image", "audio"]) {
            const cards = [];
            for (const file of groups[kind]) {
                if (this.disposed || this.doc !== doc) return;
                try {
                    cards.push(await this.uploadFile(file, kind));
                } catch (error) {
                    this.toast(error.message, true);
                }
            }
            if (this.disposed || this.doc !== doc) return;
            if (cards.length) {
                parked += addCards(this.doc, kind, cards);
                added += cards.length;
                this.purposeFilters[kind] = FILTER_ALL;
            }
        }
        if (added) {
            if (!groups[this.doc.ui.page]?.length) this.doc.ui.page = groups.image.length ? "image" : "audio";
            this.save(true);
            this.toast(parked ? `已添加 ${added} 个，其中 ${parked} 个超出上限已停用` : `已添加 ${added} 个`);
        } else if (ignored) {
            this.toast("视频请拖到「投放视频池」视频卡的左侧封面区", true);
        }
    }

    async uploadFile(file, kind) {
        const form = new FormData();
        const subfolder = `${UPLOAD_ROOT}/${kind}/${projectFolder(this.refProject(kind))}`;
        form.append("image", file);
        form.append("subfolder", subfolder);
        form.append("type", "input");
        const response = await this.api.fetchApi("/upload/image", { method: "POST", body: form });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.name) throw new Error(`上传失败：${file.name}`);
        const card = { filename: data.name, subfolder: data.subfolder || subfolder, type: data.type || "input",
            name: nameFromFile(file.name) };
        if (kind === "audio") Object.assign(card, { start: 0, duration: 0 });
        return card;
    }

    setFileHover(target = null) {
        if (this.fileHoverTarget !== target) {
            this.fileHoverTarget?.classList.remove("is-drop");
            this.fileHoverTarget = target;
            if (target !== this.root) target?.classList.add("is-drop");
        }
        this.root.classList.toggle("is-file-over", target === this.root);
    }

    bindDrop() {
        const updateHover = event => {
            if (!event.dataTransfer?.types.includes("Files")) return;
            const target = event.target.closest?.("[data-file-drop]");
            this.setFileHover(target && this.root.contains(target) ? target : this.root);
        };
        this.root.addEventListener("dragenter", updateHover, true);
        this.root.addEventListener("dragover", updateHover, true);
        this.root.addEventListener("drop", () => this.setFileHover(), true);
        this.root.addEventListener("dragover", event => {
            if (!event.dataTransfer?.types.includes("Files")) return;
            event.preventDefault();
            event.stopPropagation();
        });
        this.root.addEventListener("dragleave", event => {
            if (!this.root.contains(event.relatedTarget)) this.setFileHover();
        });
        this.root.addEventListener("drop", event => {
            if (!event.dataTransfer?.files?.length) return;
            event.preventDefault();
            event.stopPropagation();
            this.importFiles([...event.dataTransfer.files]);
        });
    }

    // ---------- audio ----------
    async peaks(card) {
        const key = `${card.type}/${card.subfolder}/${card.filename}`;
        if (!peakCache.has(key)) {
            peakCache.set(key, (async () => {
                const url = this.fileUrl(card);
                const response = await fetch(await (this.api.resolveMedia?.(url) ?? url));
                const buffer = await response.arrayBuffer();
                const context = new (window.AudioContext || window.webkitAudioContext)();
                try {
                    const audio = await context.decodeAudioData(buffer);
                    const data = audio.getChannelData(0);
                    const bins = 240, size = Math.max(1, Math.floor(data.length / bins));
                    const values = [];
                    for (let i = 0; i < bins; i++) {
                        let peak = 0;
                        for (let j = i * size; j < Math.min(data.length, (i + 1) * size); j += 16) peak = Math.max(peak, Math.abs(data[j]));
                        values.push(peak);
                    }
                    return { values, duration: audio.duration, rate: audio.sampleRate, channels: audio.numberOfChannels };
                } finally {
                    context.close?.();
                }
            })());
            peakCache.get(key).catch(() => peakCache.delete(key));
        }
        return peakCache.get(key);
    }

    drawWaveforms() {
        for (const canvas of this.root.querySelectorAll("canvas.ahr-wave")) {
            const card = this.doc.audios.find(item => item.id === canvas.dataset.id);
            if (card) this.drawWaveform(canvas, card);
        }
    }

    async drawWaveform(canvas, card) {
        let data;
        try { data = await this.peaks(card); } catch { return; }
        this.audioDurations.set(this.audioCardKey(card), data.duration);
        if (!canvas.isConnected) return;
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.round(rect.width * ratio));
        canvas.height = Math.max(1, Math.round(rect.height * ratio));
        const context = canvas.getContext("2d");
        const { start, end } = trimWindow(data.duration, card.start, card.duration);
        const width = canvas.width, height = canvas.height, bar = width / data.values.length;
        context.clearRect(0, 0, width, height);

        const trimmed = data.duration > 0 && (start > 0.01 || end < data.duration - 0.01);
        const x1 = data.duration > 0 ? (start / data.duration) * width : 0;
        const x2 = data.duration > 0 ? (end / data.duration) * width : width;
        if (trimmed) {
            context.fillStyle = "rgba(240, 180, 90, 0.14)";
            context.fillRect(x1, 0, Math.max(2 * ratio, x2 - x1), height);
        }

        const loudest = Math.max(0.05, ...data.values);
        data.values.forEach((value, index) => {
            const time = (index + 0.5) / data.values.length * data.duration;
            context.fillStyle = time >= start && time <= end ? "#f0b45a" : "#4e402c";
            const h = Math.max(2 * ratio, value / loudest * height * 0.78);
            context.fillRect(index * bar + bar * 0.15, (height - h) / 2, Math.max(1, bar * 0.7), h);
        });

        const waveWrap = canvas.closest(".hub-wave-wrap");
        if (waveWrap) this.syncWaveSelection(waveWrap, data.duration, card);

        if (this.audio && this.previewAudioId === card.id && data.duration > 0) {
            const px = Math.max(0, Math.min(width - 2 * ratio, (this.audio.currentTime / data.duration) * width));
            context.fillStyle = "#3fc8b4";
            context.fillRect(px, 0, Math.max(1.5, 2 * ratio), height);
        }

        const info = this.root.querySelector(`[data-info="${card.id}"]`);
        if (info) {
            info.textContent = info.closest(".hub-aud-s2")
                ? `${formatSeconds(start)}–${formatSeconds(end)}`
                : `${formatSeconds(start)}–${formatSeconds(end)} / ${formatSeconds(data.duration)}`;
        }
    }

    audioPreviewButton(card) {
        const active = this.audio && this.previewAudioId === card.id;
        const button = iconButton(active ? "pause" : "play", "试听裁切片段", () => this.toggleAudio(card, button),
            `hub-aud-play${active ? " is-playing" : ""}`);
        if (active) this.previewAudioButton = button;
        return button;
    }

    startAudioPlayhead(card) {
        cancelAnimationFrame(this.audioPlayRaf);
        const tick = () => {
            this.audioPlayRaf = 0;
            if (!this.audio || this.previewAudioId !== card.id || this.audio.paused) return;
            const canvas = this.root?.querySelector(`canvas.ahr-wave[data-id="${card.id}"]`);
            if (canvas) this.drawWaveform(canvas, card);
            this.audioPlayRaf = requestAnimationFrame(tick);
        };
        this.audioPlayRaf = requestAnimationFrame(tick);
    }

    stopAudio() {
        cancelAnimationFrame(this.audioPlayRaf);
        this.audioPlayRaf = 0;
        const audio = this.audio;
        if (!audio) return;
        const prevId = this.previewAudioId;
        const button = this.previewAudioButton;
        this.audio = null;
        this.previewAudioId = null;
        this.previewAudioButton = null;
        if (button) {
            button.classList.remove("is-playing");
            if (button.firstChild) button.firstChild.className = "pi pi-play";
        }
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        if (prevId) {
            const canvas = this.root?.querySelector(`canvas.ahr-wave[data-id="${prevId}"]`);
            const card = this.doc?.audios?.find(item => item.id === prevId);
            if (canvas && card) this.drawWaveform(canvas, card);
        }
    }

    toggleAudio(card, button) {
        const sameCard = this.previewAudioId === card.id;
        this.stopAudio();
        if (sameCard) return;

        const audio = new Audio();
        this.audio = audio;
        this.previewAudioId = card.id;
        this.previewAudioButton = button;
        button.classList.add("is-playing");
        button.firstChild.className = "pi pi-pause";

        const finish = (failed = false) => {
            if (this.audio !== audio) return;
            this.stopAudio();
            if (failed) this.toast("试听失败：无法播放这条音频", true);
        };
        audio.addEventListener("loadedmetadata", () => {
            if (this.audio !== audio) return;
            const { start, end } = trimWindow(audio.duration, card.start, card.duration);
            audio.currentTime = start;
            audio.addEventListener("timeupdate", () => { if (audio.currentTime >= end) finish(); });
            audio.play().then(() => {
                if (this.audio === audio) this.startAudioPlayhead(card);
            }).catch(() => finish(true));
        }, { once: true });
        audio.addEventListener("pause", () => finish());
        audio.addEventListener("ended", () => finish());
        audio.addEventListener("error", () => finish(true));
        const url = this.fileUrl(card);
        Promise.resolve(this.api.resolveMedia?.(url) ?? url).then(src => {
            if (this.audio === audio) audio.src = src;
        }, () => finish(true));
    }

    // ---------- preview & manifest ----------
    openPreview(kind, src, title) {
        this.closePreview();
        const overlay = el("div", "ahr-preview");
        const frame = el("div", "ahr-preview-frame");
        const head = el("div", "ahr-preview-head");
        head.append(el("span", "", title || ""), iconButton("times", "关闭", () => this.closePreview()));
        const media = kind === "video" ? el("video") : el("img");
        Promise.resolve(this.api.resolveMedia?.(src) ?? src).then(url => {
            if (overlay.isConnected) media.src = url;
        }, error => this.toast(error.message, true));
        if (kind === "video") { media.controls = true; media.autoplay = true; }
        frame.append(head, media);
        overlay.append(frame);
        overlay.addEventListener("click", event => { if (event.target === overlay) this.closePreview(); });
        this.escape = event => { if (event.key === "Escape") this.closePreview(); };
        document.addEventListener("keydown", this.escape);
        document.body.append(overlay);
        this.preview = overlay;
    }

    closePreview() {
        this.preview?.querySelector("video")?.pause();
        this.preview?.remove();
        this.preview = null;
        if (this.escape) document.removeEventListener("keydown", this.escape);
        this.escape = null;
    }

    async copyManifest() {
        const text = manifestText(this.doc);
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            const area = el("textarea");
            area.value = text;
            document.body.append(area);
            area.select();
            document.execCommand("copy");
            area.remove();
        }
        this.toast("素材清单已复制");
    }

    showResults(message) {
        const items = message?.h3_refs?.[0]?.items || [];
        this.results = new Map(items.map(item => [item.id, item]));
        if (this.isTyping()) { this.pendingRender = true; return; }
        this.render();
    }
}

export { newId };
