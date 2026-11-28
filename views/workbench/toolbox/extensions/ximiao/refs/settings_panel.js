// H3 生成设置: duration, reference video switches, pass-1 megapixels, pass-2 upscale,
// aspect ratio tiles, and live 3-column output HUD (Soft Luminous design system).
// Edits the node's own hidden widgets only — zero backend/widget schema changes.
import { RATIOS, planSize, scaledSize, secondsToLength } from "./refs_state.js";

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

const SVG_NS = "http://www.w3.org/2000/svg";
function exclamationIcon(size = 14) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "ahs-info-icon");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("fill", "none");
    svg.setAttribute("aria-hidden", "true");
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", "8");
    circle.setAttribute("cy", "8");
    circle.setAttribute("r", "6.75");
    circle.setAttribute("stroke", "currentColor");
    circle.setAttribute("stroke-width", "1.4");
    const stem = document.createElementNS(SVG_NS, "path");
    stem.setAttribute("d", "M8 4.6V8.9");
    stem.setAttribute("stroke", "currentColor");
    stem.setAttribute("stroke-width", "1.5");
    stem.setAttribute("stroke-linecap", "round");
    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("cx", "8");
    dot.setAttribute("cy", "11.35");
    dot.setAttribute("r", "0.85");
    dot.setAttribute("fill", "currentColor");
    svg.append(circle, stem, dot);
    return svg;
}

// One glyph per ratio, drawn to scale inside a fixed box so the tiles never resize.
function ratioGlyph(long, short, portrait) {
    const box = el("span", "ahs-glyph");
    const shape = el("i");
    const max = 28;
    let w = max, h = max * short / long;
    if (portrait) [w, h] = [h, w];
    if (h > 20) { w = w * 20 / h; h = 20; }
    shape.style.width = `${w.toFixed(1)}px`;
    shape.style.height = `${h.toFixed(1)}px`;
    box.append(shape);
    return box;
}

const RATIO_HINTS = {
    "1:1": "方形",
    "4:3": "传统",
    "3:2": "相机",
    "16:9": "常用",
    "1.85:1": "电影",
    "21:9": "超宽",
    "2.39:1": "宽银幕",
};

const PAD_DETAIL_TEXT =
    "H3只能按固定帧数阵列读取参考视频。当视频长度不匹配时，就会向下匹配帧率，导致参考视频被砍掉一部分结尾内容。" +
    "开启此选项后，内部算法会自动冻结尾帧，强制补足帧长度，这样就能让原来的动作都会保留。";
const PAD_DETAIL_NOTE = "对齐网格：17n + 5 帧 · 开启「跟随 Video 1」时，解码后会自动裁掉补出的尾帧。";

export class SettingsPanel {
    // fields: { get(name), set(name, value) } bound to the node widgets.
    constructor(fields) {
        this.fields = fields;
        this.reference = null;  // { frames, name } from the last run, for 跟随 Video 1
        this.liveReference = { status: "missing", text: "未启用 Video 1" };
        this.popover = null;
        this.popoverAnchor = null;
        this.onGlobalClose = () => this.hidePopover();
        this.root = el("div", "ahr ahs");
        this.render();
    }

    value(name) { return this.fields.get(name); }

    set(name, value, rerender = true) {
        this.fields.set(name, value);
        if (rerender) this.render(); else this.updateResult();
    }

    showResult(message) {
        const info = message?.h3_settings?.[0];
        if (info?.reference_frames) {
            this.reference = { frames: info.reference_frames, name: info.reference_name || "Video 1" };
        }
        this.render();
    }

    setReference(reference) {
        this.liveReference = reference;
        if (reference.status === "missing" && this.value("follow_reference")) {
            this.fields.set("follow_reference", false);
        }
        this.render();
    }

    dispose() {
        this.hidePopover();
    }

