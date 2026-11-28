import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { NODE_ID, PROMPT_NODE_ID, SETTINGS_NODE_ID, parseDocument, secondsToLength } from "./refs_state.js";
import { RefHubPanel, IMAGE_SETTINGS } from "./panel.js";
import { SettingsPanel } from "./settings_panel.js";
import { TwoPassSigmasPanel } from "./sigmas_panel.js";
import { PromptPanel } from "./prompt_panel.js";
import { ClipPickerPanel, ClipSaverPanel } from "./clip_panel.js";
import { CLIP_PICKER_ID, CLIP_SAVER_ID, STAGE_PICKER_ID, STAGE_SAVER_ID, STAGE_FIELDS } from "./clip_state.js";

const REF2V_NODE_ID = "AmiaomiaoH3_ReferenceToVideo";
const SIGMAS_NODE_ID = "AmiaomiaoH3_TwoPassSigmas";
const SIGMAS_FIELDS = ["scheduler", "first_steps", "second_steps", "extra_steps", "start_at_sigma", "end_at_sigma", "spacing"];
const MOTION_CONTEXT_NODE_ID = "AmiaomiaoH3_MiniMaxH3MotionContextClipStream";
const OVERLAP_RESTORE_NODE_ID = "AmiaomiaoH3_MiniMaxH3OverlapRestoreClipStream";
const CONTEXT_FIELDS = ["context_length", "enable_audio_context", "audio_context_length"];
const HUB_CHANGED = "amiaomiao-h3-refs-changed";
const GUIDE_DURATION_CHANGED = "amiaomiao-h3-guide-duration-changed";
// Widgets the generation-settings node takes over on the Ref2V node while it is connected.
const SETTINGS_OVERRIDES = ["width", "height", "length", "follow_reference", "pad_reference"];
const SETTINGS_FIELDS = ["seconds", "follow_reference", "ratio", "orientation", "megapixels", "upscale",
    "pad_reference", "custom_width", "custom_height"];

function normalizeClipboardMetadata(nodeType) {
    const serialize = nodeType.prototype.onSerialize;
    nodeType.prototype.onSerialize = function (data) {
        const result = serialize?.apply(this, arguments);
        if (data.properties?.aux_id === null) {
            data.properties = { ...data.properties };
            delete data.properties.aux_id;
        }
        return result;
    };
}

if (!document.getElementById("amiaomiao-h3-refs-style")) {
    const link = document.createElement("link");
    link.id = "amiaomiao-h3-refs-style";
    link.rel = "stylesheet";
    link.href = new URL("./refs.css?v=20261127y", import.meta.url).href;
    document.head.append(link);
}

