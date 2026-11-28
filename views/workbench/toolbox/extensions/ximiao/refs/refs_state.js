// Pure state for the H3 reference hub panel. Mirrors refs_module/core.py.
export const NODE_ID = "AmiaomiaoH3_ReferenceHub";
export const LIMITS = { image: 9, audio: 3, video: 3 };
export const KIND_NAMES = { image: "图片", audio: "音频", video: "视频" };
export const UPLOAD_ROOT = "amiaomiao-h3-refs";
export const CARD_DENSITIES = [["xlarge", "expand", "特大卡片"], ["large", "stop", "大卡片"], ["medium", "th-large", "中卡片"]];

export function normalizeCardDensity(value) {
    return CARD_DENSITIES.some(([density]) => density === value) ? value : "large";
}

export const PURPOSES = {
    image: [["", "未设置"], ["subject.character", "角色"], ["subject.object", "物体"],
        ["subject.scene", "场景"], ["subject.costume", "服装"], ["frame.first", "首帧"],
        ["frame.key", "关键帧"], ["frame.last", "尾帧"], ["layout", "构图 / 分镜"], ["style", "画风参考"]],
    video: [["", "未设置"], ["edit_source", "剪辑源"], ["continuation", "续写源"],
        ["motion", "动作 / 运镜参考"], ["subject.character", "角色"], ["style", "画风参考"]],
    audio: [["", "未设置"], ["voice", "角色音色"], ["speech_reuse", "角色原声"],
        ["reuse", "直接复用"], ["ambience", "环境声参考"], ["music", "配乐参考"]],
};
// 0 = auto: decode to the canvas H3 resizes reference videos to (long side 1344 for 16:9).
// 8192 never shrinks anything in practice, so it stands for the original size.
export const VIDEO_SIZES = [[0, "自动（H3 尺寸）"], [8192, "原始尺寸"], [1920, "最长边 1920"],
    [1280, "最长边 1280"], [960, "最长边 960"], [640, "最长边 640"], ["custom", "自定义"]];

export function customVideoSide(value) {
    const side = Math.round((Number(value) || 1024) / 32) * 32;
    return Math.max(64, Math.min(8192, side));
}

export function decodedVideoSize(width, height, maxSide) {
    const sourceWidth = Math.trunc(Number(width) || 0);
    const sourceHeight = Math.trunc(Number(height) || 0);
    const limit = Math.trunc(Number(maxSide) || 0);
    if (sourceWidth <= 0 || sourceHeight <= 0 || limit <= 0 || Math.max(sourceWidth, sourceHeight) <= limit) {
        return [sourceWidth, sourceHeight];
    }
    const ratio = limit / Math.max(sourceWidth, sourceHeight);
    const outputWidth = Math.floor(sourceWidth * ratio / 2) * 2;
    const outputHeight = Math.floor(sourceHeight * ratio / 2) * 2;
    return outputWidth >= 2 && outputHeight >= 2 ? [outputWidth, outputHeight] : [sourceWidth, sourceHeight];
}

let counter = 0;

