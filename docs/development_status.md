# 开发状态

## v3.1.0 · V40 前后放大任务开关

- 将用户已验证的 Advanced Gemma V40 Ultimate SD Upscale Pre Detailer（43）和 Post Detailer（upscale_post）加入新建任务，可分别勾选，参数沿用保存的工作流。支持简易添加、普通命令和简易 LoRA 遍历，仅覆盖本次构图。Detailer V40 没有这对分支，不添加无效选项。
- 覆盖前／后四种组合的实际节点 #126/#130 和输出连线。同步能力声明到 AstrBot 画布、API 与随包图；保留本机画布布局和 API 当前参数。Minor v3.1.0。
- 15 项工作流适配测试、隔离 AstrBot 的四种组合及命令提交、1200px／360px 界面勾选与提交检查通过，Ruff、JS 语法和 Git 差异检查通过。
- Git Commit Message：`feat: expose V40 pre and post detailer upscale task switches`。运行副本未同步，GPU 放大沿用用户已验证结果，本轮不重复生成。


## v3.0.0 · 可选任务功能与 RGB 区域提示词

- 按用户要求发布 Major v3.0.0。全部 14 条工作流通过统一能力接口，任务只显示已适配的常用功能：Advanced Gemma V40 的 OpenPose、Any ControlNet 与 RGB Regional Prompt，Anima T2I 的 LLLite。不加入其他低频修复或放大节点；既有工作流参数保持入口。v3 网页未勾选功能显式关闭，旧客户端省略字段仍沿用工作流默认值。
- 区域编辑提供触摸画笔、矩形、橡皮、笔径、撤销、三行／三列、横纵比例、RGB PNG 导入、图集及本地参考底图；三区提示词及强度独立，全局强度可调。整套提示词预设持久保存，电脑与手机共用，加载不改变遮罩。
- 核对 V40 #1/#2/#3 → 调整尺寸 → #39/#40/#41 RGB 通道 → Attention Couple #51，以及三区编码与强度连线。单次参数开启分支 #24，运行图与上传图片独立，相同 RGB 遮罩每任务只上传一次。LoRA 批次复用该设置。
- 更新两条相关 AstrBot 画布的功能元数据、API 导出、随包图及 Anima 同步模板，节点、连线和布局保留，原始画布未修改。Anima 导出器保留功能声明。运行实例未自动覆盖。
- 40 项回归检查通过；隔离 AstrBot 覆盖 14 条工作流和 72 条路由、普通与命令任务、开启／关闭、错误输入、预设版本冲突。Chromium 在 1200px 和 360px 验证选择后展开、RGB 画笔与撤销、整套预设、关闭 ControlNet 和提交草稿。
- 本机 ComfyUI 完成已安装 SDXL Turbo 的 192×128、1 步 AttentionCouplePPM GPU 烟雾测试（任务 8ca55daa-ea82-45ad-aeff-c2aebdaeb04d）：上传 RGB，三路通道及条件连接通过并生成预览。该测试验证执行路径，完整 V40 长步数画面效果和 QQ 投递待验证。
- 安装副本未部署或重载；真实手机待验证。说明见 [使用教程](../user%20docs/REGIONAL_PROMPT.md)。Git Commit Message：`feat: add selectable task features and RGB regional prompting`。


## v2.40.2 · 工作流基础配置归组

- 命令简称、提示词前缀、种子、LoRA 扫图目录与参考图来源合并为默认收起的「基础配置」，保留原控件 ID、显示条件和保存逻辑。桌面展开采用分栏，窄屏纵向排列，折叠保留未保存内容；未保存项定位可自动展开该分组。
- Chromium 在 1200px 和 360px 下验证 Anima T2I 归组、默认折叠、参考图来源、前缀与种子草稿保留，原有 H3 和 Detailer 新建任务回归通过。Git 差异检查通过。Patch v2.40.2，运行副本未同步，真实手机访问待验证。
- Git Commit Message：`fix: group workflow basics into a compact collapsible panel`。


## v2.40.1 · 精简 H3 模板操作

