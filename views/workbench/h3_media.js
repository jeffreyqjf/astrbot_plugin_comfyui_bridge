import { app, configureH3Transport, prepareH3Files } from "./h3_media_transport.js";
import { LoaderPanel, pastedFiles } from "./h3_media_vendor.js";

const workflowName = "MiniMax_H3_Seed_Hunter_V3_AstrBot";

export function mountH3Media({ bridge, host, status, pickGallery }) {
  configureH3Transport(bridge);
  const area = host.querySelector("[data-h3-panel]");
  const state = { items: [], panel: null, active: false, loading: null };
  let loadError = "";
  let uploads = 0;
  const node = {
    id: 416, type: "MiniMaxH3MediaLoader", size: [900, 600], properties: {},
    widgets: [{
      name: "media_state",
      get value() { return JSON.stringify(state.items); },
      set value(value) { state.items = JSON.parse(value); },
    }],
    graph: app.graph,
    setDirtyCanvas() {},
  };
  app.graph._nodes = [node];

  async function load() {
    host.querySelector("[data-h3-reload]").disabled = true;
    status("正在加载 H3 参考素材…");
    try {
      const result = await bridge.apiGet("studio/h3/media");
      if (!result.available) throw new Error("当前模式没有启用 Fantastic H3 Media Loader。");
      await prepareH3Files(result.items);
      for (const player of state.panel?.players || []) player.stop();
      state.items = result.items;
      if (state.panel) {
        clearTimeout(state.panel._dimsCommit);
        clearTimeout(state.panel._matchTimer);
        state.panel.items = state.panel.read();
        state.panel.presetName = "";
        state.panel.render();
      } else {
        state.panel = node._mmlPanel = new LoaderPanel(node);
        const add = state.panel.add.bind(state.panel);
        state.panel.add = async (files) => {
          uploads++;
          try { await add(files); }
          finally { uploads--; }
        };
      }
      area.replaceChildren(state.panel.root);
      area.querySelectorAll("button").forEach((button) => { button.type = "button"; });
      loadError = "";
      status("");
    } catch (error) {
      loadError = error.message;
      status(loadError, true);
    } finally {
      host.querySelector("[data-h3-reload]").disabled = false;
    }
  }

  host.querySelector("[data-h3-reload]").addEventListener("click", () => {
    if (state.loading || state.panel?.busy || uploads) return;
    state.loading = load().finally(() => { state.loading = null; });
  });
  const galleryButton = host.querySelector("[data-h3-gallery]");
  galleryButton.addEventListener("click", () => {
    if (!state.panel || state.loading || uploads) return;
    pickGallery(async ({ entry, kind, state: galleryState, label }) => {
      uploads++;
      galleryButton.disabled = true;
      status("正在导入图集原图…");
      try {
        const { src } = await bridge.apiGet(
          kind === "controls" ? "studio/control-assets/preview" : "studio/images/file",
          { id: kind === "controls" ? entry.asset_id ?? entry.id : entry.id,
            ...(kind === "controls" ? {} : { state: galleryState }), original: "1" },
        );
        const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(src);
        if (!match) throw new Error("图集返回的图片格式无效。");
        const suffix = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" }[match[1]];
        const name = (entry.name || label || "图集图片").replace(/\.(png|jpe?g|webp|gif)$/i, "") + suffix;
        const bytes = Uint8Array.from(atob(match[2]), (value) => value.charCodeAt(0));
        await state.panel.add([new File([bytes], name, { type: match[1] })]);
        status("");
      } catch (error) {
        status(error.message, true);
      } finally {
        uploads--;
        galleryButton.disabled = false;
      }
    });
  });
  host.addEventListener("paste", (event) => {
    const files = pastedFiles(event);
    if (!files.length || !state.panel) return;
    event.preventDefault();
    state.panel.add(files);
  });

  return {
    async show(name) {
      state.active = name === workflowName;
      host.hidden = !state.active;
      if (!state.active) {
        for (const player of state.panel?.players || []) player.stop();
        return;
      }
      if (!state.panel && !state.loading) state.loading = load().finally(() => { state.loading = null; });
      await state.loading;
      if (state.panel) {
        try { await prepareH3Files(state.items); }
        catch (error) { status(error.message, true); }
      }
    },
    async payload() {
      if (!state.active) return {};
      await state.loading;
      if (loadError) throw new Error(loadError);
      if (!state.panel || state.panel.busy || uploads) throw new Error("请等待 H3 素材上传完成。");
      return { h3_media: structuredClone(state.items) };
    },
  };
}
