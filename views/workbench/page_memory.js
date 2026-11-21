const pages = new Map();
const pending = new Map();
let bridge, reportError, writing = false;

export async function initializePageMemory(api, onError = () => {}) {
  bridge = api; reportError = onError;
  try {
    const {pages: saved} = await bridge.apiGet("studio/gallery-pages");
    for (const [key, page] of Object.entries(saved)) if (Number.isSafeInteger(page) && page >= 1 && page <= 1000000) {
      pages.set(key, page);
      try { localStorage.setItem(key, String(page)); } catch { /* Account memory still works without browser storage. */ }
    }
  } catch { reportError("页码记忆读取失败，本次先使用浏览器记忆。"); }
}

async function flush() {
  if (!bridge || writing) return;
  writing = true;
  let current;
  try {
    while (pending.size) {
      const [key, page] = pending.entries().next().value;
      current = [key, page];
      pending.delete(key);
      await bridge.apiPost("studio/gallery-pages", {key, page});
      current = null;
    }
  } catch {
    if (current && !pending.has(current[0])) pending.set(...current);
    reportError("页码记忆保存失败，下次翻页时会再次尝试。");
  }
  finally { writing = false; }
}

export function pageKey(view, query = {}) {
  return `comfy-gallery-page:${JSON.stringify([view, Object.entries(query).sort(([a], [b]) => a.localeCompare(b))])}`;
}

export function readPage(key) {
  if (pages.has(key)) return pages.get(key);
  let value = pages.get(key);
  try { value = localStorage.getItem(key) ?? value; } catch { /* Embedded views may prohibit browser storage. */ }
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 && page <= 1000000 ? page : 1;
}

export function savePage(key, page) {
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000) return;
  if (pages.get(key) === page && !pending.has(key)) return;
  pages.set(key, page);
  try { localStorage.setItem(key, String(page)); } catch { /* Keep navigation memory for this view session. */ }
  if (bridge) { pending.set(key, page); flush(); }
}