// Mirror of toolbox/long_video/core/ref_size.py plan_reference (32 grid, same scoring).
function rnd(value) { return Math.round(value * 1e12) / 1e12; }
function pyRound(value) { const f = Math.floor(value), d = value - f; return d > 0.5 ? f + 1 : d < 0.5 ? f : (f % 2 === 0 ? f : f + 1); }
function lessKey(a, b) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false; }
export function planImageSize(width, height, megapixels, upscale) {
    const w = Math.trunc(Number(width) || 0), h = Math.trunc(Number(height) || 0);
    const mp = Math.min(8, Math.max(0.02, Number(megapixels) || 0.25));
    if (w <= 0 || h <= 0) return null;
    const G = 32;
    let best = null, size = null;
    if (upscale || w * h > mp * 1e6) {
        const area = mp * 1e6, ratio = w / h;
        const biw = Math.max(1, pyRound(Math.sqrt(area * ratio) / G)), bih = Math.max(1, pyRound(Math.sqrt(area / ratio) / G));
        for (let ih = Math.max(1, bih - 2); ih <= bih + 2; ih++) {
            const hh = ih * G;
            for (const iw of [biw, Math.max(1, pyRound(area / hh / G)), Math.max(1, pyRound(hh * ratio / G))]) {
                for (const step of [-1, 0, 1]) {
                    const jw = iw + step; if (jw < 1) continue;
                    const ww = jw * G, ae = Math.abs(ww * hh - area) / area, re = Math.abs((ww / hh) / ratio - 1);
                    const key = [rnd(ae + 3 * re), rnd(re), rnd(ae), ww * hh, ww, hh];
                    if (!best || lessKey(key, best)) { best = key; size = [ww, hh]; }
                }
            }
        }
        return size;
    }
    if (w % G === 0 && h % G === 0) return [w, h];
    const biw = Math.max(1, pyRound(w / G)), bih = Math.max(1, pyRound(h / G));
    for (let iw = Math.max(1, biw - 1); iw <= biw + 1; iw++) for (let ih = Math.max(1, bih - 1); ih <= bih + 1; ih++) {
        const ww = iw * G, hh = ih * G;
        const key = [rnd(Math.abs(ww * hh - w * h) / (w * h)), rnd(Math.abs((ww / hh) / (w / h) - 1)),
            rnd(Math.max(Math.abs(ww - w) / w, Math.abs(hh - h) / h)), ww * hh, ww, hh];
        if (!best || lessKey(key, best)) { best = key; size = [ww, hh]; }
    }
    return size;
}
export function newId(kind) {
    counter += 1;
    return `${kind}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function emptyDocument() {
    return { version: 1, images: [], audios: [], videos: [], ui: { page: "image" } };
}

export const PAGES = ["image", "audio", "video"];
// Workflows saved with the two-page layout used "media" for images + audio.
export function normalizePage(page) {
    if (page === "media") return "image";
    return PAGES.includes(page) ? page : "image";
}

// Audio numbers taken by enabled video soundtracks, in order (shown on the audio page).
export function soundtrackLabels(doc) {
    const labels = assignLabels(doc);
    return doc.videos.filter(card => !card.skip && card.use_audio)
        .map(card => ({ audio: labels.get(card.id).audioLabel, video: labels.get(card.id).label, name: card.name,
            display: labels.get(card.id).audioDisplay }));
}

const listKey = kind => kind + "s";
const clean = (value, limit) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);

export function parseDocument(raw) {
    let data = raw;
    if (typeof raw === "string") {
        try { data = raw.trim() ? JSON.parse(raw) : {}; } catch { data = {}; }
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) data = {};
    const doc = emptyDocument();
    for (const kind of ["image", "audio", "video"]) {
        const rows = Array.isArray(data[listKey(kind)]) ? data[listKey(kind)] : [];
        doc[listKey(kind)] = rows.filter(row => row && typeof row === "object").map(row => ({
            ...row, id: String(row.id || newId(kind)), name: clean(row.name, 60),
            purpose: PURPOSES[kind].some(([value]) => value === row.purpose) ? row.purpose : "",
            note: String(row.note ?? "").slice(0, 400), skip: !!row.skip,
        }));
    }
    doc.ui = { ...(data.ui && typeof data.ui === "object" ? data.ui : {}) };
    doc.ui.page = normalizePage(doc.ui.page);
    // Earlier builds shared one project between images and audio; split it once.
    if (typeof doc.ui.ref_project === "string" && doc.ui.ref_project) {
        doc.ui.image_project ||= doc.ui.ref_project;
        doc.ui.audio_project ||= doc.ui.ref_project;
    }
    delete doc.ui.ref_project;
    // The audio page used to have its own compact/detail switch; card size decides it now.
    delete doc.ui.audio_view;
    return doc;
}

export function serializeDocument(doc) {
    return JSON.stringify(doc);
}

export function activeCount(doc, kind) {
    return doc[listKey(kind)].filter(card => !card.skip).length;
}

export function canActivate(doc, kind) {
    return activeCount(doc, kind) < LIMITS[kind];
}

// Two numbering systems, both from the native MiniMaxH3ReferenceToVideo:
//   port   - which input it feeds: ref_image_N / ref_video_N / ref_video_audio_N / ref_audio_N
//            (ref_video_audio_N is paired with ref_video_N);
//   label  - what the prompt calls it. Images and videos count per type; video soundtracks and
//            standalone audio share one <Audio j> count, soundtracks first (text encoder order).
export function assignLabels(doc) {
    const labels = new Map();
    doc.images.filter(c => !c.skip).forEach((card, slot) => labels.set(card.id, {
        label: `<Picture ${slot + 1}>`, slot, port: `ref_image_${slot}`, display: `Picture ${slot + 1}` }));
    let audio = 0;
    doc.videos.filter(c => !c.skip).forEach((card, slot) => {
        const audioLabel = card.use_audio ? `<Audio ${++audio}>` : null;
        labels.set(card.id, { label: `<Video ${slot + 1}>`, slot, audioLabel, port: `ref_video_${slot}`,
            display: `Video ${slot + 1}`, audioPort: card.use_audio ? `ref_video_audio_${slot}` : null,
            audioDisplay: card.use_audio ? `Video Audio ${slot + 1}` : null });
    });
    doc.audios.filter(c => !c.skip).forEach((card, slot) => labels.set(card.id, {
        label: `<Audio ${++audio}>`, slot, port: `ref_audio_${slot}`, display: `Audio ${slot + 1}` }));
    return labels;
}

export function manifestText(doc) {
    const labels = assignLabels(doc);
    const lines = [];
    for (const kind of ["image", "video", "audio"]) {
        for (const card of doc[listKey(kind)]) {
            const info = labels.get(card.id);
            if (!info) continue;
            const name = card.name || KIND_NAMES[kind] + (info.slot + 1);
            const purpose = PURPOSES[kind].find(([value]) => value && value === card.purpose)?.[1];
            const parts = [purpose, clean(card.note, 400)].filter(Boolean).map(part => part.replace(/。$/, ""));
            if (info.audioLabel) lines.push(`${info.audioLabel} ${name}的 Video Audio（${info.label} 的原音轨）。`);
            lines.push(`${info.label} ${name}${parts.length ? "：" + parts.join("。") : ""}。`);
        }
    }
    return lines.length ? ["参考素材（编号以此为准）：", ...lines].join("\n") : "参考素材：无。";
}

export function addCards(doc, kind, cards) {
    const list = doc[listKey(kind)];
    let room = LIMITS[kind] - activeCount(doc, kind);
    let parked = 0;
    for (const card of cards) {
        const skip = room <= 0;
        if (skip) parked += 1; else room -= 1;
        list.push({ id: newId(kind), name: "", purpose: "", note: "", skip, ...card });
    }
    return parked;
}

export function removeCard(doc, kind, id) {
    doc[listKey(kind)] = doc[listKey(kind)].filter(card => card.id !== id);
}

export function moveCard(doc, kind, id, targetIndex) {
    const list = doc[listKey(kind)];
    const from = list.findIndex(card => card.id === id);
    if (from < 0) return false;
    const [card] = list.splice(from, 1);
    const to = Math.max(0, Math.min(list.length, targetIndex > from ? targetIndex - 1 : targetIndex));
    list.splice(to, 0, card);
    return to !== from;
}

export function toggleSkip(doc, kind, id) {
    const card = doc[listKey(kind)].find(item => item.id === id);
    if (!card) return false;
    if (card.skip && !canActivate(doc, kind)) return false;
    card.skip = !card.skip;
    return true;
}

// Move a card into the active or parked group, at a position inside that group.
// The stored list keeps active cards first, then parked ones, so order == numbering.
export function placeCard(doc, kind, id, skip, index = Infinity) {
    const list = doc[listKey(kind)];
    const card = list.find(item => item.id === id);
    if (!card) return { ok: false, reason: "missing" };
    if (!skip && card.skip && !canActivate(doc, kind)) return { ok: false, reason: "full" };
    const rest = list.filter(item => item.id !== id);
    const active = rest.filter(item => !item.skip);
    const parked = rest.filter(item => item.skip);
    const group = skip ? parked : active;
    group.splice(Math.max(0, Math.min(group.length, index)), 0, card);
    card.skip = !!skip;
    doc[listKey(kind)] = [...active, ...parked];
    return { ok: true };
}

export function splitCards(doc, kind) {
    const list = doc[listKey(kind)];
    return { active: list.filter(card => !card.skip), parked: list.filter(card => card.skip) };
}

// Batch switch for one kind. Enabling fills the free slots in the parked order; whatever does
// not fit stays parked. Returns how many cards changed and how many could not be enabled.
export function setAllSkip(doc, kind, skip) {
    const { active, parked } = splitCards(doc, kind);
    if (skip) {
        for (const card of active) card.skip = true;
        doc[listKey(kind)] = [...active, ...parked];
        return { changed: active.length, left: 0 };
    }
    const room = Math.max(0, LIMITS[kind] - active.length);
    const enable = parked.slice(0, room);
    for (const card of enable) card.skip = false;
    doc[listKey(kind)] = [...active, ...enable, ...parked.slice(room)];
    return { changed: enable.length, left: parked.length - enable.length };
}

export function clearCards(doc, kind) {
    const count = doc[listKey(kind)].length;
    doc[listKey(kind)] = [];
    return count;
}

export function nameFromFile(filename) {
    return clean(String(filename || "").split("/").pop().replace(/\.[^.]+$/, ""), 60);
}

export function mediaKind(filename) {
    const name = String(filename || "").toLowerCase();
    if (/\.(png|jpe?g|jfif|webp|bmp|gif|tiff?)$/.test(name)) return "image";
    if (/\.(wav|mp3|m4a|aac|ogg|oga|flac|opus)$/.test(name)) return "audio";
    if (/\.(mp4|mov|mkv|webm|avi|m4v)$/.test(name)) return "video";
    return "";
}

// Mirrors refs_module.core.library_key: survives renumbering after delete / reorder.
export function libraryKey(source, record) {
    if (!record || typeof record !== "object") return "";
    if (source === "uploads") return String(record.storage_name || "");
    if (record.uid) return `uid:${record.uid}`;
    return [record.dir, record.saved_at].map(value => String(value || "")).join("|");
}

// Every key that still names a record: current, legacy dir|saved_at, and aliases from renames.
export function libraryKeys(source, record) {
    const keys = new Set([libraryKey(source, record)]);
    if (source !== "uploads" && record && typeof record === "object") {
        keys.add([record.dir, record.saved_at].map(value => String(value || "")).join("|"));
        if (Array.isArray(record.aliases)) for (const alias of record.aliases) if (alias) keys.add(String(alias));
    }
    keys.delete("");
    return keys;
}

// Find the record a video card points at. A stored key wins over the number.
export function matchLibrary(card, records) {
    const list = Array.isArray(records) ? records : [];
    if (card.key) {
        const record = list.find(item => libraryKeys(card.source, item).has(card.key)) || null;
        // moved also covers "same card, key upgraded" so the panel stores the current key.
        return { record, moved: !!record && (record.segment_id !== card.segment_id || libraryKey(card.source, record) !== card.key) };
    }
    return { record: list.find(item => item.segment_id === card.segment_id) || null, moved: false };
}

export function projectFolder(name) {
    const cleaned = String(name ?? "").trim().replace(/[\\/:*?"<>|\x00-\x1f]+/g, "_").trim()
        .replace(/^\.+|\.+$/g, "");
    return cleaned || "H3_LVM";
}

// Saved reference projects use the reference loaders' own format: filename, subfolder,
// type, label, skip (+ start/duration for audio). Hub-only fields stay in the workflow.
export function toPresetEntries(doc, kind) {
    return doc[kind + "s"].map(card => {
        const entry = { filename: card.filename, subfolder: card.subfolder || "", type: card.type || "input" };
        if (card.id) entry.card_id = card.id;
        if (card.name) entry.label = card.name;
        if (card.skip) entry.skip = true;
        if (card.purpose) entry.purpose = card.purpose;
        if (card.note) entry.note = card.note;
        if (kind === "audio") {
            if (Number(card.start)) entry.start = Number(card.start);
            if (Number(card.duration)) entry.duration = Number(card.duration);
        }
        return entry;
    });
}

// On a reload of the same project, keep matching card IDs.
export function fromPresetEntries(doc, kind, entries, sameProject = false) {
    const fileKey = card => `${card.type || "input"}/${card.subfolder || ""}/${card.filename}`;
    const previous = new Map();
    for (const card of sameProject ? doc[kind + "s"] : []) {
        const key = fileKey(card);
        if (!previous.has(key)) previous.set(key, []);
        previous.get(key).push(card);
    }
    const used = new Set(["image", "audio", "video"].filter(other => other !== kind)
        .flatMap(other => (doc[other + "s"] || []).map(card => card.id)));
    const cards = [];
    let active = 0;
    for (const raw of Array.isArray(entries) ? entries : []) {
        if (!raw || typeof raw.filename !== "string" || !raw.filename) continue;
        const old = previous.get(fileKey(raw))?.shift();
        let skip = !!raw.skip;
        if (!skip && active >= LIMITS[kind]) skip = true;
        if (!skip) active += 1;
        const preferredId = typeof raw.card_id === "string" ? raw.card_id : old?.id;
        const id = preferredId && !used.has(preferredId) ? preferredId : newId(kind);
        used.add(id);
        const card = { id, filename: raw.filename, subfolder: raw.subfolder || "",
            type: raw.type || "input", name: clean(raw.label ?? old?.name ?? nameFromFile(raw.filename), 60),
            purpose: PURPOSES[kind].some(([value]) => value === raw.purpose) ? raw.purpose : "",
            note: typeof raw.note === "string" ? raw.note.slice(0, 400) : "", skip };
        if (kind === "audio") Object.assign(card, { start: Number(raw.start) || 0, duration: Number(raw.duration) || 0 });
        cards.push(card);
    }
    doc[kind + "s"] = cards;
    return cards.length;
}

export function formatSeconds(value) {
    const seconds = Math.max(0, Number(value) || 0);
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${(seconds - minutes * 60).toFixed(1).padStart(4, "0")}`;
}