- 模板选中即加载文本与编辑模式，常用区只保留保存／更新与更多菜单。恢复原文、刷新和删除收进菜单；点击外部、按 Escape 或执行操作关闭菜单，模板名称支持回车保存，中文输入法确认不触发保存。
- 取消模板选择保留当前提示词；保存、导入和刷新列表不会自动覆盖草稿。桌面及手机布局保持紧凑，导入导出仍在管理页面。
- Chromium 在 1200px 和 360px 下通过自动加载、模式恢复、草稿保留、保存更新与原有导入导出回归检查；JS 语法、Ruff 和 Git 差异检查通过。Patch v2.40.1，运行副本未同步，真实手机访问待验证。
- Git Commit Message：`fix: streamline H3 prompt template selection and actions`。


## v2.40.0 · 控制图管理、LoRA 列表与参考图集

- 控制图预览新增文件重命名和删除。重命名同步实际文件并保持资产 ID，检查路径、扩展名及跨状态同名冲突；删除原图后保留墓碑记录和生成结果，旧引用给出不可用提示。
- 新建任务的 LoRA 选项仅解析文件头，避免首次显示列表遍历完整权重计算 SHA-256；编号、分类、顺序和默认强度不变，正式提交仍保留完整校验。
- Detailer V40 等参考图入口改为从图集选图，支持普通三类图集及控制图、筛选分页、预览和读取原图。读取过程中禁用提交，成功后按本地参考图路径入参并清理旧遮罩。
- 38 项回归检查通过，隔离 AstrBot 验证快速 LoRA 列表未调用完整哈希、编号一致，以及控制图重命名／删除和登录限制。Chromium 在 1200px 和 360px 下验证图集预览、原图读取和 Detailer 任务提交。Ruff、JS 语法及 Git 差异检查通过。
- Minor v2.40.0；运行副本未同步，真实手机与 GPU 生成待验证。未修改现有工作流或用户数据。
- Git Commit Message：`feat: manage control images and streamline task LoRA and gallery inputs`。


## v2.39.1 · H3 导入导出入口归位

- 将 H3 当前提示词导出、模板库 JSON 导入导出、TXT 导入及同名覆盖选项移至「管理 → 导入导出 → MiniMax H3 提示词与模板」。编辑器保留保存、加载、删除与刷新。
- 模板库操作无需先打开编辑器；当前草稿导出在编辑器加载后启用。尚未打开编辑器时，TXT 按文件名保存为模板；已打开时载入草稿。结果与错误在管理页面就近显示，返回任务时同步最新提示词。
- Chromium 在 1200px 和 360px 下验证入口归属、独立模板库导出、JSON／TXT 导入、现有编辑器与两类任务提交。JS 语法、Ruff 和 Git 差异检查通过。Patch v2.39.1，运行副本未同步，真实手机访问待验证。
- Git Commit Message 为 `fix: move H3 prompt transfers to management exports`。

## v2.39.0 · 工作流任务输入适配与 H3 模板导入导出

- 核对 14 条随包工作流的提示词、参考图、遮罩与专用节点。服务端为新建任务和命令解析返回 `task_inputs`，网页只展示有实际映射的控件，省略不适用的提交字段。H3 隐藏负向输入，完整版使用专用模板和媒体加载器；普通提示词、预设、LoRA 与 ControlNet 按各自能力保留。详见 [逐项核对](task_inputs.md)。
- 简易添加接通 Anima AIO 与三条 WAN 图生视频的参考图路径，Anima 的 LoRA 任务同步传递参考图状态；遮罩以实际输出连线和 AIO 图生图候选分支判断。图片反推不进入生成任务列表。切换工作流保留草稿，但旧图、负向词和 H3 素材不会进入不适用的任务。
- H3 支持导出当前提示词和模式、导入／导出 JSON 模板库及 TXT 直接载入。导入默认合并且跳过同名项，可显式选择覆盖同名；整批校验、文件版本冲突保护和原子写入保留，其他已有模板不受影响。
- 37 项回归测试通过。隔离 AstrBot 验证 14 条能力映射、70 条路由、AIO 和三条 WAN 的实际任务图参考输入、H3 无效输入拒绝，以及模板批量合并、覆盖、损坏项整批拒绝和原有保存流程。Chromium 在 1200px 和 360px 下通过工作流切换、隐藏字段不入参、折叠保留以及模板 JSON／TXT 交互检查。
- Minor v2.39.0；运行副本尚未部署，GPU 生成、QQ 投递和真实手机访问待验证。原始画布、API 工作流文件与用户数据未修改。
- Git Commit Message 为 `feat: adapt task inputs to workflows and transfer H3 prompt templates`。

