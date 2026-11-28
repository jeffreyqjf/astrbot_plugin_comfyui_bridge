// H3 两采 Sigma: Scheme B · Soft Luminous stacked steppers + live SVG sigma split curve + collapsible advanced drawer.
// Zero backend/widget changes: reads/writes the existing hidden widgets of AmiaomiaoH3_TwoPassSigmas.

const SVG_NS = "http://www.w3.org/2000/svg";
const SPACING_LABELS = {
    cosine: "cosine（低噪更密）",
    linear: "linear（均匀）",
    exponential: "exponential（指数）",
};

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

function svgEl(tag, attrs = {}) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    return node;
}

function icon(name) {
    const node = el("i", `pi pi-${name}`);
    node.setAttribute("aria-hidden", "true");
    return node;
}

function clampInt(value, min, max, fallback) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

function clampFloat(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.round(Math.min(max, Math.max(min, n)) * 100) / 100;
}

// Pure visual preview of the two-pass sigma schedule + low-noise extra steps (mirrors refs/two_pass.py).
export function previewSigmaPoints({ firstSteps, secondSteps, extraSteps, startAtSigma, endAtSigma, spacing }) {
    const p1 = clampInt(firstSteps, 1, 200, 6);
    const p2 = clampInt(secondSteps, 1, 200, 4);
    const extra = clampInt(extraSteps, 0, 15, 1);
    const totalBase = p1 + p2;
    const base = [];
    for (let i = 0; i <= totalBase; i++) {
        const t = i / totalBase;
        base.push(Math.pow(1 - t, 1.35));
    }

    let sigmas = base;
    let extraStartIdx = -1;
    if (extra > 0) {
        const startNorm = Math.min(0.95, Math.max(0.0, Number(startAtSigma) || 0));
        const endNorm = Math.min(startNorm, Math.max(0.0, Number(endAtSigma) || 0));
        const idx = base.findIndex(s => s <= startNorm);
        if (idx >= 0 && idx < base.length - 1) {
            const a = base[idx];
            const b = Math.min(a, endNorm);
            const tailLen = base.length - idx + extra;
            const head = base.slice(0, idx);
            const tail = [];
            for (let i = 0; i < tailLen; i++) {
                const u = tailLen > 1 ? i / (tailLen - 1) : 1;
                let f = u;
                if (spacing === "cosine") f = (1 - Math.cos(u * Math.PI)) / 2;
                else if (spacing === "exponential") f = (Math.exp(u * 3) - 1) / (Math.exp(3) - 1);
                tail.push(a + (b - a) * f);
            }
            if (b > 0) tail.push(0);
            sigmas = [...head, ...tail];
            extraStartIdx = base.length - 1;
        }
    }
    const splitIdx = Math.min(p1, sigmas.length - 1);
    const totalSteps = Math.max(1, sigmas.length - 1);
    return { sigmas, splitIdx, extraStartIdx, totalSteps };
}

export class TwoPassSigmasPanel {
    // fields: { get(name), set(name, value), options(name), isLinked(name) }
    constructor(fields, { onToggleAdvanced } = {}) {
        this.fields = fields;
        this.onToggleAdvanced = onToggleAdvanced || (() => {});
        this.advancedOpen = false;
        this.root = el("div", "ahr ahsg");
        this.build();
        this.render();
    }

    isExpanded() { return this.advancedOpen; }

