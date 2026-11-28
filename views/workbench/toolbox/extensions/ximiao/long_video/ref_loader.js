// Soft Luminous Studio UI for H3 Image Reference Loader (ref_image_0..8)
// and H3 Audio Reference Loader (ref_audio_0..2).
//
// Zero backend / widget / serialization changes:
//   - Reads/writes the exact hidden widgets (media_files, project_name, and for image:
//     target_megapixels, resampling_method, upscale_small_images) in their original order.
//   - Preserves all ref_state.js serialization, slot rules, replace-in-place, audio trim,
//     and shared project preset libraries (openLibraryBrowser + /amiaomiao_h3/lvm/ref_presets).

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { addPanel } from "./dom_panel.js";
import { imageMetadataPath, imageThumbnailUrl } from "./image_preview.js";
import { openLibraryBrowser } from "../refs/library_browser.js";
import {
    MAX_REF_AUDIOS, MAX_REF_IMAGES, addEntries, applyPreset, audioInfoLine,
    isSkipped, mediaKey, mediaKind, parseMedia, pickPresetEntries, removeEntry,
    replaceEntry, resolveTrim, restoreAll, serializeMedia, sizeLine, slotName,
    slotTitle, splitEntries, trimRange,
} from "./ref_state.js";

try {
    const sheets = [
        ["amiaomiao-h3-refs-style", "../refs/refs.css?v=20261127y"],
        ["amiaomiao-h3-ui-theme-style", "../refs/ui_theme.css?v=20261127w"],
        ["amiaomiao-amiao-h3ref-styles", "./ref_loader.css?v=20261127y"],
    ];
    for (const [styleId, path] of sheets) {
        if (document.getElementById(styleId)) continue;
        const link = document.createElement("link");
        link.id = styleId;
        link.rel = "stylesheet";
        link.type = "text/css";
        link.href = new URL(path, import.meta.url).href;
        document.head.appendChild(link);
    }
} catch (error) {
    console.warn("[H3 Ref Loader] CSS injection failed:", error);
}

const IMAGE_NODE = "AmiaomiaoH3_H3 Image Reference Loader";
const AUDIO_NODE = "AmiaomiaoH3_H3 Audio Reference Loader";
const MEDIA_FIELD = "media_files";
const MP_FIELD = "target_megapixels";
const RESAMPLE_FIELD = "resampling_method";
const UPSCALE_FIELD = "upscale_small_images";
const PROJECT_FIELD = "project_name";
const DEFAULT_PROJECT = "H3_LVM";
const UPLOAD_ROOT = "amiaomiao-h3-refs";
const RESAMPLE_OPTIONS = ["Lanczos", "Bicubic", "Bilinear", "Nearest"];

const CARD_SCALE_MIN = 0.50;
const CARD_SCALE_MAX = 2.00;
const CARD_SCALE_STEP = 0.05;
const CARD_SCALE_DEFAULT = 1.00;

const peakCache = new Map();

function projectFolder(name) {
    const cleaned = String(name ?? "")
        .trim()
        .replace(/[\\/:*?"<>|\x00-\x1f]+/g, "_")
        .trim()
        .replace(/^\.+|\.+$/g, "");
    return cleaned || DEFAULT_PROJECT;
}

function normalizeCardScale(value) {
    const raw = Number(value);
    if (Number.isFinite(raw) && raw > 0) {
        const normalized = raw > 10 ? raw / 100 : raw;
        const clamped = Math.min(CARD_SCALE_MAX, Math.max(CARD_SCALE_MIN, normalized));
        return Math.round(clamped / CARD_SCALE_STEP) * CARD_SCALE_STEP;
    }
    return CARD_SCALE_DEFAULT;
}

function scalePercent(scale) {
    return `${Math.round(scale * 100)}%`;
}

function scaleProgress(scale) {
    return `${((scale - CARD_SCALE_MIN) / (CARD_SCALE_MAX - CARD_SCALE_MIN)) * 100}%`;
}

function formatSeconds(sec) {
    const val = Math.max(0, Number(sec) || 0);
    return `${val.toFixed(1)}s`;
}

function readLocalPref(key, fallback) {
    try {
        const stored = localStorage.getItem(key);
        return stored === null ? fallback : stored;
    } catch {
        return fallback;
    }
}

function writeLocalPref(key, value) {
    try { localStorage.setItem(key, String(value)); } catch { /* optional */ }
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

// Reorder or move a card between active / parked blocks while preserving canonical order.
function placeEntryAt(entries, fromDeckIndex, targetSkip, targetGroupIndex, max) {
    const list = entries ?? [];
    if (fromDeckIndex < 0 || fromDeckIndex >= list.length) {
        return { ok: false, reason: "missing", entries: list };
    }
    const { active, parked } = splitEntries(list);
    const moving = list[fromDeckIndex];
    const wasSkipped = isSkipped(moving);
    const nextSkip = !!targetSkip;

    if (!nextSkip && wasSkipped && active.length >= max) {
        return { ok: false, reason: "full", entries: list };
    }

    const restActive = wasSkipped ? [...active] : active.filter((_, i) => i !== fromDeckIndex);
    const parkedFrom = fromDeckIndex - active.length;
    const restParked = wasSkipped ? parked.filter((_, i) => i !== parkedFrom) : [...parked];

    const updated = { ...moving };
    if (nextSkip) updated.skip = true;
    else delete updated.skip;

    const targetGroup = nextSkip ? restParked : restActive;
    const insertAt = Math.max(0, Math.min(targetGroup.length, Number.isFinite(targetGroupIndex) ? targetGroupIndex : targetGroup.length));
    targetGroup.splice(insertAt, 0, updated);

    return {
        ok: true,
        entries: [...restActive, ...restParked],
        key: mediaKey(updated),
        slot: nextSkip ? -1 : insertAt,
    };
}

function setAllEntriesSkip(entries, skip, max) {
    const { active, parked } = splitEntries(entries);
    if (skip) {
        if (!active.length) return { entries: [...entries], changed: 0, left: 0 };
        const moved = active.map(item => ({ ...item, skip: true }));
        return { entries: [...parked, ...moved], changed: active.length, left: 0 };
    }
    const result = restoreAll(entries, max);
    return { entries: result.entries, changed: result.restored, left: result.blocked };
}

const SPECS = {
    [IMAGE_NODE]: {
        kind: "image",
        noun: "图片",
        brandTitle: "H3 图片参考",
        brandTag: "9 槽直出",
        stageTitle: "图片参考槽位",
        portsLabel: "ref_image_0..8",
        icon: "image",
        max: MAX_REF_IMAGES,
        panelH: 440,
        defaultW: 840,
        defaultH: 640,
        accept: "image/png,image/jpeg,image/webp,image/bmp,image/gif",
        uploadSubfolder: `${UPLOAD_ROOT}/image`,
        scaleKey: "amiaomiao-h3.refloader.image.scale",
        viewKey: "amiaomiao-h3.refloader.image.view",
    },
    [AUDIO_NODE]: {
        kind: "audio",
        noun: "音频",
        brandTitle: "H3 音频参考",
        brandTag: "3 槽直出",
        stageTitle: "音频参考槽位",
        portsLabel: "ref_audio_0..2",
        icon: "volume-up",
        max: MAX_REF_AUDIOS,
        panelH: 360,
        defaultW: 820,
        defaultH: 520,
        accept: "audio/*,.wav,.mp3,.m4a,.flac,.ogg,.opus",
        uploadSubfolder: `${UPLOAD_ROOT}/audio`,
        scaleKey: "amiaomiao-h3.refloader.audio.scale",
        viewKey: "amiaomiao-h3.refloader.audio.view",
    },
};

const LABELS = {
    media_files: "🎞 参考素材列表",
    target_megapixels: "🎯 目标像素量 (MP)",
    resampling_method: "🔍 重采样算法",
    upscale_small_images: "↕ 放大小图至目标 MP",
    project_name: "📦 项目素材库",
};

const TOOLTIPS = {
    media_files: "由下方卡片面板写入的 JSON 列表；卡片顺序就是 ref_image_0..8 / ref_audio_0..2 的槽位顺序。",
    target_megapixels: "每张图的目标像素量（百万像素），按各自比例缩放并对齐 32 像素网格。",
    resampling_method: "缩放用的重采样算法：Lanczos / Bicubic / Bilinear / Nearest。",
    upscale_small_images: "开启：小图放大到目标 MP；关闭：小图保持原面积，仅微调到 32 的倍数。",
    project_name: "当前关联的参考素材项目库名称，只保存路径与排列，不复制原文件。",
};

app.registerExtension({
    name: "Amiaomiao.H3.H3.LVM.RefLoaders",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        const spec = SPECS[nodeData.name];
        if (!spec) return;

        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = originalCreated ? originalCreated.apply(this, arguments) : undefined;
            try {
                translateWidgets(this);
                installRefPanel(this, spec);
            } catch (error) {
                console.warn("[H3 Ref Loader] panel setup failed (node still works):", error);
            }
            return r;
        };

        const originalConfigure = nodeType.prototype.configure;
        nodeType.prototype.configure = function (info) {
            const r = originalConfigure ? originalConfigure.apply(this, arguments) : undefined;
            this._h3lvmRefRefresh?.();
            return r;
        };

        const originalRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            this._h3lvmRefDispose?.();
            return originalRemoved ? originalRemoved.apply(this, arguments) : undefined;
        };
    },
});

function translateWidgets(node) {
    for (const widget of node.widgets ?? []) {
        const label = LABELS[widget.name];
        if (label) widget.label = label;
        const tooltip = TOOLTIPS[widget.name];
        if (tooltip) widget.tooltip = tooltip;
    }
}

class RefLoaderPanel {
    constructor(node, spec) {
        this.node = node;
        this.spec = spec;
        this.disposed = false;
        this.entries = this.readEntries();
        this.activeProject = this.readProjectName();

        this.preset = null;
        this.presetRevision = undefined;
        this.presetSeq = 0;
        this.projectOperation = null;
        this.projectChoice = null;
        this.pendingImports = 0;

        this.sourceCache = new Map();
        this.planCache = new Map();
        this.audioDurations = new Map();
        this.audioMetaCache = new Map();
        this.expandedAudioDrawers = new Set();

        this.generation = 0;
        this.cardScale = normalizeCardScale(readLocalPref(spec.scaleKey, CARD_SCALE_DEFAULT));
        this.viewMode = spec.kind === "image"
            ? (readLocalPref(spec.viewKey, "grid") === "list" ? "list" : "grid")
            : (readLocalPref(spec.viewKey, "card") === "strip" ? "strip" : "card");

        this.pointerDragCleanup = null;
        this.suppressPreviewUntil = 0;
        this.flashKey = null;
        this.flashTimer = 0;
        this.toastTimer = 0;
        this.audio = null;
        this.previewAudioKey = null;
        this.previewAudioButton = null;
        this.audioPlayRaf = 0;
        this.preview = null;
        this.previewEscape = null;
        this.fileHoverTarget = null;
        this.pendingRender = false;

        this.root = el("div", "ahr ahr-hub h3rl-loader");
        this.root.tabIndex = -1;
        this.root.dataset.page = spec.kind;
        this.root.dataset.density = "custom";
        this.root.dataset.hideNotes = "1";

        // Hidden file inputs reused for add & replace-in-place
        this.addInput = el("input");
        this.addInput.type = "file";
        this.addInput.multiple = true;
        this.addInput.accept = spec.accept;
        this.addInput.style.display = "none";
        this.addInput.addEventListener("change", () => {
            const files = [...(this.addInput.files ?? [])];
            this.addInput.value = "";
            void this.addFiles(files);
        });

        this.replaceIndex = -1;
        this.replaceInput = el("input");
        this.replaceInput.type = "file";
        this.replaceInput.accept = spec.accept;
        this.replaceInput.style.display = "none";
        this.replaceInput.addEventListener("change", () => {
            const files = [...(this.replaceInput.files ?? [])];
            this.replaceInput.value = "";
            const index = this.replaceIndex;
            this.replaceIndex = -1;
            if (index >= 0 && files.length) void this.replaceWith(index, files[0]);
        });

        this.root.addEventListener("focusout", event => {
            if (this.pendingRender && !this.isTyping(event.relatedTarget)) {
                this.pendingRender = false;
                requestAnimationFrame(() => this.render());
            }
        });

        this.bindDrop();
        this.hideManagedWidgets();
        this.hookImageSettingWidgets();
        this.render();
        void this.refreshPreset();
    }

