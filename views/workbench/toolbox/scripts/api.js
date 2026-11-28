// AstrBot transport for the original H3 Toolbox extensions.
// SPDX-License-Identifier: GPL-3.0-only
const events = new EventTarget();
const pending = new Map();
const cached = new Map();
const placeholders = new Map();
const paths = new Map();
const pixel = "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==#h3toolbox-";
let bridge;
let observed = false, nextPlaceholder = 0;

export function connect(value) {
  bridge = value;
  if (observed) return;
  observed = true;
  const load = element => {
    if (!(element instanceof Element)) return;
    for (const attr of ["src", "poster", "href"]) {
      const placeholder = element.getAttribute(attr);
      const path = placeholders.get(placeholder);
      if (!path || element.dataset.h3Preview === placeholder) continue;
      element.dataset.h3Preview = placeholder;
      resolveMedia(path).then(src => {
        if (element.getAttribute(attr) === placeholder) element.setAttribute(attr, src);
      }).catch(error => {
        delete element.dataset.h3Preview;
        if (element.getAttribute(attr) === placeholder) element.title = error.message;
      });
    }
  };
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === "attributes") load(record.target);
      else for (const element of record.addedNodes) {
        load(element);
        element.querySelectorAll?.("[src],[poster],[href]").forEach(load);
      }
    }
  }).observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ["src", "poster", "href"]});
}

export function resolveMedia(path) {
  path = placeholders.get(path) ?? path;
  if (/^(?:\/h3-media\/|\/api\/v1\/files\/tokens\/|data:image\/jpeg;base64,)/.test(path)) return Promise.resolve(path);
  if (cached.has(path)) return Promise.resolve(cached.get(path));
  if (!pending.has(path)) {
    pending.set(path, bridge.apiPost("studio/h3/toolbox/rpc", {path, method: "GET"}).then(data => {
      if (!data.src) throw Error(data.error || "无法读取 H3 素材。");
      cached.set(path, data.src);
      if (cached.size > 256) cached.delete(cached.keys().next().value);
      return data.src;
    }).finally(() => pending.delete(path)));
  }
  return pending.get(path);
}

async function sendFile(file, project = null) {
  const query = project === null ? "" : "?" + new URLSearchParams({pool:"1", project});
  return bridge.upload("studio/h3/toolbox/upload" + query, file);
}

async function pickVideo(signal) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "video/*,.mkv,.avi";
  const file = await new Promise(resolve => {
    input.onchange = () => resolve(input.files[0]);
    input.oncancel = () => resolve(null);
    signal?.addEventListener("abort", () => resolve(null), {once:true});
    input.click();
  });
  if (!file) return {cancelled:true};
  const data = await sendFile(file);
  return {path: [data.subfolder, data.name].filter(Boolean).join("/")};
}

export const api = {
  addEventListener: (...args) => events.addEventListener(...args),
  removeEventListener: (...args) => events.removeEventListener(...args),
  dispatchEvent: event => events.dispatchEvent(event),
  resolveMedia,
  apiURL(path) {
    if (cached.has(path)) return cached.get(path);
    if (paths.has(path)) return paths.get(path);
    const placeholder = pixel + (++nextPlaceholder);
    placeholders.set(placeholder, path);
    paths.set(path, placeholder);
    if (placeholders.size > 4096) {
      const [old, original] = placeholders.entries().next().value;
      paths.delete(original);
      placeholders.delete(old);
    }
    return placeholder;
  },
  async fetchApi(path, init = {}) {
    try {
      init.signal?.throwIfAborted();
      let value;
      if (path === "/upload/image") {
        value = await sendFile(init.body.get("image"));
      } else if (path === "/amiaomiao_h3/lvm/uploads/import") {
        value = await sendFile(init.body.get("file"), init.body.get("project"));
      } else if (path === "/amiaomiao_h3/lvm/system_video_picker") {
        value = await pickVideo(init.signal);
      } else {
        const body = init.body ? JSON.parse(init.body) : null;
        value = await bridge.apiPost("studio/h3/toolbox/rpc", {path, method: init.method || "GET", body});
      }
      init.signal?.throwIfAborted();
      return Response.json(value, {status: value.error ? 400 : 200});
    } catch (error) {
      return Response.json({error: error.message}, {status:400});
    }
  },
};
