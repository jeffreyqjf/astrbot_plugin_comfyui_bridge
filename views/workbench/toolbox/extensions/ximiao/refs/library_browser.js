// Project library browser shared across「H3 片段选择 v2」「H3 参考素材」「H3 视频裁切/拼接」.
// Left: project cards (search, sort, create). Right: compact project header + full scrollable
// content preview with positive/reverse order toggle and 2/3-column density switch.
// Uses the same backend routes as the old nodes' project menu, so libraries stay shared.

const LIBRARIES = {
    image: { title: "图片项目库", unit: "张图片", icon: "image", field: "references" },
    audio: { title: "音频项目库", unit: "段音频", icon: "volume-up", field: "references" },
    segments: { title: "裁切片段库", unit: "段片段", icon: "clone", field: "segments" },
    uploads: { title: "投放视频库", unit: "个视频", icon: "video", field: "videos" },
    clips: { title: "片段项目库", unit: "个片段", icon: "video", field: "clips" },
};
// The clip library lives in the Clip Bin store, with its own routes.
const ROUTES = {
    default: {
        projects: scope => `/amiaomiao_h3/lvm/projects?scope=${encodeURIComponent(scope)}`,
        create: "/amiaomiao_h3/lvm/project", rename: "/amiaomiao_h3/lvm/project/rename",
        remove: "/amiaomiao_h3/lvm/project/delete", open: "/amiaomiao_h3/lvm/project/open",
    },
    clips: {
        projects: () => "/amiaomiao_h3/clip_bin/projects",
        create: "/amiaomiao_h3/clip_bin/project", rename: "/amiaomiao_h3/clip_bin/project/rename",
        remove: "/amiaomiao_h3/clip_bin/project/delete", open: "/amiaomiao_h3/clip_bin/project/open",
    },
};
const SORT_KEY = "amiaomiao.refs.library.sort";
const CONTENT_ORDER_KEY = "amiaomiao.refs.library.contentOrder";
const CONTENT_COLS_KEY = "amiaomiao.refs.library.contentCols";
const DEFAULT_PROJECT = "H3_LVM";

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}
function icon(name) {
    const node = el("i", `pi pi-${name}`);
    node.setAttribute("aria-hidden", "true");
    return node;
}
function button(label, iconName, className = "ahl-btn") {
    const node = el("button", className);
    node.type = "button";
    if (iconName) node.append(icon(iconName));
    if (label) node.append(el("span", "", label));
    return node;
}