    widgetFor(name) {
        return this.node.widgets?.find(item => item.name === name);
    }

    isTyping(target = document.activeElement) {
        return !!target && this.root.contains(target) && target.matches?.("input:not([type=checkbox]):not([type=range]), textarea");
    }

    hideManagedWidgets() {
        const names = this.spec.kind === "image"
            ? [MEDIA_FIELD, PROJECT_FIELD, MP_FIELD, RESAMPLE_FIELD, UPSCALE_FIELD]
            : [MEDIA_FIELD, PROJECT_FIELD];
        for (const name of names) {
            const w = this.widgetFor(name);
            if (!w) continue;
            w.options = { ...w.options, hidden: true };
        }
    }

    hookImageSettingWidgets() {
        if (this.spec.kind !== "image") return;
        for (const field of [MP_FIELD, RESAMPLE_FIELD, UPSCALE_FIELD]) {
            const w = this.widgetFor(field);
            if (!w) continue;
            const orig = w.callback;
            w.callback = (...args) => {
                const res = orig?.apply(w, args);
                if (field !== RESAMPLE_FIELD) {
                    this.planCache.clear();
                    this.refreshAllImageSizes();
                }
                this.syncImageSettingControls();
                return res;
            };
        }
    }

    readEntries() {
        try {
            return parseMedia(this.widgetFor(MEDIA_FIELD)?.value, this.spec.max).entries;
        } catch (error) {
            console.warn("[H3 Ref Loader] media list is not readable:", error);
            return [];
        }
    }

    readProjectName() {
        const raw = String(this.widgetFor(PROJECT_FIELD)?.value ?? "").trim();
        return raw || DEFAULT_PROJECT;
    }

    writeProjectWidget(name) {
        this.activeProject = name || DEFAULT_PROJECT;
        const w = this.widgetFor(PROJECT_FIELD);
        if (w && w.value !== this.activeProject) {
            w.value = this.activeProject;
            w.callback?.(w.value);
        }
        this.node.setDirtyCanvas?.(true, true);
        this.node.graph?.setChanged?.();
    }

    commit(rerender = false) {
        const w = this.widgetFor(MEDIA_FIELD);
        if (w) {
            w.value = serializeMedia(this.entries);
            w.callback?.(w.value);
        }
        this.node.setDirtyCanvas?.(true, true);
        this.node.graph?.setChanged?.();
        if (rerender) this.render();
        else this.syncStatusUi();
    }

    currentMegapixels() {
        const raw = Number(this.widgetFor(MP_FIELD)?.value);
        return Number.isFinite(raw) ? raw : 0.25;
    }

    currentResample() {
        return String(this.widgetFor(RESAMPLE_FIELD)?.value || "Lanczos");
    }

    currentUpscale() {
        const val = this.widgetFor(UPSCALE_FIELD)?.value;
        return val === undefined ? false : Boolean(val);
    }

    setWidgetValue(name, value) {
        const w = this.widgetFor(name);
        if (!w) return;
        w.value = value;
        w.callback?.(value);
        this.node.setDirtyCanvas?.(true, true);
        this.node.graph?.setChanged?.();
    }

    url(path) {
        if (typeof api.apiURL === "function") return api.apiURL(path);
        if (typeof api.getFileUrl === "function") return api.getFileUrl(path);
        return path;
    }

    viewUrl(entry) {
        const query = new URLSearchParams({
            filename: entry.filename,
            subfolder: entry.subfolder || "",
            type: entry.type || "input",
        });
        return this.url(`/view?${query}`);
    }

