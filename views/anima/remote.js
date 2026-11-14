const get = (id) => document.getElementById(id);
const sessionKey = "comfyui-studio-token";
let token = sessionStorage.getItem(sessionKey) ?? "";

async function call(path, options = {}, query = {}, asFile = false) {
  const url = new URL(`/api/${path}`, location.origin);
  url.search = new URLSearchParams(query);
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(url, { ...options, headers, credentials: "omit", redirect: "error" });
  if (asFile && response.ok) return response.blob();
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.message || (response.status === 413 ? "请求数据过大。" : `请求失败（${response.status}）`));
  }
  if (data === null) throw new Error("工作台返回的数据格式有误。");
  return data;
}

async function ready() {
  document.body.classList.add("remote-studio");
  get("workspace").hidden = true;
  get("remote-logout").addEventListener("click", async () => {
    try {
      await call("logout", { method: "POST" });
    } finally {
      sessionStorage.removeItem(sessionKey);
      location.reload();
    }
  });
  if (token) {
    try {
      await call("studio");
      get("workspace").hidden = false;
      return;
    } catch {
      sessionStorage.removeItem(sessionKey);
      token = "";
    }
  }
  const login = get("remote-login");
  const form = get("remote-login-form");
  login.hidden = false;
  await new Promise((resolve) => {
    form.addEventListener("submit", async function signIn(event) {
      event.preventDefault();
      const button = form.querySelector("button");
      if (button.disabled) return;
      button.disabled = true;
      get("remote-login-status").textContent = "";
      token = get("remote-token").value.trim();
      try {
        if (!/^(?:[0-9]{6}|[A-Za-z0-9_-]{24,128})$/.test(token)) throw new Error("请输入 6 位数字或原有长口令。");
        const session = await call("login", { method: "POST" });
        token = session.token;
        sessionStorage.setItem(sessionKey, token);
        form.reset();
        form.removeEventListener("submit", signIn);
        login.hidden = true;
        get("workspace").hidden = false;
        resolve();
      } catch (error) {
        token = "";
        get("remote-login-status").textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
  });
}

export const bridge = {
  ready,
  apiGet: (path, query) => call(path, {}, query),
  apiPost: (path, data) => call(path, data instanceof FormData ? { method: "POST", body: data } : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  }),
  upload(path, file) {
    const form = new FormData();
    form.append("file", file);
    return call(path, { method: "POST", body: form });
  },
  async download(path, query, filename) {
    const url = URL.createObjectURL(await call(path, {}, query, true));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
