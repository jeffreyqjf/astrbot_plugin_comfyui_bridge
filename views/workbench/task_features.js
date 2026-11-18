export function mountTaskFeatures({bridge, host, onControlChange, pickGallery}) {
  const choices = host.querySelector("[data-feature-choices]");
  const regionHost = host.querySelector("[data-regional]");
  const selected = new Map();
  let workflow, entries = [];
  const regional = mountRegional({bridge, host: regionHost, pickGallery});
  return {
    configure(name, features = []) {
      workflow = name;
      entries = features;
      if (!selected.has(name)) selected.set(name, new Set());
      const active = selected.get(name);
      choices.replaceChildren();
      host.hidden = !features.length;
      regionHost.hidden = !features.some(item => item.kind === "regional" && active.has(item.id));
      for (const feature of features) {
        const label = document.createElement("label");
        label.className = "task-feature-choice";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = active.has(feature.id);
        input.dataset.feature = feature.id;
        label.append(input, document.createTextNode(feature.title));
        const apply = () => {
          if (feature.kind === "controlnet") onControlChange(feature.branch, input.checked);
          if (feature.kind === "regional") {
            regionHost.hidden = !input.checked;
            if (input.checked) regional.refresh(false);
          }
        };
        input.addEventListener("change", () => {
          if (input.checked) active.add(feature.id); else active.delete(feature.id);
          apply();
        });
        choices.append(label);
        apply();
      }
    },
    payload() {
      const active = selected.get(workflow);
      const result = entries.some(item => item.kind === "regional") ? {regional: active.has("regional") ? regional.payload() : null} : {};
      if (entries.some(item => item.kind === "branch")) result.upscale = {
        pre: active.has("upscale.pre"), post: active.has("upscale.post"),
      };
      return result;
    },
  };
}

