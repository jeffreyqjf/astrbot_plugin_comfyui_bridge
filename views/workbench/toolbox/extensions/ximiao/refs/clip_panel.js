// Panels for「H3 片段选择 v2」and「H3 片段保存 v2」.
// The picker edits the node's own hidden widgets (project_name, mode,
// clip_selection, passes and continuation settings), so saved workflows keep their values in place.
import { openLibraryBrowser, relativeTime, fullTime } from "./library_browser.js";
import { AUDIO_LENGTH_MAX, CONTEXT_LENGTHS, FLOW_DUAL, FLOW_SINGLE, LATEST, MODE_CONTINUE, MODE_NEW, PASS_ONE, PASS_TWO,
    chainOf, isLatest, normalizeContext, normalizeMode, normalizePasses, parentLabel, plannedStatus,
    resolutionOf, shotLabel, splitStageCards, variantsOf } from "./clip_state.js";

const DENSITY_KEY = "amiaomiao.clipv2.density";
const CARD_SCALE_KEY = "amiaomiao.clipv2.card-scale";
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
    const node = el("button", `ahc-icon-btn ${className}`.trim());
    node.type = "button";
    node.title = title;
    node.setAttribute("aria-label", title);
    node.append(icon(name));
    node.addEventListener("click", event => { event.stopPropagation(); onClick(event); });
    return node;
}
function textButton(label, iconName, onClick, className = "") {
    const node = el("button", `ahc-btn ${className}`.trim());
    node.type = "button";
    if (iconName) node.append(icon(iconName));
    node.append(el("span", "", label));
    node.addEventListener("click", event => { event.stopPropagation(); onClick(event); });
    return node;
}
function readCardScale() {
    try {
        const savedScale = localStorage.getItem(CARD_SCALE_KEY);
        const legacy = localStorage.getItem(DENSITY_KEY);
        return normalizeCardScale(savedScale, legacy);
    } catch { return CARD_SCALE_DEFAULT; }
}
function thumbPlaceholder() {
    const box = el("div", "ahc-lib-thumb-empty");
    box.append(icon("video"));
    return box;
}
function eyebrow(label, { right = null, video = false } = {}) {
    const row = el("div", "ahc-eyebrow");
    const left = el("span", "ahc-eyebrow-title");
    left.append(el("span", `ahc-eyebrow-dot${video ? " is-video" : ""}`), el("span", "", label));
    row.append(left);
    if (right) row.append(right);
    return row;
}

export class ClipPickerPanel {
    // fields: { get(name), set(name, value) } bound to the node widgets. fetchJson(path, options), url(path).
    constructor({ fields, fetchJson, url, resolve = src => src, stageWorkflow = false }) {
        this.fields = fields;
        this.fetchJson = fetchJson;
        this.url = url || (path => path);
        this.resolve = resolve;
        this.stageWorkflow = stageWorkflow;
        this.clips = [];
        this.drafts = [];
        this.page = "complete";
        this.projects = null;
        this.projectRows = new Map();
        this.loading = true;
        this.error = "";
        this.lastRun = null;
        this.cardScale = readCardScale();
        this.view = "all";          // all | chain (only the chain the next run continues)
        this.batch = false;         // batch lock / delete mode
        this.marked = new Set();
        this.root = el("div", "ahr ahc ahc-picker");
        this.root.tabIndex = -1;
        // one toast for the panel's lifetime, so a re-render does not swallow a message
        this.status = el("div", "ahr-toast ahc-toast");
        this.status.setAttribute("role", "status");
        this.request = 0;
        this.root.addEventListener("dblclick", event => {
            const node = event.target.closest?.(".ahc-card[data-clip-id]");
            if (!node || this.batch || event.target.closest("button, input, .ahr-clear-confirm, .ahc-rerun-confirm")) return;
            const clip = this.cards.find(c => c.clip_id === node.dataset.clipId);
            if (!clip) return;
            const before = this.beforeClick;
            if (before && Date.now() - before.at < 800) {
                this.fields.set("mode", before.mode);
                this.fields.set("clip_selection", before.selection);
                this.status.classList.remove("is-visible");
                this.render();
            }
            this.beforeClick = null;
            this.openDetail(clip);
        });
        this.render();
        this.reload();
    }

    get project() { return String(this.fields.get("project_name") || "Default_Project"); }
    get mode() { return normalizeMode(this.fields.get("mode")); }
    get passes() { return normalizePasses(this.fields.get("passes")); }
    get selection() { return String(this.fields.get("clip_selection") ?? LATEST); }
    get dualStage() { return this.stageWorkflow && this.passes === FLOW_DUAL; }
    get assetKind() { return !this.stageWorkflow ? "v2" : this.dualStage ? "stage_dual" : "stage_single"; }
    get refineId() { return this.dualStage ? String(this.fields.get("refine_clip") || "") : ""; }
    get cards() { return [...this.clips, ...this.drafts]; }
    get draftPage() { return this.dualStage && this.page === "draft"; }
    get context() {
        return normalizeContext(this.fields.get("context_length"), this.fields.get("enable_audio_context"),
            this.fields.get("audio_context_length"));
    }

    set(name, value) {
        this.fields.set(name, value);
        this.render();
    }

    clearRefine() {
        this.fields.set("refine_clip", "");
        this.fields.set("refine_revision", "");
    }

    openPage(page) {
        this.page = page;
        this.batch = false;
        this.marked.clear();
        this.render();
    }

    chooseRefine(clip) {
        this.fields.set("refine_clip", clip.clip_id);
        this.fields.set("refine_revision", clip.stage_revision);
        this.render();
    }

    saved(info) {
        if (!this.stageWorkflow) return;
        const folder = name => String(name || "").replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "Default_Project";
        if (info.project && folder(info.project) !== folder(this.project)) return;
        if (info.stage === "first" && this.dualStage && !this.refineId && !this.openedDraftOnSave) {
            this.openedDraftOnSave = true;
            this.openPage("draft");
        }
        if (info.stage === "second" && this.refineId === info.clip_id) {
            this.clearRefine();
            this.openPage("complete");
        }
        this.lastRun = info;
        this.reload({ projects: true });
    }

    // What the next run continues from, or null. Only meaningful in 接续前段.
    target() {
        if (this.mode !== MODE_CONTINUE) return null;
        if (isLatest(this.selection)) return this.clips[0] || null;
        return this.clips.find(c => c.clip_id === this.selection) || null;
    }

    // Picking a clip always means "continue from this one":
    //  - in 全新段落 it switches back to 接续前段;
    //  - picking the newest while following keeps following;
    //  - anything else pins that clip.
    pick(clip) {
        const following = isLatest(this.selection);
        const wasNew = this.mode !== MODE_CONTINUE;
        if (wasNew) this.fields.set("mode", MODE_CONTINUE);
        if (following && clip === this.clips[0]) {
            this.render();
            this.toast(wasNew ? `已切到接续前段，跟随最新：${shotLabel(clip)}`
                : `正在跟随最新（${shotLabel(clip)}）。要固定它，关掉“跟随最新”`);
            return;
        }
        this.set("clip_selection", clip.clip_id);
        if (wasNew) this.toast(`已切到接续前段，固定：${shotLabel(clip)}`);
    }

    setFollow(on) {
        if (this.mode !== MODE_CONTINUE) this.fields.set("mode", MODE_CONTINUE);
        if (on) return this.set("clip_selection", LATEST);
        const newest = this.clips[0];
        if (newest) this.set("clip_selection", newest.clip_id);
        else this.render();
    }

