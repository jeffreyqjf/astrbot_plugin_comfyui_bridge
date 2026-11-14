export function mountVideos({ get, bridge, showPanel, message, notify, canOpen }) {
  const panel = get("videos");
  const list = get("videos-list");
  const refreshButton = get("videos-refresh");
  const previous = get("videos-prev");
  const next = get("videos-next");
  const dialog = get("video-dialog");
  const player = get("video-player");
  const animation = get("video-animation");
  const status = get("video-play-status");
  const deleteDialog = get("video-delete-dialog");
  const deleteButton = get("video-delete-confirm");
  const deleteCancel = get("video-delete-cancel");
  const deleteStatus = get("video-delete-status");
  const date = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" });
  let page = 1;
  let pages = 1;
  let loading = false;
  let playing = 0;
  let pendingDelete;

  function mediaStatus(text) {
    status.textContent = text;
    status.hidden = !text;
  }

  async function play(item) {
    const current = ++playing;
    get("video-title").textContent = item.name;
    mediaStatus("正在打开视频…");
    dialog.showModal();
    try {
      const { src } = await bridge.apiPost("studio/videos/play", item);
      if (current !== playing || !dialog.open) return;
      const media = item.name.toLowerCase().endsWith(".gif") ? animation : player;
      media.hidden = false;
      media.src = src;
    } catch (error) {
      if (current === playing && dialog.open) mediaStatus(error.message);
    }
  }

  player.addEventListener("loadedmetadata", () => mediaStatus(""));
  animation.addEventListener("load", () => mediaStatus(""));
  for (const media of [player, animation]) {
    media.addEventListener("error", () => {
      if (dialog.open && media.hasAttribute("src")) {
        mediaStatus("无法播放此文件。请确认浏览器支持该视频格式，或关闭后重新打开。");
      }
    });
  }
  get("video-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    playing++;
    player.pause();
    player.removeAttribute("src");
    player.load();
    animation.removeAttribute("src");
    player.hidden = animation.hidden = true;
  });

  function row(item) {
    const article = document.createElement("article");
    article.className = "video-row";
    const details = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = item.name;
    const info = document.createElement("small");
    info.textContent = `${date.format(item.modified * 1000)} · ${(item.size / 1048576).toFixed(1)} MB`;
    details.append(title, info);
    const actions = document.createElement("div");
    actions.className = "row-actions";
    const open = document.createElement("button");
    open.type = "button";
    open.textContent = "播放";
    open.addEventListener("click", () => play(item));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "删除";
    remove.addEventListener("click", () => {
      pendingDelete = item;
      get("video-delete-name").textContent = `确定从输出目录删除「${item.name}」？`;
      deleteStatus.textContent = "";
      deleteDialog.showModal();
    });
    actions.append(open, remove);
    article.append(details, actions);
    return article;
  }

  async function refresh(target = page) {
    if (loading) return;
    loading = refreshButton.disabled = previous.disabled = next.disabled = true;
    list.inert = true;
    try {
      const data = await bridge.apiGet("studio/videos", { page: target });
      page = data.page;
      pages = data.pages;
      list.replaceChildren(...data.videos.map(row));
      get("videos-empty").hidden = data.videos.length > 0;
      get("videos-page").textContent = data.videos.length ? `第 ${page} / ${pages} 页` : "";
    } catch (error) {
      if (!panel.hidden) message(error.message, true);
    } finally {
      loading = refreshButton.disabled = false;
      list.inert = false;
      previous.disabled = page <= 1;
      next.disabled = page >= pages;
    }
  }

  get("open-videos").addEventListener("click", (event) => {
    if (!canOpen()) return;
    showPanel("videos", event.currentTarget);
    message("");
    refresh();
  });
  refreshButton.addEventListener("click", () => refresh());
  previous.addEventListener("click", () => refresh(page - 1));
  next.addEventListener("click", () => refresh(page + 1));
  deleteCancel.addEventListener("click", () => deleteDialog.close());
  deleteDialog.addEventListener("cancel", (event) => {
    if (deleteButton.disabled) event.preventDefault();
  });
  deleteButton.addEventListener("click", async () => {
    deleteButton.disabled = deleteCancel.disabled = true;
    deleteStatus.textContent = "正在删除…";
    try {
      await bridge.apiPost("studio/videos/delete", pendingDelete);
      deleteDialog.close();
      notify("视频已删除。");
      await refresh();
    } catch (error) {
      deleteStatus.textContent = error.message;
    } finally {
      deleteButton.disabled = deleteCancel.disabled = false;
    }
  });
}
