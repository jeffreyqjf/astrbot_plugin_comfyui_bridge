const pages = new Map();
const selections = new Map();
const pending = new Map();
let bridge, reportError, writing = false, selectionsLoaded = false;
const selectionPrefix = "comfy-gallery-selection:";

export async function initializePageMemory(api, onError = () => {}) {
  bridge = api; reportError = onError;
  try {
    const {pages: saved, selections: savedSelections} = await bridge.apiGet("studio/gallery-pages");
    for (const [key, page] of Object.entries(saved)) if (Number.isSafeInteger(page) && page >= 1 && page <= 1000000) {
      pages.set(key, page);
      try { localStorage.setItem(key, String(page)); } catch { /* Account memory still works without browser storage. */ }
    }
    if (savedSelections) {
      for (const [key, selection] of Object.entries(savedSelections)) selections.set(key, selection);
      selectionsLoaded = true;
    }
  } catch { reportError("图集记忆读取失败，本次先使用浏览器记忆。"); }
}

async function flush() {
  if (!bridge || writing) return;
  writing = true;
  let current;
  try {
    while (pending.size) {
      const [key, data] = pending.entries().next().value;
      current = [key, data];
      pending.delete(key);
      await bridge.apiPost("studio/gallery-pages", {key, ...data});
      current = null;
    }
  } catch {
    if (current && !pending.has(current[0])) pending.set(...current);
    reportError("图集记忆保存失败，下次切换图集或翻页时会再次尝试。");
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
  if (bridge) { pending.set(key, {page}); flush(); }
}

export function restoreGallerySelection(scope, select, fallback) {
  const key = selectionPrefix + scope;
  let value = selections.get(key);
  if (value === undefined && !selectionsLoaded) {
    try { value = localStorage.getItem(key); } catch { /* Browser storage may be disabled. */ }
  }
  const available = [...select.options].some(option => option.value === value &&
    !option.disabled && !option.closest("optgroup")?.disabled);
  select.value = available ? value : fallback;
}

export function saveGallerySelection(scope, selection) {
  const key = selectionPrefix + scope;
  if (selections.get(key) === selection && !pending.has(key)) return;
  selections.set(key, selection);
  try { localStorage.setItem(key, selection); } catch { /* Keep session and account memory. */ }
  if (bridge) { pending.set(key, {selection}); flush(); }
}
