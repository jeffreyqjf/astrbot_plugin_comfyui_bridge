// H3 提示词: Scheme B Soft Luminous Studio Split.
// Left: syntax-highlighted prompt editor with integrated 1px hairline status footer.
// Right: visual reference card rail (auto-hides when disconnected; collapses to top strip on narrow nodes).
// Zero backend/widget changes: reads/writes the existing hidden "text" widget & h3_dialogue_language property.
import { DIALOGUE_LANGUAGES, KIND_NAMES, PROMPT_TEMPLATES, danglingLabels, detectLanguage, dialogueIssues,
    filterItems, filterLanguages, insertTemplate, referenceItems, toggleDialogue, triggerAt } from "./refs_state.js";

const TEMPLATES = [
    ["keyframes", "添加首尾帧结构", "images", "插入首尾帧格式（三段）：integrated_multimodal_description / overall_soundscape / non_diegetic_music"],
    ["reference", "添加多参考结构", "clone", "插入多参考格式（六段）：subject_definitions / summary / retention_analysis / detailed_description / overall_soundscape / non_diegetic_music"],
];
const FIELD_PATTERN = new RegExp(`^(?:${[...new Set(Object.values(PROMPT_TEMPLATES).flat())].join("|")}):`, "gm");
const FONT_SIZE_KEY = "amiaomiao-h3.prompt.font-size";
const DEFAULT_FONT_SIZE = 13;
const MIN_FONT_SIZE = 11;
const MAX_FONT_SIZE = 28;
const RAIL_WIDTH_KEY = "amiaomiao-h3.prompt.rail-width";
const DEFAULT_RAIL_WIDTH = 220;
const MIN_RAIL_WIDTH = 140;
const MAX_RAIL_WIDTH = 480;
const MIN_EDITOR_WIDTH = 210;

function storedFontSize() {
    try {
        const size = Number(localStorage.getItem(FONT_SIZE_KEY));
        if (Number.isInteger(size) && size >= MIN_FONT_SIZE && size <= MAX_FONT_SIZE) return size;
    } catch { /* display preference is optional */ }
    return DEFAULT_FONT_SIZE;
}

function storedRailWidth() {
    try {
        const width = Number(localStorage.getItem(RAIL_WIDTH_KEY));
        if (Number.isFinite(width) && width >= MIN_RAIL_WIDTH && width <= MAX_RAIL_WIDTH) return Math.round(width);
    } catch { /* display preference is optional */ }
    return DEFAULT_RAIL_WIDTH;
}

const KIND_ICONS = { image: "image", video: "video", audio: "volume-up" };
const KIND_SHORT = { image: "图", video: "视", audio: "音" };
// reference tags and dialogue tags (<d>, </d> and the [Language] right after <d>)
const TAG_PATTERN = /(<(?:Picture|Video|Audio) \d+>|<d>(?:\[[^\]\n]*\])?|<\/d>)/g;
const REF_LABEL_PATTERN = /<(?:Picture|Video|Audio) \d+>/g;

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

function usedLabelsInText(text) {
    const used = new Set();
    for (const [tag] of String(text || "").matchAll(REF_LABEL_PATTERN)) used.add(tag);
    return used;
}

export class PromptPanel {
    // source(): { doc, title } of the connected hub, or null. url(path): ComfyUI API URL.
    // language: { get(), set(value) } for the dialogue language, kept with the workflow.
    constructor({ value, onChange, source, url, language }) {
        this.onChange = onChange;
        this.source = source || (() => null);
        this.url = url || (path => path);
        this.language = language || { value: "auto", get() { return this.value; }, set(v) { this.value = v; } };
        this.items = [];
        this.connected = false;
        this.menu = null;
        this.copyTimer = null;
        this.splitterCleanup = null;
        this.resizeObserver = null;
        this.metricsRaf = 0;
        this.lastScrollbarW = -1;
        this.lastScrollbarH = -1;
        this.railWidth = storedRailWidth();
        this.railCards = [];
        this.root = el("div", "ahr ahp");
        this.build();
        this.setValue(value ?? "");
        this.refresh();
    }