app.registerExtension({
    name: "Amiaomiao.H3.ReferenceHub",
    setup() {
        const queuePrompt = api.queuePrompt;
        if (typeof queuePrompt !== "function") return;
        api.queuePrompt = async function (...args) {
            try {
                return await queuePrompt.apply(this, args);
            } catch (error) {
                for (const node of Object.values(error?.response?.node_errors ?? {})) {
                    if (node.class_type !== "AmiaomiaoH3_MiniMaxClipStageError") continue;
                    for (const issue of node.errors ?? []) {
                        if (issue.type !== "custom_validation_failed" || issue.extra_info?.input_name !== "message") continue;
                        // First line of the backend message is the short title; show it instead of "message".
                        const title = String(issue.details ?? "").match(/H3 抽卡：([^\n]+)/)?.[1]?.trim();
                        if (title) issue.extra_info.input_name = title;
                    }
                }
                throw error;
            }
        };
    },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name.startsWith("AmiaomiaoH3_")) normalizeClipboardMetadata(nodeType);
        if (nodeData.name === CLIP_PICKER_ID) nodeData.display_name = "H3 片段选择 v1";
        if (nodeData.name === SETTINGS_NODE_ID) return registerSettingsNode(nodeType);
        if (nodeData.name === SIGMAS_NODE_ID) return registerTwoPassSigmasNode(nodeType);
        if (nodeData.name === REF2V_NODE_ID) return registerRef2V(nodeType);
        if (nodeData.name === PROMPT_NODE_ID) return registerPromptNode(nodeType);
        if (nodeData.name === CLIP_PICKER_ID || nodeData.name === STAGE_PICKER_ID)
            return registerClipPicker(nodeType, nodeData.name === STAGE_PICKER_ID);
        if (nodeData.name === CLIP_SAVER_ID || nodeData.name === STAGE_SAVER_ID) return registerClipSaver(nodeType);
        if (nodeData.name === MOTION_CONTEXT_NODE_ID) return registerMotionContext(nodeType);
        if (nodeData.name === OVERLAP_RESTORE_NODE_ID) return registerOverlapRestore(nodeType);
        if (nodeData.name !== NODE_ID) return;
        const created = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = created?.apply(this, arguments);
            const field = this.widgets?.find(widget => widget.name === "references");
            if (!field) return result;
            field.options = { ...field.options, hidden: true };
            // Image-only settings live on the image page; the widgets stay (hidden) so saved
            // workflows keep their values in place and the backend reads them as before.
            const settingWidgets = new Map();
            for (const name of IMAGE_SETTINGS) {
                const widget = this.widgets?.find(item => item.name === name);
                if (!widget) continue;
                widget.options = { ...widget.options, hidden: true };
                settingWidgets.set(name, widget);
            }
            const panel = new RefHubPanel({
                api, value: field.value,
                onChange: value => {
                    field.value = value;
                    app.graph?.setDirtyCanvas(true, true);
                    window.dispatchEvent(new CustomEvent(HUB_CHANGED));
                },
                settings: settingWidgets.size === IMAGE_SETTINGS.length ? {
                    get: name => settingWidgets.get(name)?.value,
                    set: (name, value) => {
                        const widget = settingWidgets.get(name);
                        if (!widget) return;
                        widget.value = value;
                        widget.callback?.(value);
                        app.graph?.setDirtyCanvas(true, true);
                    },
                } : null,
            });
            this.h3RefHub = panel;
            const widget = this.addDOMWidget("h3_ref_hub", "h3-ref-hub", panel.root, {
                serialize: false, hideOnZoom: false, getMinHeight: () => 420,
            });
            widget.serialize = false;
            this.size = [Math.max(this.size[0], 920), Math.max(this.size[1], 800)];
            return result;
        };
        const configure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const result = configure?.apply(this, arguments);
            const field = this.widgets?.find(widget => widget.name === "references");
            if (field) this.h3RefHub?.load(field.value);
            window.dispatchEvent(new CustomEvent(HUB_CHANGED));
            return result;
        };
        const executed = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            const result = executed?.apply(this, arguments);
            this.h3RefHub?.showResults(message);
            return result;
        };
        const removed = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            this.h3RefHub?.dispose();
            return removed?.apply(this, arguments);
        };
    },
});