// Resolve a card's trim against the real file length, like TrimAudioDuration.
export function trimWindow(total, start = 0, duration = 0) {
    const length = Math.max(0, Number(total) || 0);
    let first = Number(start) || 0;
    first = first < 0 ? length + first : first;
    first = Math.max(0, Math.min(first, length));
    const last = Number(duration) > 0 ? Math.min(length, first + Number(duration)) : length;
    return { start: first, end: Math.max(first, last) };
}

// ---------- H3 生成设置: mirrors refs_module/core.py ----------
export const SETTINGS_NODE_ID = "AmiaomiaoH3_GenerationSettings";
export const RATIOS = [["1:1", 1, 1], ["5:4", 5, 4], ["4:3", 4, 3], ["3:2", 3, 2], ["16:9", 16, 9],
    ["1.85:1", 1.85, 1], ["2:1", 2, 1], ["21:9", 21, 9], ["2.39:1", 2.39, 1]];
// Python's round() is round-half-even; the sizes here never land on .5 exactly, but match it anyway.
function roundHalfEven(value) {
    const floor = Math.floor(value), diff = value - floor;
    if (Math.abs(diff - 0.5) > 1e-9) return Math.round(value);
    return floor % 2 === 0 ? floor : floor + 1;
}
const snap = (value, multiple = 32) => Math.max(multiple, roundHalfEven(value / multiple) * multiple);