## v2.38.1 · H3 折叠与禁用按钮指针

- 修复全局禁用按钮使用 `cursor: wait` 导致灰色按钮悬停持续转圈的问题，改用普通指针并保留禁用状态。
- H3 Prompt IDE（含模板）与 Fantastic H3 Media Loader 分别提供默认收起的标题折叠区。折叠保留编辑器、素材及模板草稿，简易和命令任务提交继续使用当前内容；切换任务入口保留展开状态，加载错误在折叠区外可见。
- Chromium 在 1200px 与 360px 下通过折叠、展开、禁用指针、提示词模板回归、草稿保留和两种任务提交检查。原始工作流、API 与持久数据未修改。
- Patch 版本 v2.38.1；运行副本尚未同步，真实手机访问待验证。
- Git Commit Message 为 `fix: collapse H3 task editors and correct disabled button cursor`。

## v2.38.0 · H3 提示词模板

- H3 Prompt IDE 上方新增模板列表、名称和保存、加载、更新、删除、刷新操作。保存完整提示词及编辑模式，简易与命令添加共用，电脑和手机通过插件数据目录 `h3_prompt_templates.json` 共用模板。操作结果在按钮下方就近显示。
- 新增登录验证、名称与提示词校验、文件大小限制和原子写入。使用文件版本避免多页面覆盖，刷新或保存失败保留当前提示词；损坏模板文件返回错误并保留原文件。
- 37 项回归测试通过。安装包在真实 AstrBot 的隔离目录加载 14 条工作流和 70 条 Web 路由，验证模板持久化、完整文本与模式、同名更新、删除、登录限制、无效输入和过期版本保护。Chromium 在 1200px 和 360px 下验证模板操作、并发冲突提示和草稿保留。Ruff、JavaScript 语法与 Git 差异检查通过。
- 版本为兼容新增功能 Minor v2.38.0。当前运行副本尚未部署，真实手机访问与 GPU 生成未验证。
- Git Commit Message 为 `feat: save and reuse H3 prompt templates`。

## 2026-11-16 多 Agent 初始化

- 插件位于 `master`，基线 `fb23c4e`，前两次提交为 `c731cee` 与 `5c2d6a5`。源代码登记版本为 `v2.24.1`。
- 基线已有从 `docs/` 到 `user docs/` 的用户文档迁移差异。保留迁移原状，新的 `docs/` 存放项目分析。ComfyUI 检出为 detached HEAD，已有 `run.bat` 与 `script_examples/wan22_astrbot_client.py` 未跟踪。
- 新增 `workflow`、`backend`、`frontend`、`data`、`reviewer` 五个项目角色。Architect 由主会话承担，同时最多四个子 Agent。Reviewer 仅做只读检查。
- 六个 TOML 文件通过语法检查。本机 Codex 严格配置读取确认项目可信且项目层启用 Agents，并发上限为 4。
- 当时本机 Codex 分两批实际启动五个项目角色，全部依据各自收到的源码片段返回了正确结果。独立命令行进程的 Windows 文件读取组件报错，当时的运行验证覆盖角色加载、派工和回传。
- 当前检出未见 README 所述的 `tests/`。本轮只写入 Agent 配置、维护指南和项目分析文档。业务测试、ComfyUI 生成、QQ 投递、运行图同步及发布留待获批任务。

## 2026-11-16 需求调查与开发计划

- 五个专业角色完成只读调查和独立审查。已提供 [开发计划](development_plan.md) 与 [工作流执行顺序](workflow_execution_order.md)，状态为待批准。
- 工作流附录覆盖本机使用的 11 条注册工作流及 WD14，注明运行配置、手动 API 和随包版本的差异。三个诊断的静态及历史证据已记录。V40 实机同种子对照、真实双 LoRA 生成和手机实际访问留在获批阶段。
- 本轮输出限于计划、执行顺序和本状态记录。业务开发、工作流及运行数据改动尚未开始。