    build() {
        // ---- Top Chrome: Brand/Connection + Font/Copy on Row 1, Format Actions on Row 2 ----
        const top = el("div", "ahp-top");

        const header = el("div", "ahp-header");
        const brand = el("div", "ahp-brand");
        brand.append(el("span", "ahp-title-dot"), el("span", "ahp-title", "H3 提示词"));
        this.sourceBadge = el("span", "ahp-conn");
        brand.append(this.sourceBadge);

        const barRight = el("div", "ahp-bar-right");
        this.copyButton = el("button", "ahp-icon-act");
        this.copyButton.type = "button";
        this.copyButton.title = "复制当前提示词";
        this.copyButton.setAttribute("aria-label", "复制提示词");
        this.copyIcon = icon("copy");
        this.copyLabel = el("span", "", "复制");
        this.copyButton.append(this.copyIcon, this.copyLabel);
        this.copyButton.addEventListener("pointerdown", event => event.preventDefault());
        this.copyButton.addEventListener("click", () => this.copyText());

        barRight.append(this.buildFontControls(), this.copyButton);
        header.append(brand, barRight);

        this.tools = el("div", "ahp-tools");
        this.tools.setAttribute("role", "toolbar");
        this.tools.setAttribute("aria-label", "格式与结构");

        const dialogue = el("div", "ahp-dialogue");
        this.dialogueButton = el("button", "ahp-tool is-dialogue");
        this.dialogueButton.type = "button";
        this.dialogueButton.title = "添加对白结构：选中台词后点击套上 <d>[语言] …</d>，再点一次取消（Ctrl+D）";
        this.dialogueButton.setAttribute("aria-label", "添加对白结构");
        this.dialogueText = el("span", "", "添加对白结构");
        this.dialogueButton.append(icon("comment"), this.dialogueText, el("code", "", "<d>"));
        this.dialogueButton.addEventListener("pointerdown", event => event.preventDefault());
        this.dialogueButton.addEventListener("click", () => this.dialogue());

        this.languageSelect = el("select", "ahp-lang");
        this.languageSelect.title = "对白语言，自动 = 按台词文字判断";
        this.languageSelect.setAttribute("aria-label", "对白语言");
        for (const [value, text] of DIALOGUE_LANGUAGES) {
            const option = el("option", "", text);
            option.value = value;
            this.languageSelect.append(option);
        }
        this.languageSelect.value = DIALOGUE_LANGUAGES.some(([v]) => v === this.language.get()) ? this.language.get() : "auto";
        this.languageSelect.addEventListener("change", () => this.language.set(this.languageSelect.value));
        dialogue.append(this.dialogueButton, this.languageSelect);

        const templates = el("div", "ahp-templates");
        for (const [kind, name, glyph, tip] of TEMPLATES) {
            const button = el("button", "ahp-tool ahp-template");
            button.type = "button";
            button.title = tip;
            button.setAttribute("aria-label", name);
            button.append(icon(glyph), el("span", "", name));
            button.addEventListener("pointerdown", event => event.preventDefault());
            button.addEventListener("click", () => this.template(kind));
            templates.append(button);
        }
        this.tools.append(dialogue, templates);
        top.append(header, this.tools);

        // ---- Studio Split Body: Left Hero Editor Card + Right Reference Asset Rail ----
        this.splitBody = el("div", "ahp-split-body");

        const stage = el("div", "ahp-stage");
        this.editorCard = el("div", "ahp-editor-card");
        const editor = el("div", "ahp-editor");
        this.backdrop = el("div", "ahp-backdrop");
        this.backdrop.setAttribute("aria-hidden", "true");
        this.input = el("textarea", "ahp-input");
        this.input.spellcheck = false;
        this.input.placeholder = "输入或粘贴提示词，按 @ 引用素材，按 # 插入对白…";
        this.input.setAttribute("aria-label", "提示词");
        editor.append(this.backdrop, this.input);

        this.foot = el("div", "ahp-foot");
        this.footLeft = el("div", "ahp-foot-left");
        this.warning = el("span", "ahp-warning");
        this.hints = this.buildHints();
        this.footLeft.append(this.warning, this.hints);

        this.footRight = el("div", "ahp-foot-right");
        this.usedStat = el("span", "ahp-stat-pill");
        this.usedStat.hidden = true;
        this.counter = el("span", "ahp-count");
        this.footRight.append(this.usedStat, this.counter);

        this.foot.append(this.footLeft, this.footRight);
        this.editorCard.append(editor, this.foot);
        stage.append(this.editorCard);

        this.splitter = this.buildSplitter();

        this.rail = el("aside", "ahp-ref-rail");
        const railHead = el("div", "ahp-ref-rail-head");
        this.railCount = el("span", "ahp-rail-count");
        railHead.append(el("span", "", "已启用素材"), this.railCount);
        this.chips = el("div", "ahp-ref-rail-list");
        this.chips.setAttribute("role", "toolbar");
        this.chips.setAttribute("aria-label", "插入素材编号");
        this.rail.append(railHead, this.chips);

        this.splitBody.append(stage, this.splitter, this.rail);
        this.root.append(top, this.splitBody);
        this.setRailWidth(this.railWidth);
        this.setFontSize(storedFontSize());

        this.input.addEventListener("input", () => {
            this.paint();
            this.onChange(this.input.value);
            this.suggest();
        });
        this.input.addEventListener("scroll", () => this.syncScroll());
        this.input.addEventListener("select", () => this.updateTools());
        this.input.addEventListener("keyup", () => this.updateTools());
        this.input.addEventListener("mouseup", () => this.updateTools());
        this.input.addEventListener("keydown", event => this.onKey(event));
        this.input.addEventListener("click", () => this.suggest());
        this.input.addEventListener("blur", () => setTimeout(() => {
            if (!this.menu?.contains(document.activeElement)) this.closeMenu();
        }, 120));
        // the hub may have changed while the pointer was elsewhere
        this.root.addEventListener("pointerenter", () => this.refresh());
        this.input.addEventListener("focus", () => this.refresh());
        if (typeof ResizeObserver === "function") {
            this.resizeObserver = new ResizeObserver(() => this.syncMetrics());
            this.resizeObserver.observe(this.input);
        }
        this.scheduleMetricsSync();
    }