export function align17n5(frames) {
    const n = Math.max(5, Math.trunc(frames));
    return n + ((5 - (n % 17)) % 17 + 17) % 17;
}

export function planSize(ratio, orientation, megapixels, customWidth = 1344, customHeight = 768) {
    if (ratio === "自定义") return [snap(customWidth), snap(customHeight)];
    const entry = RATIOS.find(row => row[0] === ratio);
    if (!entry) return [snap(customWidth), snap(customHeight)];
    const [, long, short] = entry;
    const scale = Math.sqrt(Number(megapixels) * 1024 * 1024 / (long * short));
    const width = snap(long * scale), height = snap(short * scale);
    return orientation === "竖" && width !== height ? [height, width] : [width, height];
}

export function scaledSize(width, height, factor) {
    return [snap(width * Number(factor)), snap(height * Number(factor))];
}

export function secondsToLength(seconds) {
    return align17n5(roundHalfEven(Number(seconds) * 24));
}

// ---------- H3 提示词: plain text with @ references to the hub's active cards ----------
export const PROMPT_NODE_ID = "AmiaomiaoH3_Prompt";
const LABEL_PATTERN = /<(Picture|Video|Audio) (\d+)>/g;

// Everything the prompt may reference, in hub order. A video with its soundtrack on is one
// entry: in H3 the soundtrack is defined together with <Video k>, so it needs no tag of its own.
export function referenceItems(doc) {
    const labels = assignLabels(doc);
    const items = [];
    for (const kind of ["image", "video", "audio"]) {
        for (const card of doc[listKey(kind)]) {
            const info = labels.get(card.id);
            if (!info) continue;
            const purpose = PURPOSES[kind].find(([value]) => value && value === card.purpose)?.[1] || "";
            items.push({ id: card.id, kind, label: info.label, display: info.display,
                name: card.name || KIND_NAMES[kind] + (info.slot + 1), purpose,
                withAudio: kind === "video" && !!info.audioLabel, audioLabel: info.audioLabel || null, card });
        }
    }
    return items;
}

