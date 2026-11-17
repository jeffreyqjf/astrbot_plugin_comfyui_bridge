export async function editMask(source, savedMask) {
  const dialog = document.createElement("dialog");
  dialog.className = "mask-dialog";
  dialog.setAttribute("aria-label", "参考图遮罩编辑器");
  dialog.innerHTML = `
    <div class="panel-heading">
      <h2>编辑遮罩</h2>
      <button type="button" data-action="cancel">取消</button>
    </div>
    <div class="mask-tools">
      <button type="button" data-tool="brush" aria-pressed="true">画笔</button>
      <button type="button" data-tool="erase" aria-pressed="false">橡皮</button>
      <button type="button" data-tool="pan" aria-pressed="false">移动</button>
      <label>笔径 <input data-brush="size" type="range" min="4" max="300" value="42"></label>
      <label>强度 <input data-brush="opacity" type="range" min="5" max="100" value="100"></label>
      <label>硬度 <input data-brush="hardness" type="range" min="0" max="100" value="80"></label>
      <button type="button" data-action="undo" disabled>撤销</button>
      <button type="button" data-action="redo" disabled>重做</button>
      <button type="button" data-action="invert">反选</button>
      <button type="button" data-action="clear">清空</button>
      <button type="button" data-action="zoom-out" aria-label="缩小">−</button>
      <button type="button" data-action="zoom-in" aria-label="放大">＋</button>
      <button type="button" data-action="fit">适应窗口</button>
    </div>
    <div class="mask-stage"><div class="mask-layer">
      <img alt="参考图"><canvas aria-label="在图片上绘制遮罩"></canvas>
    </div></div>
    <p class="section-note" role="status">正在读取图片…</p>
    <footer><button type="button" class="primary" data-action="apply" disabled>应用遮罩</button></footer>`;
  document.body.append(dialog);
  const action = (name) => dialog.querySelector(`[data-action="${name}"]`);
  const stage = dialog.querySelector(".mask-stage");
  const layer = dialog.querySelector(".mask-layer");
  const image = dialog.querySelector("img");
  const canvas = dialog.querySelector("canvas");
  const note = dialog.querySelector("[role=status]");
  const ctx = canvas.getContext("2d");
  const sourceURL = source instanceof Blob ? URL.createObjectURL(source) : source;
  const savedURL = savedMask ? URL.createObjectURL(savedMask) : null;
  let result = null;
  const closed = new Promise((resolve) => dialog.addEventListener("close", () => resolve(result), { once: true }));
  action("cancel").onclick = () => dialog.close();
  let resizeObserver;
  try {
    dialog.showModal();
    image.src = sourceURL;
    const previous = savedURL ? new Image() : null;
    if (previous) previous.src = savedURL;
    await Promise.all([image.decode(), previous?.decode()]);
    if (!dialog.open) return null;
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (width * height > 24_000_000) throw new Error("遮罩编辑支持最高 2400 万像素的图片。");
    canvas.width = width;
    canvas.height = height;
    note.textContent = "绿色区域将重绘。滚轮或＋／−缩放，选「移动」或按住鼠标中键拖动。";

    const history = [];
    const redo = [];
    let pointer;
    let tool = "brush";
    let zoom = 1;
    let tip;
    let tipKey;
    const color = "#32c99a";

    function layout() {
      const scale = Math.min(stage.clientWidth / width, stage.clientHeight / height) * zoom;
      layer.style.width = `${Math.max(1, width * scale)}px`;
      layer.style.height = `${Math.max(1, height * scale)}px`;
    }
    resizeObserver = new ResizeObserver(layout);
    resizeObserver.observe(stage);
    layout();
    action("fit").onclick = () => { zoom = 1; layout(); };
    function zoomAt(factor, clientX, clientY) {
      const before = layer.getBoundingClientRect();
      const x = (clientX - before.left) / before.width;
      const y = (clientY - before.top) / before.height;
      zoom = Math.max(0.4, Math.min(8, zoom * factor));
      layout();
      const after = layer.getBoundingClientRect();
      stage.scrollLeft += after.left + x * after.width - clientX;
      stage.scrollTop += after.top + y * after.height - clientY;
    }
    for (const [name, factor] of [["zoom-in", 1.25], ["zoom-out", 0.8]]) action(name).onclick = () => {
      const rect = stage.getBoundingClientRect();
      zoomAt(factor, rect.left + stage.clientWidth / 2, rect.top + stage.clientHeight / 2);
    };
    stage.addEventListener("wheel", (event) => {
      event.preventDefault();
      zoomAt(event.deltaY < 0 ? 1.15 : 1 / 1.15, event.clientX, event.clientY);
    }, { passive: false });

    function brushTip(size, hardness) {
      const key = `${size}/${hardness}`;
      if (key === tipKey) return tip;
      tip = document.createElement("canvas");
      tip.width = tip.height = size + 2;
      const paint = tip.getContext("2d");
      const center = tip.width / 2;
      if (hardness === 1) {
        paint.fillStyle = color;
      } else {
        const gradient = paint.createRadialGradient(center, center, size * hardness / 2, center, center, size / 2);
        gradient.addColorStop(0, color);
        gradient.addColorStop(1, "#32c99a00");
        paint.fillStyle = gradient;
      }
      paint.beginPath();
      paint.arc(center, center, size / 2, 0, Math.PI * 2);
      paint.fill();
      tipKey = key;
      return tip;
    }

    function paintSegment(stroke, from, to) {
      const stamp = brushTip(stroke.size, stroke.hardness);
      const distance = Math.hypot(to.x - from.x, to.y - from.y);
      const steps = Math.max(1, Math.ceil(distance / Math.max(1, stroke.size * 0.2)));
      ctx.globalCompositeOperation = stroke.erase ? "destination-out" : "source-over";
      ctx.globalAlpha = stroke.opacity;
      for (let i = 1; i <= steps; i++) {
        const part = i / steps;
        ctx.drawImage(stamp, from.x + (to.x - from.x) * part - stamp.width / 2,
          from.y + (to.y - from.y) * part - stamp.height / 2);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }

    function renderOperation(operation) {
      if (operation === "clear") {
        ctx.clearRect(0, 0, width, height);
      } else if (operation === "invert") {
        ctx.globalCompositeOperation = "xor";
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = "source-over";
      } else {
        const points = operation.points;
        for (let i = 0; i < points.length; i++) paintSegment(operation, points[i - 1] ?? points[i], points[i]);
      }
    }

    function rebuild() {
      ctx.clearRect(0, 0, width, height);
      if (previous) {
        ctx.drawImage(previous, 0, 0);
      } else {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = "destination-out";
        ctx.drawImage(image, 0, 0);
        ctx.globalCompositeOperation = "source-over";
      }
      for (const operation of history) renderOperation(operation);
    }

    function updateHistory() {
      action("undo").disabled = !history.length;
      action("redo").disabled = !redo.length;
    }
    function remember(operation) {
      history.push(operation);
      redo.length = 0;
      updateHistory();
    }
    rebuild();
    for (const name of ["clear", "invert"]) action(name).onclick = () => {
      if (pointer) return;
      renderOperation(name);
      remember(name);
    };
    action("undo").onclick = () => {
      if (pointer || !history.length) return;
      redo.push(history.pop());
      rebuild();
      updateHistory();
    };
    action("redo").onclick = () => {
      if (pointer || !redo.length) return;
      const operation = redo.pop();
      history.push(operation);
      renderOperation(operation);
      updateHistory();
    };
    for (const button of dialog.querySelectorAll("[data-tool]")) button.onclick = () => {
      tool = button.dataset.tool;
      canvas.classList.toggle("mask-pan", tool === "pan");
      for (const option of dialog.querySelectorAll("[data-tool]")) option.setAttribute("aria-pressed", String(option === button));
    };

    function point(event) {
      const rect = canvas.getBoundingClientRect();
      return { x: (event.clientX - rect.left) * width / rect.width, y: (event.clientY - rect.top) * height / rect.height };
    }
    const setting = (name) => dialog.querySelector(`[data-brush="${name}"]`).valueAsNumber;
    canvas.addEventListener("pointerdown", (event) => {
      if (pointer || ![0, 1].includes(event.button)) return;
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      if (tool === "pan" || event.button === 1) {
        pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop };
      } else {
        const start = point(event);
        const stroke = { size: setting("size"), opacity: setting("opacity") / 100,
          hardness: setting("hardness") / 100, erase: tool === "erase", points: [start] };
        pointer = { id: event.pointerId, stroke };
        paintSegment(stroke, start, start);
      }
    });
    canvas.addEventListener("pointermove", (event) => {
      if (event.pointerId !== pointer?.id) return;
      if (pointer.stroke) {
        const next = point(event);
        paintSegment(pointer.stroke, pointer.stroke.points.at(-1), next);
        pointer.stroke.points.push(next);
      } else {
        stage.scrollLeft = pointer.left + pointer.x - event.clientX;
        stage.scrollTop = pointer.top + pointer.y - event.clientY;
      }
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) canvas.addEventListener(type, (event) => {
      if (event.pointerId !== pointer?.id) return;
      if (pointer.stroke) remember(pointer.stroke);
      pointer = null;
    });
    dialog.addEventListener("keydown", (event) => {
      if (!(event.ctrlKey || event.metaKey) || !["z", "y"].includes(event.key.toLowerCase())) return;
      event.preventDefault();
      action(event.shiftKey || event.key.toLowerCase() === "y" ? "redo" : "undo").click();
    });
    action("apply").disabled = false;
    action("apply").onclick = () => {
      action("apply").disabled = true;
      canvas.toBlob((blob) => {
        if (!dialog.open) return;
        if (!blob) {
          note.textContent = "无法导出遮罩，请重试。";
          action("apply").disabled = false;
          return;
        }
        result = blob;
        dialog.close();
      }, "image/png");
    };
    return await closed;
  } finally {
    resizeObserver?.disconnect();
    dialog.remove();
    if (source instanceof Blob) URL.revokeObjectURL(sourceURL);
    if (savedURL) URL.revokeObjectURL(savedURL);
  }
}