    build() {
        // ---- Section 1: Clean Stacked Pass-1 & Pass-2 Steppers (Zero Preset Clutter) ----
        const stack = el("div", "ahsg-stack");
        this.p1Row = this.buildPassRow({
            name: "first_steps",
            tag: "P1",
            tagClass: "is-p1",
            title: "一采步数",
            hint: "建议 4–8",
            min: 1,
            max: 200,
            fallback: 6,
        });
        this.p2Row = this.buildPassRow({
            name: "second_steps",
            tag: "P2",
            tagClass: "is-p2",
            title: "二采步数",
            hint: "建议 3–5",
            min: 1,
            max: 200,
            fallback: 4,
        });
        stack.append(this.p1Row.row, this.p2Row.row);

        // ---- Section 2: Live Sigma Schedule Split Curve ----
        const curveCard = el("div", "ahsg-curve-card");
        const curveHead = el("div", "ahsg-curve-head");
        this.curveTitle = el("span", "ahsg-curve-title");
        const legend = el("div", "ahsg-legend");
        const mkLegend = (cls, text) => {
            const item = el("span", "ahsg-legend-item");
            item.append(el("i", `ahsg-ldot ${cls}`), el("span", "", text));
            return item;
        };
        this.legendExtra = mkLegend("is-ex", "加步");
        legend.append(mkLegend("is-p1", "一采"), mkLegend("is-p2", "二采"), this.legendExtra);
        curveHead.append(this.curveTitle, legend);

        this.curveHost = el("div", "ahsg-curve-host");
        curveCard.append(curveHead, this.curveHost);

        // ---- Section 3: Collapsible Advanced Settings Drawer ----
        const advBox = el("div", "ahsg-adv");
        this.advTrigger = el("button", "ahsg-adv-trigger");
        this.advTrigger.type = "button";
        this.advTrigger.setAttribute("aria-expanded", "false");
        const advLeft = el("span", "ahsg-adv-title");
        advLeft.append(icon("sliders-h"), el("span", "", "高级参数设置"));
        this.advChev = icon("chevron-down");
        this.advChev.classList.add("ahsg-adv-chev");
        this.advTrigger.append(advLeft, this.advChev);
        this.advTrigger.addEventListener("click", () => {
            this.advancedOpen = !this.advancedOpen;
            this.syncAdvancedState();
            this.onToggleAdvanced(this.advancedOpen);
        });

        this.advBody = el("div", "ahsg-adv-body");
        this.advBody.hidden = true;

        this.schedulerCtrl = this.buildSelectRow("scheduler", "Scheduler", null, "采样噪声调度器");
        this.extraCtrl = this.buildIntStepperRow("extra_steps", "低噪加步", 0, 15, 1, "低噪阶段额外增加的细化步数，0 = 不加");
        this.startSigmaCtrl = this.buildFloatRow("start_at_sigma", "加步起点 sigma", 0, 20, 0.01, 0.7);
        this.endSigmaCtrl = this.buildFloatRow("end_at_sigma", "加步终点 sigma", 0, 5, 0.01, 0.0);
        this.spacingCtrl = this.buildSelectRow("spacing", "加步分布", SPACING_LABELS, "低噪加步分布方式（cosine 越接近 0 越密）");

        this.advBody.append(
            this.schedulerCtrl.row,
            this.extraCtrl.row,
            this.startSigmaCtrl.row,
            this.endSigmaCtrl.row,
            this.spacingCtrl.row,
        );
        advBox.append(this.advTrigger, this.advBody);

        this.root.append(stack, curveCard, advBox);
    }

    buildPassRow({ name, tag, tagClass, title, hint, min, max, fallback }) {
        const row = el("div", "ahsg-pass-row");
        const label = el("div", "ahsg-pass-lbl");
        const top = el("strong", "ahsg-pass-name");
        top.append(el("span", `ahsg-pass-tag ${tagClass}`, tag), el("span", "", title));
        label.append(top, el("small", "ahsg-pass-hint", hint));

        const stepper = el("div", `ahsg-stepper ${tagClass}`);
        const minus = el("button", "ahsg-step-btn", "−");
        minus.type = "button";
        minus.title = `${title} -1`;
        minus.setAttribute("aria-label", `${title} 减 1`);

        const input = el("input", "ahsg-step-input");
        input.type = "number";
        input.min = String(min);
        input.max = String(max);
        input.step = "1";
        input.setAttribute("aria-label", title);

        const plus = el("button", "ahsg-step-btn", "+");
        plus.type = "button";
        plus.title = `${title} +1`;
        plus.setAttribute("aria-label", `${title} 加 1`);

        const commit = raw => {
            const next = clampInt(raw, min, max, fallback);
            input.value = String(next);
            this.fields.set(name, next);
            this.render();
        };
        minus.addEventListener("click", () => commit(clampInt(this.fields.get(name), min, max, fallback) - 1));
        plus.addEventListener("click", () => commit(clampInt(this.fields.get(name), min, max, fallback) + 1));
        input.addEventListener("change", () => commit(input.value));
        input.addEventListener("keydown", event => {
            if (event.key === "Enter") { event.preventDefault(); input.blur(); }
        });

        stepper.append(minus, input, plus);
        row.append(label, stepper);

        return {
            row,
            sync: () => {
                const val = clampInt(this.fields.get(name), min, max, fallback);
                const locked = !!this.fields.isLinked?.(name);
                if (document.activeElement !== input) input.value = String(val);
                input.disabled = locked;
                minus.disabled = locked || val <= min;
                plus.disabled = locked || val >= max;
                row.classList.toggle("is-locked", locked);
            },
        };
    }