// The "@query" right before the caret, or null. Stops at whitespace and at a tag's closing ">".
export function mentionAt(text, caret) {
    return triggerAt(text, caret, "@");
}

// "@query" / "#query" right before the caret; the trigger must not sit inside a word.
export function triggerAt(text, caret, char) {
    const pattern = char === "#" ? /(?:^|[^\w#&])#([^\s#<>]{0,20})$/u : /(?:^|[^\w@])@([^\s@<>]{0,30})$/u;
    const match = String(text).slice(0, caret).match(pattern);
    if (!match) return null;
    return { start: caret - match[1].length - 1, end: caret, query: match[1], char };
}

// "#" menu: concrete languages only (the text is not typed yet, so nothing to detect from).
const LANGUAGE_ALIASES = { Chinese: ["zh", "cn", "中", "汉", "普通话"], English: ["en", "英"],
    Japanese: ["ja", "jp", "日"], Korean: ["ko", "kr", "韩"] };
export function filterLanguages(query) {
    const q = String(query || "").trim().toLowerCase();
    return DIALOGUE_LANGUAGES.filter(([value]) => value !== "auto")
        .filter(([value, name]) => !q || value.toLowerCase().startsWith(q) || name.includes(q)
            || LANGUAGE_ALIASES[value].some(alias => alias.startsWith(q) || q.startsWith(alias)))
        .map(([value, name]) => ({ value, name }));
}

export function filterItems(items, query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return items;
    return items.filter(item => [item.name, item.display, item.label, item.purpose, KIND_NAMES[item.kind]]
        .some(text => String(text).toLowerCase().includes(q)));
}

// Tags in the text that no active card answers to (after reordering or disabling cards).
export function danglingLabels(text, items) {
    const known = new Set(items.map(item => item.label));
    for (const item of items) if (item.audioLabel) known.add(item.audioLabel);
    const missing = [];
    for (const [tag] of String(text).matchAll(LABEL_PATTERN)) {
        if (!known.has(tag) && !missing.includes(tag)) missing.push(tag);
    }
    return missing;
}


// ---------- dialogue: H3 writes spoken lines as <d>[Language] ...</d> ----------
export const DIALOGUE_LANGUAGES = [["auto", "自动"], ["Chinese", "中文"], ["English", "英文"],
    ["Japanese", "日文"], ["Korean", "韩文"]];
const DIALOGUE_BLOCK = /^<d>(?:\[[^\]\n]*\]\s*)?([\s\S]*)<\/d>$/;

export function detectLanguage(text) {
    const s = String(text);
    if (/[\u3040-\u30ff]/.test(s)) return "Japanese";
    if (/[\uac00-\ud7af]/.test(s)) return "Korean";
    if (/[\u4e00-\u9fff]/.test(s)) return "Chinese";
    if (/[A-Za-z]/.test(s)) return "English";
    return "Chinese";
}

// Wrap the selection in <d>[Language] ...</d>, or unwrap it when the selection already is (or sits
// exactly inside) one. Returns the new text and selection.
export function toggleDialogue(text, start, end, language = "auto") {
    text = String(text);
    const selected = text.slice(start, end);
    const whole = selected.match(DIALOGUE_BLOCK);
    if (whole) {
        const inner = whole[1];
        return { text: text.slice(0, start) + inner + text.slice(end), start, end: start + inner.length };
    }
    const before = text.slice(0, start).match(/<d>(?:\[[^\]\n]*\]\s*)?$/);
    if (before && text.startsWith("</d>", end) && !selected.includes("<d>") && !selected.includes("</d>")) {
        const from = start - before[0].length;
        return { text: text.slice(0, from) + selected + text.slice(end + 4), start: from, end: from + selected.length };
    }
    // keep surrounding spaces and line breaks outside the tags
    const lead = selected.match(/^\s*/)[0].length;
    const trail = selected.length - lead - selected.trim().length;
    const core = selected.trim();
    const tagged = /^\[[^\]\n]+\]/.test(core);
    const lang = language === "auto" ? detectLanguage(core) : language;
    const open = tagged ? "<d>" : `<d>[${lang}] `;
    const s = start + lead, e = end - trail;
    const next = text.slice(0, s) + open + core + "</d>" + text.slice(e);
    if (!core) return { text: next, start: s + open.length, end: s + open.length };
    const after = s + open.length + core.length + 4;
    return { text: next, start: after, end: after };
}