function registerSettingsNode(nodeType) {
    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        const result = created?.apply(this, arguments);
        const widgets = new Map();
        for (const name of SETTINGS_FIELDS) {
            const widget = this.widgets?.find(item => item.name === name);
            if (!widget) return result;  // unexpected schema: leave the plain widgets visible
            widgets.set(name, widget);
        }
        for (const widget of widgets.values()) widget.options = { ...widget.options, hidden: true };
        this.h3GuideDurationFrames = () => {
            const seconds = Number(widgets.get("seconds").value);
            return !widgets.get("follow_reference").value && Number.isFinite(seconds) && seconds > 0
                ? secondsToLength(seconds) : 0;
        };
        const panel = new SettingsPanel({
            get: name => widgets.get(name)?.value,
            set: (name, value) => {
                const widget = widgets.get(name);
                if (!widget) return;
                widget.value = value;
                widget.callback?.(value);
                if (name === "seconds" || name === "follow_reference") {
                    window.dispatchEvent(new CustomEvent(GUIDE_DURATION_CHANGED, { detail: this }));
                }
                app.graph?.setDirtyCanvas(true, true);
            },
        });
        this.h3Settings = panel;
        const refreshReference = () => updateSettingsReference(this);
        this.h3SettingsReferenceRefresh = refreshReference;
        window.addEventListener(HUB_CHANGED, refreshReference);
        queueMicrotask(refreshReference);
        const widget = this.addDOMWidget("h3_settings", "h3-settings", panel.root, {
            serialize: false, hideOnZoom: false, margin: 10, getMinHeight: () => 360,
        });
        widget.serialize = false;
        this.size = [Math.max(this.size[0], 496), Math.max(this.size[1], 710)];
        return result;
    };
    const configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
        const result = configure?.apply(this, arguments);
        this.h3Settings?.render();  // widget values were restored after the panel was built
        requestAnimationFrame(() => this.h3SettingsReferenceRefresh?.());
        return result;
    };
    const connections = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
        const result = connections?.apply(this, arguments);
        this.h3SettingsReferenceRefresh?.();
        return result;
    };
    const removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
        window.removeEventListener(HUB_CHANGED, this.h3SettingsReferenceRefresh);
        this.h3Settings?.dispose?.();
        return removed?.apply(this, arguments);
    };
    const executed = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
        const result = executed?.apply(this, arguments);
        this.h3Settings?.showResult(message);
        return result;
    };
}

function registerTwoPassSigmasNode(nodeType) {
    const COLLAPSED_MIN = 248;
    const EXPANDED_MIN = 432;
    const EXPAND_DELTA = 188;

    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        const result = created?.apply(this, arguments);
        const widgets = new Map();
        for (const name of SIGMAS_FIELDS) {
            const widget = this.widgets?.find(item => item.name === name);
            if (!widget) return result;
            widgets.set(name, widget);
        }
        for (const widget of widgets.values()) widget.options = { ...widget.options, hidden: true };

        let collapsedHeight = null;
        const panel = new TwoPassSigmasPanel({
            get: name => widgets.get(name)?.value,
            set: (name, value) => {
                const widget = widgets.get(name);
                if (!widget) return;
                widget.value = value;
                widget.callback?.(value);
                app.graph?.setDirtyCanvas(true, true);
            },
            options: name => {
                const values = widgets.get(name)?.options?.values;
                return Array.isArray(values) ? values : [];
            },
            isLinked: name => Boolean(this.inputs?.find(port => port.name === name)?.link != null),
        }, {
            onToggleAdvanced: open => {
                if (open) {
                    collapsedHeight = this.size[1];
                    this.size = [this.size[0], Math.max(this.size[1] + EXPAND_DELTA, EXPANDED_MIN + 94)];
                } else if (collapsedHeight != null) {
                    this.size = [this.size[0], Math.max(COLLAPSED_MIN + 88, collapsedHeight)];
                    collapsedHeight = null;
                }
                app.graph?.setDirtyCanvas(true, true);
            },
        });

        this.h3TwoPassSigmas = panel;
        const domWidget = this.addDOMWidget("h3_two_pass_sigmas", "h3-two-pass-sigmas", panel.root, {
            serialize: false,
            hideOnZoom: false,
            margin: 8,
            getMinHeight: () => (panel.isExpanded() ? EXPANDED_MIN : COLLAPSED_MIN),
        });
        domWidget.serialize = false;
        this.size = [Math.max(this.size[0], 350), Math.max(this.size[1], 338)];
        return result;
    };

    const configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
        const result = configure?.apply(this, arguments);
        this.h3TwoPassSigmas?.render();
        return result;
    };
    const connections = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
        const result = connections?.apply(this, arguments);
        this.h3TwoPassSigmas?.render();
        return result;
    };
    const removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
        this.h3TwoPassSigmas?.dispose?.();
        return removed?.apply(this, arguments);
    };
}

