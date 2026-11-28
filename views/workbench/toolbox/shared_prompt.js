// SPDX-License-Identifier: MIT
const css = document.createElement("link");
css.rel = "stylesheet";
css.href = new URL("./shared_prompt.css", import.meta.url);
document.head.append(css);

function element(tag, text) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  return node;
}

export function createSharedPrompts({api, family, read, write}) {
  const path = "/astrbot_h3_shared/prompts/" + family;
  const panel = element("div");
  panel.className = "astrbot-shared-prompts";
  const selector = element("select");
  selector.setAttribute("aria-label", "共享提示词");
  const name = element("input");
  name.maxLength = 80;
  name.placeholder = "提示词名称";
  name.setAttribute("aria-label", name.placeholder);
  const status = element("small");
  status.setAttribute("role", "status");
  const title = element("strong", "共享提示词库");
  let snapshot, busy = false;
  function button(label, action) {
    const control = element("button", label);
    control.type = "button";
    control.addEventListener("click", action);
    return control;
  }
  const refresh = button("刷新", () => operation(async () => {
    snapshot = await request();
    render();
  }));
  const load = button("载入", () => {
    const entry = snapshot?.entries.find(item => item.name === selector.value);
    if (entry) write(entry.text);
  });
  const save = button("保存", () => change(name.value, read()));
  const remove = button("删除", () => {
    if (selector.value && window.confirm(`从共享库删除「${selector.value}」？`)) change(selector.value, null);
  });
  selector.addEventListener("change", () => {
    if (selector.value) name.value = selector.value;
    buttons();
  });

  function buttons() {
    refresh.disabled = save.disabled = selector.disabled = busy;
    load.disabled = remove.disabled = busy || !selector.value;
  }
  function render(selected = selector.value) {
    selector.replaceChildren(new Option("选择已保存的提示词", ""), ...snapshot.entries.map(entry => new Option(entry.name, entry.name)));
    selector.value = snapshot.entries.some(entry => entry.name === selected) ? selected : "";
  }
  async function request(body) {
    const response = await api.fetchApi(path, body === undefined ? {} : {
      method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body),
    });
    if (response.status === 404) throw Error("请安装 ComfyUI 的 AstrBot H3 共享扩展并重启。");
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(data.entries)) throw Error(data.error || "读取共享提示词库失败。");
    return data;
  }
  async function operation(action) {
    if (busy) return;
    busy = true; buttons();
    status.textContent = "";
    try { await action(); }
    catch (error) { status.textContent = error.message; }
    finally { busy = false; buttons(); }
  }
  function change(entry, text) {
    void operation(async () => {
      entry = entry.trim();
      if (!entry || (text !== null && !text.trim())) throw Error("请填写名称和提示词。");
      const prior = snapshot ?? await request();
      snapshot = await request({name: entry, text, revision: prior.revision});
      render(text === null ? "" : entry);
      status.textContent = text === null ? "已删除。" : "已保存到共享库。";
    });
  }
  const list = element("div");
  list.append(selector, load, refresh, remove);
  const edit = element("div");
  edit.append(name, save);
  panel.append(title, list, edit, status);
  buttons();
  void operation(async () => {
    snapshot = await request();
    render();
  });
  return panel;
}
