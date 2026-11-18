// Standalone host for the separately licensed H3 Prompt IDE component.
const prefix = "astrbot.h3-prompt.";
const sessionSettings = new Map();
export function readPromptSetting(id, fallback) {
  if (sessionSettings.has(id)) return sessionSettings.get(id);
  try {
    const value = localStorage.getItem(prefix + id);
    return value === null ? fallback : JSON.parse(value);
  } catch { return fallback; }
}
export function writePromptSetting(id, value) {
  sessionSettings.set(id, value);
  try { localStorage.setItem(prefix + id, JSON.stringify(value)); } catch { /* Session controls still apply. */ }
  for (const node of app.graph._nodes) node._h3PromptIdeSettingsChanged?.();
}
export const app = {
  graph: { _nodes: [], setDirtyCanvas() {} },
  ui: { settings: { getSettingValue: readPromptSetting } },
};
export { api } from "./h3_media_transport.js";