    toast(message, error = false) {
        if (!this.status) return;
        this.status.textContent = message;
        this.status.classList.toggle("is-error", error);
        this.status.classList.add("is-visible");
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => this.status?.classList.remove("is-visible"), 2600);
    }

    async reload({ projects = false, restorePage = false } = {}) {
        const id = ++this.request;
        if (projects) this.projects = null;
        this.ensureProjects();
        try {
            const data = await this.fetchJson(`/amiaomiao_h3/clip_bin/list?project=${encodeURIComponent(this.project)}&asset_kind=${this.assetKind}`);
            if (id !== this.request) return;
            const { drafts, completed } = splitStageCards(data.clips || []);
            this.clips = completed;
            this.drafts = drafts;
            if (restorePage && this.refineId) this.page = drafts.some(c => c.clip_id === this.refineId) ? "draft" : "complete";
            this.error = "";
        } catch (error) {
            if (id !== this.request) return;
            this.clips = [];
            this.drafts = [];
            this.error = error.message;
        }
        this.loading = false;
        this.render();
    }

    ensureProjects() {
        if (!this.projects) {
            const query = this.stageWorkflow ? `?asset_kind=${this.assetKind}` : "";
            const req = this.fetchJson(`/amiaomiao_h3/clip_bin/projects${query}`);
            this.projects = req;
            req.then(data => {
                if (this.projects !== req) return;
                this.projectRows = new Map((data.projects || []).filter(r => r?.name).map(r => [r.name, r]));
                this.syncProjectCardMeta();
            }).catch(() => {
                if (this.projects === req) this.projects = null;
            });
        }
        return this.projects;
    }

    clipThumbUrl(clip) {
        if (!clip?.thumbnail_url) return "";
        return this.url(clip.thumbnail_url + (clip.stage_revision ? `&v=${encodeURIComponent(clip.stage_revision)}` : ""));
    }

    currentProjectVisual() {
        const meta = this.projectRows.get(this.project);
        const newest = this.clips[0] || this.drafts[0] || null;
        const coverUrl = newest ? this.clipThumbUrl(newest) : (meta?.cover_url ? this.url(meta.cover_url) : "");
        const updatedAt = newest?.created_at || meta?.updated_at || "";
        return { coverUrl, updatedAt, meta };
    }

    syncProjectCardMeta() {
        if (!this.libCardRefs || !this.libCardRefs.card.isConnected) return;
        const { thumb, metaBox, card } = this.libCardRefs;
        const { coverUrl, updatedAt } = this.currentProjectVisual();
        if (coverUrl && thumb.dataset.src !== coverUrl) {
            thumb.dataset.src = coverUrl;
            const img = el("img");
            img.src = coverUrl;
            img.alt = "";
            img.draggable = false;
            img.addEventListener("error", () => {
                thumb.dataset.src = "";
                thumb.replaceChildren(thumbPlaceholder());
            });
            thumb.replaceChildren(img);
        } else if (!coverUrl && thumb.dataset.src !== "") {
            thumb.dataset.src = "";
            thumb.replaceChildren(thumbPlaceholder());
        }
        const full = fullTime(updatedAt);
        card.title = full
            ? `点击打开片段项目库（最近更新：${full}）`
            : "点击打开片段项目库（切换、搜索、新建、重命名或删除）";
        if (this.loading && !this.clips.length && !this.drafts.length) {
            const count = Number(this.projectRows.get(this.project)?.clips);
            if (Number.isFinite(count) && count > 0) {
                metaBox.classList.remove("is-empty");
                const when = relativeTime(updatedAt);
                metaBox.replaceChildren(el("span", "ahc-lib-count", `${count} 片段`));
                if (when) metaBox.append(el("span", "ahc-lib-dot", "·"), el("span", "ahc-lib-time", when));
            }
        }
    }

    showResult(message) {
        const info = message?.h3_clip_v2?.[0];
        if (info) this.lastRun = info;
        this.reload({ projects: true });
    }

    dispose() {
        clearTimeout(this.toastTimer);
        document.querySelector(".ahc-modal")?._close?.();
    }

    // ---------- layout: Scheme A Studio Split (Soft Luminous + Resize-Proof) ----------
    render() {
        // never rebuild under a text field being typed in (checkbox/radio/range is fine)
        if (this.root.contains(document.activeElement)
            && document.activeElement.matches?.("input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea")) return;
        const railTop = this.railScroll?.scrollTop || 0;
        const stageTop = this.stageScroll?.scrollTop || 0;
        this.root.replaceChildren();
        const scale = normalizeCardScale(this.cardScale);
        this.cardScale = scale;
        this.root.dataset.density = "custom";
        this.root.dataset.compactCards = scale <= 0.75 ? "1" : "0";
        this.root.style.setProperty("--h3-card-scale", scale.toFixed(2));

        const split = el("div", "ahc-split");
        const rail = el("aside", "ahc-rail");
        this.railScroll = el("div", "ahc-rail-scroll");
        this.railScroll.append(this.projectBlock());
        if (this.refineId) {
            this.railScroll.append(this.refineBlock());
        } else {
            this.railScroll.append(this.modeBlock());
            const params = this.paramsBlock();
            if (params) this.railScroll.append(params);
        }
        rail.append(this.railScroll, this.planHud(), this.scaleFooter());

        const main = el("div", "ahc-main");
        const visible = this.visibleClips();
        main.append(this.stageTopbar(visible));
        const subbar = this.followSubbar();
        if (subbar) main.append(subbar);
        this.stageScroll = el("div", "ahc-stage-scroll");
        if (this.batch) this.stageScroll.append(this.batchBar(visible));
        this.stageScroll.append(this.clipGrid(visible));
        main.append(this.stageScroll);

        split.append(rail, main);
        this.root.append(split, this.status);
        this.railScroll.scrollTop = railTop;
        this.stageScroll.scrollTop = stageTop;
    }

    // ---------- Left Rail Block 1: Visual Project Card + Flow Switch + Actions ----------
    projectBlock() {
        const block = el("div", "ahc-block");
        const flowSeg = el("div", "ahc-seg");
        flowSeg.setAttribute("role", "radiogroup");
        flowSeg.setAttribute("aria-label", "工作流");
        for (const [value, tip] of [
            [FLOW_DUAL, "双采样工作流（一采 + 二采放大）：两个接续口都输出，保存一采和二采"],
            [FLOW_SINGLE, "单采样工作流（只采样一次）：只用一采接续，只保存一采"]]) {
            const btn = el("button", "", value);
            btn.type = "button";
            btn.title = tip;
            btn.setAttribute("role", "radio");
            btn.setAttribute("aria-checked", String(this.passes === value));
            btn.addEventListener("click", () => {
                if (this.passes === value) return;
                this.fields.set("passes", value);
                if (this.stageWorkflow) this.switchProject(this.project);
                else this.render();
            });
            flowSeg.append(btn);
        }
        const label = this.stageWorkflow ? (this.dualStage ? "双采项目库" : "单采项目库") : "项目库";
        block.append(eyebrow(label, { right: flowSeg }));

        // Visual Project Library Card Button (thumbnail + name + count/time -> opens library modal)
        const card = el("button", "ahc-lib-card");
        card.type = "button";
        card.setAttribute("aria-label", `切换项目库：${this.project}`);
        card.addEventListener("click", () => this.openLibrary());

        const { coverUrl, updatedAt } = this.currentProjectVisual();
        const thumb = el("div", "ahc-lib-thumb");
        thumb.dataset.src = coverUrl;
        if (coverUrl) {
            const img = el("img");
            img.src = coverUrl;
            img.alt = "";
            img.draggable = false;
            img.addEventListener("error", () => {
                thumb.dataset.src = "";
                thumb.replaceChildren(thumbPlaceholder());
            });
            thumb.append(img);
        } else {
            thumb.append(thumbPlaceholder());
        }

        const info = el("div", "ahc-lib-info");
        info.append(el("strong", "ahc-lib-name", this.project));
        const metaBox = el("div", "ahc-lib-meta");
        const clipCount = this.clips.length;
        const draftCount = this.drafts.length;
        if (this.loading && !clipCount && !draftCount) {
            metaBox.append(el("span", "ahc-lib-time", "读取中…"));
        } else if (clipCount || draftCount) {
            if (this.dualStage && draftCount) {
                metaBox.append(
                    el("span", "ahc-lib-count", `${clipCount} 成片`),
                    el("span", "ahc-lib-dot", "·"),
                    el("span", "ahc-lib-time", `${draftCount} 草稿`)
                );
            } else {
                const when = relativeTime(updatedAt);
                metaBox.append(el("span", "ahc-lib-count", `${clipCount} 片段`));
                if (when) metaBox.append(el("span", "ahc-lib-dot", "·"), el("span", "ahc-lib-time", when));
            }
        } else {
            metaBox.classList.add("is-empty");
            metaBox.append(el("span", "ahc-lib-count", "空库"), el("span", "ahc-lib-dot", "·"), el("span", "ahc-lib-time", "暂无片段"));
        }
        info.append(metaBox);

        const chev = el("span", "ahc-lib-chevron");
        chev.setAttribute("aria-hidden", "true");
        chev.append(icon("chevron-down"));
        card.append(thumb, info, chev);
        const full = fullTime(updatedAt);
        card.title = full
            ? `点击打开片段项目库（最近更新：${full}）`
            : "点击打开片段项目库（切换、搜索、新建、重命名或删除）";
        this.libCardRefs = { card, thumb, metaBox };
        this.ensureProjects();
        block.append(card);

        // Action row directly underneath project card
        const actionsWrap = el("div", "ahc-lib-actions-wrap");
        const actions = el("div", "ahc-lib-actions");
        const browse = textButton("浏览库", "folder-open", () => this.openLibrary());
        browse.title = "打开片段项目库（封面、内容预览、重命名、删除）";
        const create = textButton("新建", "plus", () => this.showCreateProject(actionsWrap));
        create.title = "新建片段项目";
        const refresh = iconButton("refresh", "刷新片段", () => this.reload({ projects: true }));
        actions.append(browse, create, refresh);
        actionsWrap.append(actions);
        block.append(actionsWrap);

        return block;
    }

    // Inline create inside the left rail action bar: Enter submits, Esc cancels.
    showCreateProject(container) {
        if (container.classList.contains("is-creating")) return container.querySelector(".ahc-create-input")?.focus();
        const saved = [...container.children];
        const form = el("form", "ahc-create-form");
        const input = el("input", "ahc-create-input");
        input.placeholder = "新项目名称…";
        input.maxLength = 80;
        input.setAttribute("aria-label", "新片段项目名称");
        const confirm = textButton("建立", "", () => {}, "is-solid");
        confirm.type = "submit";
        confirm.disabled = true;
        const error = el("div", "ahc-create-error");
        error.hidden = true;
        const restore = () => {
            container.classList.remove("is-creating");
            container.replaceChildren(...saved);
        };
        const cancel = iconButton("times", "取消新建", () => restore());
        input.addEventListener("input", () => {
            confirm.disabled = !input.value.trim();
            error.textContent = "";
            error.hidden = true;
        });
        input.addEventListener("keydown", event => {
            event.stopPropagation();
            if (event.key === "Escape") { event.preventDefault(); restore(); }
        });
        form.addEventListener("submit", async event => {
            event.preventDefault();
            const typed = input.value.trim();
            if (!typed) return;
            confirm.disabled = true;
            try {
                const data = await this.fetchJson("/amiaomiao_h3/clip_bin/project", { method: "POST",
                    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: typed }) });
                input.blur();
                this.switchProject(data.name || typed);
                this.toast(`已新建片段项目「${data.name || typed}」`);
            } catch (err) {
                error.textContent = err.message;
                error.hidden = false;
                confirm.disabled = false;
                input.focus();
            }
        });
        form.append(input, confirm, cancel);
        container.classList.add("is-creating");
        container.replaceChildren(form, error);
        input.focus();
    }

    // ---------- Left Rail Block 2: Generation Mode Cards ----------
    modeBlock() {
        const block = el("div", "ahc-block");
        block.append(eyebrow("生成模式"));
        const group = el("div", "ahc-mode-grid");
        group.setAttribute("role", "radiogroup");
        group.setAttribute("aria-label", "模式");
        const target = this.target();
        const contSub = this.loading ? "读取片段中…"
            : !this.clips.length ? "项目为空时将自动从头生成"
            : isLatest(this.selection) ? `跟随最新 · ${shotLabel(this.clips[0])}`
            : target ? `已固定 · ${shotLabel(target)}`
            : "固定接续的片段已不在项目里";
        for (const [value, title, sub, tip] of [
            [MODE_CONTINUE, "接续前段", contSub, "接着选中的片段（默认最新）往下生成；库是空的时自动按全新段落"],
            [MODE_NEW, "全新段落", "断开上下文，从头起新镜", "不接任何片段，从头生成"],
        ]) {
            const card = el("button", "ahc-mode-card");
            card.type = "button";
            card.title = tip;
            card.setAttribute("role", "radio");
            card.setAttribute("aria-checked", String(this.mode === value));
            const top = el("div", "ahc-mode-card-top");
            top.append(el("strong", "", title), el("span", "ahc-mode-radio"));
            card.append(top, el("small", "", sub));
            card.addEventListener("click", () => { if (this.mode !== value) this.set("mode", value); });
            group.append(card);
        }
        block.append(group);
        return block;
    }

    // ---------- Left Rail Refine Mode Card (replaces Mode + Params while refining) ----------
    refineBlock() {
        const block = el("div", "ahc-block");
        block.append(eyebrow("仅跑二采模式", { video: true }));
        const selected = this.cards.find(c => c.clip_id === this.refineId && c.stage_revision === this.fields.get("refine_revision"));
        const card = el("div", "ahc-refine-card");
        const top = el("div", "ahc-refine-top");
        const thumbUrl = this.clipThumbUrl(selected);
        if (thumbUrl) {
            const thumb = el("div", "ahc-refine-thumb");
            const img = el("img");
            img.src = thumbUrl;
            img.alt = "";
            img.draggable = false;
            img.addEventListener("error", () => thumb.remove());
            thumb.append(img);
            top.append(thumb);
        }
        const meta = el("div", "ahc-refine-meta");
        meta.append(el("strong", "", selected ? shotLabel(selected) : "选中的卡片已变更"));
        let note = "请重新选卡或退出仅二采";
        if (selected) {
            const parent = this.clips.find(c => c.clip_id === selected.parent_clip_id);
            const size = parent && resolutionOf(parent);
            if (parent) note = `接自 ${shotLabel(parent)}${size ? ` · 二采需 ${size}` : ""}`;
            else if (selected.parent_clip_id && selected.parent_clip_id !== "[INITIAL]") note = "找不到原接续片段";
            else note = "首段草稿补二采";
        }
        meta.append(el("small", "", note));
        top.append(meta);
        const cancel = textButton("退出仅二采，恢复常规生成", "times", () => { this.clearRefine(); this.render(); }, "is-full");
        card.append(top, cancel);
        block.append(card);
        return block;
    }

    // ---------- Left Rail Block 3: Sampling & Continuation Params (1px hairline card) ----------
    paramsBlock() {
        const hasContext = this.fields.get("context_length") != null;
        if (!this.dualStage && !hasContext) return null;
        const block = el("div", "ahc-block");
        block.append(eyebrow(this.dualStage ? "采样与接续参数" : "接续参数"));
        const box = el("div", "ahc-params-box");

        if (this.dualStage) {
            const row = el("div", "ahc-param-row");
            row.append(el("span", "ahc-param-lbl", "采样阶段"));
            const seg = el("div", "ahc-seg");
            seg.setAttribute("role", "group");
            seg.setAttribute("aria-label", "采样阶段");
            for (const [label, draft] of [["一+二采", false], ["只一采", true]]) {
                const btn = el("button", "", label);
                btn.type = "button";
                btn.title = draft ? "只跑一采并保存为一采草稿" : "完整执行一采与二采放大";
                btn.setAttribute("aria-pressed", String(Boolean(this.fields.get("draft_only")) === draft));
                btn.addEventListener("click", () => this.set("draft_only", draft));
                seg.append(btn);
            }
            row.append(seg);
            box.append(row);
        }

        if (hasContext) {
            const { video_frames, audio, audio_frames } = this.context;
            const disabled = this.mode !== MODE_CONTINUE;

            const rOverlap = el("div", `ahc-param-row${disabled ? " is-dim" : ""}`);
            const lbl = el("span", "ahc-param-lbl", "画面重叠");
            lbl.title = "沿用上一段结尾的画面帧数。Motion Context 接入「接续信息」后使用此设置。";
            const frames = el("div", "ahc-seg is-compact");
            frames.setAttribute("role", "group");
            frames.setAttribute("aria-label", "画面重叠");
            for (const value of CONTEXT_LENGTHS) {
                const btn = el("button", "", value);
                btn.type = "button";
                btn.disabled = disabled;
                btn.title = `${value} 帧 · ${(Number(value) / 24).toFixed(2)} 秒`;
                btn.setAttribute("aria-pressed", String(video_frames === Number(value)));
                btn.addEventListener("click", () => {
                    this.fields.set("context_length", value);
                    for (const item of frames.children) item.setAttribute("aria-pressed", String(item === btn));
                });
                frames.append(btn);
            }
            rOverlap.append(lbl, frames);
            box.append(rOverlap);

            const rAudio = el("div", `ahc-param-row${disabled ? " is-dim" : ""}`);
            const toggle = el("label", "ahc-toggle");
            toggle.title = "带入上一段结尾的声音。关闭不影响画面接续。";
            const check = el("input");
            check.type = "checkbox";
            check.checked = audio;
            check.disabled = disabled;
            toggle.append(check, el("span", "ahc-switch"), el("span", "", "声音接续"));

            const field = el("label", `ahc-unit-field${disabled || !audio ? " is-disabled" : ""}`);
            const length = el("input");
            Object.assign(length, { type: "number", min: 0, max: AUDIO_LENGTH_MAX, step: 1, value: audio_frames, disabled: disabled || !audio });
            length.setAttribute("aria-label", "声音接续帧数");
            length.title = "按视频帧计。填 0 时与画面重叠帧数相同。";
            field.append(length, el("span", "", "帧"));

            check.addEventListener("change", () => {
                this.fields.set("enable_audio_context", check.checked);
                length.disabled = disabled || !check.checked;
                field.classList.toggle("is-disabled", length.disabled);
            });
            length.addEventListener("change", () => {
                const value = normalizeContext(undefined, undefined, length.value).audio_frames;
                length.value = String(value);
                this.fields.set("audio_context_length", value);
            });

            rAudio.append(toggle, field);
            box.append(rAudio);
        }

        block.append(box);
        return block;
    }

    // ---------- Left Rail Bottom HUD: Next Run Plan ----------
    planHud() {
        const selected = this.cards.find(c => c.clip_id === this.refineId && c.stage_revision === this.fields.get("refine_revision"));
        const plan = this.loading ? { text: "读取片段…", tone: "continue" }
            : this.refineId ? selected ? { text: `仅跑二采 · ${shotLabel(selected)}`, tone: "refine" }
                : { text: "选中的卡片已变更，请重新选卡", tone: "error" }
            : plannedStatus({ project: this.project, mode: this.mode, passes: this.passes, clips: this.clips, selection: this.selection });

        let mainText = plan.text;
        if (!this.refineId && this.dualStage && this.fields.get("draft_only") && plan.tone !== "error" && !this.loading) {
            mainText = `${mainText} · 只跑一采存草稿`;
        }

        const newest = this.clips[0];
        const pinned = !this.refineId && !this.loading && this.mode === MODE_CONTINUE && !isLatest(this.selection) ? this.target() : null;
        const isPinnedOld = Boolean(pinned && newest && pinned !== newest);
        const tone = isPinnedOld && plan.tone === "continue" ? "warn" : plan.tone;

        const hud = el("div", `ahc-hud is-${tone}`);
        hud.setAttribute("role", "status");
        const head = el("div", "ahc-hud-head");
        head.append(el("span", `ahc-status-dot is-${tone}`), el("span", "", "下次运行确认"));
        hud.append(head, el("div", "ahc-hud-main", mainText));

        if (selected) {
            const parent = this.clips.find(c => c.clip_id === selected.parent_clip_id);
            const size = parent && resolutionOf(parent);
            if (parent) hud.append(el("div", "ahc-hud-sub", `接自 ${shotLabel(parent)}${size ? ` · 二采需 ${size}` : ""}`));
            else if (selected.parent_clip_id && selected.parent_clip_id !== "[INITIAL]") {
                hud.append(el("div", "ahc-hud-sub is-warn", "找不到原接续片段"));
            }
        } else if (isPinnedOld) {
            hud.append(el("div", "ahc-hud-sub is-warn", `已固定旧片段 ${shotLabel(pinned)}（非最新 ${shotLabel(newest)}），将从此分出新支`));
        } else if (!this.refineId && !this.loading && this.mode === MODE_CONTINUE && !plan.missing && this.clips.length) {
            hud.append(el("div", "ahc-hud-sub", isLatest(this.selection) ? "跟随最新 · 出新成片后自动顺延" : "已固定该镜头作为接续源"));
        }

        if (plan.missing || isPinnedOld) {
            const fix = textButton("改回跟随最新", "history", () => {
                this.setFollow(true);
                this.toast("已改回跟随最新");
            }, "ahc-hud-fix");
            hud.append(fix);
        }
        if (this.lastRun?.status && !this.loading) {
            hud.append(el("div", "ahc-hud-last", `上次运行：${this.lastRun.status}`));
        }
        return hud;
    }

    // ---------- Left Rail Bottom-Left Free Card-Size Slider (50%–200%, unified across all 4 nodes) ----------
    scaleFooter() {
        const foot = el("div", "ahc-rail-foot");
        const row = el("div", "ahc-scale-row");
        const label = el("span", "ahc-scale-lbl", "卡片大小");
        label.title = "拖动自由调节右侧卡片显示比例（双击恢复 100%）";
        const slider = el("input", "ahc-scale-slider");
        slider.type = "range";
        slider.min = String(CARD_SCALE_MIN);
        slider.max = String(CARD_SCALE_MAX);
        slider.step = String(CARD_SCALE_STEP);
        slider.value = this.cardScale.toFixed(2);
        slider.style.setProperty("--slider-pct", scaleProgress(this.cardScale));
        slider.setAttribute("aria-label", "卡片显示大小");
        slider.title = "左右拖动自由调节卡片大小（50%–200%，双击恢复 100%）";

        const valBtn = el("button", "ahc-scale-val", `${Math.round(this.cardScale * 100)}%`);
        valBtn.type = "button";
        valBtn.title = "点击恢复默认 100%";

        const applyScale = (nextRaw, persist = false) => {
            const next = normalizeCardScale(nextRaw);
            this.cardScale = next;
            slider.value = next.toFixed(2);
            slider.style.setProperty("--slider-pct", scaleProgress(next));
            valBtn.textContent = `${Math.round(next * 100)}%`;
            valBtn.classList.toggle("is-default", Math.abs(next - CARD_SCALE_DEFAULT) < 0.001);
            this.root.dataset.density = "custom";
            this.root.dataset.compactCards = next <= 0.75 ? "1" : "0";
            this.root.style.setProperty("--h3-card-scale", next.toFixed(2));
            if (persist) {
                try {
                    localStorage.setItem(CARD_SCALE_KEY, next.toFixed(2));
                    localStorage.setItem(DENSITY_KEY, scaleToLegacyDensity(next));
                } catch { /* optional */ }
            }
        };
        valBtn.classList.toggle("is-default", Math.abs(this.cardScale - CARD_SCALE_DEFAULT) < 0.001);
        slider.addEventListener("pointerdown", event => event.stopPropagation());
        slider.addEventListener("input", () => applyScale(slider.value, false));
        slider.addEventListener("change", () => applyScale(slider.value, true));
        slider.addEventListener("dblclick", () => applyScale(CARD_SCALE_DEFAULT, true));
        label.addEventListener("dblclick", () => applyScale(CARD_SCALE_DEFAULT, true));
        valBtn.addEventListener("click", () => applyScale(CARD_SCALE_DEFAULT, true));

        row.append(label, slider, valBtn);
        foot.append(row);
        return foot;
    }

    visibleClips() {
        if (this.draftPage) return this.drafts;
        if (this.view !== "chain") return this.clips;
        return chainOf(this.clips, this.target());
    }

    // ---------- Right Stage Topbar: Underline Tabs + View/Batch/Density ----------
    stageTopbar(visible) {
        const bar = el("div", "ahc-stage-topbar");
        if (this.dualStage) {
            const tabs = el("div", "ahc-utabs");
            tabs.setAttribute("role", "tablist");
            tabs.setAttribute("aria-label", "片段库");
            for (const [page, label, count, cls] of [
                ["complete", "二采成片", this.clips.length, ""],
                ["draft", "一采草稿", this.drafts.length, "is-draft"],
            ]) {
                const tab = el("button", `ahc-utab ${cls}`.trim());
                tab.type = "button";
                tab.setAttribute("role", "tab");
                tab.setAttribute("aria-selected", String(this.page === page));
                tab.append(el("span", "", label), el("span", "ahc-utab-num", this.loading ? "…" : String(count)));
                tab.addEventListener("click", () => this.openPage(page));
                tabs.append(tab);
            }
            bar.append(tabs);
        } else {
            const title = el("div", "ahc-stage-title");
            const countText = this.loading ? "…" : this.view === "chain" ? `${visible.length} / ${this.clips.length}` : String(this.clips.length);
            title.append(el("strong", "", this.stageWorkflow ? "单采片段" : "接续片段"), el("span", "ahc-utab-num", countText));
            bar.append(title);
        }

        const tools = el("div", "ahc-stage-tools");
        if (!this.draftPage) {
            const view = el("div", "ahc-seg");
            view.setAttribute("role", "radiogroup");
            view.setAttribute("aria-label", "显示");
            for (const [value, label, tip] of [
                ["all", "全部", "显示项目里的全部片段"],
                ["chain", "接续链", "只显示下次运行要接的这一支：所选片段、它接自的片段……一直往前"],
            ]) {
                const option = el("button", "", label);
                option.type = "button";
                option.title = tip;
                option.setAttribute("role", "radio");
                option.setAttribute("aria-checked", String(this.view === value));
                option.disabled = value === "chain" && !this.target();
                option.addEventListener("click", () => { if (this.view !== value) { this.view = value; this.render(); } });
                view.append(option);
            }
            tools.append(view);
        }

        const batch = textButton(this.batch ? "完成" : "批量", this.batch ? "check" : "check-square",
            () => { this.batch = !this.batch; this.marked.clear(); this.render(); }, this.batch ? "is-active" : "");
        batch.title = this.batch ? "退出批量选择" : "批量锁定、解锁或删除片段";
        batch.setAttribute("aria-pressed", String(this.batch));
        batch.disabled = !visible.length;
        tools.append(batch);

        bar.append(tools);
        return bar;
    }

    // ---------- Right Stage Subbar: Compact Follow Latest Toggle ----------
    followSubbar() {
        if (this.draftPage || this.refineId) return null;
        const follow = isLatest(this.selection);
        const newest = this.clips[0];
        const pinned = follow ? null : this.clips.find(c => c.clip_id === this.selection);
        const bar = el("div", `ahc-stage-subbar${this.mode === MODE_NEW ? " is-idle" : ""}`);

        const box = el("label", "ahc-toggle");
        box.title = follow ? "开着：每次运行都接最新的片段，存了新片段会自动换。点任意卡片可固定接那一段。"
            : "关着：固定接选中的那一段。打开则改回每次接最新。";
        const input = el("input");
        input.type = "checkbox";
        input.checked = follow;
        input.setAttribute("aria-label", "跟随最新");
        input.addEventListener("change", () => this.setFollow(input.checked));
        box.append(input, el("span", "ahc-switch"), el("span", "", "跟随最新"));

        let detail;
        if (this.loading) detail = "正在读取片段列表…";
        else if (!this.clips.length) detail = "库里还没有片段，首次运行将自动生成首段";
        else if (this.mode === MODE_NEW) detail = "全新段落模式：点击任意卡片可快速切回接续";
        else if (follow) detail = `自动接最新：${shotLabel(newest)} · 点击卡片可手动固定`;
        else detail = pinned ? `已固定：${shotLabel(pinned)} · 点击其他卡片切换` : "已固定的片段不在了，请重新选卡或打开跟随最新";

        const hint = el("span", "ahc-stage-subbar-hint", detail);
        hint.title = detail;
        bar.append(box, hint);
        return bar;
    }

    batchBar(visible) {
        const bar = el("div", "ahc-batch-bar");
        const all = el("label", "ahc-batch-all");
        const box = el("input");
        box.type = "checkbox";
        const ids = visible.map(c => c.clip_id);
        const markedVisible = ids.filter(id => this.marked.has(id));
        box.checked = ids.length > 0 && markedVisible.length === ids.length;
        box.indeterminate = markedVisible.length > 0 && !box.checked;
        box.setAttribute("aria-label", "全选");
        box.addEventListener("change", () => {
            if (box.checked) ids.forEach(id => this.marked.add(id)); else ids.forEach(id => this.marked.delete(id));
            this.render();
        });
        const chosen = this.cards.filter(c => this.marked.has(c.clip_id));
        const unlocked = chosen.filter(c => !c.locked);
        all.append(box, el("span", "", `全选（已选 ${chosen.length}）`));

        const lock = textButton("锁定", "lock", () => this.setLocks(chosen, true));
        lock.disabled = !chosen.some(c => !c.locked);
        const unlock = textButton("解锁", "unlock", () => this.setLocks(chosen, false));
        unlock.disabled = !chosen.some(c => c.locked);
        const remove = textButton(`删除 ${unlocked.length} 个`, "trash", () => {
            const confirm = el("div", "ahr-clear-confirm");
            confirm.setAttribute("role", "group");
            confirm.setAttribute("aria-label", "确认批量删除");
            const skipped = chosen.length - unlocked.length;
            const yes = textButton(`删除 ${unlocked.length} 个`, "trash", () => this.deleteMany(unlocked), "is-danger-solid");
            const no = textButton("取消", "", () => confirm.replaceWith(remove));
            confirm.append(el("span", "ahr-clear-text", skipped ? `删除？已锁定的 ${skipped} 个会保留` : "删除？"), yes, no);
            confirm.addEventListener("keydown", event => {
                if (event.key === "Escape") { event.stopPropagation(); confirm.replaceWith(remove); remove.focus(); }
            });
            remove.replaceWith(confirm);
            no.focus();
        }, "is-danger");
        remove.disabled = !unlocked.length;
        if (chosen.length && !unlocked.length) remove.title = "选中的片段都已锁定";

        const spacer = el("span", "ahc-spacer");
        bar.append(all, spacer, lock, unlock, remove);
        return bar;
    }

    clipGrid(visible) {
        const grid = el("div", `ahc-grid${this.draftPage ? " is-drafts" : this.mode === MODE_NEW && !this.refineId ? " is-idle" : ""}`);
        grid.setAttribute("role", "listbox");
        grid.setAttribute("aria-label", this.draftPage ? "一采草稿" : this.dualStage ? "二采成片" : "接续片段");
        if (this.error) {
            grid.append(this.empty("exclamation-triangle", `读取失败：${this.error}`, true));
        } else {
            for (const clip of visible) grid.append(this.card(clip));
            if (!this.loading && this.draftPage && !visible.length) {
                grid.append(this.empty("inbox", "暂无一采草稿", false, "在左栏开启「只一采」运行后，草稿会显示在这里供挑选二采"));
            } else if (!this.loading && !this.clips.length && !this.draftPage) {
                grid.append(this.empty("inbox", this.dualStage ? "暂无二采成片" : "这个项目还没有片段", false, "直接运行即可生成第一段镜头，或点击左栏项目卡切换其他库"));
            } else if (!this.loading && !visible.length) {
                grid.append(this.empty("share-alt", "没有可显示的接续链"));
            }
        }
        return grid;
    }

    async setLocks(clips, locked) {
        const targets = clips.filter(c => !!c.locked !== locked);
        if (!targets.length) return;
        try {
            await this.fetchJson("/amiaomiao_h3/clip_bin/lock", { method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ project: this.project, clip_ids: targets.map(c => c.clip_id), locked }) });
            for (const clip of targets) clip.locked = locked;
            this.render();
            this.toast(`${targets.length} 个片段已${locked ? "锁定" : "解锁"}`);
        } catch (error) {
            this.toast(`${locked ? "锁定" : "解锁"}失败：${error.message}`, true);
        }
    }

    async deleteMany(clips) {
        try {
            const result = await this.fetchJson("/amiaomiao_h3/clip_bin/delete_many", { method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ project: this.project, clip_ids: clips.map(c => c.clip_id) }) });
            const deleted = result.deleted || [];
            if (deleted.includes(this.selection)) this.fields.set("clip_selection", LATEST);
            for (const id of deleted) this.marked.delete(id);
            const kept = (result.locked || []).length;
            this.toast(`已删除 ${deleted.length} 个片段${kept ? `，${kept} 个已锁定的保留` : ""}`);
            await this.reload({ projects: true });
        } catch (error) {
            this.toast(`删除失败：${error.message}`, true);
        }
    }

    // Rename in place. Click the name to edit; Enter / blur saves, Esc cancels.
    nameEditor(clip) {
        const name = el("button", "ahc-name ahc-name-edit", shotLabel(clip));
        name.type = "button";
        name.title = "点击改名";
        name.setAttribute("aria-label", `改名：${shotLabel(clip)}`);
        name.addEventListener("click", event => {
            event.stopPropagation();
            const input = el("input", "ahr-name ahc-name-input");
            input.value = shotLabel(clip);
            input.maxLength = 60;
            input.setAttribute("aria-label", "镜头名");
            let done = false;
            const finish = async save => {
                if (done) return;
                done = true;
                const next = input.value.trim();
                if (!save || !next || next === shotLabel(clip)) { input.replaceWith(name); return; }
                try {
                    const data = await this.fetchJson("/amiaomiao_h3/clip_bin/rename", { method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ project: this.project, clip_id: clip.clip_id, shot_tag: next }) });
                    clip.shot_tag = data.shot_tag || next;
                    input.blur();
                    this.render();
                    this.toast(`已改名为「${clip.shot_tag}」`);
                } catch (error) {
                    input.replaceWith(name);
                    this.toast(`改名失败：${error.message}`, true);
                }
            };
            input.addEventListener("keydown", e => {
                e.stopPropagation();
                if (e.key === "Enter") { e.preventDefault(); finish(true); }
                if (e.key === "Escape") { e.preventDefault(); finish(false); }
            });
            input.addEventListener("blur", () => finish(true));
            for (const type of ["click", "dblclick", "pointerdown"]) input.addEventListener(type, e => e.stopPropagation());
            name.replaceWith(input);
            input.focus();
            input.select();
        });
        return name;
    }

    empty(glyph, text, error = false, sub = "") {
        const box = el("div", `ahc-empty${error ? " is-error" : ""}`);
        box.append(icon(glyph), el("strong", "", text));
        if (sub) box.append(el("small", "", sub));
        return box;
    }

    videoUrl(clip, variant) {
        const file = clip.variants?.[variant]?.video_file;
        if (file && clip.subfolder) {
            const query = new URLSearchParams({ filename: file, subfolder: clip.subfolder, type: "output" });
            if (clip.stage_revision) query.set("v", clip.stage_revision);
            return this.url(`/view?${query}`);
        }
        return clip.video_url ? this.url(clip.video_url) : "";
    }

    bestVideo(clip) {
        for (const variant of [PASS_TWO, PASS_ONE]) {
            if (clip.variants?.[variant]?.has_video) return this.videoUrl(clip, variant);
        }
        return clip.has_video ? this.url(clip.video_url) : "";
    }

    // ---------- cards ----------
    card(clip) {
        const draft = clip.clip_stage === "draft";
        const refining = clip.clip_id === this.refineId && clip.stage_revision === this.fields.get("refine_revision");
        const newest = !draft && clip === this.clips[0];
        const continuing = !draft && !this.refineId && this.mode === MODE_CONTINUE;
        const auto = continuing && isLatest(this.selection) && newest;
        const on = refining || auto || (continuing && this.selection === clip.clip_id);
        const card = el("article", `ahc-card${on ? " is-selected" : ""}${auto ? " is-auto" : ""}${refining ? " is-refining" : ""}${clip.locked ? " is-locked" : ""}`);
        card.setAttribute("role", "option");
        card.setAttribute("aria-selected", String(on));
        card.tabIndex = 0;
        card.dataset.clipId = clip.clip_id;
        card.title = draft || this.refineId ? "双击查看详情" : "单击接续这一段，双击查看详情";

        const cover = el("div", "ahc-cover");
        const thumbUrl = this.clipThumbUrl(clip);
        if (thumbUrl) {
            const image = el("img");
            image.src = thumbUrl;
            image.alt = "";
            image.loading = "lazy";
            image.draggable = false;
            image.addEventListener("error", () => image.replaceWith(icon("image")));
            cover.append(image);
        } else {
            cover.append(icon("image"));
        }
        cover.append(el("div", "ahc-cover-scrim"));

        if (this.bestVideo(clip)) {
            const play = el("button", "ahc-play");
            play.type = "button";
            play.title = "播放";
            play.setAttribute("aria-label", "播放");
            play.append(icon("play"));
            play.addEventListener("click", event => { event.stopPropagation(); this.openDetail(clip); });
            cover.append(play);
            this.hoverPreview(card, cover, clip);
        }

        if (refining) cover.append(el("span", "ahc-badge is-refining", "仅跑二采"));
        else if (draft) cover.append(el("span", "ahc-badge is-draft", "一采草稿"));
        else if (on) cover.append(el("span", "ahc-badge", auto ? "接续 · 自动" : "接续 · 已固定"));

        if (newest) cover.append(el("span", "ahc-newest", "最新"));
        if (clip.locked) {
            const lockDot = el("span", "ahc-lock-dot");
            lockDot.title = "已锁定";
            lockDot.append(icon("lock"));
            cover.append(lockDot);
        }

        // Hover-reveal frosted glass card tools
        const tools = el("div", "ahc-card-tools");
        const lock = el("button", `ahc-tbtn${clip.locked ? " is-locked" : ""}`);
        lock.type = "button";
        lock.title = clip.locked ? "已锁定，点击解锁" : "锁定，防止误删";
        lock.setAttribute("aria-label", lock.title);
        lock.setAttribute("aria-pressed", String(!!clip.locked));
        lock.append(icon(clip.locked ? "lock" : "lock-open"));
        lock.addEventListener("click", event => { event.stopPropagation(); this.setLock(clip, !clip.locked); });
        tools.append(lock, this.deleteButton(clip));

        if (this.dualStage && !draft && clip.stage_ready && !this.batch) {
            const confirm = el("div", "ahc-rerun-confirm");
            confirm.hidden = true;
            const cancel = () => { confirm.hidden = true; rerun.focus(); };
            const rerun = el("button", "ahc-tbtn ahc-tbtn-text");
            rerun.type = "button";
            rerun.disabled = Boolean(clip.locked);
            rerun.title = clip.locked ? "请先解锁这张成片" : "保留一采结果，重新跑二采";
            rerun.append(icon("refresh"), el("span", "", "二采"));
            rerun.addEventListener("click", event => {
                event.stopPropagation();
                confirm.hidden = !confirm.hidden;
                if (!confirm.hidden) confirm.querySelector("button")?.focus();
            });
            confirm.append(
                el("p", "", "二采成功后将替换当前二采结果，一采不变。"),
                textButton("取消", "", cancel),
                textButton("确认重跑", "check", () => this.chooseRefine(clip), "is-danger-solid")
            );
            confirm.addEventListener("click", e => e.stopPropagation());
            card.addEventListener("keydown", event => {
                if (event.key === "Escape" && !confirm.hidden) { event.stopPropagation(); cancel(); }
            });
            tools.append(rerun);
            card.append(confirm);
        }
        cover.append(tools);

        if (this.batch) {
            const mark = el("input", "ahc-mark");
            mark.type = "checkbox";
            mark.checked = this.marked.has(clip.clip_id);
            mark.setAttribute("aria-label", `选择 ${shotLabel(clip)}`);
            mark.addEventListener("click", e => e.stopPropagation());
            mark.addEventListener("change", () => {
                if (mark.checked) this.marked.add(clip.clip_id); else this.marked.delete(clip.clip_id);
                this.render();
            });
            cover.append(mark);
            card.classList.toggle("is-marked", mark.checked);
        }

        const body = el("div", "ahc-body");
        const nameRow = el("div", "ahc-name-row");
        nameRow.append(this.nameEditor(clip));
        const when = relativeTime(clip.created_at);
        if (when) {
            const time = el("span", "ahc-time", when);
            time.title = fullTime(clip.created_at);
            nameRow.append(time);
        }
        body.append(nameRow);

        const meta = el("div", "ahc-meta");
        const parent = parentLabel(clip, this.clips);
        meta.append(el("span", "", parent ? `接自 ${parent}` : "全新段落"), el("span", "", resolutionOf(clip)));
        body.append(meta);

        const passes = el("div", "ahc-passes");
        const have = variantsOf(clip);
        for (const name of [PASS_ONE, PASS_TWO]) {
            if (have[name] === undefined) continue;
            const pill = el("span", `ahc-pass${name === PASS_TWO ? " is-two" : ""}`);
            pill.append(el("b", "", name), el("span", "", have[name] ? `${have[name].toFixed(1)}s` : "—"));
            passes.append(pill);
        }
        body.append(passes);

        if (refining || (draft && clip.stage_ready && !this.batch)) {
            const actions = el("div", "ahc-draft-actions");
            if (refining) {
                const selected = el("span", "ahc-draft-selected");
                selected.append(icon("check"), el("span", "", "已选作仅跑二采"));
                actions.append(selected);
            } else {
                actions.append(textButton("用这张做二采", "arrow-right", () => this.chooseRefine(clip), "is-solid is-full"));
            }
            body.append(actions);
        }
        card.append(cover, body);

        card.addEventListener("click", event => {
            if (event.detail > 1 || event.target.closest("button, input, .ahr-clear-confirm, .ahc-rerun-confirm")) return;
            if (this.batch) {
                if (this.marked.has(clip.clip_id)) this.marked.delete(clip.clip_id); else this.marked.add(clip.clip_id);
                this.render();
                return;
            }
            if (draft || this.refineId) return;
            this.beforeClick = { at: Date.now(), mode: this.fields.get("mode"), selection: this.selection };
            this.pick(clip);
        });
        card.addEventListener("keydown", event => {
            if (event.target !== card) return;
            if (event.key === "Enter") { event.preventDefault(); this.openDetail(clip); }
            if (event.key === " ") {
                event.preventDefault();
                if (this.batch) {
                    if (this.marked.has(clip.clip_id)) this.marked.delete(clip.clip_id);
                    else this.marked.add(clip.clip_id);
                    this.render();
                } else if (!draft && !this.refineId) this.pick(clip);
            }
        });
        return card;
    }

    hoverPreview(card, cover, clip) {
        const src = this.bestVideo(clip);
        let video = null, timer = null;
        const stop = () => {
            clearTimeout(timer);
            if (video) { video.pause(); video.removeAttribute("src"); video.load(); video.remove(); video = null; }
        };
        card.addEventListener("mouseenter", () => {
            timer = setTimeout(() => {
                if (!card.isConnected) return;
                video = el("video", "ahc-hover");
                Object.assign(video, { src, muted: true, loop: true, playsInline: true, autoplay: true });
                cover.insertBefore(video, cover.querySelector(".ahc-play"));
            }, 220);
        });
        card.addEventListener("mouseleave", stop);
    }

    // Delete with inline confirm (no browser dialog); locked cards cannot be deleted.
    deleteButton(clip) {
        const button = el("button", "ahc-tbtn is-danger");
        button.type = "button";
        button.title = clip.locked ? "已锁定，先解锁才能删除" : "删除这个片段";
        button.setAttribute("aria-label", button.title);
        button.append(icon("trash"));
        button.disabled = !!clip.locked;
        button.addEventListener("click", event => {
            event.stopPropagation();
            const confirm = el("div", "ahr-clear-confirm");
            confirm.setAttribute("role", "group");
            confirm.setAttribute("aria-label", "确认删除片段");
            const yes = textButton("删除", "trash", async () => {
                yes.disabled = true;
                try {
                    await this.fetchJson("/amiaomiao_h3/clip_bin/delete", { method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ project: this.project, clip_id: clip.clip_id }) });
                    if (this.selection === clip.clip_id) this.fields.set("clip_selection", LATEST);
                    this.toast(`已删除 ${shotLabel(clip)}`);
                    await this.reload({ projects: true });
                } catch (error) {
                    this.toast(`删除失败：${error.message}`, true);
                    confirm.replaceWith(button);
                }
            }, "is-danger-solid");
            const no = textButton("取消", "", () => confirm.replaceWith(button));
            confirm.append(el("span", "ahr-clear-text", "删除？"), yes, no);
            confirm.addEventListener("click", e => e.stopPropagation());
            confirm.addEventListener("keydown", e => {
                if (e.key === "Escape") { e.stopPropagation(); confirm.replaceWith(button); button.focus(); }
            });
            button.replaceWith(confirm);
            no.focus();
        });
        return button;
    }

    async setLock(clip, locked) {
        try {
            await this.fetchJson("/amiaomiao_h3/clip_bin/lock", { method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ project: this.project, clip_ids: [clip.clip_id], locked }) });
            clip.locked = locked;
            this.render();
            this.toast(`${shotLabel(clip)} 已${locked ? "锁定" : "解锁"}`);
        } catch (error) {
            this.toast(`锁定失败：${error.message}`, true);
        }
    }

    openLibrary() {
        openLibraryBrowser({
            scope: "clips", current: this.project, url: this.url, clipAssetKind: this.assetKind,
            fetchJson: (path, options) => this.fetchJson(path, options),
            onUse: name => { this.switchProject(name); this.toast(`已切换到「${name}」`); },
            onPickClip: (name, clip) => {
                if (clip.clip_stage === "draft") {
                    this.switchProject(name);
                    this.openPage("draft");
                    this.chooseRefine(clip);
                } else {
                    this.switchProject(name, clip.clip_id);
                    this.toast(`接续 ${shotLabel(clip)}`);
                }
            },
            onRenamed: (from, to) => { this.projects = null; if (this.project === from) this.switchProject(to); else this.render(); },
            onDeleted: (name, next) => { this.projects = null; if (next) this.switchProject(next); else this.render(); },
        });
    }

    switchProject(name, selection = LATEST) {
        this.batch = false;
        this.marked.clear();
        this.fields.set("project_name", name);
        this.fields.set("clip_selection", selection);
        this.clearRefine();
        this.page = "complete";
        this.openedDraftOnSave = false;
        this.projects = null;
        this.loading = true;
        this.clips = [];
        this.drafts = [];
        this.render();
        this.reload();
    }

    // ---------- detail (library-browser dialog shell) ----------
    openDetail(clip) {
        document.querySelector(".ahc-modal")?._close?.();
        const overlay = el("div", "ahl-overlay ahc-modal is-open");
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.setAttribute("aria-label", shotLabel(clip));
        const dialog = el("div", "ahl-dialog ahc-dialog");
        const head = el("header", "ahl-head");
        const badge = el("span", "ahl-head-icon");
        badge.append(icon("video"));
        const close = el("button", "ahl-icon-btn ahl-close");
        close.type = "button";
        close.title = "关闭";
        close.setAttribute("aria-label", "关闭");
        close.append(icon("times"));
        head.append(badge, el("h2", "ahl-title", shotLabel(clip)), el("span", "ahl-count", this.project), close);
        const body = el("div", "ahc-detail");
        const stage = el("div", "ahc-stage");
        const have = variantsOf(clip);
        const available = [PASS_TWO, PASS_ONE].filter(v => clip.variants?.[v]?.has_video);
        const player = el("video", "ahc-player");
        player.controls = true;
        player.playsInline = true;
        let previewRequest = 0;
        const show = async variant => {
            const src = variant ? this.videoUrl(clip, variant) : this.bestVideo(clip);
            if (!src) return;
            const request = ++previewRequest;
            try {
                const url = await this.resolve(src);
                if (request !== previewRequest || !player.isConnected) return;
                player.src = url;
                await player.play().catch(() => {});
            } catch (error) { this.toast(error.message, true); }
        };
        if (available.length > 1) {
            const seg = el("div", "ahl-seg");
            seg.setAttribute("role", "group");
            seg.setAttribute("aria-label", "视频");
            for (const variant of available) {
                const option = el("button", "ahl-seg-btn", variant);
                option.type = "button";
                option.setAttribute("aria-pressed", String(variant === available[0]));
                option.addEventListener("click", () => {
                    for (const b of seg.children) b.setAttribute("aria-pressed", String(b === option));
                    show(variant);
                });
                seg.append(option);
            }
            stage.append(seg);
        }
        if (this.bestVideo(clip)) { stage.append(player); show(available[0]); }
        else {
            const still = el("div", "ahc-still");
            if (clip.thumbnail_url) { const img = el("img"); img.src = this.url(clip.thumbnail_url); img.alt = ""; still.append(img); }
            else still.append(icon("image"));
            stage.append(still);
        }
        const info = el("aside", "ahc-info");
        const facts = el("dl", "ahl-facts");
        const fact = (label, value) => {
            const row = el("div", "ahl-fact");
            row.append(el("dt", "", label), el("dd", "", value));
            facts.append(row);
        };
        for (const name of [PASS_ONE, PASS_TWO]) {
            if (have[name] === undefined) continue;
            const v = clip.variants?.[name] || clip;
            fact(name, [have[name] ? `${have[name].toFixed(2)} 秒` : "", v.frames ? `${v.frames} 帧` : ""].filter(Boolean).join(" · ") || "—");
        }
        const res = resolutionOf(clip);
        if (res) fact("分辨率", res);
        fact("接自", parentLabel(clip, this.clips) || "全新段落");
        fact("生成时间", fullTime(clip.created_at) || "—");
        fact("片段 ID", clip.clip_id);
        info.append(facts);
        const promptBox = el("section", "ahl-contents ahc-prompt");
        const promptHead = el("div", "ahl-section-head");
        promptHead.append(el("span", "", "提示词"));
        promptBox.append(promptHead, el("pre", clip.prompt ? "" : "is-empty", clip.prompt || "保存时没有接提示词"));
        info.append(promptBox);
        const actions = el("div", "ahl-actions");
        const use = el("button", "ahl-btn is-primary");
        use.type = "button";
        const current = this.target() === clip;
        const draft = clip.clip_stage === "draft";
        const label = draft ? "用这张做二采" :
            !current ? "接续这一段" : isLatest(this.selection) ? "正在接续（跟随最新）" : "正在接续（已固定）";
        use.append(icon(current ? "check" : "link"), el("span", "", label));
        use.disabled = draft ? !clip.stage_ready || this.refineId === clip.clip_id : current || Boolean(this.refineId);
        use.addEventListener("click", () => { if (draft) this.chooseRefine(clip); else this.pick(clip); done(); });
        actions.append(use);
        info.append(actions);
        body.append(stage, info);
        dialog.append(head, body);
        overlay.append(dialog);
        const onKey = event => { if (event.key === "Escape") { event.stopPropagation(); done(); } };
        const done = () => {
            player.pause(); player.removeAttribute("src"); player.load();
            document.removeEventListener("keydown", onKey, true);
            overlay.remove();
        };
        overlay._close = done;
        close.addEventListener("click", done);
        overlay.addEventListener("pointerdown", event => { overlay._down = event.target === overlay; });
        overlay.addEventListener("click", event => { if (event.target === overlay && overlay._down) done(); });
        for (const type of ["pointerdown", "mousedown", "wheel", "dblclick"]) overlay.addEventListener(type, e => e.stopPropagation());
        document.addEventListener("keydown", onKey, true);
        document.body.append(overlay);
        use.focus();
    }
}

export class ClipSaverPanel {
    constructor() {
        this.root = el("div", "ahr ahc ahc-saver");
        this.result = null;
        this.render();
    }

    showResult(message) {
        this.result = message?.h3_clip_v2?.[0] || null;
        this.render();
    }

    render() {
        this.root.replaceChildren();
        const line = el("div", `ahc-plan is-${this.result ? "continue" : "idle"}`);
        line.setAttribute("role", "status");
        const head = el("div", "ahc-plan-main");
        head.append(icon(this.result ? "check-circle" : "save"),
            el("span", "ahc-plan-label", this.result ? "已保存" : "保存到"),
            el("span", "", this.result ? this.result.status.replace(/^已存为 /, "") : "片段选择里的项目"));
        line.append(head);
        if (this.result?.project) line.append(el("div", "ahc-plan-last", `片段项目库：${this.result.project}`));
        this.root.append(line);
    }
}