    buildSelectRow(name, labelText, labelMap, tip) {
        const row = el("div", "ahsg-adv-row");
        if (tip) row.title = tip;
        const lbl = el("span", "ahsg-adv-lbl", labelText);
        const sel = el("select", "ahsg-adv-ctl is-select");
        sel.setAttribute("aria-label", labelText);
        sel.addEventListener("change", () => {
            this.fields.set(name, sel.value);
            this.render();
        });
        row.append(lbl, sel);
        return {
            row,
            sync: () => {
                const opts = this.fields.options?.(name) || [];
                const cur = String(this.fields.get(name) ?? "");
                const list = opts.length ? opts : (cur ? [cur] : []);
                const sig = list.join("\u0000");
                if (sel.dataset.optsSig !== sig) {
                    sel.dataset.optsSig = sig;
                    sel.replaceChildren();
                    for (const val of list) {
                        const opt = el("option", "", labelMap?.[val] || String(val));
                        opt.value = String(val);
                        sel.append(opt);
                    }
                }
                if (document.activeElement !== sel) sel.value = cur;
                sel.disabled = !!this.fields.isLinked?.(name);
            },
        };
    }

    buildIntStepperRow(name, labelText, min, max, fallback, tip) {
        const row = el("div", "ahsg-adv-row");
        if (tip) row.title = tip;
        const lbl = el("span", "ahsg-adv-lbl", labelText);
        const stepper = el("div", "ahsg-stepper is-compact");
        const minus = el("button", "ahsg-step-btn", "−");
        minus.type = "button";
        minus.setAttribute("aria-label", `${labelText} 减 1`);
        const input = el("input", "ahsg-step-input");
        input.type = "number";
        input.min = String(min);
        input.max = String(max);
        input.step = "1";
        input.setAttribute("aria-label", labelText);
        const plus = el("button", "ahsg-step-btn", "+");
        plus.type = "button";
        plus.setAttribute("aria-label", `${labelText} 加 1`);

        const commit = raw => {
            const next = clampInt(raw, min, max, fallback);
            input.value = String(next);
            this.fields.set(name, next);
            this.render();
        };
        minus.addEventListener("click", () => commit(clampInt(this.fields.get(name), min, max, fallback) - 1));
        plus.addEventListener("click", () => commit(clampInt(this.fields.get(name), min, max, fallback) + 1));
        input.addEventListener("change", () => commit(input.value));
        stepper.append(minus, input, plus);
        row.append(lbl, stepper);
        return {
            row,
            sync: () => {
                const val = clampInt(this.fields.get(name), min, max, fallback);
                const locked = !!this.fields.isLinked?.(name);
                if (document.activeElement !== input) input.value = String(val);
                input.disabled = locked;
                minus.disabled = locked || val <= min;
                plus.disabled = locked || val >= max;
            },
        };
    }