async function updateSettingsReference(node) {
    const panel = node.h3Settings;
    if (!panel) return;
    const hub = upstreamHub(node);
    const card = hub ? parseDocument(hub.widgets?.find(widget => widget.name === "references")?.value).videos.find(item => !item.skip) : null;
    if (!card?.segment_id) {
        panel.setReference({ status: "missing", text: "没有启用的 Video 1，不能跟随参考视频" });
        return;
    }
    const ticket = {};
    node.h3SettingsReferenceTicket = ticket;
    panel.setReference({ status: "loading", text: "正在读取 Video 1 时长…" });
    try {
        const path = card.source === "uploads"
            ? `/amiaomiao_h3/lvm/uploads?project=${encodeURIComponent(card.project)}`
            : `/amiaomiao_h3/lvm/segments?project=${encodeURIComponent(card.project)}`;
        const data = await fetchJson(path);
        if (node.h3SettingsReferenceTicket !== ticket) return;
        const records = (card.source === "uploads" ? data.videos : data.segments) || [];
        const record = records.find(item => Number(item.segment_id) === Number(card.segment_id));
        const name = card.name || record?.original_name || record?.label || "Video 1";
        const exact = Number(record?.frames) || 0;
        const estimate = Math.round((Number(record?.duration_sec) || 0) * 24);
        if (exact > 0) panel.setReference({ status: "ready", frames: exact, name, text: `Video 1：${name} · ${exact} 帧` });
        else if (estimate > 0) panel.setReference({ status: "estimate", frames: estimate, name, text: `Video 1：${name} · 约 ${estimate} 帧（运行时按实际解码帧数）` });
        else panel.setReference({ status: "missing", text: "读不到 Video 1 的时长，请重新选择视频" });
    } catch (error) {
        if (node.h3SettingsReferenceTicket === ticket) panel.setReference({ status: "missing", text: `读不到 Video 1：${error.message}` });
    }
}

// While 生成设置 is connected, the Ref2V widgets it replaces are hidden so there is one source.
function registerRef2V(nodeType) {
    const sync = node => {
        const linked = node.inputs?.some(input => input.name === "settings" && input.link != null);
        let changed = false;
        for (const widget of node.widgets || []) {
            if (widget.name === "sampling_pass") {
                if (!!widget.options?.hidden === linked) { widget.options = { ...widget.options, hidden: !linked }; changed = true; }
                continue;
            }
            if (!SETTINGS_OVERRIDES.includes(widget.name)) continue;
            if (!!widget.options?.hidden !== linked) { widget.options = { ...widget.options, hidden: linked }; changed = true; }
        }
        if (changed) {
            node.setSize?.([node.size[0], node.computeSize?.()[1] ?? node.size[1]]);
            app.graph?.setDirtyCanvas(true, true);
        }
    };
    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        const result = created?.apply(this, arguments);
        sync(this);
        return result;
    };
    const connections = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
        const result = connections?.apply(this, arguments);
        sync(this);
        if (arguments[0] === 1 && this.inputs?.[arguments[1]]?.name === "settings") {
            window.dispatchEvent(new CustomEvent(GUIDE_DURATION_CHANGED, { detail: this }));
        }
        return result;
    };
    const configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
        const result = configure?.apply(this, arguments);
        sync(this);
        return result;
    };
}

// The hub feeding a node's "refs" input, following reroutes and bypassed pass-through nodes.
function upstreamHub(node, inputName = "refs", seen = new Set()) {
    const graph = node?.graph || app.graph;
    const input = node?.inputs?.find(item => item.name === inputName) ?? node?.inputs?.find(item => item.type === "H3_REFS");
    const link = input?.link != null ? (graph?.links?.get?.(input.link) ?? graph?.links?.[input.link]) : null;
    const origin = link ? graph.getNodeById(link.origin_id) : null;
    if (!origin || seen.has(origin.id)) return null;
    seen.add(origin.id);
    if (origin.type === NODE_ID) return origin;
    if (origin.type === "Reroute" || origin.mode === 4) {
        const pass = origin.inputs?.find(item => item.link != null && (item.type === "H3_REFS" || item.type === "*"));
        return pass ? upstreamHub(origin, pass.name, seen) : null;
    }
    return null;
}

