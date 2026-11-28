import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { addPanel } from "./dom_panel.js";
import { adjacentSelection, toggleMergeSelection } from "./deck_selection.js";
import { moveCard, parseOrder, pruneMissingExclusions, resolveDeckOrder } from "../clipstream/long_builder_order.js";
import {
    button,
    createFields,
    createPreview,
    createProjectBar,
    createShell,
    el,
    fetchJson,
    icon,
    mediaUrl,
    outputUrl,
    post,
    railGroup,
} from "./video_v3_ui.js";

const CUT = "AmiaomiaoH3_H3VideoCutterV3";
const BUILD = "AmiaomiaoH3_H3LongBuilderV3";
const LVM = "/amiaomiao_h3/lvm";
const CLIPS = "/amiaomiao_h3/clip_bin";
const SPEED = [["1.0x", "1.0× 原速"], ["0.75x", "0.75×"], ["0.5x", "0.5×"], ["custom", "自定义"]];

function stylesheet(id, file) {
    if (document.getElementById(id)) return;
    const link = el("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = new URL(file, import.meta.url).href;
    document.head.append(link);
}

function mediaCard({ name, badge, badgeKind = "video", imageUrl, durationText = "", facts = "", onPlay = null }) {
    const card = el("article", "ahv3-card");
    const cover = el("div", "ahv3-cover");
    const placeholder = icon("video");
    cover.append(placeholder);
    if (imageUrl) {
        const image = el("img");
        image.alt = "";
        image.draggable = false;
        image.loading = "lazy";
        image.src = mediaUrl(imageUrl);
        image.addEventListener("error", () => image.remove(), { once: true });
        cover.append(image);
    }
    cover.append(el("div", "ahv3-cover-scrim"));
    cover.append(el("span", `ahv3-card-badge is-${badgeKind}`, badge));
    if (durationText) cover.append(el("span", "ahv3-card-dur", durationText));
    if (onPlay) {
        const play = el("button", "ahv3-cover-play");
        play.type = "button";
        play.title = `播放 ${name}`;
        play.setAttribute("aria-label", `播放 ${name}`);
        play.append(icon("play"));
        play.addEventListener("click", event => {
            event.stopPropagation();
            onPlay();
        });
        cover.append(play);
    }

    const body = el("div", "ahv3-card-body");
    const titleRow = el("div", "ahv3-card-title-row");
    const title = el("strong", "ahv3-card-name", name);
    title.title = name;
    titleRow.append(title);
    const factsEl = el("div", "ahv3-facts", facts);
    const tools = el("div", "ahv3-card-tools");
    body.append(titleRow, factsEl, tools);
    card.append(cover, body);
    return { card, cover, body, titleRow, title, factsEl, tools };
}

export function installVideoV3(node, cut) {
    stylesheet("amiaomiao-h3-refs-style", "../refs/refs.css?v=20261127y");
    stylesheet("amiaomiao-h3-ui-theme-style", "../refs/ui_theme.css?v=20261127w");
    stylesheet("amiaomiao-ahv3", "./video_v3.css?v=20261127s");

    const lifetime = new AbortController();
    const { signal } = lifetime;
    const fields = createFields(node, signal);
    const { read, write, fieldRow } = fields;

    for (const widget of node.widgets || []) {
        widget.options ??= {};
        widget.options.hidden = true;
    }

    const { root, subtitleEl, rail, railScroll, railFoot, stage, toast, refreshDensity } = createShell(
        node,
        cut ? "H3 视频裁切 V3" : "H3 长视频拼接 V3",
        cut ? "定长裁切 · 24fps" : "双采片段",
        cut ? "sliders-h" : "video",
        cut ? "video" : "accent",
        signal,
    );
    root.classList.add(cut ? "ahv3-cutter" : "ahv3-builder");

    const preview = createPreview(signal);
    const clipKind = () => read("asset_kind") || "dual";
    const num = (min, max, step) => ({ numeric: { min, max, step, required: true } });
    const safe = action => async event => {
        const control = event.currentTarget;
        control.disabled = true;
        try { await action(); } catch (error) { toast(error.message, true); }
        finally { control.disabled = false; }
    };

    let cards = [], ticket = 0, loading = false, loadError = "";
    let merge = null, confirmId = null, mutating = false;
    let pointerDragCleanup = null;
    let visualMode = () => {};

    function cancelPointerDrag() {
        if (!pointerDragCleanup) return;
        const cleanup = pointerDragCleanup;
        pointerDragCleanup = null;
        cleanup();
    }
    signal.addEventListener("abort", cancelPointerDrag, { once: true });

    function resetOrder() {
        write("clip_order", "");
        write("exclude_clips", "");
    }

    // ==================== LEFT CONTROL RAIL ====================
    let buildKindSeg = null;
    let syncBuildKind = () => {};
    if (!cut) {
        buildKindSeg = el("div", "ahv3-seg");
        buildKindSeg.setAttribute("role", "radiogroup");
        buildKindSeg.setAttribute("aria-label", "片段来源");
        const kindBtns = [["dual", "双采"], ["single", "单采"]].map(([val, lbl]) => {
            const btn = el("button", "", lbl);
            btn.type = "button";
            btn.setAttribute("role", "radio");
            btn.dataset.segKey = val;
            btn.addEventListener("click", () => {
                if (btn.disabled || clipKind() === val) return;
                write("asset_kind", val);
                resetOrder();
                visualMode();
                syncBuildKind();
                void project.refresh();
                void reload();
            });
            buildKindSeg.append(btn);
            return { btn, val };
        });
        syncBuildKind = () => {
            const cur = clipKind();
            const locked = fields.isLocked("asset_kind", {});
            for (const { btn, val } of kindBtns) {
                btn.setAttribute("aria-checked", String(val === cur));
                btn.setAttribute("aria-pressed", String(val === cur));
                btn.disabled = locked;
            }
        };
    }

    const project = createProjectBar({
        parent: railScroll,
        fields,
        cut,
        signal,
        toast,
        kind: clipKind,
        headerRight: buildKindSeg,
        onRefresh: () => void reload(),
        onSelect(changed) {
            if (changed && !cut) resetOrder();
            merge = confirmId = null;
            void reload();
        },
    });

    if (cut) {
        // ---- Cutter Left Rail: Source Video, Split Mode & Params, Archive ----
        const srcGroup = railGroup(railScroll, "源视频输入", "本地路径优先");
        const srcBox = el("div", "ahv3-param-box");
        const srcBtns = el("div", "ahv3-param-row ahv3-btn-row");
        const pickVideoBtn = button("选择视频", "folder-open", safe(async () => {
            const data = await post(`${LVM}/system_video_picker`, {}, signal);
            if (!data.cancelled && data.path && !signal.aborted) {
                preview.close();
                write("custom_path", data.path);
                fields.refresh();
            }
        }));
        pickVideoBtn.classList.add("is-primary");
        const previewSrcBtn = button("预览源视频", "play", safe(async () => {
            const result = await post(`${LVM}/source_preview`, {
                video: read("video") || "",
                custom_path: read("custom_path") || "",
            }, signal);
            preview.open(result.name || "源视频", result.proxy_recommended ? "" : result.url, result.proxy_url);
        }));
        srcBtns.append(pickVideoBtn, previewSrcBtn);
        srcBox.append(srcBtns);

        const files = fields.widget("video")?.options?.values;
        if (Array.isArray(files)) {
            fieldRow(srcBox, "video", "input 视频", { options: files, fullValue: true, stack: true });
        } else {
            fieldRow(srcBox, "video", "input 视频", { wrap: true, stack: true, placeholder: "input 下的相对路径" });
        }
        fieldRow(srcBox, "custom_path", "本地完整路径（选填）", {
            wrap: true, stack: true, placeholder: "粘贴完整路径，优先于上方 input 视频",
        });
        srcGroup.group.append(srcBox);

        const splitGroup = railGroup(railScroll, "裁切方式与参数");
        const choices = el("div", "ahv3-mode-pair");
        choices.setAttribute("role", "group");
        choices.setAttribute("aria-label", "裁切方式");
        const fixed = () => read("split_mode") !== "smart";
        for (const [modeKey, label, desc, mark] of [
            ["fixed", "定长裁切", "默认重叠 22 帧", "clock"],
            ["smart", "智能分镜", "默认重叠 0 帧", "bolt"],
        ]) {
            const control = el("button", "ahv3-mode-card");
            control.type = "button";
            control.dataset.mode = modeKey;
            const headLine = el("strong", "ahv3-mode-head");
            headLine.append(icon(mark), el("span", "", label));
            control.append(headLine, el("small", "", desc));
            control.addEventListener("click", () => {
                write("split_mode", modeKey);
                visualMode();
                fields.refresh();
            });
            choices.append(control);
        }
        splitGroup.group.append(choices);

        const splitBox = el("div", "ahv3-param-box");
        fieldRow(splitBox, "segment_duration", "每段时长（秒）", { ...num(0.5, 120, 0.001), show: fixed });
        fieldRow(splitBox, "detection_sensitivity", "切点灵敏度", {
            options: [["low", "低"], ["medium", "中（推荐）"], ["high", "高"]],
            show: () => !fixed(),
        });
        const overlap = fieldRow(splitBox, "motion_context_frames", "接续重叠", {
            options: [
                ["auto", "默认（22帧）"],
                ["0", "0 帧"],
                ["5", "5 帧"],
                ["22", "22 帧"],
                ["39", "39 帧"],
                ["56", "56 帧"],
            ],
        });
        fieldRow(splitBox, "scale_percent", "画面缩放（%）", num(10, 100, 1));
        fieldRow(splitBox, "playback_speed", "切片慢放", { options: SPEED });
        fieldRow(splitBox, "playback_speed_custom", "自定义慢放", {
            ...num(0.1, 1, 0.1),
            show: () => read("playback_speed") === "custom",
        });
        fieldRow(splitBox, "align_to_h3_grid", "对齐 H3 帧数网格", { toggle: true, show: fixed });
        splitGroup.group.append(splitBox);

        visualMode = () => {
            const isFixed = fixed();
            for (const control of choices.children) {
                control.setAttribute("aria-pressed", String((control.dataset.mode === "fixed") === isFixed));
            }
            if (overlap.options?.[0]) {
                overlap.options[0].textContent = `默认（${isFixed ? 22 : 0}帧）`;
            }
            subtitleEl.textContent = isFixed ? "定长裁切 · 24fps" : "智能分镜 · 24fps";
        };

        const archiveGroup = railGroup(railScroll, "归档与预览");
        const archiveBox = el("div", "ahv3-param-box");
        fieldRow(archiveBox, "save_preview_mp4", "生成 MP4 预览", { toggle: true });
        fieldRow(archiveBox, "save_dtype", "存盘精度", {
            segments: [["int8", "int8"], ["fp16", "fp16"]],
        });
        archiveGroup.group.append(archiveBox);
    } else {
        // ---- Long Builder Left Rail: Join Params + Bottom Film Dock ----
        const optValues = (name, fallback) => {
            const values = fields.widget(name)?.options?.values;
            return Array.isArray(values) && values.length ? values : fallback;
        };
        const joinOpts = optValues("join_mode", [
            "auto（参数一致无损直拷，否则重编码）",
            "copy（只允许无损直拷，参数不一致报错）",
            "reencode（统一重编码）",
        ]).map((val, idx) => [val, ["自动", "无损直拷", "重编码"][idx] || val]);

        const paramGroup = railGroup(railScroll, "拼接参数");
        const paramBox = el("div", "ahv3-param-box");
        fieldRow(paramBox, "variant_policy", "采样版本", {
            options: optValues("variant_policy", ["优先二采（无则退回一采）", "仅一采", "仅二采"]),
            change: () => void reload(),
        });
        fieldRow(paramBox, "join_mode", "拼接方式", {
            segments: joinOpts,
            fullSeg: true,
            stack: true,
        });
        fieldRow(paramBox, "fps", "基准帧率", num(1, 240, 0.001));
        fieldRow(paramBox, "playback_speed", "恢复原速", {
            options: SPEED.map(([val, label]) => [
                val,
                val === "1.0x" ? "不恢复" : val === "custom" ? label : `按 ${label} 恢复`,
            ]),
        });
        fieldRow(paramBox, "playback_speed_custom", "切片慢放倍率", {
            ...num(0.1, 1, 0.1),
            show: () => read("playback_speed") === "custom",
        });
        fieldRow(paramBox, "output_name", "输出文件名（选填）", {
            stack: true,
            placeholder: "留空自动命名（项目_段数_时间.mp4）",
        });
        paramGroup.group.append(paramBox);

        visualMode = () => {
            subtitleEl.textContent = clipKind() === "single" ? "单采片段" : "双采片段";
            syncBuildKind();
        };
    }

    // ==================== RIGHT MAIN STAGE ====================
    const stageTop = el("div", "ahv3-stage-top");
    const stageTopLeft = el("div", "ahv3-stage-top-left");
    const stageHeading = el("strong", "ahv3-stage-heading", cut ? "裁切片段墙" : "镜头时间轨");
    const summaryPill = el("span", `ahv3-stat-pill ${cut ? "is-video" : "is-accent"}`);
    summaryPill.setAttribute("role", "status");
    const manualPill = cut ? null : el("span", "ahv3-stat-pill is-warn", "手动顺序");
    if (manualPill) manualPill.hidden = true;
    stageTopLeft.append(stageHeading, summaryPill);
    if (manualPill) stageTopLeft.append(manualPill);

    const stageTopRight = el("div", "ahv3-stage-top-right");
    const refreshBtn = button("刷新片段", "refresh", () => { void project.refresh(); void reload(); }, true);

    let confirmMergeBtn = null;
    let restoreAllBtn = null;
    const specialBtn = cut
        ? button("合并相邻片段", "link", () => { merge = merge ? null : new Set(); confirmId = null; renderDeck(); })
        : button("按镜头序号", "sort-amount-down", () => { write("clip_order", ""); renderDeck(); });

    if (cut) {
        confirmMergeBtn = button("确认合并", "check", () => void mutate("merge"));
        confirmMergeBtn.classList.add("is-primary");
        confirmMergeBtn.hidden = true;
        stageTopRight.append(confirmMergeBtn, specialBtn, refreshBtn);
    } else {
        restoreAllBtn = button("恢复全部", "replay", () => {
            write("exclude_clips", "");
            renderDeck();
        });
        restoreAllBtn.classList.add("is-ok");
        restoreAllBtn.hidden = true;
        stageTopRight.append(restoreAllBtn, specialBtn, refreshBtn);
    }
    stageTop.append(stageTopLeft, stageTopRight);

    const banners = el("div", "ahv3-banners");
    const warningBanner = cut ? el("div", "ahv3-banner is-error") : null;
    const resultBanner = cut ? el("div", "ahv3-banner is-ok") : null;
    if (warningBanner) {
        warningBanner.hidden = true;
        warningBanner.setAttribute("role", "status");
        banners.append(warningBanner);
    }
    if (resultBanner) {
        resultBanner.hidden = true;
        resultBanner.setAttribute("role", "status");
        banners.append(resultBanner);
    }

    const stageScroll = el("div", "ahv3-stage-scroll");
    if (cut) {
        stageScroll.tabIndex = 0;
        stageScroll.setAttribute("role", "region");
        stageScroll.setAttribute("aria-label", "视频裁切片段列表");
    }
    const deck = el("div", "ahv3-deck");
    stageScroll.append(deck);
    stage.append(stageTop, banners, stageScroll);

    // ==================== LONG BUILDER BOTTOM FILM DOCK ====================
    let showFilm = () => {};
    if (!cut) {
        const dock = el("div", "ahv3-film-dock");
        const dockHead = el("div", "ahv3-film-head");
        const dockTitle = el("strong", "ahv3-film-title");
        const liveDot = el("span", "ahv3-live-dot");
        liveDot.hidden = true;
        dockTitle.append(liveDot, el("span", "", "成片监看"));
        const filmHud = el("span", "ahv3-film-hud", "等待运行");
        filmHud.setAttribute("role", "status");
        dockHead.append(dockTitle, filmHud);

        const filmPlayer = el("video", "ahv3-dock-player");
        filmPlayer.controls = filmPlayer.playsInline = true;
        filmPlayer.preload = "metadata";
        filmPlayer.hidden = true;

        const dockActs = el("div", "ahv3-film-acts");
        dockActs.hidden = true;
        const downloadLink = el("a", "ahv3-btn is-ok", "下载成片");
        downloadLink.prepend(icon("download"));
        let latestFilm = null;
        const expandBtn = button("大屏", "window-maximize", () => {
            if (!latestFilm) return;
            preview.open(latestFilm.filename || "拼接成片", latestFilm.href, null, { autoplay: true });
        });
        const reportBtn = button("报告", "file", () => {
            const open = reportBox.hidden;
            reportBox.hidden = !open;
            reportBtn.setAttribute("aria-pressed", String(open));
        });
        reportBtn.setAttribute("aria-pressed", "false");
        dockActs.append(downloadLink, expandBtn, reportBtn);

        const reportBox = el("pre", "ahv3-report-box");
        reportBox.hidden = true;

        dock.append(dockHead, filmPlayer, dockActs, reportBox);
        rail.insertBefore(dock, railFoot);

        filmPlayer.addEventListener("error", () => toast("无法内联播放成片，可点大屏或下载后查看。", true));
        signal.addEventListener("abort", () => {
            filmPlayer.pause();
            filmPlayer.removeAttribute("src");
            filmPlayer.load();
        }, { once: true });

        showFilm = data => {
            const href = outputUrl(data);
            latestFilm = { ...data, href };
            filmPlayer.pause();
            filmPlayer.src = href;
            liveDot.hidden = false;
            filmPlayer.hidden = false;
            dockActs.hidden = false;
            filmHud.textContent = `${data.frames} 帧 · ${Number(data.seconds).toFixed(2)} 秒`;
            filmHud.classList.add("is-ready");
            downloadLink.href = href;
            downloadLink.download = data.filename;
            const warns = (data.warnings || []).filter(Boolean);
            reportBox.textContent = [data.report, ...warns].filter(Boolean).join("\n");
            reportBtn.classList.toggle("is-warn", warns.length > 0);
            reportBtn.title = warns.length ? `拼接报告（含 ${warns.length} 条注意）` : "拼接报告";
        };
    }

    // ==================== CUTTER ACTIONS ====================
    const cutIds = () => cards.map(card => Number(card.segment_id));

    async function mutate(action, id) {
        if (mutating) return;
        const name = project.current();
        const chosen = [...(merge || [])].sort((a, b) => a - b);
        if (action === "merge" && (chosen.length < 2 || !adjacentSelection(chosen, cutIds()))) return;
        mutating = true;
        try {
            await post(`${LVM}/${action}`, action === "merge"
                ? { project: name, segment_ids: chosen }
                : { project: name, segment_id: id }, signal);
            if (signal.aborted || project.current() !== name) return;
            merge = confirmId = null;
            toast(action === "merge" ? "片段已合并" : "片段已删除");
            void project.refresh();
            await reload();
        } catch (error) {
            toast(error.message, true);
        } finally {
            mutating = false;
        }
    }

    function appendCut(card) {
        const id = Number(card.segment_id);
        const marked = Boolean(merge?.has(id));
        const durText = card.duration_sec ? `${Number(card.duration_sec).toFixed(2)}s` : "";
        const facts = [
            card.width && card.height ? `${card.width}×${card.height}` : "",
            card.frames ? `${card.frames} 帧` : "",
        ].filter(Boolean).join(" · ");
        const item = mediaCard({
            name: card.tag || `片段 ${id}`,
            badge: `#${id}`,
            badgeKind: "video",
            imageUrl: card.thumbnail_url,
            durationText: durText,
            facts,
            onPlay: card.mp4_url ? () => preview.open(`片段 ${id}`, card.mp4_url, null, { autoplay: true }) : null,
        });
        item.card.classList.toggle("is-current", marked);
        item.card.dataset.card = String(id);

        if (confirmId === id) {
            const remove = el("button", "ahv3-card-btn is-danger", "永久删除");
            remove.type = "button";
            remove.prepend(icon("trash"));
            remove.addEventListener("click", () => void mutate("delete", id));
            const cancelBtn = el("button", "ahv3-card-btn", "取消");
            cancelBtn.type = "button";
            cancelBtn.addEventListener("click", () => { confirmId = null; renderDeck(); });
            item.tools.append(remove, cancelBtn);
        } else if (merge) {
            const pick = el("button", `ahv3-card-btn ahv3-pick${marked ? " is-ok" : ""}`);
            pick.type = "button";
            pick.append(icon(marked ? "check" : "plus"), el("span", "", marked ? "已选合并" : "选择合并"));
            pick.setAttribute("aria-pressed", String(marked));
            pick.style.flex = "1";
            pick.addEventListener("click", () => {
                merge = toggleMergeSelection(merge, id, cutIds());
                renderDeck(`[data-card="${id}"] .ahv3-pick`);
            });
            item.tools.append(pick);
        } else {
            const playBtn = el("button", "ahv3-card-btn");
            playBtn.type = "button";
            playBtn.append(icon("play"), el("span", "", "预览"));
            playBtn.disabled = !card.mp4_url;
            playBtn.title = card.mp4_url ? "预览片段 MP4" : "无 MP4 预览文件";
            playBtn.addEventListener("click", () => preview.open(`片段 ${id}`, card.mp4_url, null, { autoplay: true }));

            const delBtn = el("button", "ahv3-card-ico is-danger");
            delBtn.type = "button";
            delBtn.title = "删除片段";
            delBtn.setAttribute("aria-label", "删除片段");
            delBtn.append(icon("trash"));
            delBtn.addEventListener("click", () => {
                confirmId = id;
                renderDeck(`[data-card="${id}"] .is-danger`);
            });
            item.tools.append(playBtn, delBtn);
        }
        deck.append(item.card);
    }

    // ==================== LONG BUILDER ORDERING & POINTER DRAG ====================
    function orderState() {
        const references = parseOrder(read("exclude_clips"));
        const excluded = new Set(references
            .map(reference => cards.find(card => String(card.clip_id) === reference)
                || cards.find(card => String(card.clip_id).includes(reference)
                    || String(card.shot_tag || "").includes(reference)))
            .filter(Boolean)
            .map(card => String(card.clip_id)));
        return { excluded, ...resolveDeckOrder(cards, read("clip_order"), excluded) };
    }

    function applyBuildMove(joinIds, sourceId, targetId, before, focusSelector) {
        write("clip_order", moveCard(joinIds, sourceId, targetId, before).join(","));
        renderDeck(focusSelector);
    }

    function bindBuildPointerDrag(handleEl, cardEl, card, state) {
        const dragId = String(card.clip_id);
        handleEl.addEventListener("pointerdown", event => {
            if (event.button !== 0) return;
            if (event.target.closest?.("button, a, input, select")) return;
            event.preventDefault();
            event.stopPropagation();
            cancelPointerDrag();

            const startX = event.clientX;
            const startY = event.clientY;
            let active = false;
            let ghost = null;
            let ghostBadge = null;
            let dropTargetId = "";
            let dropBefore = true;
            let scrollRaf = 0;
            let lastClientY = startY;

            const clearDrops = () => {
                for (const nodeEl of deck.querySelectorAll(".ahv3-card.is-drop-before, .ahv3-card.is-drop-after")) {
                    nodeEl.classList.remove("is-drop-before", "is-drop-after");
                }
            };

            const autoScroll = () => {
                scrollRaf = 0;
                if (!active) return;
                const box = stageScroll.getBoundingClientRect();
                const edge = 36;
                let dy = 0;
                if (lastClientY < box.top + edge) dy = -10;
                else if (lastClientY > box.bottom - edge) dy = 10;
                if (dy) {
                    stageScroll.scrollTop += dy;
                    scrollRaf = requestAnimationFrame(autoScroll);
                }
            };

            const finish = commit => {
                window.removeEventListener("pointermove", onMove, true);
                window.removeEventListener("pointerup", onUp, true);
                window.removeEventListener("pointercancel", onCancel, true);
                window.removeEventListener("keydown", onKeyDown, true);
                if (scrollRaf) cancelAnimationFrame(scrollRaf);
                clearDrops();
                cardEl.classList.remove("is-dragging");
                root.classList.remove("is-dragging-deck");
                ghost?.remove();
                ghost = null;
                pointerDragCleanup = null;
                if (commit && active && dropTargetId && dropTargetId !== dragId) {
                    applyBuildMove(state.joinIds, dragId, dropTargetId, dropBefore);
                }
            };

            const startGhost = ev => {
                active = true;
                cardEl.classList.add("is-dragging");
                root.classList.add("is-dragging-deck");
                ghost = el("div", "ahv3-drag-ghost");
                const thumbBox = el("div", "ahv3-drag-ghost-thumb");
                if (card.thumbnail_url) {
                    const img = el("img");
                    img.alt = "";
                    img.src = mediaUrl(card.thumbnail_url);
                    thumbBox.append(img);
                } else {
                    thumbBox.append(icon("video"));
                }
                const label = el("span", "ahv3-drag-ghost-name", card.shot_tag || "镜头");
                ghostBadge = el("span", "ahv3-drag-ghost-badge", "");
                ghost.append(thumbBox, label, ghostBadge);
                document.body.append(ghost);
                ghost.style.left = `${ev.clientX + 14}px`;
                ghost.style.top = `${ev.clientY - 14}px`;
            };

            const onMove = ev => {
                lastClientY = ev.clientY;
                if (!active) {
                    if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
                    startGhost(ev);
                }
                ev.preventDefault();
                ev.stopPropagation();
                ghost.style.left = `${ev.clientX + 14}px`;
                ghost.style.top = `${ev.clientY - 14}px`;

                clearDrops();
                dropTargetId = "";
                const candidates = [...deck.querySelectorAll(".ahv3-card.is-joinable")];
                for (const candidate of candidates) {
                    const cid = candidate.dataset.card;
                    if (!cid || cid === dragId) continue;
                    const rect = candidate.getBoundingClientRect();
                    if (ev.clientX >= rect.left - 10 && ev.clientX <= rect.right + 10
                        && ev.clientY >= rect.top - 10 && ev.clientY <= rect.bottom + 10) {
                        dropTargetId = cid;
                        dropBefore = ev.clientX < rect.left + rect.width / 2;
                        candidate.classList.add(dropBefore ? "is-drop-before" : "is-drop-after");
                        const previewIds = moveCard(state.joinIds, dragId, cid, dropBefore);
                        const nextPos = previewIds.indexOf(dragId) + 1;
                        if (ghostBadge) ghostBadge.textContent = nextPos > 0 ? `→ #${nextPos}` : "";
                        break;
                    }
                }
                if (!dropTargetId && ghostBadge) ghostBadge.textContent = "";
                if (!scrollRaf) scrollRaf = requestAnimationFrame(autoScroll);
            };

            const onUp = ev => {
                if (active) {
                    ev.preventDefault();
                    ev.stopPropagation();
                }
                finish(true);
            };
            const onCancel = () => finish(false);
            const onKeyDown = ev => {
                if (ev.key === "Escape") {
                    ev.preventDefault();
                    ev.stopPropagation();
                    finish(false);
                }
            };

            pointerDragCleanup = () => finish(false);
            window.addEventListener("pointermove", onMove, true);
            window.addEventListener("pointerup", onUp, true);
            window.addEventListener("pointercancel", onCancel, true);
            window.addEventListener("keydown", onKeyDown, true);
        });
    }

    function appendBuild(card, state) {
        const id = String(card.clip_id);
        const index = state.joinIds.indexOf(id);
        const excluded = state.excluded.has(id);
        const name = card.shot_tag || "镜头";
        const video = card.join_video_url ?? (card.join_has_video === false ? "" : card.video_url);
        const durText = card.video_duration_seconds ? `${Number(card.video_duration_seconds).toFixed(2)}s` : "";
        const facts = [
            card.video_width && card.video_height ? `${card.video_width}×${card.video_height}` : "",
            card.video_fps ? `${card.video_fps} fps` : "",
        ].filter(Boolean).join(" · ");

        const item = mediaCard({
            name,
            badge: index >= 0 ? `#${index + 1}` : excluded ? "已排除" : "无视频",
            badgeKind: index >= 0 ? "order" : excluded ? "off" : "muted",
            imageUrl: card.thumbnail_url,
            durationText: durText,
            facts,
            onPlay: video ? () => preview.open(name, video, null, { autoplay: true }) : null,
        });

        const parentId = String(card.parent_clip_id || "").trim();
        const initial = parentId.toUpperCase().startsWith("[INITIAL");
        const parentName = state.namesById.get(parentId);
        const lineageRow = el("div", "ahv3-lineage");
        const lineagePill = el(
            "span",
            `ahv3-lineage-pill${initial ? " is-init" : parentId ? " is-derived" : ""}`,
            initial ? "首段" : parentId ? `自 ${parentName || parentId.slice(-8)}` : "来源未记录",
        );
        lineageRow.title = initial
            ? "首段生成，无接续来源"
            : parentId
                ? `衍生自 ${parentName ? `${parentName} · ` : ""}${parentId}`
                : "归档没有记录接续来源";
        lineageRow.append(lineagePill);
        if (card.join_variant) {
            lineageRow.append(el("span", "ahv3-variant-tag", card.join_variant));
        }
        item.factsEl.before(lineageRow);

        item.card.classList.toggle("is-skipped", excluded || !card.has_video);
        item.card.classList.toggle("is-joinable", index >= 0);
        item.card.dataset.card = id;
        const selector = `[data-card="${CSS.escape(id)}"]`;

        if (index >= 0) {
            const grip = el("span", "ahv3-drag-grip", "⋮⋮");
            grip.title = "按住拖动调整成片顺序";
            grip.setAttribute("aria-hidden", "true");
            item.titleRow.append(grip);
            bindBuildPointerDrag(item.body, item.card, card, state);

            const nudge = el("div", "ahv3-nudge-group");
            nudge.setAttribute("role", "group");
            nudge.setAttribute("aria-label", "调整镜头顺序");
            for (const [delta, label, mark, key, opposite] of [
                [-1, "向前移一位", "arrow-left", "before", "after"],
                [1, "向后移一位", "arrow-right", "after", "before"],
            ]) {
                const moveBtn = el("button", `ahv3-card-ico ahv3-move-${key}`);
                moveBtn.type = "button";
                moveBtn.title = label;
                moveBtn.setAttribute("aria-label", label);
                moveBtn.append(icon(mark));
                moveBtn.disabled = !state.joinIds[index + delta];
                moveBtn.addEventListener("click", () => {
                    const next = index + delta;
                    const focus = state.joinIds[next + delta] ? key : opposite;
                    applyBuildMove(state.joinIds, id, state.joinIds[next], delta < 0, `${selector} .ahv3-move-${focus}`);
                });
                nudge.append(moveBtn);
            }
            item.tools.append(nudge);
        } else {
            item.tools.append(el("span"));
        }

        const toggleBtn = el("button", `ahv3-card-btn ahv3-include${excluded ? " is-ok" : ""}`);
        toggleBtn.type = "button";
        toggleBtn.append(icon(excluded ? "plus" : "minus"), el("span", "", excluded ? "加入拼接" : "排除"));
        toggleBtn.disabled = !card.has_video;
        toggleBtn.addEventListener("click", () => {
            if (excluded) state.excluded.delete(id);
            else state.excluded.add(id);
            write("exclude_clips", [...state.excluded].join(","));
            renderDeck(`${selector} .ahv3-include`);
        });
        item.tools.append(toggleBtn);

        deck.append(item.card);
    }

    // ==================== DECK RENDER & RELOAD ====================
    function renderDeck(focus) {
        if (signal.aborted) return;
        cancelPointerDrag();
        deck.replaceChildren();
        refreshBtn.disabled = loading;
        summaryPill.classList.toggle("is-error", Boolean(loadError));
        deck.setAttribute("aria-busy", String(loading));

        if (cut) {
            confirmMergeBtn.hidden = !merge;
            confirmMergeBtn.disabled = !merge || merge.size < 2;
            confirmMergeBtn.lastElementChild.textContent = merge ? `确认合并 (${merge.size})` : "确认合并";
            const label = merge ? "取消合并" : "合并相邻片段";
            specialBtn.lastElementChild.textContent = label;
            specialBtn.title = label;
            specialBtn.setAttribute("aria-label", label);
            specialBtn.classList.toggle("is-danger", Boolean(merge));
            specialBtn.disabled = cards.length < 2 && !merge;
        } else {
            const hasOrder = Boolean(read("clip_order"));
            specialBtn.disabled = !hasOrder;
            if (manualPill) manualPill.hidden = !hasOrder;
        }

        if (!cards.length) {
            if (!loading) project.syncDeck({ count: 0, coverUrl: "", updatedAt: "", loaded: !loadError });
            if (restoreAllBtn) restoreAllBtn.hidden = true;
            summaryPill.textContent = loadError || (loading ? "正在读取…" : "0 段");
            deck.append(el(
                "div",
                loading ? "ahv3-empty is-loading" : "ahv3-empty",
                loadError
                    ? `无法读取片段：${loadError}`
                    : loading
                        ? "正在读取项目片段…"
                        : cut
                            ? "选择源视频并运行裁切，片段将自动归档到这里。"
                            : "用 H3 片段保存节点归档生成结果后，镜头会自动出现在这里。",
            ));
            return;
        }

        const coverCard = cards.find(c => c.thumbnail_url) || cards[0];
        project.syncDeck({
            count: cards.length,
            coverUrl: coverCard?.thumbnail_url || "",
            updatedAt: coverCard?.created_at || "",
            loaded: true,
        });

        if (cut) {
            summaryPill.textContent = merge ? `已选 ${merge.size} 段相邻` : `共 ${cards.length} 段`;
            cards.forEach(appendCut);
        } else {
            const state = orderState();
            state.namesById = new Map(cards.map(card => [String(card.clip_id), card.shot_tag]));
            const included = state.deck.filter(card => state.joinIds.includes(String(card.clip_id)));
            const seconds = included.reduce((total, card) => total + Number(card.video_duration_seconds || 0), 0);
            summaryPill.textContent = `${included.length} / ${cards.length} 段参与${seconds ? ` · ${seconds.toFixed(2)}s` : ""}`;
            if (restoreAllBtn) {
                const offCount = state.excluded.size;
                restoreAllBtn.hidden = offCount === 0;
                if (offCount > 0) restoreAllBtn.lastElementChild.textContent = `恢复全部 (${offCount})`;
            }
            state.deck.forEach(card => appendBuild(card, state));
        }

        if (focus) deck.querySelector(focus)?.focus({ preventScroll: true });
    }

    async function reload() {
        const current = ++ticket;
        const name = project.current();
        const kind = clipKind();
        loading = true;
        loadError = "";
        cards = [];
        renderDeck();
        try {
            const query = new URLSearchParams({ project: name });
            if (!cut) {
                query.set("asset_kind", kind);
                query.set("variant_policy", read("variant_policy") || "");
                query.set("probe", "1");
                query.set("join_view", "1");
            }
            const data = await fetchJson(`${cut ? `${LVM}/segments` : `${CLIPS}/list`}?${query}`, { signal });
            if (signal.aborted || current !== ticket) return;
            cards = cut
                ? [...(data.segments || [])].sort((a, b) => a.segment_id - b.segment_id)
                : (data.clips || []).map(card => ({ ...card, has_video: card.join_has_video ?? card.has_video }));

            // Clean up deleted clip_ids lingering in exclude_clips so old exclusions stay tidy.
            if (!cut && cards.length > 0) {
                const rawExcluded = read("exclude_clips");
                if (rawExcluded) {
                    const pruned = pruneMissingExclusions(rawExcluded, cards);
                    if (pruned !== String(rawExcluded)) write("exclude_clips", pruned);
                }
            }
        } catch (error) {
            if (signal.aborted || current !== ticket) return;
            loadError = error.message;
        } finally {
            if (current === ticket) {
                loading = false;
                renderDeck();
            }
        }
    }

    deck.addEventListener("keydown", event => {
        if (event.key === "Escape" && confirmId != null) {
            confirmId = null;
            renderDeck();
        }
    });

    const changeEvent = cut ? "amiaomiao_h3/lvm/changed" : "amiaomiao_h3/clip_bin/changed";
    const onChanged = event => {
        const name = event.detail?.project;
        if (!name || name === project.current()) {
            void project.refresh();
            void reload();
        }
    };
    api.addEventListener(changeEvent, onChanged);
    signal.addEventListener("abort", () => api.removeEventListener(changeEvent, onChanged), { once: true });

    addPanel(node, "h3_video_v3", root, cut ? 560 : 540);
    return {
        root,
        destroy: () => lifetime.abort(),
        controls: () => {
            fields.refresh();
            syncBuildKind();
        },
        refresh() {
            fields.refresh();
            refreshDensity();
            visualMode();
            void project.refresh();
            void reload();
        },
        executed(data) {
            const row = (cut ? data?.h3v3_cut : data?.h3v3_film)?.[0];
            if (!row) return;
            if (cut) {
                resultBanner.textContent = `已保存 ${row.segments} 段至「${row.project}」${row.previews ? ` · ${row.previews} 个 MP4 预览` : ""}`;
                resultBanner.hidden = false;
                warningBanner.textContent = row.warning || "";
                warningBanner.hidden = !row.warning;
                void project.refresh();
                void reload();
            } else {
                showFilm(row);
            }
        },
    };
}

app.registerExtension({
    name: "Amiaomiao.H3.VideoWorkflowV3",
    async beforeRegisterNodeDef(type, data) {
        if (data.name !== CUT && data.name !== BUILD) return;
        const proto = type.prototype;
        for (const [event, action] of Object.entries({
            onNodeCreated() {
                this._h3VideoV3 = installVideoV3(this, data.name === CUT);
                this._h3VideoV3.refresh();
            },
            onConfigure() {
                if (this.outputs?.length) {
                    // Let LiteGraph finish restoring downstream slots before disconnecting old links.
                    queueMicrotask(() => {
                        for (let index = (this.outputs?.length ?? 0) - 1; index >= 0; index--) {
                            this.removeOutput(index);
                        }
                    });
                }
                this._h3VideoV3?.refresh();
            },
            onConnectionsChange() { this._h3VideoV3?.controls(); },
            onExecuted(message) { this._h3VideoV3?.executed(message); },
            onRemoved() { this._h3VideoV3?.destroy(); },
        })) {
            const original = proto[event];
            proto[event] = function (...args) {
                const output = original?.apply(this, args);
                action.apply(this, args);
                return output;
            };
        }
    },
});