## 2026-11-17 阶段 1 · 批量扫图与评价导航

- 用户批准按计划实施，并确认网页拖拽参数布局与 LoRA「全部匹配」。独立 worktree 使用 `fb23c4e` 作为基线，主工作区保留先前的用户文档和 Agent 配置改动。
- 已集成数字多预设扫人物 LoRA、待评与图库分页、预览相邻导航和 LoRA 全部匹配。Reviewer 发现待评轮询可能切换正在预览的图，已修复并覆盖在途响应的回归测试。
- 两项 Python 归档测试、隔离队列与多输出模拟、Chrome 桌面和手机尺寸交互、Ruff、JS 语法、Git 差异检查通过。阶段 ZIP 在真实 AstrBot 4.29.4 的隔离数据目录成功初始化 11 条工作流及 52 条 Web 路由。实际双 LoRA 生成和 QQ 投递待验证。
- 联机原生测试由本机可用性决定。阶段 2 正在处理 ControlNet 适配、修脚顺序、输入目录和独立资产存储。

## 2026-11-17 阶段 2 至 4 · ControlNet、参数布局与 v2.25.0

- 阶段 2 完成 input 树及安全预览、控制图独立持久化和三条工作流适配。Detailer V40 修脚移到全局后处理之前。V40、Anima T2I、Detailer 的 AstrBot 画布与 API 已同步，原画布和已安装的 AstrBot 运行图留在原位置。审查中发现 Detailer 放大分支旧 Canny 位置，已更新画布和随包默认值。
- 阶段 3 完成桌面与手机共用的「新建任务」、V40 与 Anima T2I 独立单次 ControlNet 输入，以及控制图集和配对独立评分。隔离 ComfyUI 完成 V40 固定种子的无控制/Canny 对照，另用插件队列真实生成双 LoRA 图，验证全部匹配与控制图独立评价。OpenPose、LLLite 和 Detailer 分支完成自动构图检查，未做各自实际生成。
- 阶段 4 支持网页分类、分组与字段布局，首次导入生成依赖顺序，已保存布局保留。Chromium 桌面鼠标和手机尺寸模拟触摸拖拽通过，参数输入的未保存值保留。发布候选使用 Minor v2.25.0，Git Commit Message 为 `feat: add ControlNet task creation and configurable workflow layouts`。当前生产安装、真实手机与 QQ 投递待验证。
- 最终 29 项回归测试全部通过。发布 ZIP 在真实 AstrBot 4.29.4 的隔离目录加载了 11 条工作流和 58 条 Web 路由。Ruff、JavaScript 语法和 Git 差异检查通过。两个仓库的提交指针保持原值。

## 切换为单 Agent

- 应用户要求，项目关闭子 Agent。当前会话负责调查、实现、审查和交付，历史角色配置和开发记录保留供查阅。

## v2.25.1 · ControlNet 选图

- 增加 ControlNet 选框和操作按钮之间的间距。「浏览 ComfyUI input」在 Windows 主机打开文件选择窗口，初始目录为已配置的 ComfyUI input。手机发起该操作时由 Windows 主机完成选图。当前设备可用「网页预览」查看目录内缩略图，也可用「上传本地图片」打开本机文件选择器。
- 29 项回归测试通过。安装包在隔离 AstrBot 实例加载了 11 条工作流和 59 条 Web 路由。选图接口使用模拟 Windows 窗口结果验证了登录限制、目录限制、选中和取消。Chromium 在 1100px 和 360px 宽度下验证了间距、两种选择入口和目录内缩略图。实际 Windows 选图操作、真机手机和运行实例更新待验证。
- Git Commit Message 为 `fix: use Windows file picker for ControlNet inputs`。

## v2.26.0 · 简易添加 LoRA