    // Floating body-mounted popover so ComfyUI's node overflow never clips the detail card.
    showPopover(anchor) {
        this.hidePopover();
        this.popoverAnchor = anchor;
        const pop = el("div", "ahs-popover");
        pop.setAttribute("role", "tooltip");
        const title = el("div", "ahs-popover-title");
        title.append(exclamationIcon(13), el("span", "", "保留参考视频结尾说明"));
        const body = el("div", "ahs-popover-body", PAD_DETAIL_TEXT);
        const note = el("div", "ahs-popover-note", PAD_DETAIL_NOTE);
        pop.append(title, body, note);
        document.body.append(pop);
        this.popover = pop;

        const rect = anchor.getBoundingClientRect();
        const margin = 10;
        const popW = Math.min(320, window.innerWidth - margin * 2);
        pop.style.width = `${popW}px`;
        const popH = pop.offsetHeight || 130;

        let left = rect.right - popW;
        if (left < margin) left = margin;
        if (left + popW > window.innerWidth - margin) left = window.innerWidth - popW - margin;

        let top = rect.top - popH - 10;
        let placeBelow = false;
        if (top < margin) {
            top = rect.bottom + 10;
            placeBelow = true;
        }
        pop.style.left = `${Math.round(left)}px`;
        pop.style.top = `${Math.round(top)}px`;
        pop.dataset.placement = placeBelow ? "bottom" : "top";
        const arrowRight = Math.max(14, Math.min(popW - 22, (left + popW) - (rect.left + rect.width / 2) - 6));
        pop.style.setProperty("--ahs-arrow-right", `${Math.round(arrowRight)}px`);

        requestAnimationFrame(() => pop.classList.add("is-visible"));
        window.addEventListener("scroll", this.onGlobalClose, true);
        window.addEventListener("resize", this.onGlobalClose);
        window.addEventListener("pointerdown", this.onGlobalClose);
    }

    hidePopover() {
        if (!this.popover) return;
        this.popover.remove();
        this.popover = null;
        this.popoverAnchor = null;
        window.removeEventListener("scroll", this.onGlobalClose, true);
        window.removeEventListener("resize", this.onGlobalClose);
        window.removeEventListener("pointerdown", this.onGlobalClose);
    }

    unitNumberField(name, unit, { min, max, step, digits = 2, aligned = false, label, disabled = false }) {
        const wrap = el("div", `ahs-input-unit${aligned ? " is-aligned" : ""}${disabled ? " is-disabled" : ""}`);
        const input = el("input", "ahs-unit-input");
        input.type = "number";
        Object.assign(input, { min, max, step });
        input.disabled = disabled;
        input.setAttribute("aria-label", label);
        const formatVal = v => {
            const num = Number(v);
            if (!Number.isFinite(num)) return "";
            if (digits === 0) return String(Math.round(num));
            return num.toFixed(digits);
        };
        input.value = formatVal(this.value(name));
        const commit = () => {
            let value = Number(input.value);
            if (!Number.isFinite(value)) value = Number(this.value(name));
            value = Math.min(max, Math.max(min, value));
            value = digits === 0 ? Math.round(value / step) * step : Number(value.toFixed(digits));
            input.value = formatVal(value);
            this.set(name, value, false);
        };
        input.addEventListener("change", commit);
        input.addEventListener("input", () => {
            const value = Number(input.value);
            if (Number.isFinite(value) && value >= min && value <= max) {
                this.fields.set(name, value);
                this.updateResult();
            }
        });
        wrap.append(input, el("span", "ahs-unit-tag", unit));
        return { wrap, input, formatVal };
    }

    cardHead(title, extra) {
        const head = el("div", "ahs-head");
        const h4 = el("h4");
        h4.append(el("span", "ahs-title-dot"), el("span", "", title));
        head.append(h4);
        if (extra) head.append(extra);
        return head;
    }

    segmented(name, options, label, disabled = false) {
        const group = el("div", "ahs-seg ahs-orient");
        group.setAttribute("role", "radiogroup");
        group.setAttribute("aria-label", label);
        for (const [value, text] of options) {
            const button = el("button", "", text);
            button.type = "button";
            button.setAttribute("role", "radio");
            button.setAttribute("aria-checked", String(this.value(name) === value));
            button.disabled = disabled;
            button.addEventListener("click", () => {
                if (this.value(name) !== value) this.set(name, value);
            });
            group.append(button);
        }
        return group;
    }