    async fetchJson(path, options) {
        const response = await api.fetchApi(path, { cache: "no-store", ...options });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const err = new Error(data.error || `请求失败（HTTP ${response.status}）`);
            err.status = response.status;
            err.data = data;
            throw err;
        }
        return data;
    }

    toast(message, error = false) {
        if (!this.statusEl) return;
        this.statusEl.textContent = message;
        this.statusEl.classList.toggle("is-error", error);
        this.statusEl.classList.add("is-visible");
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => this.statusEl?.classList.remove("is-visible"), 2800);
    }

    // ---------- Preset / Dirty Tracking ----------
    presetSerialized() {
        const list = pickPresetEntries(this.preset);
        if (!list.length) return "[]";
        try {
            return serializeMedia(applyPreset([], list, this.spec.max).entries);
        } catch {
            return "[]";
        }
    }

    presetDirtyState() {
        const hasDiskPreset = this.presetRevision !== null && this.presetRevision !== undefined;
        const diskEntries = pickPresetEntries(this.preset);
        const currentSig = serializeMedia(this.entries);
        const diskSig = this.presetSerialized();
        const dirty = hasDiskPreset
            ? currentSig !== diskSig
            : this.entries.length > 0;
        return {
            bound: hasDiskPreset,
            dirty,
            diskCount: diskEntries.length,
        };
    }

    syncStatusUi() {
        const { active, parked } = splitEntries(this.entries);
        const { bound, dirty, diskCount } = this.presetDirtyState();

        if (this.stageCountBadge) {
            this.stageCountBadge.textContent = `${active.length} / ${this.spec.max}`;
        }
        if (this.activeSlotValEl) {
            this.activeSlotValEl.textContent = `${active.length} / ${this.spec.max}`;
        }
        if (this.parkedSlotValEl) {
            this.parkedSlotValEl.textContent = `${parked.length} 张`;
        }
        if (this.projectStatusEl) {
            this.projectStatusEl.textContent = bound
                ? (dirty ? "有未保存改动" : "已同步")
                : (this.entries.length ? "未存库" : "空项目");
        }
        if (this.projectSubCountEl) {
            this.projectSubCountEl.textContent = diskCount > 0
                ? `${this.entries.length} 张 · 库 ${diskCount}`
                : `${this.entries.length} 张卡片`;
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

    async refreshPreset(project = this.activeProject) {
        const seq = ++this.presetSeq;
        try {
            const data = await this.fetchJson(
                `/amiaomiao_h3/lvm/ref_presets?strict=1&kind=${this.spec.kind}&project=${encodeURIComponent(project)}`
            );
            if (seq !== this.presetSeq || this.disposed || project !== this.activeProject) return;
            this.preset = data;
            this.presetRevision = data.revision ?? null;
        } catch (error) {
            if (seq !== this.presetSeq || this.disposed) return;
            this.preset = null;
            this.presetRevision = null;
        }
        this.syncStatusUi();
    }

    syncFromNodeConfigure() {
        const nextProject = this.readProjectName();
        if (nextProject !== this.activeProject) {
            this.activeProject = nextProject;
            this.preset = null;
            this.presetRevision = undefined;
        }
        this.entries = this.readEntries();
        this.planCache.clear();
        this.projectChoice = null;
        this.render();
        void this.refreshPreset(this.activeProject);
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

    // ---------- Main Render ----------
    render() {
        const railScrollTop = this.railScroll?.scrollTop ?? 0;
        const stageScrollTop = this.body?.scrollTop ?? 0;
        this.generation++;
        this.cancelPointerDrag();
        this.setFileHover();
        this.root.replaceChildren();

        this.root.dataset.page = this.spec.kind;
        this.root.dataset.compactCards = this.cardScale <= 0.75 ? "1" : "0";
        this.root.style.setProperty("--h3-card-scale", this.cardScale.toFixed(2));
        if (this.spec.kind === "image") this.root.dataset.imageView = this.viewMode;
        else this.root.dataset.audioLayout = this.viewMode;

        const split = el("div", "hub-split");

        // ===== Left Control Rail =====
        const rail = el("aside", "hub-rail");
        const railHead = el("div", "hub-rail-head");
        const brand = el("span", "hub-brand");
        brand.append(el("span", "hub-brand-dot"), el("span", "", this.spec.brandTitle));
        railHead.append(brand, el("span", "hub-brand-tag", this.spec.brandTag));

        this.railScroll = el("div", "hub-rail-scroll");
        this.railScroll.append(this.buildProjectBlock());
        if (this.spec.kind === "image") {
            this.railScroll.append(this.buildImageSettingsBlock());
        }
        this.railScroll.append(this.buildSlotOverviewBlock());

        // Left Rail Footer: Unified 50%-200% Free Card-Size Slider
        const railFoot = el("div", "hub-rail-foot");
        const scaleRow = el("div", "hub-scale-row");
        const scaleLabel = el("span", "hub-scale-lbl", "卡片大小");
        scaleLabel.title = "拖动自由调节右侧卡片显示比例（双击恢复 100%）";
        const scaleSlider = el("input", "hub-scale-slider");
        scaleSlider.type = "range";
        scaleSlider.min = String(CARD_SCALE_MIN);
        scaleSlider.max = String(CARD_SCALE_MAX);
        scaleSlider.step = String(CARD_SCALE_STEP);
        scaleSlider.value = this.cardScale.toFixed(2);
        scaleSlider.style.setProperty("--slider-pct", scaleProgress(this.cardScale));
        scaleSlider.setAttribute("aria-label", "卡片显示大小");
        scaleSlider.title = "左右拖动自由调节卡片大小（双击恢复 100%）";
        const scaleVal = el("button", "hub-scale-val", scalePercent(this.cardScale));
        scaleVal.type = "button";
        scaleVal.title = "点击恢复默认 100%";

        const applyScale = (nextRaw, persist = false) => {
            const next = normalizeCardScale(nextRaw);
            this.cardScale = Number(next.toFixed(2));
            scaleSlider.value = this.cardScale.toFixed(2);
            scaleSlider.style.setProperty("--slider-pct", scaleProgress(this.cardScale));
            scaleVal.textContent = scalePercent(this.cardScale);
            scaleVal.classList.toggle("is-default", Math.abs(this.cardScale - CARD_SCALE_DEFAULT) < 0.001);
            this.root.style.setProperty("--h3-card-scale", this.cardScale.toFixed(2));
            this.root.dataset.compactCards = this.cardScale <= 0.75 ? "1" : "0";
            if (this.spec.kind === "audio") requestAnimationFrame(() => this.drawWaveforms());
            if (persist) writeLocalPref(this.spec.scaleKey, this.cardScale.toFixed(2));
        };
        scaleVal.classList.toggle("is-default", Math.abs(this.cardScale - CARD_SCALE_DEFAULT) < 0.001);
        scaleSlider.addEventListener("pointerdown", event => event.stopPropagation());
        scaleSlider.addEventListener("input", () => applyScale(scaleSlider.value, false));
        scaleSlider.addEventListener("change", () => applyScale(scaleSlider.value, true));
        scaleSlider.addEventListener("dblclick", () => applyScale(CARD_SCALE_DEFAULT, true));
        scaleLabel.addEventListener("dblclick", () => applyScale(CARD_SCALE_DEFAULT, true));
        scaleVal.addEventListener("click", () => applyScale(CARD_SCALE_DEFAULT, true));

        scaleRow.append(scaleLabel, scaleSlider, scaleVal);
        railFoot.append(scaleRow);
        rail.append(railHead, this.railScroll, railFoot);

        // ===== Right Pure Asset Stage =====
        const main = el("div", "hub-main");
        main.append(this.buildStageBar());

        this.body = el("div", "hub-stage-scroll");
        this.body.inert = !!this.projectOperation;
        this.body.setAttribute("aria-busy", String(!!this.projectOperation));
        if (this.projectChoice) this.body.append(this.renderProjectChoice());
        this.body.append(...this.renderZones());
        main.append(this.body);

        split.append(rail, main);
        this.statusEl = el("div", "ahr-toast");
        this.statusEl.setAttribute("role", "status");
        this.root.append(split, this.statusEl, this.addInput, this.replaceInput);

        this.syncStatusUi();
        this.railScroll.scrollTop = railScrollTop;
        this.body.scrollTop = stageScrollTop;

        if (this.spec.kind === "image") {
            for (const [deckIndex, entry] of this.entries.entries()) {
                void this.fillImageCard(entry, deckIndex);
            }
        } else {
            requestAnimationFrame(() => this.drawWaveforms());
        }
    }

    eyebrow(titleText, rightText = "", withDot = true) {
        const row = el("div", "hub-eyebrow");
        const left = el("span", "hub-eyebrow-l");
        if (withDot) left.append(el("span", "hub-eyebrow-dot"));
        left.append(el("span", "", titleText));
        row.append(left);
        if (rightText !== undefined && rightText !== null) {
            row.append(el("span", "hub-eyebrow-r", rightText));
        }
        return row;
    }

    buildProjectBlock() {
        const noun = this.spec.noun;
        const { bound, dirty, diskCount } = this.presetDirtyState();

        const block = el("div", "hub-rail-block");
        const headRow = this.eyebrow(
            `${noun}项目库`,
            bound ? (dirty ? "有未保存改动" : "已同步") : (this.entries.length ? "未存库" : "空项目"),
            true
        );
        this.projectStatusEl = headRow.querySelector(".hub-eyebrow-r");
        block.append(headRow);

        const cardBtn = el("button", "hub-lib-card");
        cardBtn.type = "button";
        cardBtn.title = `点击打开${noun}项目库（切换、封面预览、新建、重命名、删除）`;
        const thumb = el("span", "hub-lib-thumb");
        const firstImg = this.spec.kind === "image"
            ? (this.entries.find(e => !isSkipped(e)) || this.entries[0])
            : null;
        if (firstImg?.filename) {
            const img = el("img");
            img.src = imageThumbnailUrl(api, firstImg);
            img.alt = "";
            img.draggable = false;
            img.addEventListener("error", () => { thumb.replaceChildren(icon("image")); });
            thumb.append(img);
        } else {
            thumb.append(icon(this.spec.icon));
        }

        const info = el("span", "hub-lib-info");
        info.append(el("span", "hub-lib-name", this.activeProject));
        const sub = el("span", "hub-lib-sub");
        this.projectSubCountEl = el("span", "", diskCount > 0 ? `${this.entries.length} 张 · 库 ${diskCount}` : `${this.entries.length} 张卡片`);
        this.projectDirtyPill = el("span", "hub-dirty-pill", bound ? "未保存" : "未存库");
        this.projectDirtyPill.hidden = !dirty;
        sub.append(this.projectSubCountEl, this.projectDirtyPill);
        info.append(sub);

        const chev = el("span", "hub-lib-chev");
        chev.append(icon("chevron-right"));
        cardBtn.append(thumb, info, chev);
        cardBtn.addEventListener("click", () => this.openLibrary());
        block.append(cardBtn);

        const actsWrap = el("div", "hub-lib-acts-wrap");
        const acts = el("div", "hub-lib-acts h3rl-lib-acts");
        const saveBtn = textButton(
            dirty && bound ? "保存改动" : "保存库",
            "save",
            () => void this.saveProjectPreset(),
            `hub-btn${dirty ? " is-warn-pulse" : ""}`
        );
        saveBtn.title = `把当前${noun}卡片保存到「${this.activeProject}」项目预设（只存路径、名称与排序，与 H3 参考素材互通）`;
        this.projectSaveBtn = saveBtn;

        const createBtn = iconButton("plus", `新建${noun}项目`, () => this.showCreateProject(actsWrap), "hub-icon-btn");
        const reloadBtn = iconButton("refresh", "刷新元数据 / 从项目库重载预设", () => void this.onRefreshOrReloadClick(), "hub-icon-btn");
        const openFolderBtn = iconButton("folder-open", "打开当前项目本地目录", () => void this.openLocalFolder(), "hub-icon-btn");

        acts.append(saveBtn, createBtn, reloadBtn, openFolderBtn);
        actsWrap.append(acts);
        block.append(actsWrap);
        return block;
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
        const unit = el("span", "hub-unit is-bare");
        const mpInput = el("input");
        mpInput.type = "number";
        mpInput.min = "0.02";
        mpInput.max = "8";
        mpInput.step = "0.01";
        mpInput.value = String(this.currentMegapixels());
        mpInput.setAttribute("aria-label", "图片目标像素量（MP）");
        mpInput.addEventListener("change", () => {
            const value = Math.min(8, Math.max(0.02, Math.round((Number(mpInput.value) || 0.25) * 100) / 100));
            mpInput.value = String(value);
            this.setWidgetValue(MP_FIELD, value);
        });
        unit.append(mpInput);
        rowMp.append(el("span", "hub-param-lbl", "目标像素 (MP)"), unit);
        this.mpInputEl = mpInput;

        // Row 2: Resampling method
        const rowMethod = el("div", "hub-param-row");
        const methodSel = el("select", "ahr-select hub-param-select");
        methodSel.title = "图片重采样算法";
        methodSel.setAttribute("aria-label", "图片重采样");
        for (const opt of RESAMPLE_OPTIONS) {
            const option = el("option", "", opt);
            option.value = opt;
            methodSel.append(option);
        }
        methodSel.value = this.currentResample();
        methodSel.addEventListener("change", () => this.setWidgetValue(RESAMPLE_FIELD, methodSel.value));
        rowMethod.append(el("span", "hub-param-lbl", "重采样"), methodSel);
        this.resampleSelectEl = methodSel;

        // Row 3: Upscale small images
        const rowUp = el("div", "hub-param-row");
        rowUp.title = "开启：比目标像素小的图片放大到目标像素\n关闭：小图保持原尺寸，只微调到 32 的倍数";
        const toggle = el("label", "hub-toggle");
        const checkbox = el("input");
        checkbox.type = "checkbox";
        checkbox.checked = this.currentUpscale();
        checkbox.setAttribute("aria-label", "小于目标时放大");
        checkbox.addEventListener("change", () => this.setWidgetValue(UPSCALE_FIELD, checkbox.checked));
        toggle.append(checkbox, el("span", "hub-switch"));
        rowUp.append(el("span", "hub-param-lbl", "小图放大"), toggle);
        this.upscaleCheckEl = checkbox;

        box.append(rowMp, rowMethod, rowUp);
        block.append(box);
        return block;
    }

    syncImageSettingControls() {
        if (this.mpInputEl && document.activeElement !== this.mpInputEl) {
            this.mpInputEl.value = String(this.currentMegapixels());
        }
        if (this.resampleSelectEl) {
            this.resampleSelectEl.value = this.currentResample();
        }
        if (this.upscaleCheckEl) {
            this.upscaleCheckEl.checked = this.currentUpscale();
        }
    }

    buildSlotOverviewBlock() {
        const { active, parked } = splitEntries(this.entries);
        const block = el("div", "hub-rail-block");
        block.append(this.eyebrow("槽位直出映射", this.spec.portsLabel, true));
        const box = el("div", "hub-param-box");

        const r1 = el("div", "hub-param-row");
        this.activeSlotValEl = el("strong", "h3rl-slot-val", `${active.length} / ${this.spec.max}`);
        r1.append(el("span", "hub-param-lbl", "已启用槽位"), this.activeSlotValEl);

        const r2 = el("div", "hub-param-row");
        this.parkedSlotValEl = el("strong", "h3rl-slot-val is-muted", `${parked.length} 张`);
        r2.append(el("span", "hub-param-lbl", "停用保留"), this.parkedSlotValEl);

        const noteText = this.spec.kind === "image"
            ? "卡片顺序直接对应 ref_image_0..8 输出；拖卡片排序、点击大图预览、空槽输出 None。"
            : "卡片顺序直接对应 ref_audio_0..2 输出；不重采样不混音，波形划选即可精准裁切。";
        const r3 = el("div", "hub-param-row is-note", noteText);

        box.append(r1, r2, r3);
        block.append(box);
        return block;
    }

    buildStageBar() {
        const { active } = splitEntries(this.entries);
        const bar = el("div", "hub-stage-bar");
        const left = el("div", "hub-stage-left");
        const title = el("span", "hub-stage-title");
        title.append(el("span", "", this.spec.stageTitle));
        this.stageCountBadge = el("span", "hub-stage-badge", `${active.length} / ${this.spec.max}`);
        title.append(this.stageCountBadge);
        left.append(title);

        if (this.spec.kind === "audio") {
            const tip = el("span", "hub-stage-tip", "划选裁切 · 拖两边滑块微调 · 双击重置");
            tip.title = "在波形上按住拖选裁切区间；裁切后可拖动左右滑块微调或平移，双击重置全长";
            left.append(tip);
        }

        const right = el("div", "hub-stage-actions");
        const viewSeg = el("div", "hub-seg hub-view-seg");
        viewSeg.setAttribute("role", "group");
        viewSeg.setAttribute("aria-label", `${this.spec.noun}视图模式`);
        const modes = this.spec.kind === "image"
            ? [
                ["grid", "th-large", "网格", "紧凑图墙视图（无遮挡三段卡，自由拖拽排序）"],
                ["list", "list", "列表", "横向条带列表视图（文件名与输出尺寸一览）"],
            ]
            : [
                ["card", "th-list", "标准", "紧凑双层音频卡（波形与精确裁切同行）"],
                ["strip", "bars", "极简", "极简 DAW 音轨条（裁切抽屉按需展开）"],
            ];
        for (const [mode, iconName, label, tip] of modes) {
            const btn = el("button", "hub-view-btn");
            btn.type = "button";
            btn.title = tip;
            btn.setAttribute("aria-pressed", String(this.viewMode === mode));
            btn.append(icon(iconName), el("span", "", label));
            btn.addEventListener("click", () => {
                if (this.viewMode === mode) return;
                this.viewMode = mode;
                writeLocalPref(this.spec.viewKey, mode);
                this.render();
            });
            viewSeg.append(btn);
        }
        right.append(
            viewSeg,
            this.buildClearButton(),
            textButton(`添加${this.spec.noun}`, "plus", () => this.addInput.click(), "hub-btn is-primary")
        );
        bar.append(left, right);
        return bar;
    }

    buildClearButton() {
        const total = this.entries.length;
        const noun = this.spec.noun;
        const button = iconButton("trash", `清空全部${noun}卡片（不删原文件与项目预设）`, () => {
            const confirm = el("div", "ahr-clear-confirm");
            confirm.setAttribute("role", "group");
            confirm.setAttribute("aria-label", `确认清空${noun}`);
            const yes = textButton(`清空 ${total} 个`, "trash", () => {
                this.stopAudio();
                this.entries = [];
                this.commit(true);
                this.toast(`已清空 ${total} 张卡片（原文件与项目预设未删除）`);
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

    // ---------- Zones ----------
    renderZones() {
        const { active, parked } = splitEntries(this.entries);
        const listClass = this.spec.kind === "image"
            ? (this.viewMode === "list" ? "hub-img-list" : "ahr-image-grid")
            : `hub-aud-list${this.viewMode === "strip" ? " is-strip" : ""}`;
        const wideAdd = this.spec.kind === "audio" || this.viewMode === "list";

        const renderItem = (entry, deckIndex, slot) => {
            if (this.spec.kind === "image") {
                return this.viewMode === "list"
                    ? this.imageRow(entry, deckIndex, slot)
                    : this.imageCard(entry, deckIndex, slot);
            }
            return this.viewMode === "strip"
                ? this.audioStrip(entry, deckIndex, slot, active.length)
                : this.audioCard(entry, deckIndex, slot, active.length);
        };

        const activeZone = el("div", "ahr-zone is-active");
        const activeHead = el("div", "ahr-zone-head");
        activeHead.append(
            el("span", "ahr-zone-dot"),
            el("span", "ahr-zone-title", `启用 · 输出至 ${this.spec.portsLabel}`),
            el("span", "ahr-zone-count", `${active.length} / ${this.spec.max}`)
        );
        if (active.length) {
            const off = textButton("全部停用", "pause", () => this.batchSkip(true), "ahr-zone-action is-disable");
            off.title = `把启用区的全部${this.spec.noun}移到停用区`;
            activeHead.append(off);
        }
        const activeList = el("div", listClass);
        for (const [slot, entry] of active.entries()) {
            activeList.append(renderItem(entry, slot, slot));
        }
        if (active.length < this.spec.max) {
            activeList.append(this.buildAddTile(wideAdd));
        }
        activeZone.append(activeHead, activeList);

        const parkedZone = el("div", `ahr-zone is-parked${parked.length ? "" : " is-empty"}`);
        const parkedHead = el("div", "ahr-zone-head");
        parkedHead.append(
            el("span", "ahr-zone-dot"),
            el("span", "ahr-zone-title", "停用 · 不输出，不占槽位"),
            el("span", "ahr-zone-count", parked.length ? `${parked.length} 项` : "拖卡片到这里停用")
        );
        if (parked.length) {
            const on = textButton("全部启用", "play", () => this.batchSkip(false), "ahr-zone-action is-enable");
            on.disabled = active.length >= this.spec.max;
            on.title = on.disabled
                ? `启用区已满 ${this.spec.max} 个`
                : `按顺序启用停用区的${this.spec.noun}，最多 ${this.spec.max} 个`;
            parkedHead.append(on);
        }
        parkedZone.append(parkedHead);
        if (parked.length) {
            const parkedList = el("div", listClass);
            for (const [parkedIdx, entry] of parked.entries()) {
                parkedList.append(renderItem(entry, active.length + parkedIdx, -1));
            }
            parkedZone.append(parkedList);
        }

        return [activeZone, parkedZone];
    }

    buildAddTile(wide) {
        const tile = el("button", `ahr-add-tile${wide ? " is-wide" : ""}`);
        tile.type = "button";
        tile.dataset.fileDrop = "";
        tile.append(
            icon(this.spec.icon),
            el("span", "ahr-add-label", `添加${this.spec.noun}`),
            el("span", "ahr-add-hint", "点击选择或拖入文件")
        );
        tile.addEventListener("click", () => this.addInput.click());
        return tile;
    }

    // ---------- Image Cards (Zero-Overlay 3-Band Grid + Horizontal List) ----------
    imageCard(entry, deckIndex, slot) {
        const parked = slot < 0;
        const key = mediaKey(entry);
        const port = parked ? "" : slotName("image", slot);
        const shortTag = parked ? "停用" : `P${slot + 1}`;
        const node = el("article", `ahr-card ahr-image-card hub-img-card${parked ? " is-skipped" : ""}${this.flashKey === key ? " is-flash" : ""}`);
        node.dataset.deckIndex = String(deckIndex);
        node.dataset.skip = String(parked);
        node.dataset.mediaKey = key;

        const preview = () => {
            if (Date.now() < this.suppressPreviewUntil) return;
            this.openPreview(this.viewUrl(entry), entry.label || entry.filename);
        };

        // Band 1: Top Nameplate Bar
        const head = el("div", "hub-img-head");
        const dragBadge = el("span", `hub-img-badge${parked ? " is-off" : ""}`);
        dragBadge.append(el("span", "hub-drag-dots", "⋮⋮"), el("span", "", shortTag));
        dragBadge.title = parked ? "已停用 · 按住拖到启用区可启用" : `${slotTitle("image", slot)} → ${port} · 按住拖动排序`;
        this.bindPointerDrag(dragBadge, node, entry, deckIndex, parked, "grid");

        const name = el("input", "ahr-name hub-img-name");
        name.value = entry.label || "";
        name.placeholder = entry.filename || slotTitle("image", Math.max(0, slot));
        name.title = `${entry.filename}\n自定义卡片名称（留空显示文件名，不改变接口编号）`;
        name.maxLength = 60;
        name.setAttribute("aria-label", "卡片自定义名称");
        name.addEventListener("change", () => this.setCardLabel(deckIndex, name.value, name));
        name.addEventListener("keydown", event => {
            event.stopPropagation();
            if (event.key === "Enter") { event.preventDefault(); name.blur(); }
            else if (event.key === "Escape") { name.value = entry.label || ""; name.blur(); }
        });
        head.append(dragBadge, name);

        // Band 2: Pure Unobstructed Image
        const media = el("div", "ahr-image-media hub-img-media");
        media.title = `${entry.label || entry.filename}（按住拖动排序 / 点击放大预览）`;
        const image = el("img");
        image.alt = entry.label || entry.filename;
        image.loading = "lazy";
        image.draggable = false;
        image.src = imageThumbnailUrl(api, entry);
        image.addEventListener("error", () => {
            if (!image.dataset.fallback) {
                image.dataset.fallback = "1";
                image.src = this.viewUrl(entry);
            }
        });
        media.append(image);
        media.addEventListener("click", preview);
        this.bindPointerDrag(media, node, entry, deckIndex, parked, "grid");

        // Band 3: Output Resolution + Port Pill & Actions
        const body = el("div", "hub-img-body");
        const dim = el("div", "hub-img-dim ahr-image-size");
        dim.dataset.deckIndex = String(deckIndex);
        dim.textContent = "读取尺寸中…";

        const foot = el("div", "hub-img-foot");
        const portPill = el("span", `h3rl-port-pill${parked ? " is-off" : ""}`, parked ? "已停用" : port);
        portPill.title = parked ? "已停用：不输出、不占槽位" : `输出端口：${port}`;

        const acts = el("div", "hub-img-acts");
        const replaceBtn = el("button", "hub-tbtn is-replace");
        replaceBtn.type = "button";
        replaceBtn.title = "替换成新图片（槽位与自定义名称不变）";
        replaceBtn.setAttribute("aria-label", "替换图片");
        replaceBtn.append(icon("refresh"));
        replaceBtn.addEventListener("click", event => { event.stopPropagation(); this.pickReplacement(deckIndex); });

        const toggleBtn = el("button", `hub-tbtn ${parked ? "is-enable" : "is-pause"}`, parked ? "启用" : "停");
        toggleBtn.type = "button";
        toggleBtn.title = parked ? "启用：加入输出槽位" : "停用：保留卡片，但不输出、不占槽位";
        toggleBtn.setAttribute("aria-label", parked ? "启用" : "停用");
        toggleBtn.addEventListener("click", event => { event.stopPropagation(); this.toggleCardSkip(deckIndex, parked); });

        const delBtn = el("button", "hub-tbtn is-del", "×");
        delBtn.type = "button";
        delBtn.title = "移除卡片（原文件不会被删除）";
        delBtn.setAttribute("aria-label", "移除卡片");
        delBtn.addEventListener("click", event => { event.stopPropagation(); this.dropCard(deckIndex); });

        acts.append(replaceBtn, toggleBtn, delBtn);
        foot.append(portPill, acts);
        body.append(dim, foot);
        node.append(head, media, body);
        return node;
    }

    imageRow(entry, deckIndex, slot) {
        const parked = slot < 0;
        const key = mediaKey(entry);
        const port = parked ? "" : slotName("image", slot);
        const shortTag = parked ? "停用" : `P${slot + 1}`;
        const node = el("article", `ahr-card hub-img-row${parked ? " is-skipped" : ""}${this.flashKey === key ? " is-flash" : ""}`);
        node.dataset.deckIndex = String(deckIndex);
        node.dataset.skip = String(parked);
        node.dataset.mediaKey = key;

        const preview = () => {
            if (Date.now() < this.suppressPreviewUntil) return;
            this.openPreview(this.viewUrl(entry), entry.label || entry.filename);
        };

        const grip = el("div", "hub-row-grip", "⋮⋮");
        grip.title = "按住上下拖动排序，或拖入停用区";
        grip.setAttribute("aria-label", "拖动排序");

        const thumb = el("div", "hub-row-thumb");
        thumb.title = `${entry.label || entry.filename}（点击放大预览 / 按住拖动排序）`;
        const image = el("img");
        image.alt = entry.label || entry.filename;
        image.loading = "lazy";
        image.draggable = false;
        image.src = imageThumbnailUrl(api, entry);
        image.addEventListener("error", () => {
            if (!image.dataset.fallback) {
                image.dataset.fallback = "1";
                image.src = this.viewUrl(entry);
            }
        });
        thumb.append(image, el("span", `hub-row-badge${parked ? " is-off" : ""}`, shortTag));
        thumb.addEventListener("click", preview);

        const fields = el("div", "hub-row-fields");
        const top = el("div", "hub-row-top");
        const name = el("input", "ahr-name hub-img-name");
        name.value = entry.label || "";
        name.placeholder = entry.filename || slotTitle("image", Math.max(0, slot));
        name.title = entry.filename || "";
        name.maxLength = 60;
        name.setAttribute("aria-label", "卡片自定义名称");
        name.addEventListener("change", () => this.setCardLabel(deckIndex, name.value, name));
        name.addEventListener("keydown", event => {
            event.stopPropagation();
            if (event.key === "Enter") { event.preventDefault(); name.blur(); }
            else if (event.key === "Escape") { name.value = entry.label || ""; name.blur(); }
        });

        const portPill = el("span", `h3rl-port-pill is-inline${parked ? " is-off" : ""}`, parked ? "已停用" : port);
        top.append(name, portPill);

        const sub = el("div", "h3rl-row-sub");
        const fileEl = el("span", "h3rl-row-file", entry.filename);
        fileEl.title = entry.filename;
        const dim = el("span", "h3rl-row-dim ahr-image-size", "读取尺寸中…");
        dim.dataset.deckIndex = String(deckIndex);
        sub.append(fileEl, dim);
        fields.append(top, sub);

        const acts = el("div", "hub-row-acts");
        const replaceBtn = el("button", "ahr-btn hub-btn", "替换");
        replaceBtn.type = "button";
        replaceBtn.title = "替换成新图片（槽位与自定义名称不变）";
        replaceBtn.addEventListener("click", event => { event.stopPropagation(); this.pickReplacement(deckIndex); });

        const toggleBtn = el("button", `ahr-btn hub-btn${parked ? " is-accent" : ""}`, parked ? "启用" : "停用");
        toggleBtn.type = "button";
        toggleBtn.title = parked ? "启用：加入输出槽位" : "停用：保留卡片，但不输出、不占槽位";
        toggleBtn.addEventListener("click", event => { event.stopPropagation(); this.toggleCardSkip(deckIndex, parked); });

        const delBtn = el("button", "ahr-icon-btn hub-icon-btn is-danger hub-row-del", "×");
        delBtn.type = "button";
        delBtn.title = "移除卡片（原文件不会被删除）";
        delBtn.setAttribute("aria-label", "移除卡片");
        delBtn.addEventListener("click", event => { event.stopPropagation(); this.dropCard(deckIndex); });

        acts.append(replaceBtn, toggleBtn, delBtn);
        node.append(grip, thumb, fields, acts);
        this.bindPointerDrag(grip, node, entry, deckIndex, parked, "vertical");
        this.bindPointerDrag(thumb, node, entry, deckIndex, parked, "vertical");
        return node;
    }

    // ---------- Image Size Planning (exact server planner) ----------
    async loadImageSource(entry) {
        const key = mediaKey(entry);
        if (this.sourceCache.has(key)) return this.sourceCache.get(key);
        let result;
        try {
            const response = await api.fetchApi(imageMetadataPath(entry), { cache: "no-store" });
            const data = await response.json().catch(() => ({}));
            const width = Number(data.width);
            const height = Number(data.height);
            result = response.ok && width > 0 && height > 0
                ? { width, height }
                : { error: data.error || "图片读取失败" };
        } catch {
            result = { error: "图片读取失败" };
        }
        this.sourceCache.set(key, result);
        return result;
    }

    async loadPlan(source, megapixels, upscale) {
        const key = `${source.width}x${source.height}|${megapixels}|${upscale ? 1 : 0}`;
        if (this.planCache.has(key)) return this.planCache.get(key);
        const res = await api.fetchApi(
            `/amiaomiao_h3/lvm/ref_plan?w=${encodeURIComponent(source.width)}&h=${encodeURIComponent(source.height)}&mp=${encodeURIComponent(megapixels)}&upscale=${upscale ? 1 : 0}`,
            { cache: "no-store" }
        );
        const plan = res.ok ? await res.json().catch(() => null) : { error: "尺寸计算失败" };
        this.planCache.set(key, plan);
        return plan;
    }

    async fillImageCard(entry, deckIndex) {
        const at = this.generation;
        const source = await this.loadImageSource(entry);
        if (at !== this.generation || this.disposed) return;
        const setDim = (text, tip = text) => {
            const dim = this.root?.querySelector(`.ahr-image-size[data-deck-index="${deckIndex}"]`);
            if (!dim) return;
            dim.textContent = text;
            dim.title = `文件：${entry.filename}\n${tip}`;
        };
        if (source.error) {
            setDim(source.error);
            return;
        }
        const plan = await this.loadPlan(source, this.currentMegapixels(), this.currentUpscale());
        if (at !== this.generation || this.disposed) return;
        if (plan?.error) {
            setDim(plan.error);
            return;
        }
        setDim(sizeLine({ source, plan }), sizeLine({ source, plan, full: true }));
    }

    refreshAllImageSizes() {
        for (const [deckIndex, entry] of this.entries.entries()) {
            void this.fillImageCard(entry, deckIndex);
        }
    }

    // ---------- Audio Cards (DAW Scrub-to-Trim Waveform + Standard & Strip Layouts) ----------
    buildAudioWaveBox(entry, deckIndex, strip = false) {
        const key = mediaKey(entry);
        const waveWrap = el("div", strip ? "hub-wave-wrap is-strip" : "hub-wave-wrap");
        const wave = el("canvas", "ahr-wave");
        wave.dataset.deckIndex = String(deckIndex);
        wave.dataset.mediaKey = key;

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
        timePill.dataset.infoIndex = String(deckIndex);
        waveWrap.append(wave, sel, timePill);
        return { waveWrap, wave };
    }

    syncWaveSelection(waveWrap, total, entry) {
        const sel = waveWrap?.querySelector(".hub-wave-sel");
        if (!sel) return;
        if (!(total > 0)) {
            sel.hidden = true;
            waveWrap.classList.remove("is-trimmed");
            return;
        }
        const trim = trimRange(entry);
        const win = resolveTrim(total, trim.start, trim.duration) || { first: 0, last: total };
        const trimmed = win.first > 0.01 || win.last < total - 0.01;
        const leftPct = Math.max(0, Math.min(100, (win.first / total) * 100));
        const rightPct = Math.max(leftPct, Math.min(100, (win.last / total) * 100));
        sel.hidden = false;
        sel.style.left = `${leftPct}%`;
        sel.style.width = `${Math.max(0.5, rightPct - leftPct)}%`;
        sel.classList.toggle("is-trimmed", trimmed);
        waveWrap.classList.toggle("is-trimmed", trimmed);
    }

    bindWaveScrubTrim(waveWrap, canvas, deckIndex, onSyncUi) {
        const EDGE_HIT_PX = 12;
        const MIN_TRIM_SEC = 0.1;
        const round1 = value => Math.round(value * 10) / 10;

        const currentEntry = () => this.entries[deckIndex];

        const detectMode = (clientX, target) => {
            const entry = currentEntry();
            if (!entry) return "scrub";
            const total = this.audioDurations.get(mediaKey(entry));
            if (!total || !(total > 0)) return "scrub";
            const rect = waveWrap.getBoundingClientRect();
            if (!rect.width) return "scrub";
            const trim = trimRange(entry);
            const win = resolveTrim(total, trim.start, trim.duration) || { first: 0, last: total };
            const trimmed = win.first > 0.01 || win.last < total - 0.01;
            const leftPx = rect.left + (win.first / total) * rect.width;
            const rightPx = rect.left + (win.last / total) * rect.width;
            const distL = Math.abs(clientX - leftPx);
            const distR = Math.abs(clientX - rightPx);

            const edgeEl = target?.closest?.(".hub-wave-handle[data-trim-edge]");
            if (edgeEl) {
                if (distL <= EDGE_HIT_PX && distR <= EDGE_HIT_PX) return distL <= distR ? "start" : "end";
                return edgeEl.dataset.trimEdge === "start" ? "start" : "end";
            }
            if (distL <= EDGE_HIT_PX && distL <= distR) return "start";
            if (distR <= EDGE_HIT_PX) return "end";
            if (trimmed && clientX > leftPx && clientX < rightPx) return "move";
            return "scrub";
        };

        waveWrap.addEventListener("pointermove", event => {
            if (waveWrap.classList.contains("is-scrubbing")) return;
            waveWrap.dataset.hoverMode = detectMode(event.clientX, event.target);
        });
        waveWrap.addEventListener("pointerleave", () => {
            if (!waveWrap.classList.contains("is-scrubbing")) delete waveWrap.dataset.hoverMode;
        });

        waveWrap.addEventListener("dblclick", event => {
            event.preventDefault();
            event.stopPropagation();
            const entry = currentEntry();
            if (!entry) return;
            const trim = trimRange(entry);
            if (trim.start === 0 && trim.duration === 0) return;
            this.applyTrim(deckIndex, 0, 0, false);
            onSyncUi?.(currentEntry());
            void this.drawWaveform(canvas, currentEntry(), deckIndex);
            this.toast(`已重置「${entry.label || entry.filename}」裁切为全长`);
        });

        waveWrap.addEventListener("pointerdown", event => {
            if (event.button !== 0) return;
            const entry = currentEntry();
            if (!entry) return;
            const total = this.audioDurations.get(mediaKey(entry));
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
            const initTrim = trimRange(entry);
            const orig = resolveTrim(total, initTrim.start, initTrim.duration) || { first: 0, last: total };
            const origOpenEnd = initTrim.duration === 0 && orig.last >= total - 0.05;
            const windowLen = Math.max(MIN_TRIM_SEC, orig.last - orig.first);
            const moveThreshold = mode === "scrub" ? 4 : 1;
            let moved = false;
            let draftStart = initTrim.start;
            let draftDuration = initTrim.duration;

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
                    const maxStart = Math.max(0, orig.last - MIN_TRIM_SEC);
                    let nextStart = Math.max(0, Math.min(maxStart, t));
                    if (nextStart <= 0.05) nextStart = 0;
                    draftStart = round1(nextStart);
                    draftDuration = origOpenEnd ? 0 : Math.max(MIN_TRIM_SEC, round1(orig.last - draftStart));
                } else if (mode === "end") {
                    const minEnd = Math.min(total, orig.first + MIN_TRIM_SEC);
                    const nextEnd = Math.max(minEnd, Math.min(total, t));
                    draftStart = round1(orig.first);
                    draftDuration = nextEnd >= total - 0.05 ? 0 : Math.max(MIN_TRIM_SEC, round1(nextEnd - orig.first));
                } else if (mode === "move") {
                    const deltaSec = ((cx - startX) / rect.width) * total;
                    const maxStart = Math.max(0, total - windowLen);
                    let nextStart = Math.max(0, Math.min(maxStart, orig.first + deltaSec));
                    if (nextStart <= 0.05) nextStart = 0;
                    const nextEnd = Math.min(total, nextStart + windowLen);
                    draftStart = round1(nextStart);
                    draftDuration = nextEnd >= total - 0.05 && nextStart <= 0.05 ? 0 : Math.max(MIN_TRIM_SEC, round1(windowLen));
                } else {
                    const a = Math.min(t0, t);
                    const b = Math.max(t0, t);
                    draftStart = a <= 0.05 ? 0 : round1(a);
                    draftDuration = b >= total - 0.05 && draftStart === 0 ? 0 : Math.max(MIN_TRIM_SEC, round1(b - draftStart));
                }
                const previewEntry = { ...currentEntry(), start: draftStart, duration: draftDuration };
                onSyncUi?.(previewEntry);
                this.syncWaveSelection(waveWrap, total, previewEntry);
                void this.drawWaveform(canvas, previewEntry, deckIndex);
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
                this.applyTrim(deckIndex, draftStart, draftDuration, false);
                const saved = currentEntry();
                onSyncUi?.(saved);
                void this.drawWaveform(canvas, saved, deckIndex);
                const win = resolveTrim(total, draftStart, draftDuration);
                if (win) {
                    const verb = mode === "start" ? "已微调起点" : mode === "end" ? "已微调终点" : mode === "move" ? "已平移选区" : "已框选裁切";
                    this.toast(`${verb} ${formatSeconds(win.first)}–${formatSeconds(win.last)}`);
                }
            };

            const onCancel = () => {
                teardown();
                const saved = currentEntry();
                if (saved) {
                    onSyncUi?.(saved);
                    void this.drawWaveform(canvas, saved, deckIndex);
                }
            };

            this.pointerDragCleanup = teardown;
            window.addEventListener("pointermove", onMove, true);
            window.addEventListener("pointerup", onUp, true);
            window.addEventListener("pointercancel", onCancel, true);
        });
    }

    buildAudioTrimInput(entry, deckIndex, field, label, tip, canvas, onSyncUi) {
        const trim = trimRange(entry);
        const wrap = el("label", "hub-aud-unit");
        wrap.title = tip;
        const input = el("input");
        input.type = "number";
        input.step = "0.1";
        if (field === "duration") input.min = "0";
        input.value = String(trim[field] || 0);
        input.setAttribute("aria-label", label);
        input.addEventListener("change", () => {
            const val = Number(input.value);
            const ok = Number.isFinite(val) && (field === "start" || val >= 0);
            const nextStart = field === "start" ? (ok ? val : 0) : null;
            const nextDur = field === "duration" ? (ok ? val : 0) : null;
            this.applyTrim(deckIndex, nextStart, nextDur, false);
            const cur = this.entries[deckIndex];
            if (cur) {
                const t = trimRange(cur);
                input.value = String(t[field] || 0);
                onSyncUi?.(cur);
                void this.drawWaveform(canvas, cur, deckIndex);
            }
        });
        wrap.append(el("span", "hub-aud-unit-lbl", label), input, el("span", "hub-aud-unit-s", "s"));
        return { wrap, input };
    }

    audioCard(entry, deckIndex, slot, activeCountTotal) {
        const parked = slot < 0;
        const key = mediaKey(entry);
        const port = parked ? "" : slotName("audio", slot);
        const node = el("article", `ahr-card hub-aud-card hub-aud-s1${parked ? " is-skipped" : ""}${this.flashKey === key ? " is-flash" : ""}`);
        node.dataset.deckIndex = String(deckIndex);
        node.dataset.skip = String(parked);
        node.dataset.mediaKey = key;

        // Row 1: Grip + Play + Slot Badge + Name + Actions
        const r1 = el("div", "hub-aud-r1");
        const grip = el("div", "hub-row-grip hub-aud-grip", "⋮⋮");
        grip.title = "按住上下拖动排序，或拖入停用区";
        grip.setAttribute("aria-label", "拖动排序");

        const play = this.audioPreviewButton(entry, deckIndex);

        const badge = el("span", `hub-aud-badge${parked ? " is-off" : ""}`, parked ? "停用" : port);
        badge.title = parked ? `文件：${entry.filename}\n已停用` : `文件：${entry.filename}\n输出端口：${port}`;

        const name = el("input", "ahr-name hub-img-name");
        name.value = entry.label || "";
        name.placeholder = entry.filename || slotTitle("audio", Math.max(0, slot));
        name.title = entry.filename || "";
        name.maxLength = 60;
        name.setAttribute("aria-label", "音频自定义名称");
        name.addEventListener("change", () => this.setCardLabel(deckIndex, name.value, name));
        name.addEventListener("keydown", event => {
            event.stopPropagation();
            if (event.key === "Enter") { event.preventDefault(); name.blur(); }
            else if (event.key === "Escape") { name.value = entry.label || ""; name.blur(); }
        });

        const acts = el("div", "hub-row-acts");
        if (!parked) {
            const upBtn = el("button", "ahr-btn hub-btn hub-row-nudge", "↑");
            upBtn.type = "button";
            upBtn.title = "上移一位";
            upBtn.disabled = slot <= 0;
            upBtn.addEventListener("click", event => { event.stopPropagation(); this.placeWithFeedback(deckIndex, false, slot - 1); });

            const downBtn = el("button", "ahr-btn hub-btn hub-row-nudge", "↓");
            downBtn.type = "button";
            downBtn.title = "下移一位";
            downBtn.disabled = slot >= activeCountTotal - 1;
            downBtn.addEventListener("click", event => { event.stopPropagation(); this.placeWithFeedback(deckIndex, false, slot + 1); });
            acts.append(upBtn, downBtn);
        }

        const replaceBtn = el("button", "ahr-btn hub-btn", "替换");
        replaceBtn.type = "button";
        replaceBtn.title = "替换成新音频（槽位与自定义名称不变）";
        replaceBtn.addEventListener("click", event => { event.stopPropagation(); this.pickReplacement(deckIndex); });

        const toggleBtn = el("button", `ahr-btn hub-btn${parked ? " is-accent" : ""}`, parked ? "启用" : "停用");
        toggleBtn.type = "button";
        toggleBtn.title = parked ? "启用：加入输出槽位" : "停用：保留卡片，但不输出、不占槽位";
        toggleBtn.addEventListener("click", event => { event.stopPropagation(); this.toggleCardSkip(deckIndex, parked); });

        const delBtn = el("button", "ahr-icon-btn hub-icon-btn is-danger hub-row-del", "×");
        delBtn.type = "button";
        delBtn.title = "移除卡片（原文件不会被删除）";
        delBtn.setAttribute("aria-label", "移除卡片");
        delBtn.addEventListener("click", event => { event.stopPropagation(); this.dropCard(deckIndex); });

        acts.append(replaceBtn, toggleBtn, delBtn);
        r1.append(grip, play, badge, name, acts);

        // Row 2: Waveform + Trim Inputs + Reset
        const r2 = el("div", "hub-aud-r2");
        const { waveWrap, wave } = this.buildAudioWaveBox(entry, deckIndex, false);
        const trimGroup = el("div", "hub-aud-trim");
        const metaEl = el("div", "h3rl-aud-meta", "读取音频信息中…");
        metaEl.dataset.metaIndex = String(deckIndex);

        const syncUi = cur => {
            if (!cur) return;
            const t = trimRange(cur);
            startCtl.input.value = String(t.start || 0);
            durCtl.input.value = String(t.duration || 0);
            this.updateAudioMetaLine(cur, deckIndex);
        };
        const startCtl = this.buildAudioTrimInput(entry, deckIndex, "start", "起", "截取起始时间（秒，负数表示从结尾倒数）", wave, syncUi);
        const durCtl = this.buildAudioTrimInput(entry, deckIndex, "duration", "长", "截取时长（秒，0 表示截到结尾）", wave, syncUi);
        const resetBtn = el("button", "ahr-btn hub-btn h3rl-aud-reset", "↺");
        resetBtn.type = "button";
        resetBtn.title = "清除裁切：输出整段音频";
        resetBtn.addEventListener("click", event => {
            event.stopPropagation();
            this.applyTrim(deckIndex, 0, 0, false);
            const cur = this.entries[deckIndex];
            syncUi(cur);
            void this.drawWaveform(wave, cur, deckIndex);
        });

        trimGroup.append(startCtl.wrap, durCtl.wrap, resetBtn);
        r2.append(waveWrap, trimGroup);
        this.bindWaveScrubTrim(waveWrap, wave, deckIndex, syncUi);

        const r3 = el("div", "hub-aud-r3");
        r3.append(metaEl);

        node.append(r1, r2, r3);
        this.bindPointerDrag(grip, node, entry, deckIndex, parked, "vertical");
        return node;
    }

    audioStrip(entry, deckIndex, slot, activeCountTotal) {
        const parked = slot < 0;
        const key = mediaKey(entry);
        const open = this.expandedAudioDrawers.has(key);
        const port = parked ? "" : slotName("audio", slot);
        const node = el("article", `ahr-card hub-aud-card hub-aud-s2${parked ? " is-skipped" : ""}${this.flashKey === key ? " is-flash" : ""}`);
        node.dataset.deckIndex = String(deckIndex);
        node.dataset.skip = String(parked);
        node.dataset.mediaKey = key;

        const strip = el("div", "hub-aud-strip");
        const grip = el("div", "hub-row-grip hub-aud-grip", "⋮⋮");
        grip.title = "按住上下拖动排序，或拖入停用区";
        grip.setAttribute("aria-label", "拖动排序");

        const play = this.audioPreviewButton(entry, deckIndex);

        const idCol = el("div", "hub-aud-idcol");
        const idTop = el("div", "hub-aud-idtop");
        const miniBadge = el("span", `hub-aud-badge is-mini${parked ? " is-off" : ""}`, parked ? "停" : `A${slot + 1}`);
        miniBadge.title = parked ? `已停用\n文件：${entry.filename}` : `${port}\n文件：${entry.filename}`;

        const name = el("input", "ahr-name hub-aud-mini-name");
        name.value = entry.label || "";
        name.placeholder = entry.filename || slotTitle("audio", Math.max(0, slot));
        name.title = entry.filename || "";
        name.maxLength = 60;
        name.setAttribute("aria-label", "音频自定义名称");
        name.addEventListener("change", () => this.setCardLabel(deckIndex, name.value, name));
        name.addEventListener("keydown", event => {
            event.stopPropagation();
            if (event.key === "Enter") { event.preventDefault(); name.blur(); }
            else if (event.key === "Escape") { name.value = entry.label || ""; name.blur(); }
        });
        idTop.append(miniBadge, name);

        const metaEl = el("div", "h3rl-aud-meta", parked ? "已停用" : port);
        metaEl.dataset.metaIndex = String(deckIndex);
        idCol.append(idTop, metaEl);

        const { waveWrap, wave } = this.buildAudioWaveBox(entry, deckIndex, true);

        const acts = el("div", "hub-row-acts");
        const drawerBtn = el("button", "ahr-btn hub-btn hub-aud-drawer-btn");
        drawerBtn.type = "button";
        drawerBtn.title = "展开或收起精确裁切设置";
        const syncDrawerBtn = cur => {
            const t = trimRange(cur || entry);
            const lit = open || t.start !== 0 || t.duration > 0;
            drawerBtn.classList.toggle("is-lit", lit);
            drawerBtn.textContent = open ? "收起" : "裁切";
        };
        syncDrawerBtn(entry);
        drawerBtn.addEventListener("click", event => {
            event.stopPropagation();
            if (this.expandedAudioDrawers.has(key)) this.expandedAudioDrawers.delete(key);
            else this.expandedAudioDrawers.add(key);
            this.render();
        });
        acts.append(drawerBtn);

        if (!parked) {
            const upBtn = el("button", "ahr-btn hub-btn hub-row-nudge", "↑");
            upBtn.type = "button";
            upBtn.title = "上移一位";
            upBtn.disabled = slot <= 0;
            upBtn.addEventListener("click", event => { event.stopPropagation(); this.placeWithFeedback(deckIndex, false, slot - 1); });

            const downBtn = el("button", "ahr-btn hub-btn hub-row-nudge", "↓");
            downBtn.type = "button";
            downBtn.title = "下移一位";
            downBtn.disabled = slot >= activeCountTotal - 1;
            downBtn.addEventListener("click", event => { event.stopPropagation(); this.placeWithFeedback(deckIndex, false, slot + 1); });
            acts.append(upBtn, downBtn);
        }

        const replaceBtn = el("button", "ahr-icon-btn hub-icon-btn");
        replaceBtn.type = "button";
        replaceBtn.title = "替换成新音频";
        replaceBtn.append(icon("refresh"));
        replaceBtn.addEventListener("click", event => { event.stopPropagation(); this.pickReplacement(deckIndex); });

        const toggleBtn = el("button", `ahr-btn hub-btn${parked ? " is-accent" : ""}`, parked ? "启用" : "停");
        toggleBtn.type = "button";
        toggleBtn.title = parked ? "启用" : "停用";
        toggleBtn.addEventListener("click", event => { event.stopPropagation(); this.toggleCardSkip(deckIndex, parked); });

        const delBtn = el("button", "ahr-icon-btn hub-icon-btn is-danger hub-row-del", "×");
        delBtn.type = "button";
        delBtn.title = "移除卡片";
        delBtn.setAttribute("aria-label", "移除卡片");
        delBtn.addEventListener("click", event => { event.stopPropagation(); this.dropCard(deckIndex); });

        acts.append(replaceBtn, toggleBtn, delBtn);
        strip.append(grip, play, idCol, waveWrap, acts);
        node.append(strip);

        let startCtl = null;
        let durCtl = null;
        const syncUi = cur => {
            if (!cur) return;
            const t = trimRange(cur);
            if (startCtl) startCtl.input.value = String(t.start || 0);
            if (durCtl) durCtl.input.value = String(t.duration || 0);
            syncDrawerBtn(cur);
            this.updateAudioMetaLine(cur, deckIndex);
        };

        if (open) {
            const drawer = el("div", "hub-aud-drawer");
            startCtl = this.buildAudioTrimInput(entry, deckIndex, "start", "起点", "截取起始时间（秒，负数表示从结尾倒数）", wave, syncUi);
            durCtl = this.buildAudioTrimInput(entry, deckIndex, "duration", "时长", "截取时长（秒，0 表示截到结尾）", wave, syncUi);
            const resetBtn = el("button", "ahr-btn hub-btn hub-aud-reset", "重置全长");
            resetBtn.type = "button";
            resetBtn.addEventListener("click", () => {
                this.applyTrim(deckIndex, 0, 0, false);
                const cur = this.entries[deckIndex];
                syncUi(cur);
                void this.drawWaveform(wave, cur, deckIndex);
            });
            drawer.append(startCtl.wrap, durCtl.wrap, resetBtn);
            node.append(drawer);
        }

        this.bindWaveScrubTrim(waveWrap, wave, deckIndex, syncUi);
        this.bindPointerDrag(grip, node, entry, deckIndex, parked, "vertical");
        return node;
    }

    async peaks(entry) {
        const key = mediaKey(entry);
        if (!peakCache.has(key)) {
            peakCache.set(key, (async () => {
                const url = this.viewUrl(entry);
                const response = await fetch(await (api.resolveMedia?.(url) ?? url));
                const buffer = await response.arrayBuffer();
                const Ctor = window.AudioContext || window.webkitAudioContext;
                if (!Ctor) throw new Error("AudioContext unavailable");
                const context = new Ctor();
                try {
                    const audio = await context.decodeAudioData(buffer);
                    const data = audio.getChannelData(0);
                    const bins = 240;
                    const size = Math.max(1, Math.floor(data.length / bins));
                    const values = [];
                    for (let i = 0; i < bins; i++) {
                        let peak = 0;
                        for (let j = i * size; j < Math.min(data.length, (i + 1) * size); j += 16) {
                            peak = Math.max(peak, Math.abs(data[j]));
                        }
                        values.push(peak);
                    }
                    return { values, duration: audio.duration, sampleRate: audio.sampleRate, channels: audio.numberOfChannels };
                } finally {
                    context.close?.();
                }
            })());
            peakCache.get(key).catch(() => peakCache.delete(key));
        }
        return peakCache.get(key);
    }

    updateAudioMetaLine(entry, deckIndex) {
        const metaEl = this.root?.querySelector(`[data-meta-index="${deckIndex}"]`);
        if (!metaEl) return;
        const meta = this.audioMetaCache.get(mediaKey(entry));
        if (!meta) return;
        const trim = trimRange(entry);
        const text = audioInfoLine({
            duration: meta.duration,
            sampleRate: meta.sampleRate,
            channels: meta.channels,
            trimStart: trim.start,
            trimLength: trim.duration,
        });
        metaEl.textContent = text;
        metaEl.title = `${entry.filename}\n${text}`;
        const win = resolveTrim(meta.duration, trim.start, trim.duration);
        metaEl.classList.toggle("is-warn", Boolean(win?.empty));
    }

    drawWaveforms() {
        for (const canvas of this.root.querySelectorAll("canvas.ahr-wave")) {
            const idx = Number(canvas.dataset.deckIndex);
            const entry = this.entries[idx];
            if (entry) void this.drawWaveform(canvas, entry, idx);
        }
    }

    async drawWaveform(canvas, entry, deckIndex) {
        let data;
        try { data = await this.peaks(entry); } catch { return; }
        const key = mediaKey(entry);
        this.audioDurations.set(key, data.duration);
        this.audioMetaCache.set(key, data);
        if (!canvas.isConnected) return;
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.round(rect.width * ratio));
        canvas.height = Math.max(1, Math.round(rect.height * ratio));
        const ctx = canvas.getContext("2d");
        const trim = trimRange(entry);
        const win = resolveTrim(data.duration, trim.start, trim.duration) || { first: 0, last: data.duration };
        const width = canvas.width;
        const height = canvas.height;
        const bar = width / data.values.length;
        ctx.clearRect(0, 0, width, height);

        const trimmed = data.duration > 0 && (win.first > 0.01 || win.last < data.duration - 0.01);
        const x1 = data.duration > 0 ? (win.first / data.duration) * width : 0;
        const x2 = data.duration > 0 ? (win.last / data.duration) * width : width;
        if (trimmed) {
            ctx.fillStyle = "rgba(240, 180, 90, 0.14)";
            ctx.fillRect(x1, 0, Math.max(2 * ratio, x2 - x1), height);
        }

        const loudest = Math.max(0.05, ...data.values);
        data.values.forEach((value, index) => {
            const time = (index + 0.5) / data.values.length * data.duration;
            ctx.fillStyle = time >= win.first && time <= win.last ? "#f0b45a" : "#4e402c";
            const h = Math.max(2 * ratio, value / loudest * height * 0.78);
            ctx.fillRect(index * bar + bar * 0.15, (height - h) / 2, Math.max(1, bar * 0.7), h);
        });

        const waveWrap = canvas.closest(".hub-wave-wrap");
        if (waveWrap) this.syncWaveSelection(waveWrap, data.duration, entry);

        if (this.audio && this.previewAudioKey === key && data.duration > 0) {
            const px = Math.max(0, Math.min(width - 2 * ratio, (this.audio.currentTime / data.duration) * width));
            ctx.fillStyle = "#3fc8b4";
            ctx.fillRect(px, 0, Math.max(1.5, 2 * ratio), height);
        }

        const info = this.root.querySelector(`[data-info-index="${deckIndex}"]`);
        if (info) {
            info.textContent = info.closest(".hub-aud-s2")
                ? `${formatSeconds(win.first)}–${formatSeconds(win.last)}`
                : `${formatSeconds(win.first)}–${formatSeconds(win.last)} / ${formatSeconds(data.duration)}`;
        }
        this.updateAudioMetaLine(entry, deckIndex);
    }

    audioPreviewButton(entry, deckIndex) {
        const key = mediaKey(entry);
        const active = this.audio && this.previewAudioKey === key;
        const button = iconButton(active ? "pause" : "play", "试听裁切片段", () => this.toggleAudio(deckIndex, button),
            `hub-aud-play${active ? " is-playing" : ""}`);
        if (active) this.previewAudioButton = button;
        return button;
    }

    startAudioPlayhead(deckIndex, key) {
        cancelAnimationFrame(this.audioPlayRaf);
        const tick = () => {
            this.audioPlayRaf = 0;
            if (!this.audio || this.previewAudioKey !== key || this.audio.paused) return;
            const canvas = this.root?.querySelector(`canvas.ahr-wave[data-deck-index="${deckIndex}"]`);
            const cur = this.entries[deckIndex];
            if (canvas && cur) void this.drawWaveform(canvas, cur, deckIndex);
            this.audioPlayRaf = requestAnimationFrame(tick);
        };
        this.audioPlayRaf = requestAnimationFrame(tick);
    }

    stopAudio() {
        cancelAnimationFrame(this.audioPlayRaf);
        this.audioPlayRaf = 0;
        const audio = this.audio;
        if (!audio) return;
        const prevKey = this.previewAudioKey;
        const button = this.previewAudioButton;
        this.audio = null;
        this.previewAudioKey = null;
        this.previewAudioButton = null;
        if (button) {
            button.classList.remove("is-playing");
            if (button.firstChild) button.firstChild.className = "pi pi-play";
        }
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        if (prevKey) {
            const idx = this.entries.findIndex(item => mediaKey(item) === prevKey);
            const canvas = idx >= 0 ? this.root?.querySelector(`canvas.ahr-wave[data-deck-index="${idx}"]`) : null;
            if (canvas && this.entries[idx]) void this.drawWaveform(canvas, this.entries[idx], idx);
        }
    }

    toggleAudio(deckIndex, button) {
        const entry = this.entries[deckIndex];
        if (!entry) return;
        const key = mediaKey(entry);
        const same = this.previewAudioKey === key;
        this.stopAudio();
        if (same) return;

        const audio = new Audio();
        this.audio = audio;
        this.previewAudioKey = key;
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
            const cur = this.entries[deckIndex] || entry;
            const trim = trimRange(cur);
            const win = resolveTrim(audio.duration, trim.start, trim.duration) || { first: 0, last: audio.duration };
            audio.currentTime = win.first;
            audio.addEventListener("timeupdate", () => { if (audio.currentTime >= win.last) finish(); });
            audio.play().then(() => {
                if (this.audio === audio) this.startAudioPlayhead(deckIndex, key);
            }).catch(() => finish(true));
        }, { once: true });
        audio.addEventListener("pause", () => finish());
        audio.addEventListener("ended", () => finish());
        audio.addEventListener("error", () => finish(true));
        const url = this.viewUrl(entry);
        Promise.resolve(api.resolveMedia?.(url) ?? url).then(src => {
            if (this.audio === audio) audio.src = src;
        }, () => finish(true));
    }

    // ---------- Pointer Drag Sorting (zoom-immune, active <-> parked) ----------
    cancelPointerDrag() {
        if (!this.pointerDragCleanup) return;
        const cleanup = this.pointerDragCleanup;
        this.pointerDragCleanup = null;
        cleanup();
    }

    bindPointerDrag(handleEl, cardEl, entry, deckIndex, parked, axis) {
        const NO_DRAG = "button, input, textarea, select, label, [contenteditable]";
        const cardSelector = this.spec.kind === "image" ? ".hub-img-card, .hub-img-row" : ".hub-aud-card";
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
                this.root?.querySelectorAll(".is-drop-before, .is-drop-after, .is-drop-full").forEach(n => {
                    n.classList.remove("is-drop-before", "is-drop-after", "is-drop-full");
                    n.removeAttribute("data-drop-hint");
                });
                this.root?.querySelectorAll(".ahr-zone.is-drop").forEach(n => n.classList.remove("is-drop"));
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
                    this.root.dataset.dragging = this.spec.kind;
                    ghost = el("div", `hub-drag-ghost${this.spec.kind === "audio" ? " is-audio" : ""}`);
                    if (this.spec.kind === "image") {
                        const thumb = el("img");
                        thumb.src = imageThumbnailUrl(api, entry);
                        thumb.alt = "";
                        thumb.addEventListener("error", () => { if (!thumb.dataset.fb) { thumb.dataset.fb = "1"; thumb.src = this.viewUrl(entry); } });
                        ghost.append(thumb);
                    } else {
                        ghost.append(icon("volume-up"));
                    }
                    const badgeLabel = parked ? "停用" : slotName(this.spec.kind, deckIndex);
                    ghost.append(el("code", "", badgeLabel), el("span", "", entry.label || entry.filename));
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
                const hit = under?.closest?.(cardSelector);
                const { active } = splitEntries(this.entries);

                if (hit && this.root.contains(hit) && Number(hit.dataset.deckIndex) !== deckIndex) {
                    const hitDeckIdx = Number(hit.dataset.deckIndex);
                    const hitSkip = hit.dataset.skip === "true";
                    const rect = hit.getBoundingClientRect();
                    const after = axis === "vertical"
                        ? e2.clientY > rect.top + rect.height / 2
                        : e2.clientX > rect.left + rect.width / 2;

                    if (!hitSkip && parked && active.length >= this.spec.max) {
                        hit.classList.add("is-drop-full");
                        hit.setAttribute("data-drop-hint", `启用区已满 (${this.spec.max}/${this.spec.max})`);
                    } else {
                        hit.classList.add(after ? "is-drop-after" : "is-drop-before");
                        if (!hitSkip) {
                            const remaining = active.filter((_, i) => i !== deckIndex);
                            const targetItem = this.entries[hitDeckIdx];
                            const tIdx = remaining.indexOf(targetItem);
                            const pos = tIdx < 0 ? remaining.length : tIdx + (after ? 1 : 0);
                            hit.setAttribute("data-drop-hint", `→ ${slotName(this.spec.kind, pos)}`);
                        } else {
                            hit.setAttribute("data-drop-hint", "→ 停用区");
                        }
                    }
                    dropTarget = { hitDeckIdx, after, skip: hitSkip };
                } else {
                    const zone = under?.closest?.(".ahr-zone");
                    if (zone && this.root.contains(zone)) {
                        const zoneSkip = zone.classList.contains("is-parked");
                        if (zoneSkip !== parked) {
                            zone.classList.add("is-drop");
                            dropTarget = { hitDeckIdx: -1, after: true, skip: zoneSkip };
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
                if (target.hitDeckIdx >= 0) {
                    const { active, parked: parkedList } = splitEntries(this.entries);
                    const hitItem = this.entries[target.hitDeckIdx];
                    const group = (target.skip ? parkedList : active).filter(item => item !== entry);
                    const tIdx = group.indexOf(hitItem);
                    const insertIdx = tIdx < 0 ? group.length : tIdx + (target.after ? 1 : 0);
                    this.placeWithFeedback(deckIndex, target.skip, insertIdx);
                } else if (target.skip !== parked) {
                    this.placeWithFeedback(deckIndex, target.skip, Infinity);
                }
            };

            const onCancel = () => {
                const wasStarted = started;
                teardown();
                if (wasStarted) this.suppressPreviewUntil = Date.now() + 260;
            };

            const onKeyDown = e2 => {
                if (e2.key === "Escape") { e2.preventDefault(); e2.stopPropagation(); onCancel(); }
            };

            this.pointerDragCleanup = teardown;
            window.addEventListener("pointermove", onMove, true);
            window.addEventListener("pointerup", onUp, true);
            window.addEventListener("pointercancel", onCancel, true);
            window.addEventListener("keydown", onKeyDown, true);
        });
    }

    // ---------- Card Mutations ----------
    placeWithFeedback(deckIndex, targetSkip, targetGroupIndex) {
        const current = this.entries[deckIndex];
        if (!current) return false;
        const result = placeEntryAt(this.entries, deckIndex, targetSkip, targetGroupIndex, this.spec.max);
        if (!result.ok) {
            if (result.reason === "full") {
                this.toast(`${this.spec.noun}最多启用 ${this.spec.max} 个，请先停用一个再启用`, true);
            }
            return false;
        }
        this.entries = result.entries;
        this.flashKey = result.key;
        this.commit(true);
        clearTimeout(this.flashTimer);
        this.flashTimer = setTimeout(() => {
            this.flashKey = null;
            this.root?.querySelector(".is-flash")?.classList.remove("is-flash");
        }, 760);
        const dest = result.slot >= 0 ? slotName(this.spec.kind, result.slot) : "停用区";
        this.toast(`已将「${current.label || current.filename}」移至 ${dest}`);
        return true;
    }

    toggleCardSkip(deckIndex, currentlyParked) {
        this.placeWithFeedback(deckIndex, !currentlyParked, Infinity);
    }

    batchSkip(skip) {
        const result = setAllEntriesSkip(this.entries, skip, this.spec.max);
        if (!result.changed && !result.left) return;
        this.entries = result.entries;
        this.commit(true);
        if (skip) this.toast(`已停用全部${this.spec.noun}（${result.changed} 个）`);
        else if (result.left) this.toast(`已启用 ${result.changed} 个，槽位上限 ${this.spec.max}，其余 ${result.left} 个仍停用`, !result.changed);
        else this.toast(`已启用全部${this.spec.noun}（${result.changed} 个）`);
    }

    dropCard(deckIndex) {
        const target = this.entries[deckIndex];
        if (!target) return;
        if (this.previewAudioKey === mediaKey(target)) this.stopAudio();
        this.entries = removeEntry(this.entries, deckIndex);
        this.commit(true);
    }

    setCardLabel(deckIndex, value, inputEl) {
        const current = this.entries[deckIndex];
        if (!current) return;
        try {
            this.entries = replaceEntry(this.entries, deckIndex, { ...current, label: value });
            this.commit(false);
            const updated = this.entries[deckIndex];
            if (inputEl) inputEl.value = updated.label || "";
        } catch (error) {
            if (inputEl) inputEl.value = current.label || "";
            this.toast(`名称无效：${error.message}`, true);
        }
    }

    applyTrim(deckIndex, startValue, durationValue, rerender = false) {
        const current = this.entries[deckIndex];
        if (!current) return;
        const trim = trimRange(current);
        try {
            this.entries = replaceEntry(this.entries, deckIndex, {
                ...current,
                start: startValue === null ? trim.start : startValue,
                duration: durationValue === null ? trim.duration : durationValue,
            });
            this.commit(rerender);
        } catch (error) {
            this.toast(`裁切无效：${error.message}`, true);
            this.render();
        }
    }

    pickReplacement(deckIndex) {
        this.replaceIndex = deckIndex;
        this.replaceInput.click();
    }

    async replaceWith(deckIndex, file) {
        if (mediaKind(file.name) !== this.spec.kind) {
            this.toast(`请选择${this.spec.noun}文件替换`, true);
            return;
        }
        try {
            const uploaded = await this.uploadFile(file, this.activeProject);
            const old = this.entries[deckIndex];
            if (!old) return;
            if (this.previewAudioKey === mediaKey(old)) this.stopAudio();
            const merged = { ...uploaded };
            if (isSkipped(old)) merged.skip = true;
            this.entries = replaceEntry(this.entries, deckIndex, merged);
            this.commit(true);
            this.toast(`已替换为「${uploaded.filename}」`);
        } catch (error) {
            this.toast(error.message || "替换失败", true);
        }
    }

    // ---------- File Upload & External Drop ----------
    async uploadFile(file, project) {
        const form = new FormData();
        const subfolder = `${this.spec.uploadSubfolder}/${projectFolder(project)}`;
        form.append("image", file);
        form.append("subfolder", subfolder);
        form.append("type", "input");
        const res = await api.fetchApi("/upload/image", { method: "POST", body: form });
        if (!res.ok) throw new Error(`上传失败：${res.status} ${res.statusText}`);
        const data = await res.json().catch(() => ({}));
        if (!data.name) throw new Error("上传失败：服务器未返回文件名");
        return {
            filename: data.name,
            subfolder: typeof data.subfolder === "string" && data.subfolder ? data.subfolder : subfolder,
            type: data.type || "input",
        };
    }

    async addFiles(fileList) {
        if (this.projectOperation || this.disposed) {
            this.toast("项目正在切换，请稍后再添加素材", true);
            return;
        }
        const files = [...(fileList ?? [])];
        if (!files.length) return;
        const usable = files.filter(file => mediaKind(file.name) === this.spec.kind);
        const wrong = files.length - usable.length;
        if (!usable.length) {
            this.toast(`只能添加${this.spec.noun}文件`, true);
            return;
        }
        this.pendingImports += 1;
        const project = this.activeProject;
        const incoming = [];
        const failed = [];
        try {
            for (const [pos, file] of usable.entries()) {
                if (this.disposed) return;
                this.toast(`上传中 ${pos + 1}/${usable.length}…`);
                try {
                    incoming.push(await this.uploadFile(file, project));
                } catch {
                    failed.push(file.name);
                }
            }
            if (this.disposed) return;
            const result = addEntries(this.entries, incoming, this.spec.max);
            this.entries = result.entries;
            this.commit(true);
            const notes = [];
            if (result.added) notes.push(`已添加 ${result.added} 个`);
            if (result.parked) notes.push(`${result.parked} 个超出上限已停用`);
            if (result.skipped) notes.push(`跳过 ${result.skipped} 个重复文件`);
            if (wrong) notes.push(`忽略 ${wrong} 个非${this.spec.noun}文件`);
            if (failed.length) notes.push(`失败 ${failed.length} 个`);
            if (notes.length) this.toast(notes.join(" · "), failed.length > 0 && !result.added);
        } finally {
            this.pendingImports -= 1;
        }
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
            if (!event.dataTransfer?.types?.includes("Files")) return;
            const target = event.target.closest?.("[data-file-drop]");
            this.setFileHover(target && this.root.contains(target) ? target : this.root);
        };
        this.root.addEventListener("dragenter", updateHover, true);
        this.root.addEventListener("dragover", updateHover, true);
        this.root.addEventListener("drop", () => this.setFileHover(), true);
        this.root.addEventListener("dragover", event => {
            if (!event.dataTransfer?.types?.includes("Files")) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "copy";
        });
        this.root.addEventListener("dragleave", event => {
            if (!this.root.contains(event.relatedTarget)) this.setFileHover();
        });
        this.root.addEventListener("drop", event => {
            if (!event.dataTransfer?.files?.length) return;
            event.preventDefault();
            event.stopPropagation();
            void this.addFiles(event.dataTransfer.files);
        });
    }

    // ---------- Shared Library Browser & Preset Management ----------
    openLibrary() {
        openLibraryBrowser({
            scope: this.spec.kind,
            current: this.activeProject,
            url: path => this.url(path),
            fetchJson: (path, options) => this.fetchJson(path, options),
            directReferenceSwitch: true,
            onUse: name => !this.disposed && void this.switchProject(name),
            onRenamed: (from, to) => {
                if (this.disposed) return;
                if (this.activeProject === from) {
                    this.writeProjectWidget(to);
                    this.presetRevision = undefined;
                    this.render();
                    void this.refreshPreset(to);
                }
            },
            onDeleted: name => {
                if (this.disposed) return;
                if (this.activeProject === name) {
                    this.preset = null;
                    this.presetRevision = null;
                    this.syncStatusUi();
                    this.toast("项目已删除，当前卡片仍保留在节点中");
                }
            },
        });
    }

    showCreateProject(container) {
        if (container.classList.contains("is-creating")) return container.querySelector(".hub-create-input")?.focus();
        const noun = this.spec.noun;
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
            const ok = await this.switchProject(projectFolder(typed), { create: true });
            if (!ok && input.isConnected) {
                error.textContent = this.statusEl?.textContent || "创建失败";
                confirm.disabled = false;
                input.focus();
            }
        });
        form.append(input, confirm, cancel);
        container.classList.add("is-creating");
        container.replaceChildren(form, error);
        input.focus();
    }

    async openLocalFolder() {
        try {
            await this.fetchJson("/amiaomiao_h3/lvm/project/open", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ project: this.activeProject, scope: this.spec.kind }),
            });
            this.toast(`已打开「${this.activeProject}」本地目录`);
        } catch (error) {
            this.toast(`打开目录失败：${error.message}`, true);
        }
    }

    chooseProjectAction(message, actions) {
        this.projectChoice = { message, actions };
        this.render();
        this.body?.querySelector(".ahr-project-choice button:last-child")?.focus();
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

    async runProjectAction(action) {
        if (this.projectOperation || this.disposed) return false;
        if (this.pendingImports) {
            this.toast("正在上传素材，请稍后再操作项目", true);
            return false;
        }
        const op = {};
        const current = () => this.projectOperation === op && !this.disposed;
        this.projectChoice = null;
        this.projectOperation = op;
        if (this.body) {
            this.body.inert = true;
            this.body.setAttribute("aria-busy", "true");
        }
        let result;
        try {
            result = await action(current);
        } catch (error) {
            if (current()) {
                this.projectOperation = null;
                if (this.body) {
                    this.body.inert = false;
                    this.body.setAttribute("aria-busy", "false");
                }
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

    async onRefreshOrReloadClick() {
        this.sourceCache.clear();
        this.planCache.clear();
        this.audioMetaCache.clear();
        await this.refreshPreset(this.activeProject);
        const { dirty, diskCount } = this.presetDirtyState();
        if (diskCount > 0 && dirty) {
            this.chooseProjectAction(
                `项目「${this.activeProject}」磁盘预设共 ${diskCount} 张，与当前节点卡片不同：`,
                [
                    ["从项目库载入预设", () => void this.switchProject(this.activeProject, { refresh: true, decision: "discard" }), "is-accent"],
                    ["仅刷新当前尺寸与波形", () => { this.render(); this.toast("已刷新当前卡片尺寸与音频信息"); }],
                ]
            );
            return;
        }
        this.render();
        this.toast("已刷新项目状态与卡片信息");
    }

    async readProjectPreset(project) {
        const data = await this.fetchJson(
            `/amiaomiao_h3/lvm/ref_presets?strict=1&kind=${this.spec.kind}&project=${encodeURIComponent(project)}`
        );
        if (!(data.revision === null || typeof data.revision === "string") || !Array.isArray(data.references)) {
            throw new Error("无法读取项目预设，请重启 ComfyUI 后重试");
        }
        return data;
    }

    async writeProjectPreset(project) {
        // Omit expected_revision so ref_presets.py preserves H3 ReferenceHub annotations
        // (card_id / purpose / note) for retained files on shared libraries.
        const saved = await this.fetchJson("/amiaomiao_h3/lvm/ref_presets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: this.spec.kind, project, entries: serializeMedia(this.entries) }),
        });
        return saved;
    }

    switchProject(target, { refresh = false, create = false, decision, forceSave = false } = {}) {
        if (this.projectOperation || this.disposed) return false;
        const source = this.activeProject;
        const { bound, dirty } = this.presetDirtyState();
        if (!refresh && !create && target === source && bound) return false;

        if (dirty && !decision && (refresh || !bound)) {
            const proceed = choice => void this.switchProject(target, { refresh, create, decision: choice });
            const message = refresh
                ? `载入「${target}」会替换当前节点未保存的改动。`
                : `当前卡片尚未保存到「${source}」，切换前要如何处理？`;
            this.chooseProjectAction(message, refresh ? [
                ["放弃改动并载入", () => proceed("discard"), "is-danger-solid"],
            ] : [
                ["保存并切换", () => proceed("save"), "is-accent"],
                ["不保存，直接切换", () => proceed("discard")],
            ]);
            return true;
        }

        return this.runProjectAction(async current => {
            let data;
            if (!create) {
                data = await this.readProjectPreset(target);
                if (!current()) return;
                if (!data.revision && target !== source && target !== DEFAULT_PROJECT) {
                    throw new Error(`项目「${target}」不存在，当前卡片未更改`);
                }
            }
            const shouldSaveOld = !refresh && (decision === "save" || forceSave
                || (bound && dirty && decision !== "discard"));
            if (shouldSaveOld) {
                if (!forceSave && bound) {
                    const latest = await this.readProjectPreset(source);
                    if (!current()) return;
                    if (latest.revision !== this.presetRevision) {
                        const verb = create ? `新建「${target}」` : `切换到「${target}」`;
                        return () => this.chooseProjectAction(
                            `原项目「${source}」在磁盘上已有更新（磁盘 ${latest.references.length} 张），切换前要如何处理？`,
                            [
                                [`覆盖保存「${source}」并切换`, () => void this.switchProject(target, { refresh, create, decision: "save", forceSave: true }), "is-accent"],
                                [`不保存，直接${verb}`, () => void this.switchProject(target, { refresh, create, decision: "discard" })],
                            ]
                        );
                    }
                }
                const saved = await this.writeProjectPreset(source);
                if (!current()) return;
                this.presetRevision = saved.revision ?? null;
                if (!create && target === source) data = await this.readProjectPreset(target);
            }

            if (create) {
                const created = await this.fetchJson("/amiaomiao_h3/lvm/project", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ project: target, scope: this.spec.kind }),
                });
                if (!current()) return;
                target = created.name || target;
                data = await this.readProjectPreset(target);
            }
            if (!current()) return;

            this.closePreview();
            this.stopAudio();
            this.writeProjectWidget(data?.project_name || target);
            this.preset = data || { project_name: target, references: [] };
            this.presetRevision = data?.revision ?? null;
            this.entries = applyPreset([], pickPresetEntries(this.preset), this.spec.max).entries;
            this.commit(false);
            return `${refresh ? "已载入" : "已切换到"}${this.spec.noun}项目「${this.activeProject}」：${this.entries.length} 张`;
        });
    }

    saveProjectPreset(force = false) {
        const project = this.activeProject;
        const { bound } = this.presetDirtyState();
        return this.runProjectAction(async current => {
            if (!force) {
                const latest = await this.readProjectPreset(project);
                if (!current()) return;
                if (bound && latest.revision !== this.presetRevision) {
                    return () => this.chooseProjectAction(
                        `项目「${project}」在磁盘上已有更新（磁盘 ${latest.references.length} 张），要如何处理？`,
                        [
                            ["用当前卡片覆盖保存", () => void this.saveProjectPreset(true), "is-accent"],
                            ["放弃改动，载入磁盘最新版", () => void this.switchProject(project, { refresh: true, decision: "discard" }), "is-danger-solid"],
                        ]
                    );
                }
                if (!bound && latest.references.length) {
                    const diskSig = serializeMedia(applyPreset([], latest.references, this.spec.max).entries);
                    if (diskSig !== serializeMedia(this.entries)) {
                        return () => this.chooseProjectAction(
                            `用当前 ${this.entries.length} 张卡片替换「${project}」里已保存的 ${latest.references.length} 张素材？`,
                            [["确认保存", () => void this.saveProjectPreset(true), "is-accent"]]
                        );
                    }
                }
            }
            const saved = await this.writeProjectPreset(project);
            if (!current()) return;
            this.preset = { project_name: saved.name || project, references: JSON.parse(serializeMedia(this.entries)) };
            this.presetRevision = saved.revision ?? null;
            return `已保存到${this.spec.noun}项目「${project}」（${this.entries.length} 张）`;
        });
    }

    // ---------- Lightbox Preview ----------
    openPreview(src, title) {
        this.closePreview();
        const overlay = el("div", "ahr-preview");
        const frame = el("div", "ahr-preview-frame");
        const head = el("div", "ahr-preview-head");
        head.append(el("span", "", title || ""), iconButton("times", "关闭", () => this.closePreview()));
        const img = el("img");
        img.src = src;
        frame.append(head, img);
        overlay.append(frame);
        overlay.addEventListener("click", event => { if (event.target === overlay) this.closePreview(); });
        this.previewEscape = event => { if (event.key === "Escape") this.closePreview(); };
        document.addEventListener("keydown", this.previewEscape);
        document.body.append(overlay);
        this.preview = overlay;
    }

    closePreview() {
        this.preview?.remove();
        this.preview = null;
        if (this.previewEscape) {
            document.removeEventListener("keydown", this.previewEscape);
            this.previewEscape = null;
        }
    }
}

function installRefPanel(node, spec) {
    const panel = new RefLoaderPanel(node, spec);
    addPanel(node, "h3ref_panel", panel.root, spec.panelH);
    node.size = [
        Math.max(node.size?.[0] || 0, spec.defaultW),
        Math.max(node.size?.[1] || 0, spec.defaultH),
    ];
    node._h3lvmRefPanel = panel;
    node._h3lvmRefRefresh = () => panel.syncFromNodeConfigure();
    node._h3lvmRefDispose = () => panel.dispose();
}