- 已配置 LoRA 目录的工作流可在「简易添加」展开 LoRA 区域。支持多项叠加和逐个遍历，遍历名单留空时选取目录内人物 LoRA。每批复用一个种子。折叠保留选择，滑条和数字输入同步，提交按展开前的实际配置入队。
- 29 项回归测试通过。隔离 AstrBot 加载 11 条工作流和 60 条 Web 路由，通过模拟生成验证 V40 的多 LoRA 顺序、负强度、指定及全部人物遍历、批次种子和无效强度。Chromium 在 1100px 和 360px 宽度下验证交互与提交数据。实际 ComfyUI 生成和安装副本更新待验证。
- Git Commit Message 为 `feat: add LoRA stacking and sweeps to quick task creation`。

## v2.27.0 · 命令添加 ControlNet

- 命令添加使用服务端的实际工作流解析结果显示 V40 OpenPose、Any 或 Anima T2I LLLite 分支，复用简易添加的选图、直用和预处理。普通生成、人物 LoRA 遍历和预设遍历可提交独立控制图。每个遍历任务保留同一份控制输入，预处理输出继续独立归档。
- 29 项回归测试通过。隔离 AstrBot 加载 11 条工作流和 61 条 Web 路由，使用模拟生成验证 V40 普通生成、两种遍历及不支持分支的拒绝路径。Chromium 在 1100px 和 360px 宽度下通过控制面板、选图、遍历提交和乱序响应检查。实际 ComfyUI 生成和运行实例更新待验证。
- Git Commit Message 为 `feat: support ControlNet in workbench command tasks`。

## v2.28.0 · 预设翻页与 LoRA 分类筛选

- 提示词预设每页显示 12 条，支持上一页、下一页和页码选择。编号按完整列表计算，拖拽保留页内排序，箭头可跨页移动。翻页保留当前编辑及草稿，定位指定预设会打开对应页。
- LoRA 编号列表新增「全部、人物 C、风格 S、其他 O」显示筛选，从当前目录立即切换分组，按原组内编号显示并支持排序。
- Chromium 在 1100px 和 360px 宽度下通过分页、跨页移动、页内拖拽、草稿保留和分类筛选检查。29 项回归测试通过，安装包在隔离 AstrBot 加载 11 条工作流和 61 条路由。当前运行实例待更新。
- Git Commit Message 为 `feat: paginate prompt presets and filter LoRA categories`。

## v2.28.1 · 预设分页排版

- 缩短页码下拉框，上一页、页码和下一页保持在同一行。Chromium 在 320、360、760 和 1100 像素宽度下通过布局检查。
- Git Commit Message 为 `fix: keep prompt preset pagination on one line`。

## v2.29.0 · 图集下载与导出

- 生成图和控制图的原图预览提供小型下载按钮。「导入导出」可分别打包生成图和控制图的收藏、Pass、待评价状态，ZIP 包含全部原图，生成图保留其目录结构。
- 29 项回归测试通过。隔离 AstrBot 加载 11 条工作流和 62 条路由，并核对六类 ZIP 的文件清单、原图字节、权限和空图集响应。Chromium 在 360px 和 1100px 宽度下通过下载按钮与导出请求检查。运行实例待更新。
- Git Commit Message 为 `feat: add original image downloads and gallery ZIP exports`。

## v2.29.1 · 工作台目录更名

- 页面资源移至 `views/workbench/`，同步更新远程工作台路径、打包清单和文档。隔离 AstrBot 发现 `workbench` 内嵌页面，远程工作台的全部资源已核对。
- Git Commit Message 为 `fix: rename the plugin view to workbench`。

## v2.30.0 · 新建任务选图预览

- 普通参考图和各 ControlNet 分支在选图后显示按比例缩放的小预览。ControlNet 可浏览收藏、Pass、待评价生成图，直用模式还可浏览对应类型的控制图集。选图窗口同时提供目录缩略图和确认预览。
- 29 项回归测试通过。隔离 AstrBot 加载 11 条工作流和 62 条路由，验证三种生成图状态的原图读取、来源状态校验及控制图分页前按类型过滤。Chromium 在 360px 和 1100px 宽度下检查了选图、预览、清除和提交数据。实际生成、系统文件窗口及运行实例更新待验证。
- Git Commit Message 为 `feat: preview task images and select ControlNet sources from galleries`。

