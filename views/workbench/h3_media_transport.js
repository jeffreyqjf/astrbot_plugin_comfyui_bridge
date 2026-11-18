// The upstream editor uses these two ComfyUI interfaces. Requests stay within
// AstrBot's authenticated API and its configured ComfyUI instance.
let bridge;
const urls = new Map();
const pending = new Map();
const events = new EventTarget();
export const app = {
  graph: { _nodes: [], subgraphs: new Map() },
  canvas: { selected_nodes: {} },
  ui: { settings: { getSettingValue: () => false } },
};

export function configureH3Transport(value) {
  bridge = value;
}

export async function prepareH3Files(value) {
  const files = new Set();
  function collect(item, key = "") {
    if (Array.isArray(item)) item.forEach((row) => collect(row));
    else if (item && typeof item === "object") {
      for (const [name, row] of Object.entries(item)) collect(row, name);
    } else if (typeof item === "string" && (
      /\[(input|output|temp)\]$/.test(item) || ["file", "mask", "result"].includes(key)
    ) && /\.(png|jpe?g|webp|gif|bmp|tiff?|mp4|mov|mkv|webm|avi|m4v|mpe?g|wav|mp3|flac|ogg|m4a|aac|opus)( \[(input|output|temp)\])?$/i.test(item)) {
      files.add(item);
    }
  }
  collect(value);
  for (const file of files) {
    const key = file.replace(/ \[input\]$/, "").replaceAll("\\", "/");
    if ((urls.get(key)?.expires || 0) > Date.now()) continue;
    if (!pending.has(key)) {
      pending.set(key, bridge.apiPost("studio/h3/media/preview", { file }).then(({ src }) => {
        urls.set(key, { src, expires: Date.now() + 5 * 60 * 60 * 1000 });
      }).finally(() => pending.delete(key)));
    }
    await pending.get(key);
  }
}

export const api = {
  clientId: "astrbot-h3-media",
  addEventListener: (...args) => events.addEventListener(...args),
  removeEventListener: (...args) => events.removeEventListener(...args),
  apiURL(path) {
    const url = new URL(path, location.origin);
    if (url.pathname !== "/view") throw new Error("不支持的 H3 媒体地址。");
    const { filename, subfolder, type } = Object.fromEntries(url.searchParams);
    const file = (subfolder ? subfolder + "/" : "") + filename + (type && type !== "input" ? " [" + type + "]" : "");
    return urls.get(file.replaceAll("\\", "/"))?.src || "";
  },
  async fetchApi(path, init = {}) {
    try {
      if (init.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      let data;
      if (path === "/minimax_h3/upload") {
        data = await bridge.upload("studio/h3/media/upload", init.body.get("file"));
      } else {
        data = await bridge.apiPost("studio/h3/media/rpc", {
          path, method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null,
        });
      }
      if (!data.error) await prepareH3Files(data);
      return new Response(JSON.stringify(data), {
        status: data.error ? 400 : 200, headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
  },
};