    render() {
        this.hidePopover();
        this.root.replaceChildren();
        const follow = !!this.value("follow_reference");
        const custom = this.value("ratio") === "自定义";
        const portrait = this.value("orientation") === "竖";
        const refMissing = this.liveReference.status === "missing";

        // 1. 时长 (Primary Tier: input + -1s/+1s + right-aligned frame badge on SAME row)
        const duration = el("section", "ahs-section ahs-card");
        duration.append(this.cardHead("时长"));
        const durRow = el("div", "ahs-line ahs-dur-row");
        const secField = this.unitNumberField("seconds", "秒", {
            min: 0.2, max: 150, step: 0.1, digits: 1, label: "视频时长（秒）", disabled: follow,
        });
        this.secInput = secField.input;
        const stepGroup = el("div", "ahs-step-group");
        stepGroup.setAttribute("role", "group");
        stepGroup.setAttribute("aria-label", "秒级步进调节");
        const stepSeconds = delta => {
            const cur = Number(this.value("seconds")) || 0;
            const next = Math.min(150, Math.max(0.2, Number((cur + delta).toFixed(2))));
            this.secInput.value = secField.formatVal(next);
            this.set("seconds", next, false);
        };
        this.btnMinus1s = el("button", "ahs-step-btn", "-1s");
        this.btnMinus1s.type = "button";
        this.btnMinus1s.title = "减少 1 秒";
        this.btnMinus1s.addEventListener("click", () => stepSeconds(-1));
        this.btnPlus1s = el("button", "ahs-step-btn", "+1s");
        this.btnPlus1s.type = "button";
        this.btnPlus1s.title = "增加 1 秒";
        this.btnPlus1s.addEventListener("click", () => stepSeconds(1));
        stepGroup.append(this.btnMinus1s, this.btnPlus1s);

        this.durationBadge = el("span", "ahs-frame-badge");
        durRow.append(secField.wrap, stepGroup, this.durationBadge);
        duration.append(durRow);

        // 2. 参考视频 (Secondary Recessed Tier with 1px internal divider & "详情 (!)" popover)
        const reference = el("section", "ahs-section ahs-card is-secondary");
        const refHead = el("div", "ahs-ref-head");
        const refTitle = el("h4");
        refTitle.append(el("span", "ahs-title-dot is-video"), el("span", "", "参考视频"));
        refHead.append(refTitle);

        const rowFollow = el("div", "ahs-ref-row");
        const followToggle = el("label", "ahr-toggle ahs-toggle ahs-follow");
        const followBox = el("input");
        followBox.type = "checkbox";
        followBox.checked = follow;
        followBox.disabled = refMissing && !follow;
        followBox.addEventListener("change", () => {
            if (followBox.checked && this.liveReference.status === "missing") {
                followBox.checked = false;
                this.render();
                return;
            }
            this.set("follow_reference", followBox.checked);
        });
        followToggle.append(followBox, el("span", "ahr-switch"), el("span", "", "成片长度跟随 Video 1"));
        followToggle.classList.toggle("is-disabled", followBox.disabled);
        followToggle.title = followBox.disabled
            ? this.liveReference.text
            : "成片长度跟随 Video 1。生成时多补出的尾帧，会在解码后裁掉。";

        const refPill = el("span", `ahs-status-pill is-${this.liveReference.status}`);
        refPill.append(el("span", "ahs-status-dot"), el("span", "", this.referencePillText()));
        refPill.title = this.liveReference.text || "";
        rowFollow.append(followToggle, refPill);

        const rowPad = el("div", "ahs-ref-row");
        const padToggle = el("label", "ahr-toggle ahs-toggle ahs-pad");
        const padBox = el("input");
        padBox.type = "checkbox";
        padBox.checked = !!this.value("pad_reference");
        padBox.disabled = refMissing;
        padBox.addEventListener("change", () => this.set("pad_reference", padBox.checked));
        padToggle.append(padBox, el("span", "ahr-switch"), el("span", "", "保留参考视频结尾"));
        padToggle.classList.toggle("is-disabled", padBox.disabled);

        const detailBtn = el("button", "ahs-info-trigger");
        detailBtn.type = "button";
        detailBtn.setAttribute("aria-label", "查看保留参考视频结尾详情");
        detailBtn.append(el("span", "", "详情"), exclamationIcon(14));
        detailBtn.addEventListener("pointerenter", () => this.showPopover(detailBtn));
        detailBtn.addEventListener("pointerleave", () => this.hidePopover());
        detailBtn.addEventListener("focus", () => this.showPopover(detailBtn));
        detailBtn.addEventListener("blur", () => this.hidePopover());
        detailBtn.addEventListener("click", event => {
            event.stopPropagation();
            if (this.popover && this.popoverAnchor === detailBtn) this.hidePopover();
            else this.showPopover(detailBtn);
        });
        rowPad.append(padToggle, detailBtn);
        reference.append(refHead, rowFollow, rowPad);

        // 3. 一采像素 + 二采放大 (Standalone stacked card ABOVE 画幅, presets BEFORE right-aligned inputs!)
        const scaleCard = el("section", "ahs-section ahs-card ahs-param-stack");

        // Row 1: 一采像素 (-0.1 / +0.1 + aligned MP input)
        const mpRow = el("div", `ahs-param-row${custom ? " is-dimmed" : ""}`);
        const mpLabel = el("div", "ahs-param-label");
        const mpStrong = el("strong");
        mpStrong.append(el("span", "", "一采像素"), el("span", "ahs-pass-tag", "P1"));
        mpLabel.append(mpStrong, el("small", "", custom ? "自定义宽高模式下不生效" : "按比例分配总像素面积"));

        const mpControls = el("div", "ahs-param-controls");
        const mpChips = el("div", "ahs-chip-group");
        const mpField = this.unitNumberField("megapixels", "MP", {
            min: 0.1, max: 8, step: 0.01, digits: 2, aligned: true, label: "像素量（MP）", disabled: custom,
        });
        this.mpInput = mpField.input;
        const stepMp = delta => {
            const cur = Number(this.value("megapixels")) || 0.6;
            const next = Math.min(8, Math.max(0.1, Number((cur + delta).toFixed(2))));
            this.mpInput.value = mpField.formatVal(next);
            this.set("megapixels", next, false);
        };
        this.btnMpMinus = el("button", "ahs-chip", "-0.1");
        this.btnMpMinus.type = "button";
        this.btnMpMinus.title = "减少 0.1 MP";
        this.btnMpMinus.addEventListener("click", () => stepMp(-0.1));
        this.btnMpPlus = el("button", "ahs-chip", "+0.1");
        this.btnMpPlus.type = "button";
        this.btnMpPlus.title = "增加 0.1 MP";
        this.btnMpPlus.addEventListener("click", () => stepMp(0.1));
        mpChips.append(this.btnMpMinus, this.btnMpPlus);
        mpControls.append(mpChips, mpField.wrap);
        mpRow.append(mpLabel, mpControls);

        // Row 2: 二采放大 (1.5× / 2.0× + aligned 倍 input)
        const upRow = el("div", "ahs-param-row");
        const upLabel = el("div", "ahs-param-label");
        const upStrong = el("strong");
        upStrong.append(el("span", "", "二采放大"), el("span", "ahs-pass-tag", "P2"));
        upLabel.append(upStrong, el("small", "", "二采 3D 放大倍率"));

        const upControls = el("div", "ahs-param-controls");
        const upChips = el("div", "ahs-chip-group");
        const upField = this.unitNumberField("upscale", "倍", {
            min: 1, max: 4, step: 0.05, digits: 2, aligned: true, label: "二采放大倍率",
        });
        this.upInput = upField.input;
        this.upButtons = [];
        for (const preset of [1.5, 2.0]) {
            const chip = el("button", "ahs-chip", `${preset.toFixed(1)}×`);
            chip.type = "button";
            chip.dataset.up = String(preset);
            chip.addEventListener("click", () => {
                this.upInput.value = upField.formatVal(preset);
                this.set("upscale", preset, false);
            });
            this.upButtons.push(chip);
            upChips.append(chip);
        }
        upControls.append(upChips, upField.wrap);
        upRow.append(upLabel, upControls);
        scaleCard.append(mpRow, upRow);

        // 4. 画幅 (BELOW 二采放大, pure aspect ratio + orientation + custom W×H drawer)
        const picture = el("section", "ahs-section ahs-card");
        picture.append(this.cardHead(
            "画幅",
            this.segmented("orientation", [["横", "横屏"], ["竖", "竖屏"]], "方向",
                this.value("ratio") === "1:1" || custom),
        ));
        const tiles = el("div", "ahs-ratios");
        tiles.setAttribute("role", "radiogroup");
        tiles.setAttribute("aria-label", "比例");
        for (const [name, long, short] of [...RATIOS, ["自定义", 4, 3]]) {
            const tile = el("button", "ahs-ratio");
            tile.type = "button";
            tile.setAttribute("role", "radio");
            tile.setAttribute("aria-checked", String(this.value("ratio") === name));
            const glyph = ratioGlyph(long, short, portrait && name !== "1:1");
            if (name === "自定义") glyph.classList.add("is-custom");
            const shown = portrait && name.includes(":") && name !== "1:1"
                ? name.split(":").reverse().join(":")
                : name;
            tile.append(
                glyph,
                el("span", "ahs-ratio-name", shown),
                el("small", "", RATIO_HINTS[name] || (name === "自定义" ? "宽 × 高" : "\u00A0")),
            );
            tile.setAttribute("aria-label", name === "自定义" ? "自定义" : `比例 ${shown}`);
            tile.dataset.ratio = name;
            tile.addEventListener("click", () => { if (this.value("ratio") !== name) this.set("ratio", name); });
            tiles.append(tile);
        }
        picture.append(tiles);

        if (custom) {
            const customBar = el("div", "ahs-custom-bar");
            const customInputs = el("div", "ahs-line");
            const cw = this.unitNumberField("custom_width", "宽", {
                min: 64, max: 8192, step: 32, digits: 0, label: "自定义宽",
            });
            const ch = this.unitNumberField("custom_height", "高", {
                min: 64, max: 8192, step: 32, digits: 0, label: "自定义高",
            });
            customInputs.append(cw.wrap, el("span", "ahs-times", "×"), ch.wrap);
            customBar.append(el("span", "ahs-custom-label", "自定义宽高（32 对齐）"), customInputs);
            picture.append(customBar);
        }

        // 5. 底部 3 列实时输出 HUD (Retained auto-calculation with clean visual hierarchy)
        this.result = el("footer", "ahs-hud");
        this.hudP1 = el("span", "ahs-hud-val");
        this.hudP1Sub = el("span", "ahs-hud-sub");
        this.hudP2 = el("span", "ahs-hud-val");
        this.hudP2Sub = el("span", "ahs-hud-sub");
        this.hudLen = el("span", "ahs-hud-val");
        this.hudLenSub = el("span", "ahs-hud-sub");

        const cell1 = el("div", "ahs-hud-cell");
        cell1.append(el("span", "ahs-hud-label", "一采输出"), this.hudP1, this.hudP1Sub);
        const cell2 = el("div", "ahs-hud-cell is-hero");
        cell2.append(el("span", "ahs-hud-label", "二采成片"), this.hudP2, this.hudP2Sub);
        const cell3 = el("div", "ahs-hud-cell");
        cell3.append(el("span", "ahs-hud-label", "实际长度"), this.hudLen, this.hudLenSub);
        this.result.append(cell1, cell2, cell3);

        this.root.append(duration, reference, scaleCard, picture, this.result);
        this.updateResult();
    }