## v2.31.0 · 图集选图筛选与预览排版

- ControlNet 的「从图集选图」复用生成图集支持的分类、预设、工作流和 LoRA 筛选及全部匹配，选图筛选独立于主图集。待评卡片的收藏、跳过、删除排在一行。
- 生成图与控制图使用等大的预览区域和同位置的下载按钮，信息移到各自图片下方，翻页居中放在弹窗底部。已在 360px 和 1100px 宽度下验证筛选请求与布局。运行实例待更新。
- Git Commit Message 为 `feat: share gallery filters and align paired image previews`。

## v2.31.1 · 图集选图工具栏

- 图集、图片分类和筛选按钮同行，筛选面板在下方展开。Chromium 在 320px、360px 和 1100px 宽度下通过布局与交互检查。
- Git Commit Message 为 `fix: align the gallery picker filters in one toolbar`。

## v2.31.2 · 工作流选项分列

- 简短的节点参数组按参数区宽度分列，同行用纵线分隔，行间用横线分隔。长文本、复杂编辑器和带分支开关的设置保留整行。
- Chromium 在 320px、360px、746px 和 1100px 宽度下通过分列、搜索、旁路显隐及恢复已保存顺序的检查。
- Git Commit Message 为 `fix: use responsive columns for workflow option groups`。

## v2.31.3 · 工作流参数行宽

- 简短参数组按每行的实际组数分配宽度，单组占满整行。扩散模型、文本编码器和 VAE 等简短组可并排摆放。Chromium 在 320px、360px、746px 和 1100px 宽度下通过布局和参数顺序检查。
- Git Commit Message 为 `fix: fill unused space in workflow option rows`。

## v2.32.0 · ControlNet 模型预设

- 工作台新增 ControlNet 配置页。按 Advanced Gemma V40 的 OpenPose、Any 或 Anima T2I 的 LLLite 分支管理类型、模型、预处理、分辨率、强度与生效比例。首次保存写入插件数据目录的 `controlnet_profiles.json`，简易添加和命令添加可选择同类型的不同预设。未配置的分支使用内置规则。
- 30 项回归测试通过。隔离 AstrBot 加载 11 条工作流和 64 条路由，验证模型列表、配置保存、版本冲突、不同预设切换、删除回退和模拟入队。Chromium 在 360px 和 1100px 宽度下验证编辑和任务选择。使用本机 ComfyUI 的模型及节点列表构建了 V40 Illustrious Canny 预设图与 OpenPose 默认图，实际出图及运行实例更新待验证。
- Git Commit Message 为 `feat: configure ControlNet model presets for task creation`。

## v2.32.1 · 区分手机和电脑选图入口

- 手机及远程工作台只提供网页浏览。Windows 电脑的 AstrBot 内嵌工作台使用系统文件选择窗口。远程路由仅保留目录和缩略图查询。
- Git Commit Message 为 `fix: separate mobile and desktop ComfyUI input pickers`。

## v2.33.0 · MiniMax H3 Seed Hunter

- 从原画布转换搜种和放大定稿两份 AstrBot 画布，导出 API 并同步插件。QQ、命令添加、简易添加支持两条工作流及单张可选参考图。原画布哈希核对一致。新增 Markdown 使用教程。
- 32 项回归测试通过。隔离 AstrBot 加载 13 条工作流和 64 条路由，模拟验证两个简称及种子、输出映射。使用本机 ComfyUI 选项验证节点和模型清单。原画布扩散模型和 H3 文本编码器未出现在加载器列表，定稿放大文件尚未在潜空间放大目录注册，实际出图和运行副本更新待验证。
- Git Commit Message 为 `feat: integrate MiniMax H3 Seed Hunter workflows`。

## v2.33.1 · 工作流侧栏独立滚动

- 桌面侧栏根据当前窗口的可见高度限制列表区域。工作流列表独立滚动，参数区仍可正常滚动。
- Chromium 在 820 × 430 和 1200 × 680 下验证参数区停在顶部时可滚到列表末项，在 360px 宽度下检查单列布局。
- Git Commit Message 为 `fix: scroll the workflow sidebar independently`。