    buildSplitter() {
        const splitter = el("div", "ahp-splitter");
        splitter.setAttribute("role", "separator");
        splitter.setAttribute("aria-orientation", "vertical");
        splitter.setAttribute("aria-label", "拖动调整提示词与素材栏宽度");
        splitter.tabIndex = 0;
        splitter.title = "左右拖动调整提示词与素材栏宽度，双击恢复默认";
        splitter.append(el("span", "ahp-splitter-grip"));

        splitter.addEventListener("dblclick", event => {
            event.preventDefault();
            event.stopPropagation();
            this.setRailWidth(DEFAULT_RAIL_WIDTH, true);
        });

        splitter.addEventListener("keydown", event => {
            if (event.key === "ArrowLeft") {
                event.preventDefault();
                this.setRailWidth(this.railWidth + 16, true);
            } else if (event.key === "ArrowRight") {
                event.preventDefault();
                this.setRailWidth(this.railWidth - 16, true);
            } else if (event.key === "Home") {
                event.preventDefault();
                this.setRailWidth(DEFAULT_RAIL_WIDTH, true);
            }
        });

        splitter.addEventListener("pointerdown", event => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            this.splitterCleanup?.();

            const startX = event.clientX;
            const totalW = this.splitBody.offsetWidth || 640;
            const rect = this.splitBody.getBoundingClientRect();
            const scale = totalW && rect.width ? rect.width / totalW : 1;
            const startRailW = this.rail.offsetWidth || this.railWidth;
            const maxW = Math.max(MIN_RAIL_WIDTH, Math.min(MAX_RAIL_WIDTH, totalW - MIN_EDITOR_WIDTH));
            splitter.classList.add("is-resizing");
            this.root.classList.add("is-resizing-rail");

            const teardown = persist => {
                window.removeEventListener("pointermove", onMove, true);
                window.removeEventListener("pointerup", onUp, true);
                window.removeEventListener("pointercancel", onCancel, true);
                splitter.classList.remove("is-resizing");
                this.root.classList.remove("is-resizing-rail");
                this.splitterCleanup = null;
                if (persist) this.setRailWidth(this.railWidth, true, maxW);
            };

            const onMove = e2 => {
                e2.preventDefault();
                e2.stopPropagation();
                const delta = (e2.clientX - startX) / (scale || 1);
                this.setRailWidth(startRailW - delta, false, maxW);
                this.syncMetrics();
            };
            const onUp = e2 => {
                e2.preventDefault();
                e2.stopPropagation();
                teardown(true);
            };
            const onCancel = () => teardown(false);

            this.splitterCleanup = () => teardown(false);
            window.addEventListener("pointermove", onMove, true);
            window.addEventListener("pointerup", onUp, true);
            window.addEventListener("pointercancel", onCancel, true);
        });
        return splitter;
    }

    setRailWidth(width, persist = false, maxLimit = MAX_RAIL_WIDTH) {
        const cap = Math.max(MIN_RAIL_WIDTH, Math.min(MAX_RAIL_WIDTH, maxLimit));
        const clamped = Math.round(Math.min(cap, Math.max(MIN_RAIL_WIDTH, Number(width) || DEFAULT_RAIL_WIDTH)));
        this.railWidth = clamped;
        this.splitBody.style.setProperty("--ahp-rail-w", `${clamped}px`);
        if (persist) {
            try { localStorage.setItem(RAIL_WIDTH_KEY, String(clamped)); } catch { /* optional */ }
        }
        this.scheduleMetricsSync();
    }

    buildHints() {
        const wrap = el("span", "ahp-hints");
        const add = (key, desc, extra = false) => {
            const item = el("span", `ahp-hint-item${extra ? " ahp-hint-extra" : ""}`);
            item.append(el("kbd", "ahp-kbd", key), document.createTextNode(desc));
            wrap.append(item);
        };
        add("@", "引用素材");
        add("#", "插对白");
        add("Ctrl+D", "开关对白", true);
        return wrap;
    }

    buildFontControls() {
        const group = el("div", "ahp-font-controls");
        group.setAttribute("role", "group");
        group.setAttribute("aria-label", "正文字号");
        const button = (label, glyph, action) => {
            const control = el("button", "ahp-tool");
            control.type = "button";
            control.title = label;
            control.setAttribute("aria-label", label);
            if (glyph) control.append(icon(glyph));
            control.addEventListener("pointerdown", event => event.preventDefault());
            control.addEventListener("click", action);
            return control;
        };
        this.fontSmaller = button("缩小字号", "minus", () => this.setFontSize(this.fontSize - 1, true));
        this.fontDefault = button("恢复默认字号", null, () => this.setFontSize(DEFAULT_FONT_SIZE, true));
        this.fontDefault.classList.add("ahp-font-value");
        this.fontLarger = button("放大字号", "plus", () => this.setFontSize(this.fontSize + 1, true));
        group.append(this.fontSmaller, this.fontDefault, this.fontLarger);
        return group;
    }

    async copyText() {
        const text = this.input.value;
        let ok = false;
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
                ok = true;
            }
        } catch { /* fallback below */ }
        if (!ok) {
            try {
                const ghost = el("textarea");
                ghost.value = text;
                Object.assign(ghost.style, { position: "fixed", left: "-9999px", top: "0", opacity: "0" });
                document.body.append(ghost);
                ghost.select();
                ok = document.execCommand?.("copy") || false;
                ghost.remove();
            } catch { ok = false; }
        }
        clearTimeout(this.copyTimer);
        this.copyButton.classList.toggle("is-copied", ok);
        this.copyIcon.className = `pi pi-${ok ? "check" : "copy"}`;
        this.copyLabel.textContent = ok ? "已复制" : "复制失败";
        this.copyTimer = setTimeout(() => {
            this.copyButton.classList.remove("is-copied");
            this.copyIcon.className = "pi pi-copy";
            this.copyLabel.textContent = "复制";
        }, 1400);
    }

    setFontSize(size, remember = false) {
        this.fontSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, size));
        this.root.style.setProperty("--ahp-font-size", `${this.fontSize}px`);
        this.fontDefault.textContent = String(this.fontSize);
        this.fontDefault.setAttribute("aria-label", `当前字号 ${this.fontSize}，恢复默认字号`);
        this.fontSmaller.disabled = this.fontSize <= MIN_FONT_SIZE;
        this.fontLarger.disabled = this.fontSize >= MAX_FONT_SIZE;
        if (remember) {
            try { localStorage.setItem(FONT_SIZE_KEY, String(this.fontSize)); } catch { /* display preference is optional */ }
            this.syncMetrics();
            this.scheduleMetricsSync();
            if (this.menu) this.placeMenu();
        }
    }

    setValue(text) {
        if (this.input.value === text) return;
        this.input.value = text;
        this.paint();
    }

    setLanguage(value) {
        this.languageSelect.value = DIALOGUE_LANGUAGES.some(([v]) => v === value) ? value : "auto";
    }

    template(kind) {
        const { value, selectionStart, selectionEnd } = this.input;
        const result = insertTemplate(value, selectionStart, selectionEnd, kind);
        this.input.focus();
        this.input.value = result.text;
        this.input.setSelectionRange(result.start, result.end);
        this.closeMenu();
        this.paint();
        this.updateTools();
        this.onChange(this.input.value);
        // bring the caret line into view
        this.input.blur();
        this.input.focus();
        this.scheduleMetricsSync();
    }

    dialogue() {
        const { value, selectionStart, selectionEnd } = this.input;
        const scroll = this.input.scrollTop;
        const result = toggleDialogue(value, selectionStart, selectionEnd, this.languageSelect.value);
        this.input.focus();
        this.input.value = result.text;
        this.input.setSelectionRange(result.start, result.end);
        this.input.scrollTop = scroll;
        this.closeMenu();
        this.paint();
        this.updateTools();
        this.onChange(this.input.value);
    }

    // The button shows "取消对白结构" while the selection is a whole <d> block or sits right inside one.
    updateTools() {
        const { value, selectionStart: s, selectionEnd: e } = this.input;
        const selected = value.slice(s, e);
        const inside = /^<d>[\s\S]*<\/d>$/.test(selected)
            || (/<d>(?:\[[^\]\n]*\]\s*)?$/.test(value.slice(0, s)) && value.startsWith("</d>", e));
        this.dialogueButton.classList.toggle("is-on", inside);
        this.dialogueButton.setAttribute("aria-pressed", String(inside));
        this.dialogueText.textContent = inside ? "取消对白结构" : "添加对白结构";
        const auto = this.languageSelect.querySelector('option[value="auto"]');
        const guess = selected.trim() && !inside ? detectLanguage(selected) : "";
        const name = DIALOGUE_LANGUAGES.find(([v]) => v === guess)?.[1];
        if (auto) auto.textContent = name ? `自动 · ${name}` : "自动";
    }

    refresh() {
        const source = this.source();
        this.connected = !!source;
        this.items = source ? referenceItems(source.doc) : [];
        this.sourceBadge.replaceChildren();
        this.sourceBadge.classList.toggle("is-off", !source);
        this.sourceBadge.title = source ? source.title || "H3 参考素材" : "未连接素材包";
        this.sourceBadge.append(el("span", "ahp-conn-dot"), el("span", "ahp-conn-name", source ? (source.title || "H3 参考素材") : "未连接素材包"));
        if (source) {
            const counts = ["image", "video", "audio"].map(kind => [kind, this.items.filter(i => i.kind === kind).length]).filter(([, n]) => n > 0);
            if (counts.length) {
                const pills = el("span", "ahp-conn-pills");
                for (const [kind, count] of counts) {
                    const pill = el("span", `ahp-mini-count is-${kind}`, `${KIND_SHORT[kind]}${count}`);
                    pill.title = `启用的${KIND_NAMES[kind]}：${count}`;
                    pills.append(pill);
                }
                this.sourceBadge.append(pills);
            }
        }
        this.renderChips();
        this.paint();
        if (this.menu) this.suggest();
    }

    renderChips() {
        // Hide the right reference rail and splitter when disconnected so the editor fills 100% width.
        this.splitBody.classList.toggle("is-no-rail", !this.connected);
        this.splitter.hidden = !this.connected;
        this.rail.hidden = !this.connected;
        this.railCount.textContent = `${this.items.length} 项`;
        // refresh() runs on every pointer enter; rebuilding would swallow a click in progress
        const signature = JSON.stringify([this.connected, this.items.map(item => [item.id, item.label, item.name, item.purpose,
            item.withAudio, item.card.filename, item.card.view?.cover_url])]);
        if (signature === this.chipSignature) return;
        this.chipSignature = signature;
        this.chips.replaceChildren();
        this.railCards = [];
        if (!this.connected) return;
        if (!this.items.length) {
            this.chips.append(el("div", "ahp-rail-empty", "素材包暂无启用素材"));
            return;
        }
        const used = usedLabelsInText(this.input.value);
        for (const item of this.items) {
            const card = el("button", `ahp-rail-card is-${item.kind}`);
            card.type = "button";
            card.classList.toggle("is-used", used.has(item.label) || (item.audioLabel && used.has(item.audioLabel)));
            card.title = `点击插入 ${item.label}${item.purpose ? " · " + item.purpose : ""}${item.withAudio ? "（含原声）" : ""}`;
            const info = el("div", "ahp-rail-info");
            const rowTop = el("div", "ahp-rail-top");
            rowTop.append(el("span", "ahp-rail-tag", item.display));
            if (item.purpose) rowTop.append(el("span", "ahp-rail-purpose", item.purpose));
            else if (item.withAudio) rowTop.append(el("span", "ahp-rail-purpose is-audio", "含音"));
            info.append(rowTop, el("span", "ahp-rail-name", item.name));
            card.append(this.thumb(item, "ahp-rail-thumb"), info);
            // keep the caret in the textarea
            card.addEventListener("pointerdown", event => event.preventDefault());
            card.addEventListener("click", () => this.insert(item));
            this.chips.append(card);
            this.railCards.push({ card, label: item.label, audioLabel: item.audioLabel });
        }
    }

    syncRailUsedState(used) {
        for (const entry of this.railCards) {
            const hit = used.has(entry.label) || (entry.audioLabel && used.has(entry.audioLabel));
            entry.card.classList.toggle("is-used", !!hit);
        }
    }

    thumb(item, className) {
        const box = el("span", `${className} is-${item.kind}`);
        let src = "";
        if (item.kind === "image" && item.card.filename) {
            const query = new URLSearchParams({ filename: item.card.filename, subfolder: item.card.subfolder || "",
                type: item.card.type || "input" });
            src = this.url(`/amiaomiao_h3/lvm/image_thumbnail?${query}`);
        } else if (item.kind === "video" && item.card.view?.cover_url) {
            src = this.url(item.card.view.cover_url);
        }
        if (src) {
            const image = el("img");
            image.src = src;
            image.alt = "";
            image.draggable = false;
            image.addEventListener("error", () => image.replaceWith(icon(KIND_ICONS[item.kind])));
            box.append(image);
        } else {
            box.append(icon(KIND_ICONS[item.kind]));
        }
        return box;
    }

    // Coloured tags drawn under a transparent-background textarea with identical metrics.
    paint() {
        const text = this.input.value;
        const kinds = new Map(this.items.map(item => [item.label, item.kind]));
        const missing = this.connected ? danglingLabels(text, this.items) : [];
        const parts = [];
        let inDialogue = false;
        const span = () => el("span", "ahp-dline");
        let run = null;
        const pushText = piece => {
            if (!inDialogue) return parts.push(document.createTextNode(piece));
            run ||= (parts.push(span()), parts[parts.length - 1]);
            run.append(document.createTextNode(piece));
        };
        for (const piece of text.split(TAG_PATTERN)) {
            if (!piece) continue;
            if (piece.startsWith("<d>")) {
                parts.push(el("mark", "is-dialogue", piece));
                inDialogue = true; run = null;
            } else if (piece === "</d>") {
                parts.push(el("mark", "is-dialogue", piece));
                inDialogue = false; run = null;
            } else if (/^<(?:Picture|Video|Audio) \d+>$/.test(piece)) {
                const kind = kinds.get(piece) || (missing.includes(piece) ? "missing" : piece.includes("Audio") ? "audio" : "plain");
                parts.push(el("mark", `is-${this.connected ? kind : "plain"}`, piece));
                run = null;
            } else {
                pushText(piece);
            }
        }
        parts.push(document.createTextNode("\n"));
        this.backdrop.replaceChildren(...parts);
        this.markFields();
        this.syncMetrics();

        this.warning.replaceChildren();
        const problems = [];
        if (missing.length) {
            problems.push(`${missing.join("、")} 没有对应的启用素材`);
        }
        const issues = dialogueIssues(text);
        if (issues.unclosed) problems.push(`${issues.unclosed} 处 <d> 没有闭合`);
        if (issues.stray) problems.push(`${issues.stray} 处多余的 </d>`);

        const hasError = problems.length > 0;
        this.editorCard.classList.toggle("has-error", hasError);
        this.warning.hidden = !hasError;
        this.hints.hidden = hasError;
        if (hasError) {
            this.warning.append(icon("exclamation-triangle"), el("span", "", problems.join("；")));
        }

        const used = usedLabelsInText(text);
        this.syncRailUsedState(used);
        this.usedStat.hidden = used.size === 0;
        if (used.size) this.usedStat.textContent = `已引 ${used.size}`;
        this.counter.textContent = text.length ? `${text.length} 字` : "0 字";
    }

    // Section titles at the start of a line ("summary:") get a quiet highlight in the backdrop.
    markFields() {
        const walker = document.createTreeWalker(this.backdrop, NodeFilter.SHOW_TEXT);
        // walk every text node (marks included) so "line start" follows the real text
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        let lineStart = true;
        for (const node of nodes) {
            const value = node.nodeValue;
            if (node.parentElement.closest("mark")) { lineStart = value.endsWith("\n"); continue; }
            // text nodes split at tags; only treat "^" as a line start when the node really starts a line
            const pattern = new RegExp(FIELD_PATTERN.source, "gm");
            const pieces = [];
            let last = 0;
            for (const match of value.matchAll(pattern)) {
                if (match.index === 0 && !lineStart) continue;
                pieces.push(document.createTextNode(value.slice(last, match.index)), el("mark", "is-field", match[0]));
                last = match.index + match[0].length;
            }
            if (pieces.length) {
                pieces.push(document.createTextNode(value.slice(last)));
                node.replaceWith(...pieces.filter(piece => piece.nodeType !== 3 || piece.nodeValue));
            }
            lineStart = value.endsWith("\n");
        }
    }

    syncMetrics() {
        const input = this.input;
        const backdrop = this.backdrop;
        if (!input || !backdrop) return;
        if (input.offsetWidth > 0 && input.offsetHeight > 0) {
            const sbW = Math.max(0, input.offsetWidth - input.clientWidth);
            const sbH = Math.max(0, input.offsetHeight - input.clientHeight);
            if (!backdrop.classList.contains("is-gutter-locked")) {
                backdrop.classList.add("is-gutter-locked");
            }
            if (sbW !== this.lastScrollbarW) {
                backdrop.style.right = `${sbW}px`;
                this.lastScrollbarW = sbW;
            }
            if (sbH !== this.lastScrollbarH) {
                backdrop.style.bottom = `${sbH}px`;
                this.lastScrollbarH = sbH;
            }
        }
        backdrop.scrollTop = input.scrollTop;
        backdrop.scrollLeft = input.scrollLeft;
    }

    scheduleMetricsSync() {
        if (this.metricsRaf) cancelAnimationFrame(this.metricsRaf);
        this.metricsRaf = requestAnimationFrame(() => {
            this.metricsRaf = 0;
            this.syncMetrics();
        });
    }

    syncScroll() {
        if (!this.backdrop || !this.input) return;
        if (!this.backdrop.classList.contains("is-gutter-locked") && this.input.offsetWidth > 0 && this.input.offsetHeight > 0) {
            return this.syncMetrics();
        }
        this.backdrop.scrollTop = this.input.scrollTop;
        this.backdrop.scrollLeft = this.input.scrollLeft;
    }

    insert(item, start = this.input.selectionStart, end = this.input.selectionEnd) {
        const scroll = this.input.scrollTop;
        const after = this.input.value.slice(end, end + 1);
        this.input.focus();
        this.input.setRangeText(item.label + (after === " " ? "" : " "), start, end, "end");
        if (after === " ") this.input.selectionStart = this.input.selectionEnd = this.input.selectionEnd + 1;
        this.input.scrollTop = scroll;
        this.closeMenu();
        this.paint();
        this.onChange(this.input.value);
    }

    suggest() {
        const { selectionStart, selectionEnd, value } = this.input;
        const caret = selectionStart === selectionEnd ? selectionStart : -1;
        const mention = caret < 0 ? null : triggerAt(value, caret, "@") || triggerAt(value, caret, "#");
        if (!mention) return this.closeMenu();
        this.mention = mention;
        if (mention.char === "#") this.openDialogueMenu(filterLanguages(mention.query));
        else this.openMenu(filterItems(this.items, mention.query));
    }

    menuShell(label, kind) {
        const fresh = !this.menu || this.menu.dataset.kind !== kind;
        if (!this.menu) {
            this.menu = el("div", "ahp-menu");
            this.menu.setAttribute("role", "listbox");
            this.menu.addEventListener("pointerdown", event => event.preventDefault());
            document.body.append(this.menu);
        }
        this.menu.dataset.kind = kind;
        this.menu.setAttribute("aria-label", label);
        this.menu.replaceChildren();
        return fresh;
    }

    // "#": insert <d>[Language] </d> at the caret, caret between the tags.
    openDialogueMenu(languages) {
        const fresh = this.menuShell("插入对白结构", "dialogue");
        // start on the toolbar's language (Chinese when it is on auto)
        if (fresh || this.lastQuery !== this.mention.query) {
            const chosen = this.languageSelect.value === "auto" ? "Chinese" : this.languageSelect.value;
            this.active = Math.max(0, languages.findIndex(lang => lang.value === chosen));
        }
        this.lastQuery = this.mention.query;
        this.menuItems = languages.map(lang => ({ dialogue: lang.value }));
        this.active = Math.min(this.active ?? 0, Math.max(0, languages.length - 1));
        const head = el("div", "ahp-menu-head");
        head.append(icon("comment"), el("span", "", "插入对白结构"), el("code", "", "<d>[…] </d>"));
        this.menu.append(head);
        if (!languages.length) this.menu.append(el("div", "ahp-menu-empty", "没有这种语言"));
        languages.forEach((lang, index) => {
            const row = el("div", "ahp-option is-dialogue");
            row.setAttribute("role", "option");
            row.setAttribute("aria-selected", String(index === this.active));
            const badge = el("span", "ahp-option-thumb is-dialogue");
            badge.append(icon("comment"));
            const text = el("div", "ahp-option-text");
            const line = el("div", "ahp-option-line");
            line.append(el("b", "", lang.name), el("span", "", lang.value));
            const meta = el("div", "ahp-option-meta");
            meta.append(el("code", "", `<d>[${lang.value}] </d>`));
            text.append(line, meta);
            row.append(badge, text);
            row.addEventListener("pointermove", () => { if (this.active !== index) { this.active = index; this.markActive(); } });
            row.addEventListener("click", () => this.insertDialogue(lang.value));
            this.menu.append(row);
        });
        this.placeMenu();
    }

    insertDialogue(language) {
        const { start, end } = this.mention;
        const scroll = this.input.scrollTop;
        const open = `<d>[${language}] `;
        this.input.focus();
        this.input.setRangeText(open + "</d>", start, end, "start");
        this.input.setSelectionRange(start + open.length, start + open.length);
        this.input.scrollTop = scroll;
        this.closeMenu();
        this.paint();
        this.updateTools();
        this.onChange(this.input.value);
    }

    pick(index) {
        const item = this.menuItems[index];
        if (!item) return;
        if (item.dialogue) this.insertDialogue(item.dialogue);
        else this.insert(item, this.mention.start, this.mention.end);
    }

    openMenu(items) {
        if (this.menuShell("选择素材", "refs")) this.active = 0;
        this.menuItems = items;
        this.active = Math.min(this.active ?? 0, Math.max(0, items.length - 1));
        const head = el("div", "ahp-menu-head is-refs");
        head.append(icon("at"), el("span", "", "引用参考素材"), el("code", "", "@"));
        this.menu.append(head);
        if (!items.length) {
            this.menu.append(el("div", "ahp-menu-empty", !this.connected ? "未连接素材包"
                : this.items.length ? "没有匹配的素材" : "素材包里没有启用的素材"));
        }
        items.forEach((item, index) => {
            const row = el("div", `ahp-option is-${item.kind}`);
            row.setAttribute("role", "option");
            row.setAttribute("aria-selected", String(index === this.active));
            const text = el("div", "ahp-option-text");
            const line = el("div", "ahp-option-line");
            line.append(el("b", "", item.display), el("span", "", item.name));
            const meta = el("div", "ahp-option-meta");
            meta.append(el("code", "", item.label));
            if (item.purpose) meta.append(el("span", "", item.purpose));
            if (item.withAudio) meta.append(el("span", "ahp-tag-audio", "Video Audio"));
            text.append(line, meta);
            row.append(this.thumb(item, "ahp-option-thumb"), text);
            row.addEventListener("pointermove", () => { if (this.active !== index) { this.active = index; this.markActive(); } });
            row.addEventListener("click", () => this.insert(item, this.mention.start, this.mention.end));
            this.menu.append(row);
        });
        this.placeMenu();
    }

    markActive() {
        [...this.menu.querySelectorAll(".ahp-option")].forEach((row, index) => {
            row.setAttribute("aria-selected", String(index === this.active));
            if (index === this.active) row.scrollIntoView({ block: "nearest" });
        });
    }

    placeMenu() {
        const anchor = this.caretPoint();
        const width = 300;
        const height = Math.min(this.menu.scrollHeight, 320);
        let left = Math.min(anchor.left, window.innerWidth - width - 8);
        let top = anchor.bottom + 6;
        if (top + height > window.innerHeight - 8) top = Math.max(8, anchor.top - height - 6);
        Object.assign(this.menu.style, { left: `${Math.max(8, left)}px`, top: `${top}px`, width: `${width}px` });
    }

    // Caret position on screen: mirror the textarea's text up to the caret in a hidden div.
    caretPoint() {
        const editor = this.input;
        const mirror = el("div");
        const style = getComputedStyle(editor);
        for (const key of ["boxSizing", "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing",
            "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth",
            "borderBottomWidth", "borderLeftWidth", "tabSize"]) mirror.style[key] = style[key];
        Object.assign(mirror.style, { position: "fixed", left: "-10000px", top: "0", width: `${editor.clientWidth}px`,
            borderStyle: "solid", whiteSpace: "pre-wrap", overflowWrap: "break-word", visibility: "hidden" });
        mirror.textContent = editor.value.slice(0, editor.selectionStart);
        const caret = el("span", "", "\u200b");
        mirror.append(caret);
        document.body.append(mirror);
        const rect = editor.getBoundingClientRect(), bounds = mirror.getBoundingClientRect();
        const point = caret.getBoundingClientRect();
        const scale = editor.offsetWidth ? rect.width / editor.offsetWidth : 1;
        mirror.remove();
        const top = rect.top + (point.top - bounds.top - editor.scrollTop) * scale;
        const clamp = value => Math.min(Math.max(value, rect.top), rect.bottom);
        return { left: rect.left + (point.left - bounds.left) * scale, top: clamp(top),
            bottom: clamp(top + point.height * scale) };
    }

    closeMenu() {
        this.menu?.remove();
        this.menu = null;
        this.active = null;
    }

    onKey(event) {
        if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "d") {
            event.preventDefault();
            event.stopPropagation();
            this.dialogue();
            return;
        }
        if (!this.menu) return;
        const count = this.menuItems.length;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            if (!count) return;
            event.preventDefault();
            this.active = (this.active + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
            this.markActive();
        } else if ((event.key === "Enter" || event.key === "Tab") && count) {
            event.preventDefault();
            this.pick(this.active);
        } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            this.closeMenu();
        }
    }

    dispose() {
        clearTimeout(this.copyTimer);
        if (this.metricsRaf) cancelAnimationFrame(this.metricsRaf);
        this.metricsRaf = 0;
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.splitterCleanup?.();
        this.closeMenu();
    }
}