    referencePillText() {
        const live = this.liveReference;
        if (live.status === "ready") return `${live.name || "Video 1"} · ${live.frames} 帧`;
        if (live.status === "estimate") return `${live.name || "Video 1"} · 约 ${live.frames} 帧`;
        if (live.status === "loading") return "读取 Video 1 中…";
        return "未启用 Video 1";
    }

    updateResult() {
        const [w, h] = planSize(
            this.value("ratio"),
            this.value("orientation"),
            this.value("megapixels"),
            this.value("custom_width"),
            this.value("custom_height"),
        );
        const upscale = Number(this.value("upscale")) || 1;
        const [w2, h2] = scaledSize(w, h, upscale);
        const follow = !!this.value("follow_reference");
        const custom = this.value("ratio") === "自定义";
        const seconds = Number(this.value("seconds")) || 0;
        const mp = Number(this.value("megapixels")) || 0;

        // Button boundary states
        if (this.btnMinus1s) this.btnMinus1s.disabled = follow || seconds <= 0.2;
        if (this.btnPlus1s) this.btnPlus1s.disabled = follow || seconds >= 150;
        if (this.btnMpMinus) this.btnMpMinus.disabled = custom || mp <= 0.1;
        if (this.btnMpPlus) this.btnMpPlus.disabled = custom || mp >= 8.0;
        for (const btn of this.upButtons || []) {
            btn.setAttribute("aria-pressed", String(Math.abs(Number(btn.dataset.up) - upscale) < 1e-4));
        }

        // Frame readout (no redundant "24fps")
        const live = this.liveReference;
        let hudLenMain;
        let hudLenDetail;
        let badgeText;
        let badgeVideo = false;
        if (follow && live.status === "ready") {
            const frames = secondsToLength(live.frames / 24);
            badgeText = `${live.frames} → ${frames} 帧`;
            badgeVideo = true;
            hudLenMain = `${frames} 帧`;
            hudLenDetail = `${(frames / 24).toFixed(2)} 秒（裁回 ${live.frames} 帧）`;
        } else if (follow && live.status === "estimate") {
            const frames = secondsToLength(live.frames / 24);
            badgeText = `约 ${live.frames} → ${frames} 帧`;
            badgeVideo = true;
            hudLenMain = `约 ${frames} 帧`;
            hudLenDetail = `${(frames / 24).toFixed(2)} 秒`;
        } else if (follow && this.reference) {
            const frames = secondsToLength(this.reference.frames / 24);
            badgeText = `${this.reference.frames} → ${frames} 帧`;
            badgeVideo = true;
            hudLenMain = `${frames} 帧`;
            hudLenDetail = `${(frames / 24).toFixed(2)} 秒（裁回 ${this.reference.frames} 帧）`;
        } else if (follow) {
            badgeText = "跟随 Video 1";
            badgeVideo = true;
            hudLenMain = "跟随 Video 1";
            hudLenDetail = "运行时按参考视频计算";
        } else {
            const frames = secondsToLength(seconds);
            badgeText = `= ${frames} 帧`;
            hudLenMain = `${frames} 帧`;
            hudLenDetail = `${(frames / 24).toFixed(2)} 秒 · 17n+5`;
        }

        if (this.durationBadge) {
            this.durationBadge.textContent = badgeText;
            this.durationBadge.classList.toggle("is-video", badgeVideo);
        }

        const actualMp = ((w * h) / (1024 * 1024)).toFixed(2);
        this.hudP1.textContent = `${w} × ${h}`;
        this.hudP1Sub.textContent = `实测 ${actualMp} MP · 32 对齐`;
        this.hudP2.textContent = `${w2} × ${h2}`;
        this.hudP2Sub.textContent = `${upscale.toFixed(2)}× 放大`;
        this.hudLen.textContent = hudLenMain;
        this.hudLenSub.textContent = hudLenDetail;
    }
}
