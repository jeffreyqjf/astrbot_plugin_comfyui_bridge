// Pure rules for「H3 片段选择 v2」. Mirrors toolbox/clipstream/clipbin/v2_core.py.
export const CLIP_PICKER_ID = "AmiaomiaoH3_MiniMaxClipPickerV2";
export const CLIP_SAVER_ID = "AmiaomiaoH3_MiniMaxClipSaverV2";
export const STAGE_PICKER_ID = "AmiaomiaoH3_MiniMaxClipStagePicker";
export const STAGE_SAVER_ID = "AmiaomiaoH3_MiniMaxClipStageSaver";
export const STAGE_FIELDS = ["draft_only", "refine_clip", "refine_revision", "stage_plan"];
export const MODE_CONTINUE = "接续前段";
export const MODE_NEW = "全新段落";
// card variants
export const PASS_ONE = "一采";
export const PASS_TWO = "二采";
// which workflow the Picker sits in
export const FLOW_DUAL = "双采";
export const FLOW_SINGLE = "单采";
export const LATEST = "latest";
// Join settings the Picker hands to every Motion Context (mirrors v2_core.normalize_context).
export const CONTEXT_LENGTHS = ["5", "22", "39", "56"];
export const DEFAULT_CONTEXT_LENGTH = "22";
export const DEFAULT_AUDIO_LENGTH = 24;
export const AUDIO_LENGTH_MAX = 240;

export function normalizeContext(contextLength = DEFAULT_CONTEXT_LENGTH, enableAudio = false, audioLength = DEFAULT_AUDIO_LENGTH) {
    let frames = String(contextLength ?? "").trim();
    if (!CONTEXT_LENGTHS.includes(frames)) frames = DEFAULT_CONTEXT_LENGTH;
    let audio = Number.parseInt(audioLength, 10);
    if (!Number.isFinite(audio)) audio = DEFAULT_AUDIO_LENGTH;
    audio = Math.min(AUDIO_LENGTH_MAX, Math.max(0, audio));
    return { video_frames: Number(frames), audio: !!enableAudio, audio_frames: audio };
}

export function normalizeMode(value) {
    const text = String(value ?? "").trim();
    return text === MODE_NEW || text.startsWith("Force Initial") ? MODE_NEW : MODE_CONTINUE;
}
export function normalizePasses(value) {
    return [FLOW_SINGLE, PASS_ONE].includes(String(value ?? "").trim()) ? FLOW_SINGLE : FLOW_DUAL;
}

export function splitStageCards(clips) {
    return {
        drafts: clips.filter(card => card.clip_stage === "draft"),
        completed: clips.filter(card => card.clip_stage !== "draft"),
    };
}
export function isLatest(selection) {
    return ["", "latest", "auto", "default", "0"].includes(String(selection ?? "").trim().toLowerCase());
}

// {一采: seconds, 二采: seconds} for the variants a card really has; old single cards are 一采.
export function variantsOf(clip) {
    const out = {};
    const variants = clip?.variants;
    if (variants && typeof variants === "object" && Object.keys(variants).length) {
        for (const name of [PASS_ONE, PASS_TWO]) {
            const v = variants[name];
            if (v?.has_latent) out[name] = Number(v.duration_seconds) || 0;
        }
    } else if (clip?.clip_id) {
        out[PASS_ONE] = Number(clip.duration_seconds) || 0;
    }
    return out;
}

export function shotLabel(clip) {
    return String(clip?.shot_tag ?? "").trim() || String(clip?.clip_id ?? "");
}

// "1344×768" of the highest pass the card has, from the latent shape (H3 latents are 1/16).
export function resolutionOf(clip) {
    const pick = clip?.variants?.[PASS_TWO]?.has_latent ? clip.variants[PASS_TWO]
        : clip?.variants?.[PASS_ONE]?.has_latent ? clip.variants[PASS_ONE] : clip;
    const shape = pick?.video_shape;
    if (Array.isArray(shape) && shape.length === 5) return `${shape[4] * 16}×${shape[3] * 16}`;
    return "";
}

export function resolveTarget(clips, selection) {
    const usable = (clips || []).filter(c => c?.clip_id);
    if (!usable.length) return null;
    if (isLatest(selection)) return usable[0];
    const wanted = String(selection).trim();
    return usable.find(c => c.clip_id === wanted) || usable.find(c => shotLabel(c) === wanted) || undefined;
}

// The status line shown before a run: what the next run will do.
export function plannedStatus({ project, mode, passes, clips, selection }) {
    mode = normalizeMode(mode);
    passes = normalizePasses(passes);
    if (mode === MODE_NEW) return { text: `全新段落 · 保存到「${project}」`, tone: "new" };
    const target = resolveTarget(clips, selection);
    if (target === null) return { text: `「${project}」里还没有片段，本次按全新段落生成`, tone: "new" };
    if (target === undefined) return { text: "固定接续的片段已不在这个项目里（可能被删除）", tone: "error", missing: true };
    const have = variantsOf(target);
    const shown = passes === FLOW_SINGLE ? { [PASS_ONE]: have[PASS_ONE] } : have;
    const parts = Object.entries(shown).filter(([, s]) => s !== undefined)
        .map(([name, s]) => (s ? `${name} ${s.toFixed(1)} 秒` : name));
    let text = `接续 ${shotLabel(target)}${parts.length ? `（${parts.join(" / ")}）` : ""}`;
    let tone = "continue";
    if (passes === FLOW_DUAL && have[PASS_TWO] === undefined) {
        text += " · 这一段没有二采，二采按全新段落生成";
        tone = "warn";
    }
    return { text, tone, target };
}

// Lineage label: "接自 Shot 3" from the parent id, looked up among the loaded cards.
export function parentLabel(clip, clips) {
    const parent = String(clip?.parent_clip_id ?? "").trim();
    if (!parent || parent.toUpperCase().startsWith("[INITIAL")) return "";
    const found = (clips || []).find(c => c.clip_id === parent);
    return found ? shotLabel(found) : "已删除的片段";
}

// The chain the next run continues: the target, its parent, the parent's parent... newest first.
// Stops at a missing parent or a loop. Returns [] when there is no target.
export function chainOf(clips, target) {
    const byId = new Map((clips || []).map(c => [c.clip_id, c]));
    const chain = [];
    const seen = new Set();
    let node = target ? byId.get(target.clip_id) : null;
    while (node && !seen.has(node.clip_id)) {
        chain.push(node);
        seen.add(node.clip_id);
        node = byId.get(String(node.parent_clip_id ?? "").trim());
    }
    return chain;
}