// Unbalanced <d> / </d>, in reading order.
export function dialogueIssues(text) {
    let open = false, unclosed = 0, stray = 0;
    for (const [tag] of String(text).matchAll(/<\/?d>/g)) {
        if (tag === "<d>") { if (open) unclosed += 1; open = true; }
        else if (open) open = false;
        else stray += 1;
    }
    if (open) unclosed += 1;
    return { unclosed, stray };
}

// ---------- format skeletons (section titles only) ----------
// 首尾帧 = FL2VA, which shares the basic guide's three fields with T2VA / I2VA;
// 多参考 = the Full-Reference guide's six fields, in its fixed order.
export const PROMPT_TEMPLATES = {
    keyframes: ["integrated_multimodal_description", "overall_soundscape", "non_diegetic_music"],
    reference: ["subject_definitions", "summary", "retention_analysis", "detailed_description",
        "overall_soundscape", "non_diegetic_music"],
};

// Insert the titles at the selection on their own lines; the caret goes under the first title.
export function insertTemplate(text, start, end, kind) {
    const fields = PROMPT_TEMPLATES[kind];
    if (!fields) return { text, start, end };
    text = String(text);
    const before = text.slice(0, start).replace(/[ \t]+$/, "");
    const after = text.slice(end).replace(/^[ \t]+/, "");
    const lead = !before ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    const block = fields.map(name => `${name}:\n`).join("\n");
    // the block already ends with "\n": one more makes a blank line before what follows
    const tail = !after || after.startsWith("\n") ? "" : "\n";
    const caret = before.length + lead.length + fields[0].length + 2;
    return { text: before + lead + block + tail + after, start: caret, end: caret };
}