export function parseTime(value) {
    const text = String(value ?? "").trim();
    if (!text) return 0;
    const stamp = Date.parse(text.includes("T") ? text : text.replace(" ", "T"));
    return Number.isFinite(stamp) ? stamp : 0;
}
export function fullTime(value) {
    return String(value ?? "").trim().replace("T", " ").slice(0, 19);
}
export function relativeTime(value, now = Date.now()) {
    const stamp = parseTime(value);
    if (!stamp) return "";
    const minutes = Math.round((now - stamp) / 60000);
    if (minutes < 1) return "刚刚";
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days} 天前`;
    return fullTime(value).slice(0, 10);
}
export function sortProjects(list, field, dir) {
    const sorted = list.slice().sort((a, b) => {
        if (field === "updated") {
            const diff = parseTime(a.updated_at) - parseTime(b.updated_at);
            if (diff) return diff;
        }
        return a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true, sensitivity: "base" });
    });
    return dir === "desc" ? sorted.reverse() : sorted;
}
function readSort() {
    try {
        const saved = JSON.parse(localStorage.getItem(SORT_KEY) || "{}");
        return { field: saved.field === "name" ? "name" : "updated", dir: saved.dir === "asc" ? "asc" : "desc" };
    } catch {
        return { field: "updated", dir: "desc" };
    }
}
function readContentReversed() {
    try { return localStorage.getItem(CONTENT_ORDER_KEY) === "reversed"; } catch { return false; }
}
function readContentCols() {
    try { return localStorage.getItem(CONTENT_COLS_KEY) === "3" ? 3 : 2; } catch { return 2; }
}

// One browser at a time.
let active = null;

export function openLibraryBrowser(options) {
    active?.close();
    active = new LibraryBrowser(options);
    return active;
}

class LibraryBrowser {
    constructor({ scope, current, fetchJson, url, onUse, onLoad, onPickClip, onRenamed, onDeleted, clipAssetKind = "v2", directReferenceSwitch = false }) {
        this.scope = scope;
        this.lib = LIBRARIES[scope];
        this.routes = ROUTES[scope] || ROUTES.default;
        this.current = current || (scope === "clips" ? "Default_Project" : DEFAULT_PROJECT);
        this.selected = this.current;
        this.fetchJson = fetchJson;
        this.clipAssetKind = clipAssetKind;
        this.directReferenceSwitch = directReferenceSwitch;
        this.url = url;
        this.handlers = { onUse, onLoad, onPickClip, onRenamed, onDeleted };
        this.projects = [];
        this.loading = true;
        this.search = "";
        this.sort = readSort();
        this.contentReversed = readContentReversed();
        this.contentCols = readContentCols();
        this.mode = "view";          // view | rename | delete
        this.contents = new Map();
        this.build();
        this.refresh();
    }

    // ---------- shell ----------
    build() {
        this.overlay = el("div", `ahl-overlay is-${this.scope}`);
        this.overlay.setAttribute("role", "dialog");
        this.overlay.setAttribute("aria-modal", "true");
        this.overlay.setAttribute("aria-label", this.lib.title);
        const dialog = el("div", "ahl-dialog");
        const head = el("header", "ahl-head");
        const badge = el("span", "ahl-head-icon");
        badge.append(icon(this.lib.icon));
        this.countPill = el("span", "ahl-count");
        const close = button("", "times", "ahl-icon-btn ahl-close");
        close.title = "关闭";
        close.setAttribute("aria-label", "关闭");
        close.addEventListener("click", () => this.close());
        head.append(badge, el("h2", "ahl-title", this.lib.title), this.countPill, close);

        const tools = el("div", "ahl-tools");
        const searchBox = el("label", "ahl-search");
        this.searchInput = el("input");
        this.searchInput.type = "search";
        this.searchInput.placeholder = "搜索项目…";
        this.searchInput.setAttribute("aria-label", "搜索项目");
        this.searchInput.addEventListener("input", () => { this.search = this.searchInput.value; this.renderGrid(); });
        searchBox.append(icon("search"), this.searchInput);
        this.sortGroup = el("div", "ahl-seg");
        this.sortGroup.setAttribute("role", "group");
        this.sortGroup.setAttribute("aria-label", "排序");
        for (const [field, label] of [["updated", "最近修改"], ["name", "名称"]]) {
            const option = button(label, "", "ahl-seg-btn");
            option.dataset.field = field;
            option.addEventListener("click", () => {
                this.sort = field === this.sort.field
                    ? { field, dir: this.sort.dir === "asc" ? "desc" : "asc" }
                    : { field, dir: field === "updated" ? "desc" : "asc" };
                try { localStorage.setItem(SORT_KEY, JSON.stringify(this.sort)); } catch { /* optional */ }
                this.renderGrid();
            });
            this.sortGroup.append(option);
        }
        const create = button("新建项目", "plus", "ahl-btn is-primary-outline");
        create.addEventListener("click", () => this.showCreate());
        this.createRow = el("form", "ahl-create");
        this.createRow.hidden = true;
        tools.append(searchBox, this.sortGroup, create);

        const body = el("div", "ahl-body");
        const leftPane = el("div", "ahl-left");
        this.grid = el("div", "ahl-grid");
        this.grid.setAttribute("role", "listbox");
        this.grid.setAttribute("aria-label", "项目");
        this.grid.addEventListener("keydown", event => this.onGridKey(event));
        const listPane = el("div", "ahl-list");
        listPane.append(this.createRow, this.grid);
        leftPane.append(tools, listPane);

        this.detail = el("aside", "ahl-detail");
        body.append(leftPane, this.detail);
        this.toastNode = el("div", "ahl-toast");
        this.toastNode.setAttribute("role", "status");
        dialog.append(head, body, this.toastNode);
        this.overlay.append(dialog);
        this.overlay.addEventListener("pointerdown", event => { this.downOnBackdrop = event.target === this.overlay; });
        this.overlay.addEventListener("click", event => {
            if (event.target === this.overlay && this.downOnBackdrop) this.close();
        });
        for (const type of ["pointerdown", "mousedown", "wheel", "dblclick"]) {
            this.overlay.addEventListener(type, event => event.stopPropagation());
        }
        this.onKey = event => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            if (!this.createRow.hidden) return this.hideCreate();
            if (this.mode !== "view") { this.mode = "view"; return this.renderDetail(); }
            this.close();
        };
        document.addEventListener("keydown", this.onKey, true);
        document.body.append(this.overlay);
        requestAnimationFrame(() => this.overlay.classList.add("is-open"));
        this.searchInput.focus({ preventScroll: true });
    }

    close() {
        document.removeEventListener("keydown", this.onKey, true);
        this.overlay.remove();
        if (active === this) active = null;
    }

    toast(message, error = false) {
        this.toastNode.textContent = message;
        this.toastNode.classList.toggle("is-error", error);
        this.toastNode.classList.add("is-visible");
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => this.toastNode.classList.remove("is-visible"), 2600);
    }

    // ---------- data ----------
    async refresh(selectName) {
        this.loading = !this.projects.length;
        if (this.loading) this.renderGrid();
        try {
            const path = this.routes.projects(this.scope);
            const data = await this.fetchJson(this.scope === "clips" && this.clipAssetKind.startsWith("stage_")
                ? `${path}?asset_kind=${this.clipAssetKind}` : path);
            this.projects = (data.projects || []).filter(row => row && row.name);
        } catch (error) {
            this.projects = [];
            this.toast(`读取项目失败：${error.message}`, true);
        }
        if (!this.projects.some(row => row.name === this.current)) {
            this.projects.unshift({ name: this.current, [this.lib.field]: 0, cover_url: "", updated_at: "" });
        }
        this.loading = false;
        if (selectName) this.selected = selectName;
        if (!this.projects.some(row => row.name === this.selected)) this.selected = this.current;
        this.countPill.textContent = `${this.projects.length} 个项目`;
        this.renderGrid();
        this.renderDetail();
    }

    count(row) {
        const value = Number(row?.[this.lib.field]);
        return Number.isFinite(value) && value > 0 ? value : 0;
    }

    visibleProjects() {
        const term = this.search.trim().toLowerCase();
        const list = term ? this.projects.filter(row => row.name.toLowerCase().includes(term)) : this.projects;
        return sortProjects(list, this.sort.field, this.sort.dir);
    }

    // ---------- grid ----------
    renderGrid() {
        for (const option of this.sortGroup.children) {
            const on = option.dataset.field === this.sort.field;
            option.setAttribute("aria-pressed", String(on));
            option.querySelector(".pi")?.remove();
            if (on) option.append(icon(this.sort.dir === "asc" ? "sort-amount-up-alt" : "sort-amount-down"));
            option.title = on ? (this.sort.dir === "asc" ? "当前正序，再点一次倒序" : "当前倒序，再点一次正序") : "";
        }
        this.grid.replaceChildren();
        if (this.loading) {
            for (let i = 0; i < 6; i++) this.grid.append(el("div", "ahl-card is-skeleton"));
            return;
        }
        const list = this.visibleProjects();
        if (!list.length) {
            const empty = el("div", "ahl-empty");
            empty.append(icon("search"), el("strong", "", `没有名称包含「${this.search.trim()}」的项目`));
            const clear = button("清除搜索", "", "ahl-btn");
            clear.addEventListener("click", () => { this.searchInput.value = ""; this.search = ""; this.renderGrid(); });
            empty.append(clear);
            this.grid.append(empty);
            return;
        }
        for (const row of list) this.grid.append(this.card(row));
    }

    cover(row, className) {
        const box = el("div", className);
        if (row.cover_url) {
            const image = el("img");
            image.src = this.url(row.cover_url);
            image.alt = "";
            image.loading = "lazy";
            image.decoding = "async";
            image.draggable = false;
            image.addEventListener("error", () => { image.remove(); box.append(icon(this.lib.icon)); box.classList.add("is-empty"); });
            box.append(image);
        } else {
            box.classList.add("is-empty");
            box.append(icon(this.lib.icon));
        }
        return box;
    }

    card(row) {
        const selected = row.name === this.selected;
        const node = el("div", `ahl-card${selected ? " is-selected" : ""}${row.name === this.current ? " is-current" : ""}`);
        node.setAttribute("role", "option");
        node.setAttribute("aria-selected", String(selected));
        node.tabIndex = selected ? 0 : -1;
        node.dataset.name = row.name;
        node.title = row.name;
        const cover = this.cover(row, "ahl-card-cover");
        if (row.name === this.current) cover.append(el("span", "ahl-in-use", "使用中"));
        const check = el("span", "ahl-check");
        check.append(icon("check"));
        cover.append(check);
        const body = el("div", "ahl-card-body");
        body.append(el("strong", "ahl-card-name", row.name));
        const meta = el("div", "ahl-card-meta");
        const total = this.count(row);
        meta.append(el("span", total ? "" : "is-zero", total ? `${total} ${this.lib.unit}` : "空"));
        const when = relativeTime(row.updated_at);
        if (when) {
            const time = el("span", "ahl-time", when);
            time.title = `最后修改 ${fullTime(row.updated_at)}`;
            meta.append(time);
        }
        body.append(meta);
        node.append(cover, body);
        node.addEventListener("click", () => this.select(row.name));
        node.addEventListener("dblclick", () => this.primary(row.name));
        return node;
    }

    select(name, focus = false) {
        if (this.selected === name && this.mode === "view") return;
        this.selected = name;
        this.mode = "view";
        for (const node of this.grid.querySelectorAll(".ahl-card[data-name]")) {
            const on = node.dataset.name === name;
            node.classList.toggle("is-selected", on);
            node.setAttribute("aria-selected", String(on));
            node.tabIndex = on ? 0 : -1;
            if (on && focus) node.focus();
        }
        this.renderDetail();
    }

    onGridKey(event) {
        const cards = [...this.grid.querySelectorAll(".ahl-card[data-name]")];
        const index = cards.findIndex(node => node.dataset.name === this.selected);
        if (event.key === "Enter") { event.preventDefault(); return this.primary(this.selected); }
        const columns = Math.max(1, Math.round(this.grid.clientWidth / (cards[0]?.offsetWidth || 1)));
        const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns }[event.key];
        if (!step || !cards.length) return;
        event.preventDefault();
        const next = cards[Math.max(0, Math.min(cards.length - 1, (index < 0 ? 0 : index) + step))];
        this.select(next.dataset.name, true);
    }

    // ---------- detail (Scheme A: Compact Hero Header + Maximized Content Preview) ----------
    selectedRow() {
        return this.projects.find(row => row.name === this.selected)
            || { name: this.selected, [this.lib.field]: 0, cover_url: "", updated_at: "" };
    }

    orderButtonText() {
        if (this.scope === "clips") return this.contentReversed ? "最早在前" : "最新在前";
        return this.contentReversed ? "倒序" : "正序";
    }

    renderDetail() {
        const row = this.selectedRow();
        const isCurrent = row.name === this.current;
        const total = this.count(row);
        this.detail.replaceChildren();

        // Compact Project Hero Header
        const detailHead = el("div", "ahl-detail-head");
        const heroRow = el("div", "ahl-hero-row");
        const cover = this.cover(row, "ahl-detail-cover");
        const titleCol = el("div", "ahl-title-col");

        if (this.mode === "rename") {
            titleCol.append(this.renameForm(row));
        } else {
            const titleLine = el("div", "ahl-detail-title");
            const h3 = el("h3", "", row.name);
            h3.title = row.name;
            titleLine.append(h3);
            if (isCurrent) titleLine.append(el("span", "ahl-in-use is-inline", "使用中"));

            const metaLine = el("div", "ahl-meta-line");
            const full = fullTime(row.updated_at);
            if (full) metaLine.title = `最后修改：${full}`;
            const countSpan = el("strong", total ? "" : "is-zero", total ? `${total} ${this.lib.unit}` : "空库");
            metaLine.append(countSpan);
            if (full) metaLine.append(el("span", "ahl-meta-dot", "·"), el("span", "ahl-meta-time", full));
            titleCol.append(titleLine, metaLine);
        }
        heroRow.append(cover, titleCol);

        const actionBar = el("div", "ahl-action-bar");
        const actions = el("div", "ahl-actions");
        actions.append(...this.primaryButtons(row, isCurrent));

        const more = el("div", "ahl-more");
        const folder = button("目录", "folder-open", "ahl-btn is-quiet");
        folder.title = "在资源管理器中打开文件夹";
        folder.addEventListener("click", () => this.openFolder(row.name, folder));
        const rename = button("改名", "pencil", "ahl-btn is-quiet");
        rename.title = "重命名项目";
        rename.addEventListener("click", () => { this.mode = "rename"; this.renderDetail(); });
        const remove = button("", "trash", "ahl-icon-btn is-danger");
        remove.title = "删除项目";
        remove.setAttribute("aria-label", "删除项目");
        remove.addEventListener("click", () => { this.mode = "delete"; this.renderDetail(); });
        more.append(folder, rename, remove);

        actionBar.append(actions, more);
        detailHead.append(heroRow, actionBar);
        if (this.mode === "delete") detailHead.append(this.deleteConfirm(row));

        // Maximized Content Preview Area with Positive / Reverse Sort Toggle
        const contents = el("section", "ahl-contents");
        const contentsHead = el("div", "ahl-section-head");
        const headLeft = el("div", "ahl-contents-title");
        headLeft.append(el("span", "ahl-dot"), el("span", "", "内容预览"), el("span", "ahl-contents-num", String(total)));

        const ctrls = el("div", "ahl-contents-ctrls");
        const orderBtn = el("button", "ahl-order-btn");
        orderBtn.type = "button";
        orderBtn.title = "切换内容排列顺序（正序 / 倒序），切换自动记住";
        const syncOrderBtn = () => {
            orderBtn.replaceChildren(
                el("span", "", this.orderButtonText()),
                icon(this.contentReversed ? "sort-amount-up-alt" : "sort-amount-down")
            );
            orderBtn.setAttribute("aria-pressed", String(this.contentReversed));
        };
        syncOrderBtn();
        orderBtn.addEventListener("click", () => {
            this.contentReversed = !this.contentReversed;
            try { localStorage.setItem(CONTENT_ORDER_KEY, this.contentReversed ? "reversed" : "default"); } catch { /* optional */ }
            syncOrderBtn();
            this.paintContents(row, contentsBody);
        });
        ctrls.append(orderBtn);

        if (this.scope !== "audio") {
            const colSeg = el("div", "ahl-seg is-compact");
            colSeg.setAttribute("role", "group");
            colSeg.setAttribute("aria-label", "预览列数");
            for (const cols of [2, 3]) {
                const btn = el("button", "ahl-seg-btn", `${cols}列`);
                btn.type = "button";
                btn.setAttribute("aria-pressed", String(this.contentCols === cols));
                btn.addEventListener("click", () => {
                    if (this.contentCols === cols) return;
                    this.contentCols = cols;
                    try { localStorage.setItem(CONTENT_COLS_KEY, String(cols)); } catch { /* optional */ }
                    for (const child of colSeg.children) child.setAttribute("aria-pressed", String(child === btn));
                    contentsBody.querySelector(".ahl-thumbs")?.classList.toggle("is-3col", cols === 3);
                });
                colSeg.append(btn);
            }
            ctrls.append(colSeg);
        }

        contentsHead.append(headLeft, ctrls);
        const contentsBody = el("div", "ahl-contents-body");
        contents.append(contentsHead, contentsBody);

        this.detail.append(detailHead, contents);
        this.fillContents(row, contentsBody);
    }

    primaryButtons(row, isCurrent) {
        const isRef = this.scope === "image" || this.scope === "audio";
        if (isRef && !this.directReferenceSwitch) {
            const load = button("载入到卡片", "download", "ahl-btn is-primary");
            load.title = `切换到「${row.name}」，并用它保存的${this.scope === "image" ? "图片" : "音频"}替换当前卡片`;
            load.disabled = !this.count(row);
            load.addEventListener("click", () => this.primary(row.name));
            const use = button(isCurrent ? "正在使用" : "只切换项目", isCurrent ? "check" : "", "ahl-btn");
            use.disabled = isCurrent;
            use.addEventListener("click", () => this.use(row.name));
            return [load, use];
        }
        const use = button(isCurrent ? "正在使用" : this.directReferenceSwitch ? "切换到此项目" : "使用这个库", isCurrent ? "check" : "", "ahl-btn is-primary");
        use.disabled = isCurrent;
        use.addEventListener("click", () => this.use(row.name));
        return [use];
    }

    async primary(name) {
        const row = this.projects.find(item => item.name === name);
        if (!this.directReferenceSwitch && (this.scope === "image" || this.scope === "audio") && this.count(row)) {
            this.close();
            await this.handlers.onLoad?.(name);
            return;
        }
        this.use(name);
    }

    use(name) {
        this.close();
        this.handlers.onUse?.(name);
    }

    async fillContents(row, box) {
        const total = this.count(row);
        if (!total) {
            box.replaceChildren(el("div", "ahl-contents-empty", "这个项目还没有内容"));
            return;
        }
        box.replaceChildren(el("div", "ahl-contents-loading", "读取中…"));
        const key = `${this.scope}:${row.name}`;
        try {
            if (!this.contents.has(key)) this.contents.set(key, this.loadContents(row.name));
            await this.contents.get(key);
        } catch (error) {
            this.contents.delete(key);
            if (!box.isConnected || this.selected !== row.name) return;
            box.replaceChildren(el("p", "ahl-faint is-error", `读取内容失败：${error.message}`));
            return;
        }
        if (!box.isConnected || this.selected !== row.name) return;
        this.paintContents(row, box);
    }

    async paintContents(row, box) {
        const key = `${this.scope}:${row.name}`;
        const promise = this.contents.get(key);
        if (!promise) return;
        let items;
        try {
            items = await promise;
        } catch {
            return;
        }
        if (!box.isConnected || this.selected !== row.name) return;
        const ordered = this.contentReversed ? items.slice().reverse() : items;
        box.replaceChildren();
        if (!ordered.length) {
            box.append(el("div", "ahl-contents-empty", "这个项目还没有内容"));
            return;
        }
        if (this.scope === "audio") {
            const list = el("ul", "ahl-audio-list");
            for (const item of ordered) {
                const li = el("li", item.skip ? "is-off" : "");
                li.append(icon("volume-up"), el("span", "ahl-ellipsis", item.label || item.filename));
                if (item.skip) li.append(el("span", "ahl-tag", "停用"));
                li.title = item.filename;
                list.append(li);
            }
            box.append(list);
            box.scrollTop = 0;
            return;
        }
        const grid = el("div", `ahl-thumbs${this.contentCols === 3 ? " is-3col" : ""}`);
        const pickable = ["segments", "uploads", "clips"].includes(this.scope) && this.handlers.onPickClip;
        const frag = document.createDocumentFragment();
        for (const item of ordered) {
            const card = el(pickable ? "button" : "div", `ahl-thumb${item.skip ? " is-off" : ""}`);
            if (pickable) {
                card.type = "button";
                card.title = this.scope === "clips"
                    ? (item.raw?.clip_stage === "draft" ? `用「${item.title}」做二采` : `接续「${item.title}」`)
                    : `用「${item.title}」作为这张视频卡的视频`;
                card.addEventListener("click", () => {
                    this.close();
                    this.handlers.onPickClip(row.name, item.raw);
                });
            } else {
                card.title = item.title;
            }
            const media = el("div", "ahl-thumb-media");
            if (item.thumb) {
                const image = el("img");
                image.src = item.thumb;
                image.alt = "";
                image.loading = "lazy";
                image.decoding = "async";
                image.draggable = false;
                image.addEventListener("error", () => image.replaceWith(icon(this.lib.icon)));
                media.append(image);
            } else {
                media.append(icon(this.lib.icon));
            }
            if (item.badge) media.append(el("span", "ahl-thumb-stage", item.badge));
            if (item.duration) media.append(el("span", "ahl-thumb-dur", item.duration));
            if (item.skip) media.append(el("span", "ahl-tag is-over", "停用"));
            const cap = el("div", "ahl-thumb-cap");
            cap.append(el("span", "", item.title || item.caption || ""));
            card.append(media, cap);
            frag.append(card);
        }
        grid.append(frag);
        box.append(grid);
        box.scrollTop = 0;
    }

    async loadContents(name) {
        const project = encodeURIComponent(name);
        if (this.scope === "clips") {
            const data = await this.fetchJson(`/amiaomiao_h3/clip_bin/list?project=${project}&asset_kind=${this.clipAssetKind}`);
            return (data.clips || []).map(item => {
                const seconds = Number(item.variants?.["二采"]?.duration_seconds || item.variants?.["一采"]?.duration_seconds
                    || item.duration_seconds) || 0;
                const title = item.shot_tag || item.clip_id;
                const badge = item.clip_stage === "draft" ? "一采草稿" : "";
                const duration = seconds ? `${seconds.toFixed(1)}s` : "";
                return {
                    raw: item,
                    title,
                    badge,
                    duration,
                    thumb: item.thumbnail_url ? this.url(item.thumbnail_url + (item.stage_revision ? `&v=${encodeURIComponent(item.stage_revision)}` : "")) : "",
                    caption: `${title}${badge ? ` · ${badge}` : ""}${duration ? ` · ${duration}` : ""}`,
                };
            });
        }
        if (this.scope === "image" || this.scope === "audio") {
            const data = await this.fetchJson(`/amiaomiao_h3/lvm/ref_presets?kind=${this.scope}&project=${project}`);
            return (data.references || []).map(entry => {
                const query = new URLSearchParams({ filename: entry.filename, subfolder: entry.subfolder || "", type: entry.type || "input" });
                return { ...entry, title: entry.label || entry.filename, duration: "", badge: "",
                    thumb: this.scope === "image" ? this.url(`/amiaomiao_h3/lvm/image_thumbnail?${query}`) : "" };
            });
        }
        if (this.scope === "segments") {
            const data = await this.fetchJson(`/amiaomiao_h3/lvm/segments?project=${project}`);
            return (data.segments || []).map(item => {
                const seconds = Number(item.duration_sec) || (item.frames ? item.frames / (item.fps || 24) : 0);
                const title = item.tag || `#${item.segment_id}`;
                const duration = seconds ? `${seconds.toFixed(1)}s` : "";
                return { raw: item, title, duration, badge: "",
                    thumb: item.thumbnail_url ? this.url(item.thumbnail_url) : "",
                    caption: `#${item.segment_id}${duration ? ` · ${duration}` : ""}` };
            });
        }
        const data = await this.fetchJson(`/amiaomiao_h3/lvm/uploads?project=${project}`);
        return (data.videos || []).map(item => {
            const seconds = Number(item.duration_sec) || 0;
            const title = item.original_name || `#${item.segment_id}`;
            const duration = seconds ? `${seconds.toFixed(1)}s` : "";
            return { raw: item, title, duration, badge: "",
                thumb: item.cover_url ? this.url(item.cover_url) : "",
                caption: `#${item.segment_id}${duration ? ` · ${duration}` : ""}` };
        });
    }

    // ---------- create / rename / delete / folder ----------
    showCreate() {
        this.createRow.hidden = false;
        this.createRow.replaceChildren();
        const input = el("input", "ahl-input");
        input.placeholder = "新项目名称";
        input.setAttribute("aria-label", "新项目名称");
        const confirm = button("建立", "check", "ahl-btn is-primary");
        confirm.type = "submit";
        confirm.disabled = true;
        const cancel = button("取消", "", "ahl-btn");
        const error = el("span", "ahl-error");
        input.addEventListener("input", () => { confirm.disabled = !input.value.trim(); error.textContent = ""; });
        cancel.addEventListener("click", () => this.hideCreate());
        this.createRow.onsubmit = async event => {
            event.preventDefault();
            const name = input.value.trim();
            if (!name) return;
            confirm.disabled = true;
            try {
                const data = await this.fetchJson(this.routes.create, { method: "POST",
                    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: name, scope: this.scope }) });
                this.hideCreate();
                await this.refresh(data.name || name);
                this.toast(`已新建「${data.name || name}」`);
            } catch (err) {
                error.textContent = err.message;
                confirm.disabled = false;
            }
        };
        this.createRow.append(input, confirm, cancel, error);
        input.focus();
    }

    hideCreate() {
        this.createRow.hidden = true;
        this.createRow.replaceChildren();
    }

    renameForm(row) {
        const form = el("form", "ahl-rename");
        const input = el("input", "ahl-input");
        input.value = row.name;
        input.setAttribute("aria-label", "新名称");
        const save = button("保存", "check", "ahl-btn is-primary");
        save.type = "submit";
        const cancel = button("取消", "", "ahl-btn");
        cancel.addEventListener("click", () => { this.mode = "view"; this.renderDetail(); });
        const note = el("p", "ahl-note", this.scope === "clips" ? "只改片段项目库里的这个项目。"
            : "图片、音频、裁切片段、投放视频里同名的项目会一起改名。");
        const error = el("p", "ahl-error");
        form.onsubmit = async event => {
            event.preventDefault();
            const next = input.value.trim();
            if (!next || next === row.name) { this.mode = "view"; return this.renderDetail(); }
            save.disabled = true;
            try {
                const data = await this.fetchJson(this.routes.rename, { method: "POST",
                    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: row.name, new_name: next }) });
                const name = data.name || next;
                if (this.current === row.name) this.current = name;
                this.contents.clear();
                this.mode = "view";
                this.handlers.onRenamed?.(row.name, name);
                await this.refresh(name);
                this.toast(`已改名为「${name}」`);
            } catch (err) {
                error.textContent = err.message;
                save.disabled = false;
            }
        };
        const line = el("div", "ahl-rename-line");
        line.append(input, save, cancel);
        form.append(line, note, error);
        requestAnimationFrame(() => { input.focus(); input.select(); });
        return form;
    }

    deleteWarning(row) {
        const total = this.count(row);
        if (this.scope === "clips") {
            const locked = Number(row.locked_clips) || 0;
            if (locked) return `项目里有 ${locked} 个已锁定的片段，请先解除锁定再删除。`;
            return total ? `会同时删除 ${total} 个片段（latent、封面和视频），无法撤销。` : "会删除这个空项目。";
        }
        if (this.scope === "image" || this.scope === "audio") {
            return total
                ? `会删除这个项目保存的 ${total} 条卡片记录。素材文件本身仍保留在 input 文件夹。`
                : "会删除这个空项目。";
        }
        if (!total) return "会删除这个空的素材库文件夹。";
        return this.scope === "segments"
            ? `会同时删除 ${total} 个已保存片段（含缩略图和预览），无法撤销。`
            : `会同时删除 ${total} 个投放视频（原文件与封面），无法撤销。裁切片段库里的同名项目不受影响。`;
    }

    deleteConfirm(row) {
        const box = el("div", "ahl-confirm");
        box.setAttribute("role", "alertdialog");
        box.append(el("strong", "", `删除「${row.name}」？`), el("p", "", this.deleteWarning(row)));
        const actions = el("div", "ahl-confirm-actions");
        const cancel = button("取消", "", "ahl-btn");
        cancel.addEventListener("click", () => { this.mode = "view"; this.renderDetail(); });
        const confirm = button("确认删除", "trash", "ahl-btn is-danger-solid");
        const error = el("p", "ahl-error");
        confirm.addEventListener("click", async () => {
            confirm.disabled = true;
            try {
                await this.fetchJson(this.routes.remove, { method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ project: row.name, confirm: row.name, scope: this.scope }) });
                const wasCurrent = this.current === row.name;
                this.contents.delete(`${this.scope}:${row.name}`);
                this.mode = "view";
                if (wasCurrent) {
                    const fallback = this.scope === "clips" ? "Default_Project" : DEFAULT_PROJECT;
                    const remaining = this.projects.map(item => item.name).filter(name => name !== row.name);
                    this.current = remaining.includes(fallback) ? fallback : (remaining[0] || fallback);
                }
                this.handlers.onDeleted?.(row.name, wasCurrent ? this.current : null);
                this.projects = this.projects.filter(item => item.name !== row.name);
                await this.refresh(this.current);
                this.toast(`已删除「${row.name}」`);
            } catch (err) {
                error.textContent = err.message;
                confirm.disabled = false;
            }
        });
        actions.append(cancel, confirm);
        box.append(actions, error);
        requestAnimationFrame(() => cancel.focus());
        return box;
    }

    async openFolder(name, node) {
        node.disabled = true;
        try {
            await this.fetchJson(this.routes.open, { method: "POST",
                headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: name, scope: this.scope }) });
            this.toast("已在资源管理器中打开");
        } catch (error) {
            this.toast(`打不开文件夹：${error.message}`, true);
        } finally {
            node.disabled = false;
        }
    }
}