    buildFloatRow(name, labelText, min, max, step, fallback) {
        const row = el("div", "ahsg-adv-row");
        const lbl = el("span", "ahsg-adv-lbl", labelText);
        const input = el("input", "ahsg-adv-ctl is-num");
        input.type = "number";
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);
        input.setAttribute("aria-label", labelText);
        input.addEventListener("change", () => {
            const next = clampFloat(input.value, min, max, fallback);
            input.value = next.toFixed(2);
            this.fields.set(name, next);
            this.render();
        });
        row.append(lbl, input);
        return {
            row,
            sync: () => {
                const val = clampFloat(this.fields.get(name), min, max, fallback);
                if (document.activeElement !== input) input.value = val.toFixed(2);
                input.disabled = !!this.fields.isLinked?.(name);
            },
        };
    }

    syncAdvancedState() {
        this.advBody.hidden = !this.advancedOpen;
        this.advTrigger.setAttribute("aria-expanded", String(this.advancedOpen));
        this.advTrigger.classList.toggle("is-open", this.advancedOpen);
    }

    renderCurve() {
        const p1 = clampInt(this.fields.get("first_steps"), 1, 200, 6);
        const p2 = clampInt(this.fields.get("second_steps"), 1, 200, 4);
        const extra = clampInt(this.fields.get("extra_steps"), 0, 15, 1);
        const startAtSigma = clampFloat(this.fields.get("start_at_sigma"), 0, 20, 0.7);
        const endAtSigma = clampFloat(this.fields.get("end_at_sigma"), 0, 5, 0.0);
        const spacing = String(this.fields.get("spacing") || "cosine");

        const { sigmas, splitIdx, extraStartIdx, totalSteps } = previewSigmaPoints({
            firstSteps: p1,
            secondSteps: p2,
            extraSteps: extra,
            startAtSigma,
            endAtSigma,
            spacing,
        });

        const baseSteps = p1 + p2;
        const addedSteps = Math.max(0, totalSteps - baseSteps);
        if (addedSteps > 0) {
            this.curveTitle.replaceChildren(
                document.createTextNode("噪声序列切分 · 共 "),
                el("strong", "ahsg-curve-total", String(baseSteps)),
                document.createTextNode("+("),
                el("strong", "ahsg-curve-extra", String(addedSteps)),
                document.createTextNode(") 步"),
            );
        } else {
            this.curveTitle.replaceChildren(
                document.createTextNode("噪声序列切分 · 共 "),
                el("strong", "ahsg-curve-total", String(baseSteps)),
                document.createTextNode(" 步"),
            );
        }
        this.legendExtra.hidden = addedSteps <= 0;

        const W = 316, H = 56, px = 10, py = 8;
        const coords = sigmas.map((s, i) => [
            px + (i / Math.max(1, sigmas.length - 1)) * (W - px * 2),
            py + (1 - Math.max(0, Math.min(1, s))) * (H - py * 2),
        ]);

        const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "ahsg-curve-svg", "aria-hidden": "true" });
        const splitX = coords[splitIdx][0].toFixed(1);
        svg.append(svgEl("line", {
            x1: splitX, y1: "4", x2: splitX, y2: String(H - 4),
            class: "ahsg-split-line", "stroke-dasharray": "3 3",
        }));

        const d1 = coords.slice(0, splitIdx + 1)
            .map((c, i) => `${i ? "L" : "M"}${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(" ");
        const d2 = coords.slice(splitIdx)
            .map((c, i) => `${i ? "L" : "M"}${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(" ");
        if (d1) svg.append(svgEl("path", { d: d1, class: "ahsg-path is-p1" }));
        if (d2) svg.append(svgEl("path", { d: d2, class: "ahsg-path is-p2" }));

        // Cap visible dots when steps are huge (>36) so the curve stays crisp
        const stride = sigmas.length > 36 ? Math.ceil(sigmas.length / 28) : 1;
        for (let i = 0; i < coords.length; i++) {
            const isKey = i === 0 || i === splitIdx || i === coords.length - 1;
            if (!isKey && i % stride !== 0) continue;
            const cls = i < splitIdx
                ? "ahsg-dot is-p1"
                : i === splitIdx
                    ? "ahsg-dot is-split"
                    : (extra > 0 && extraStartIdx >= 0 && i >= extraStartIdx ? "ahsg-dot is-ex" : "ahsg-dot is-p2");
            svg.append(svgEl("circle", {
                cx: coords[i][0].toFixed(1),
                cy: coords[i][1].toFixed(1),
                r: i === splitIdx ? "3.4" : "2.3",
                class: cls,
            }));
        }
        this.curveHost.replaceChildren(svg);
    }

    render() {
        this.p1Row.sync();
        this.p2Row.sync();
        this.schedulerCtrl.sync();
        this.extraCtrl.sync();
        this.startSigmaCtrl.sync();
        this.endSigmaCtrl.sync();
        this.spacingCtrl.sync();
        this.syncAdvancedState();
        this.renderCurve();
    }

    dispose() {}
}
