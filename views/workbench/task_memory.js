export function createTaskMemory(bridge, report = () => {}) {
  const values = new Map(), pending = new Map();
  let timer, writing = false;
  async function flush() {
    if (writing) return;
    writing = true;
    let current;
    try {
      while (pending.size) {
        current = pending.entries().next().value;
        pending.delete(current[0]);
        await bridge.apiPost("studio/task-memory", {key: current[0], value: current[1]});
        current = null;
      }
    } catch {
      if (current && !pending.has(current[0])) pending.set(...current);
      report("任务记忆保存失败，下次调整时会重试。");
    } finally { writing = false; }
  }
  return {
    async initialize() {
      try {
        const {memory} = await bridge.apiGet("studio/task-memory");
        for (const [key, value] of Object.entries(memory)) if (value && typeof value === "object" && !Array.isArray(value)) values.set(key, value);
      } catch { report("任务记忆读取失败，本次使用当前页面设置。"); }
    },
    read(key) { return structuredClone(values.get(key) ?? {}); },
    save(key, value) {
      if (JSON.stringify(values.get(key)) === JSON.stringify(value)) return;
      values.set(key, structuredClone(value)); pending.set(key, structuredClone(value));
      clearTimeout(timer); timer = setTimeout(flush, 300);
    },
    flush,
  };
}