function registerPromptNode(nodeType) {
    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        const result = created?.apply(this, arguments);
        const field = this.widgets?.find(widget => widget.name === "text");
        if (!field) return result;
        field.options = { ...field.options, hidden: true };
        // the stock multiline widget keeps its own textarea in the DOM; hide that too
        if (field.element) field.element.style.display = "none";
        const panel = new PromptPanel({
            value: field.value,
            url: path => api.apiURL(path),
            onChange: value => { field.value = value; app.graph?.setDirtyCanvas(true, false); },
            // a node property: saved with the workflow, no backend widget to shift
            language: {
                get: () => this.properties?.h3_dialogue_language || "auto",
                set: value => { this.properties = { ...this.properties, h3_dialogue_language: value }; },
            },
            source: () => {
                const hub = upstreamHub(this);
                const raw = hub?.widgets?.find(widget => widget.name === "references")?.value;
                return hub ? { doc: parseDocument(raw), title: hub.title } : null;
            },
        });
        this.h3Prompt = panel;
        this.h3PromptRefresh = () => panel.refresh();
        window.addEventListener(HUB_CHANGED, this.h3PromptRefresh);
        const widget = this.addDOMWidget("h3_prompt", "h3-prompt", panel.root, {
            serialize: false, hideOnZoom: false, getMinHeight: () => 240,
        });
        widget.serialize = false;
        this.size = [Math.max(this.size[0], 720), Math.max(this.size[1], 460)];
        return result;
    };
    const configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
        const result = configure?.apply(this, arguments);
        const field = this.widgets?.find(widget => widget.name === "text");
        if (field) this.h3Prompt?.setValue(field.value ?? "");
        this.h3Prompt?.setLanguage(this.properties?.h3_dialogue_language || "auto");
        // links are restored after every node is configured
        requestAnimationFrame(() => this.h3Prompt?.refresh());
        return result;
    };
    const connections = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
        const result = connections?.apply(this, arguments);
        this.h3Prompt?.refresh();
        return result;
    };
    const removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
        window.removeEventListener(HUB_CHANGED, this.h3PromptRefresh);
        this.h3Prompt?.dispose();
        return removed?.apply(this, arguments);
    };
}

async function fetchJson(path, options) {
    const response = await api.fetchApi(path, { cache: "no-store", ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
    return data;
}

const PICKER_FIELDS = ["project_name", "mode", "clip_selection", "passes", ...CONTEXT_FIELDS];

function registerMotionContext(nodeType) {
    // Only hide local settings for this connection; their saved values are the fallback on disconnect.
    const sync = node => {
        const linked = node.inputs?.some(input => input.name === "link" && input.link != null);
        for (const widget of node.widgets || []) {
            if (CONTEXT_FIELDS.includes(widget.name)) widget.options = { ...widget.options, hidden: !!linked };
        }
        node.setDirtyCanvas?.(true, true);
    };
    const configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
        const result = configure?.apply(this, arguments);
        sync(this);
        return result;
    };
    const connections = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
        const result = connections?.apply(this, arguments);
        if (arguments[0] === 1 && this.inputs?.[arguments[1]]?.name === "link") sync(this);
        return result;
    };
}

function registerOverlapRestore(nodeType) {
    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        const result = created?.apply(this, arguments);
        const follow = this.widgets?.find(widget => widget.name === "color_follow_overlap");
        if (follow) follow.value = true;
        return result;
    };
    const configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
        const result = configure?.apply(this, arguments);
        const index = this.widgets?.findIndex(widget => widget.name === "color_follow_overlap");
        if (index >= 0 && info?.widgets_values?.[index] == null) this.widgets[index].value = false;
        return result;
    };
}