function mountRegional({bridge, host, pickGallery}) {
  host.innerHTML = `
    <div class="panel-heading"><h3>区域提示词 <small>RGB 三区</small></h3></div>
    <p class="section-note">先涂区域，再填写对应提示词。黑色不分区；参考底图仅辅助绘制。</p>
    <div class="regional-preset-row">
      <label class="field">整套提示词预设<select data-preset><option value="">选择即填入三个区域</option></select></label>
      <input data-preset-name maxlength="64" aria-label="区域预设名称" placeholder="预设名称">
      <button type="button" data-save>保存预设</button>
      <details class="h3-template-menu"><summary aria-label="更多区域预设操作">⋯</summary><div>
        <button type="button" data-refresh>刷新预设</button><button type="button" data-delete>删除所选预设</button>
      </div></details>
    </div>
    <p data-status role="status"></p>
    <div class="regional-tools">
      <button type="button" data-layout="columns">三列</button><button type="button" data-layout="rows">三行</button>
      <select data-ratio aria-label="画布比例"><option value="1">正方形</option><option value="1.5">横向 3:2</option><option value="0.6666667">纵向 2:3</option></select>
      <button type="button" data-tool="brush" aria-pressed="true">画笔</button>
      <button type="button" data-tool="rect" aria-pressed="false">矩形</button>
      <button type="button" data-tool="erase" aria-pressed="false">橡皮</button>
      <label>笔径 <input type="range" data-size min="4" max="120" value="32"></label>
      <button type="button" data-undo disabled>撤销</button><button type="button" data-clear>清空遮罩</button>
    </div>
    <div class="regional-stage"><img data-guide alt="绘制参考底图" hidden><canvas width="512" height="512" tabindex="0" aria-label="RGB 区域遮罩画布"></canvas></div>
    <div class="row-actions regional-sources">
      <button type="button" data-local>本地参考底图</button><button type="button" data-gallery>图集参考底图</button>
      <button type="button" data-remove-guide>移除底图</button><button type="button" data-import>导入 RGB 遮罩</button>
      <input type="file" data-guide-file accept="image/*" hidden><input type="file" data-mask-file accept="image/png" hidden>
    </div>
    <div class="regional-prompts"></div>
    <label class="field regional-base">全局提示词强度<input type="number" data-base value="1" min="0" max="10" step="0.05"></label>`;
  const get = name => host.querySelector(`[data-${name}]`);
  const canvas = host.querySelector("canvas"), ctx = canvas.getContext("2d", {willReadFrequently: true});
  const colors = ["#ff0000", "#00ff00", "#0000ff"];
  const names = ["红色区域", "绿色区域", "蓝色区域"];
  const prompts = [], history = [];
  let channel = 0, tool = "brush", pointer, presetData, busy = false, guideURL;
  const route = "studio/regional/presets";
  for (let index = 0; index < 3; index++) {
    const card = document.createElement("div");
    card.className = `regional-prompt regional-channel-${index}`;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = names[index];
    button.dataset.channel = index;
    button.setAttribute("aria-pressed", String(index === 0));
    button.addEventListener("click", () => {
      channel = index;
      for (const option of host.querySelectorAll("[data-channel]")) option.setAttribute("aria-pressed", String(option === button));
    });
    const text = document.createElement("textarea");
    text.rows = 3;
    text.maxLength = 8000;
    text.placeholder = `填写${names[index]}的主体与细节`;
    text.setAttribute("aria-label", `${names[index]}提示词`);
    const label = document.createElement("label");
    label.className = "field";
    label.append("区域强度");
    const strength = document.createElement("input");
    strength.type = "number"; strength.min = 0; strength.max = 10; strength.step = .05; strength.value = 1;
    label.append(strength);
    card.append(button, text, label);
    host.querySelector(".regional-prompts").append(card);
    prompts.push({text, strength});
  }
  function note(text, error = false) { get("status").textContent = text; get("status").classList.toggle("error", error); }
  function snapshot() { return ctx.getImageData(0, 0, canvas.width, canvas.height); }
  function remember() { history.push(snapshot()); if (history.length > 20) history.shift(); get("undo").disabled = false; }
  function layout(kind) {
    ctx.fillStyle = "black"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    colors.forEach((color, index) => {
      ctx.fillStyle = color;
      if (kind === "columns") ctx.fillRect(index * canvas.width / 3, 0, canvas.width / 3 + 1, canvas.height);
      if (kind === "rows") ctx.fillRect(0, index * canvas.height / 3, canvas.width, canvas.height / 3 + 1);
    });
  }
  layout("columns");
  for (const button of host.querySelectorAll("[data-layout]")) button.onclick = () => { remember(); layout(button.dataset.layout); };
  for (const button of host.querySelectorAll("[data-tool]")) button.onclick = () => {
    tool = button.dataset.tool;
    for (const option of host.querySelectorAll("[data-tool]")) option.setAttribute("aria-pressed", String(option === button));
  };
  get("clear").onclick = () => { remember(); layout("empty"); };
  get("undo").onclick = () => {
    if (history.length) ctx.putImageData(history.pop(), 0, 0);
    get("undo").disabled = !history.length;
  };
  get("ratio").onchange = () => {
    const copy = document.createElement("canvas"); copy.width = canvas.width; copy.height = canvas.height;
    copy.getContext("2d").drawImage(canvas, 0, 0);
    canvas.width = 512; canvas.height = Math.round(512 / Number(get("ratio").value));
    ctx.drawImage(copy, 0, 0, canvas.width, canvas.height);
    history.length = 0; get("undo").disabled = true;
  };
  const point = event => {
    const box = canvas.getBoundingClientRect();
    return {x: (event.clientX - box.left) * canvas.width / box.width, y: (event.clientY - box.top) * canvas.height / box.height};
  };
  function stroke(a, b) {
    ctx.strokeStyle = ctx.fillStyle = tool === "erase" ? "black" : colors[channel];
    ctx.lineWidth = Number(get("size").value); ctx.lineCap = ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    if (a.x === b.x && a.y === b.y) {ctx.beginPath(); ctx.arc(a.x, a.y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill();}
  }
  canvas.onpointerdown = event => {
    if (pointer || event.button !== 0) return;
    event.preventDefault(); canvas.setPointerCapture(event.pointerId); remember();
    const start = point(event);
    pointer = {id: event.pointerId, start, last: start, before: history.at(-1)};
    if (tool !== "rect") stroke(start, start);
  };
  canvas.onpointermove = event => {
    if (event.pointerId !== pointer?.id) return;
    const next = point(event);
    if (tool === "rect") {
      ctx.putImageData(pointer.before, 0, 0); ctx.fillStyle = colors[channel];
      ctx.fillRect(pointer.start.x, pointer.start.y, next.x - pointer.start.x, next.y - pointer.start.y);
    } else stroke(pointer.last, next);
    pointer.last = next;
  };
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) canvas.addEventListener(type, event => {
    if (event.pointerId === pointer?.id) pointer = null;
  });
  function guide(src) {
    if (guideURL) URL.revokeObjectURL(guideURL);
    guideURL = src instanceof Blob ? URL.createObjectURL(src) : null;
    get("guide").src = guideURL || src || ""; get("guide").hidden = !src;
    canvas.classList.toggle("regional-guided", Boolean(src));
  }
  get("local").onclick = () => get("guide-file").click();
  get("guide-file").onchange = () => { if (get("guide-file").files[0]) guide(get("guide-file").files[0]); };
  get("remove-guide").onclick = () => guide(null);
  get("gallery").onclick = () => pickGallery(({src}) => guide(src));
  get("import").onclick = () => { get("mask-file").value = ""; get("mask-file").click(); };
  get("mask-file").onchange = async () => {
    const file = get("mask-file").files[0]; if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error("遮罩文件不能超过 20 MB。");
      const image = await createImageBitmap(file);
      remember(); layout("empty"); ctx.drawImage(image, 0, 0, canvas.width, canvas.height); image.close();
    } catch (error) { note(error.message, true); }
  };
  function textData() {
    const data = {base_strength: get("base").valueAsNumber,
      regions: prompts.map(({text, strength}) => ({text: text.value, strength: strength.valueAsNumber}))};
    if ([data.base_strength, ...data.regions.map(row => row.strength)].some(x => !(x >= 0 && x <= 10))) throw new Error("强度须为 0 到 10。");
    return data;
  }
  function catalog(data) {
    presetData = data;
    const value = get("preset").value;
    get("preset").replaceChildren(new Option("选择即填入三个区域", ""));
    for (const name of Object.keys(data.presets)) get("preset").add(new Option(name, name));
    get("preset").value = Object.hasOwn(data.presets, value) ? value : "";
  }
  async function refresh(force = true) {
    if (busy || (presetData && !force)) return;
    busy = true;
    try { catalog(await bridge.apiGet(route)); note(""); }
    catch (error) { note(error.message, true); }
    finally {busy = false;}
  }
  get("preset").onchange = () => {
    const name = get("preset").value, data = presetData?.presets[name];
    get("preset-name").value = name; if (!data) return;
    get("base").value = data.base_strength;
    data.regions.forEach((row, index) => {prompts[index].text.value = row.text; prompts[index].strength.value = row.strength;});
    note(`已填入「${name}」的三个区域提示词。`);
  };
  get("refresh").onclick = () => refresh();
  async function save(deleting = false) {
    if (busy) return;
    const name = deleting ? get("preset").value : get("preset-name").value.trim();
    if (!name) {note("请填写或选择预设名称。", true); return;}
    busy = true;
    try {
      if (!presetData) catalog(await bridge.apiGet(route));
      const data = await bridge.apiPost(route, {name, preset: deleting ? null : textData(), revision: presetData.revision});
      catalog(data); get("preset").value = deleting ? "" : name;
      note(deleting ? "预设已删除，当前草稿保留。" : "三个区域提示词已保存。");
    } catch (error) {note(error.message, true);}
    finally {busy = false; host.querySelector("details").open = false;}
  }
  get("save").onclick = () => save(); get("delete").onclick = () => save(true);
  get("preset-name").onkeydown = event => {
    if (event.key === "Enter" && !event.isComposing) {event.preventDefault(); save();}
  };
  return {refresh, payload() { return {...textData(), mask: canvas.toDataURL("image/png").split(",")[1]}; }};
}