## v2.34.0 · Seed Hunter v3 完整版

- 新增 `h3-v3`，保留原画布的 168 个节点和子图布局，补齐 17 条显式连接。同步 ComfyUI API 导出和插件工作流。原画布与两份简化版保留。
- 工作台提供 11 种生成模式和 45–123 个参数项，支持实时模型选项、多 LoRA、提示词编辑器切换、候选选择和各模式专用设置。
- 34 项回归测试通过，隔离 AstrBot 加载 14 条工作流和 64 条路由，三条 H3 指令均通过模拟提交。本机 ComfyUI 提交校验覆盖 11 种模式，未执行 GPU 生成与 QQ 投递。运行副本未部署。
- Git Commit Message 为 `feat: add configurable MiniMax H3 Seed Hunter v3 workflow`。

## v2.35.0 · H3 新建任务素材加载器

- 新建任务的简易与命令入口接入 Fantastic H3 Media Loader，复用节点包 1.8.3 的 MIT 授权媒体编辑界面。桌面保留图片网格、视频和音频分区，手机纵向排列并提供顺序按钮。图片支持预览和裁剪、镜像、旋转、尺寸设置，音视频支持播放、截取、音轨分流、素材预设及原节点遮罩编辑。
- 媒体编辑通过已登录的插件入口访问配置的 ComfyUI，提供上传大小限制、路径检查、操作白名单和会话绑定预览。素材描述仅写入本次任务的 #416，默认配置和其他任务各自保留。
- 37 项单元测试通过。隔离 AstrBot 加载 14 条工作流和 68 条路由，验证两种任务入口携带完整素材描述，以及预览、上传和受限转发。Chromium 在 1200px 与 360px 下验证图片预览、裁剪镜像、视频截取、排序、音轨切换、上传与预设。隔离 ComfyUI 实际验证图片、视频、音频上传及读取、裁剪导出、音轨提取和预设保存读取。
- GPU 视频生成、Auto Mask 实际推理和 QQ 投递待验证，运行副本尚未部署。高级编辑界面部分文字沿用上游原文。新增 vendor 资源及授权文本均纳入安装包。
- Git Commit Message 为 `feat: add full H3 media loader to task creation`。

## v2.36.0 · H3 图集导入

- H3 素材加载器增加「从图集导入」，复用图集选择器的筛选、分页和预览。支持待评价、收藏、跳过及可用的控制图集，按原图格式导入，可重复添加多张图片。
- Chromium 在 1200px 和 360px 下验证普通图集与控制图集导入，确认请求原图、文件后缀匹配、素材草稿进入任务参数。JavaScript 语法与 Git 差异检查通过。运行副本待安装。
- Git Commit Message 为 `feat: import gallery images into H3 media loader`。

## v2.37.0 · H3 Prompt IDE 新建任务编辑器

- `h3-v3` 新建任务复用 H3 Prompt IDE 0.8.25，提供富文本 / 纯文本、五种 H3 模式及自动识别、结构检查与补齐、引用预览、上下文补全、标签替换、对白、撤销重做、多处编辑和字号设置。引用按本次媒体的启用状态和音轨顺序同步，编辑偏好保存在浏览器。
- 简易添加保持原有 `positive` 提交，命令添加使用独立 `h3_prompt` 传递完整文本。命令本身继续解析工作流、种子和预设，编辑器文字中的换行、引号和选项样式文本原样保留。沿用单项 8000 字符上限。
- 37 项回归测试通过，隔离 AstrBot 加载 14 条工作流和 68 条路由，并校验独立提示词与命令种子的映射。Chromium 在 1200px 和 360px 下验证引用预览、补全、结构补齐、对白、撤销重做、字号及草稿恢复，完整工作台页面的简易与命令添加均校验原文提交。生成与 QQ 投递未执行，运行副本待安装。
- 上游编辑器及核心模块按 GPL-3.0 保留授权、来源、适配记录和可读源码，相关资源均纳入安装包。部分工具栏及检查提示沿用上游英文。
- Git Commit Message 为 `feat: add H3 Prompt IDE to task creation`。