function registerClipPicker(nodeType, stageWorkflow) {
    nodeType.prototype.setSizeForImage = function () {};
    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        const result = created?.apply(this, arguments);
        const widgets = new Map();
        for (const name of [...PICKER_FIELDS, ...(stageWorkflow ? STAGE_FIELDS : [])]) {
            const widget = this.widgets?.find(item => item.name === name);
            if (!widget && CONTEXT_FIELDS.includes(name)) continue;
            if (!widget) return result;
            widgets.set(name, widget);
        }
        for (const widget of widgets.values()) widget.options = { ...widget.options, hidden: true };
        const panel = new ClipPickerPanel({
            url: path => api.apiURL(path), resolve: src => api.resolveMedia?.(src) ?? src, fetchJson, stageWorkflow,
            fields: {
                get: name => widgets.get(name)?.value,
                set: (name, value) => {
                    const widget = widgets.get(name);
                    if (!widget) return;
                    widget.value = value;
                    widget.callback?.(value);
                    app.graph?.setDirtyCanvas(true, false);
                },
            },
        });
        this.h3ClipPicker = panel;
        const widget = this.addDOMWidget("h3_clip_picker", "h3-clip-picker", panel.root, {
            serialize: false, hideOnZoom: false, getMinHeight: () => 360,
        });
        widget.serialize = false;
        this.size = [Math.max(this.size[0], 880), Math.max(this.size[1], 680)];
        // folder names drop characters other than letters, digits, space, _ and -
        const folder = name => String(name || "").replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "Default_Project";
        this.h3ClipChanged = event => {
            const project = event?.detail?.project;
            if (!project || folder(project) === folder(widgets.get("project_name")?.value)) panel.reload({ projects: true });
            else panel.projects = null;  // another project's count changed
        };
        // Savers (v2 and the old ones' delete/lock routes) announce changes per project;
        // only those reload the wall, so unrelated runs cost no request.
        api.addEventListener("amiaomiao_h3/clip_bin/changed", this.h3ClipChanged);
        return result;
    };
    const configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
        const result = configure?.apply(this, arguments);
        // old picker strings map onto the two v2 modes
        const mode = this.widgets?.find(widget => widget.name === "mode");
        if (mode && !["接续前段", "全新段落"].includes(mode.value)) {
            mode.value = String(mode.value || "").startsWith("Force Initial") ? "全新段落" : "接续前段";
        }
        this.h3ClipPicker?.reload({ restorePage: true });
        return result;
    };
    const executed = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
        const result = executed?.apply(this, arguments);
        this.imgs = null;
        this.h3ClipPicker?.showResult(message);
        return result;
    };
    const removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
        api.removeEventListener("amiaomiao_h3/clip_bin/changed", this.h3ClipChanged);
        this.h3ClipPicker?.dispose();
        return removed?.apply(this, arguments);
    };
}

function registerClipSaver(nodeType) {
    nodeType.prototype.setSizeForImage = function () {};
    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        const result = created?.apply(this, arguments);
        const panel = new ClipSaverPanel();
        this.h3ClipSaver = panel;
        const widget = this.addDOMWidget("h3_clip_saver", "h3-clip-saver", panel.root, {
            serialize: false, hideOnZoom: false, getMinHeight: () => 44,
        });
        widget.serialize = false;
        this.size = [Math.max(this.size[0], 360), this.size[1]];
        return result;
    };
    const executed = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
        const result = executed?.apply(this, arguments);
        this.imgs = null;
        this.h3ClipSaver?.showResult(message);
        const info = message?.h3_clip_v2?.[0];
        if (info?.stage && this.graph) {
            const input = this.inputs?.find(item => item.name === "link");
            const link = this.graph.getLink?.(input?.link) || this.graph.links?.[input?.link];
            if (link) this.graph.getNodeById(link.origin_id)?.h3ClipPicker?.saved(info);
        }
        return result;
    };
}
