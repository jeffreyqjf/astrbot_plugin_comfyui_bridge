# 插件需求调查与分阶段开发计划

本文记录 v2.25.0 的调查与实施分工。后续开发按 [现行单 Agent 规则](development_rules.md) 执行。

2026-11-16 · 调查基线。插件基线 master @ fb23c4e，登记版本 v2.24.1。ComfyUI 基线 2c75dc1b3。本机 AstrBot 实例指向 127.0.0.1:8188 和 G:/ComfyUI，运行目录有 11 份 API 图。独立手机工作台当前关闭。调查读取了源码、工作流、实际运行配置、历史记录和本机节点定义。

2026-11-17 · 用户批准按阶段继续，确认网页拖拽参数布局和 LoRA「全部匹配」。每项子任务由 Architect 动态评估并分配 Low、Medium、High 或 XHigh。

## 需求理解

从任务队列独立出新建任务，桌面和手机共用。创建时浏览 ComfyUI input 原目录、预览图片，按工作流选择 ControlNet 分支、类型以及是否预处理。新控制图进入专属图集，生成图继续进入原待评队列，两者配对预览并独立评价。人物 LoRA 扫描支持多个预设，图片评价增加相邻图和页码导航，新工作流只在首次导入时自动布局调参项，已有工作流另行人工整理。工作流按依赖梳理及评估修脚顺序。

## 已查明的三个问题

### D-01 · V40 original 的 Any ControlNet

- 原图位于 ILV40/Advanced_Gemma_V40.json。Any 实际连线是 #123 LoadImage → #172 AIO_Preprocessor → #166 图像选择 → #165 ControlNetApplyAdvanced。#165 的正负条件接主采样 #114，也可接启用后的 #81。OpenPose #121 → #164 → #163，#163 条件再接 Any。预览 #124 独立依赖图像，出现预览只能证明图像侧执行。
- 历史 PNG 的嵌入 API 图证实两类问题。某次 DensePose 已执行但 #166=false，Apply 取的是已选原图。其后运行里 #166=true，DensePose 或 OpenPose 的处理中间图确实流入了 Depth ControlLoRA，构成模型与控制图类型错配。另有正确匹配 DepthAnythingV2 与 Depth 的历史图，条件确实进入主采样。同种子历史样本随预处理器改变明显，但视觉约束仍需固定种子的无控制对照，隔离应用窗（原图 1.25 强度、0–0.5 生效）、二次采样和后处理的影响。
- AstrBot 运行版是另一份图。两支默认关闭、Any 预处理为 none，手动默认 API 裁掉两支。运行配置的 SDXL/control-lora-canny-rank256.safetensors 和 noobaiXLControlnet_openposeModel.safetensors 不在本机 ControlNetLoader 枚举中。本机有根级 Canny、Depth、openpose_noob.safetensors。是否适配指定 checkpoint 仍需验证。original 只调查，任何修复候选放在 AstrBot 版。

### D-02 · Anima T2I 的 LLLite 模型下拉

- #131 AnimaLLLiteApply.model_patch 是连线类型 MODEL_PATCH。实际模型由上游 #138 ModelPatchLoader.name 选择。本机实时节点定义只返回 anima-lllite-any-test-like-v2.safetensors，来自 models/model_patches。Anima I2I AIO 的 AnimaLLLiteApply_sdscripts.lllite_name 枚举 models/controlnet，那里的 pose、inpaint 等权重走另一种加载契约。
- T2I 当前 #120 LLLite 旁路，运行 API 裁掉 #129/#130/#131/#138。工作台默认隐藏旁路参数，editable_fields 跳过已连线输入。类似“固定”字段按上游连线、旁路、实时 schema 枚举及运行覆盖逐个排查。模型兼容未经验证前不混用两种加载器。

### D-03 · 一图多 LoRA

- 已存在。image_loras 按实际提交图的每个输出回溯 LoRA，识别普通加载器、LoraManager 堆栈与文本及 rgthree，保留多项模型与 CLIP 权重。新图按图槽保存 generation.loras，旧图可从 trace 恢复。内存测试确认一个输出记录两项、另一个只记录一项，筛选按各图的记录匹配。
- 本机扫描的 81 份新格式和 319 份旧格式评价记录均未见多项实例。未做真实双 LoRA 生成。当前 LoRA 同类多选为「任一」，跨维度取交集。手动入库或丢失 trace 的图可能无记录。自定义惰性节点有多候选连线时，仍需对实际执行分支验收。

## 阶段和写入责任

| 阶段 | 任务 | 启动下一阶段的条件 |
| --- | --- | --- |
| 0 · 调查 | D-01 至 D-03、AUD-01 | 本计划获批 |
| 1 · 小功能与基线 | REL-01 的旧路径修复、CMD-01、FE-01、DATA-01、GOV-01 | 队列兼容、导航验收、记录核对和隔离安装包 |
| 2 · 工作流与数据契约 | WF-01、WF-02、BE-01、DATA-02 | 已验证分支映射、输入安全和独立产物契约。修脚可单独验收 |
| 3 · 新建任务与双图评价 | BE-02 → FE-02；BE-02、BE-04 → FE-03 | 桌面和手机候选通过直用、预处理与独立评分 |
| 4 · 布局与发布 | WF-03 → BE-03 → FE-04；FE-05 人工整理；REL-01 | 布局防覆写、安装包和发布验证。REL-01 的审查与测试贯穿各阶段 |

Backend 唯一写入 main.py、bridge/service.py、bridge/client.py、bridge/qq、bridge/studio。Workflow 唯一写入 bridge/workflows、工作流模板、随包 API 和获批的 AstrBot 画布及导出。Data 负责 image_archive.py 及管理索引。Frontend 负责 views/workbench。Architect 负责治理、打包、版本、接口和文档协调。Reviewer 只读独立审查。不同任务触及同一文件时由该角色串行集成。获批后记录 worktree 基线和文件清单，独立写入线用 codex/任务 分支。当前未提交的用户文档迁移和 Agent 配置需保留。

## 开发任务

### AUD-01 · 执行顺序与旁路清单

- **来源、阶段与负责人** · 工作流全面调查。阶段 0，Workflow 分析、Architect 汇总。
- **文件与方案** · [执行顺序](workflow_execution_order.md)。比较实际运行 API、随包图、手动 API 及对应画布。沿输出回溯输入端口，对比当前默认与现有构图器渲染的旁路。覆盖 11 份注册图和 WD14 辅助图。
- **依赖、风险与验收** · 依赖实际副本和节点定义。静态依赖层允许并行，缓存与惰性节点会改变真正执行。列明每图输出、关键连线、默认可达节点、备选分支和无法验证的组合。

### CMD-01 · 按多个预设逐组扫人物 LoRA

- **来源、阶段与负责人** · 命令修改。阶段 1，Backend。
- **文件与方案** · main.py 的 _sweep_loras、service.py 的 start_lora_sweep、bridge/qq/qq_commands.py。仅此命令把纯数字逗号串解释为编号列表，其他名称维持旧解析。重复编号按首次出现保留。与数字列表相同拼写的预设名改用自身编号选择，并在帮助中说明。按同账号预设快照预检全部编号、LoRA 和总量。按「预设 → 人物」构成 M×N 一次入队，每任务保留自己的预设追溯。沿用单次 seed、显式负词优先。Frontend 改表单示例，Architect 汇总文档。
- **依赖、风险与验收** · 依赖当前预设解析和整批入队。验证单值、1,2、无效/重复编号、含逗号名称、各工作流和总队列上限。任一预设或入队前的构图校验失败时整批零受理。普通 gen 的预设兼容，完成顺序可由并发产生变化。

### FE-01 · 评价预览箭头与页码

- **来源、阶段与负责人** · 图片评价导航。阶段 1，Frontend；Data 提供统计，Backend 暴露字段。
- **文件与方案** · views/workbench/image_review.js、index.html、style.css，bridge/image_archive.py、bridge/studio/studio_settings.py。待评和图库的预览都添前后箭头、当前与附近页、页码直达。图库回传总量和页大小，待评按任务分页。旧接口请求省略页码时保留原待评列表行为。
- **依赖、风险与验收** · 依赖现有图库 ID 和排序。处理刷新、跨页、快速切页、评价后条目移除及尾页回退。桌面、手机和键盘可达，预设只读预览继续工作。

### DATA-01 · 多 LoRA 端到端核对

- **来源、阶段与负责人** · 当前疑问 3。阶段 1，Data；Workflow 核对识别器，Backend 核对输出映射。
- **文件与方案** · bridge/image_archive.py、bridge/workflows/workflow.py、bridge/service.py。获准后做双 LoRA、单 LoRA 与多输出对照。若发现具体漏记，按对应加载方式作窄修复。保留旧记录及现有任一筛选规则。
- **依赖、风险与验收** · 依赖获准的隔离生成。两项都可各自查到，权重与各图一致。若批准支持 A+B 全匹配，增加显式选择，旧查询仍任一命中。无需引入数据库或重写全量数据。

### GOV-01 · 变更确认与维护规范

- **来源、阶段与负责人** · 通用添加、AI 行为与长期规则。阶段 1，Architect。
- **文件与方案** · 根 AGENTS.md（需求里称 anget.md）、docs/development_rules.md 和 docs/version_rules.md。先复述拟改范围，有影响的歧义才提问，确认后实施已批准的范围。保留 original 与 AstrBot 两份画布，original 供用户调试，可由用户自行命名。正式修改 AstrBot 画布后把同格式 API 导出至 ComfyUI api 目录并同步插件 API 文件。按变化的兼容性决定 Major/Minor/Patch，正式版本给一行 Git Commit Message。
- **依赖、风险与验收** · 与现役规则并读，避免双份名称和相互矛盾。保存用户原图、人工布局和旧数据。逐阶段更新 docs 与 development_status.md，发布、运行加载、提交和推送按授权。

### WF-01 · ControlNet 分支能力与匹配验收

- **来源、阶段与负责人** · 新建任务的分支、类型与预处理，当前疑问 1、2。阶段 2，Workflow。
- **文件与方案** · bridge/workflows/v40.py、anima_settings.py、anima_aio.py、illustrious.py，AstrBot 画布、手动 API、随包图。声明每个分支的源、图像选择、预处理/Apply/模型节点、主采样和辅助产物。首批核对 V40 OpenPose、Any 与 Anima T2I LLLite。AIO 现有参考/深度/inpaint 控制依赖重绘入口，逐模式验证是否可独立选图。WAI 当前用自身生成的图做重采样控制，若支持选外部图需显式适配进入验收，页面按真实能力显示。
- **依赖、风险与验收** · 依赖 D-01、D-02 与实时 schema。需确认 checkpoint 与控制模型、条件正负端口、预处理切换和输入比例。隔离固定 seed 对照关、匹配已处理、匹配原图预处理、错配拒绝与 V40 双分支。主采样和最终输出分别检查结构遵从性，只有图像字节变化不计作效果验收。

### WF-02 · 修脚先后顺序

- **来源、阶段与负责人** · 工作流调整。阶段 2，Workflow。
- **文件与方案** · Detailer V40 AstrBot 画布、手动 API、随包图，bridge/workflows/detailer.py、v40.py。T2I 与 Advanced V40 的 #514/#499 已在局部修复、全局后处理之前。Detailer 画布的脚组在 #88 后面，当前运行版关闭全局后处理，编译后 #499 直接取 #58。候选为修眼 #58 后、Ultimate #33 前，并核对后续 Canny、尺寸、签名与输出使用了实际选中的修脚结果。保留节点 ID 并维护旧图升级规则。
- **依赖、风险与验收** · 依赖 AUD-01 与隔离对照。测开关两态、遮罩/整图、放大和签名组合。检查兼容映射、原图与运行设置。若其他两条图无对照收益，保留其局部顺序。

### BE-01 · 保留层级的 input 资源浏览

- **来源、阶段与负责人** · input 资源浏览按钮和图片预览。阶段 2，Backend。
- **文件与方案** · main.py、bridge/studio/studio_settings.py、remote_studio.py，必要时新增一个受限路径模块。确定 ComfyUI 实际 input 根，包括参数覆盖，逐层分页列子目录与文件，以鉴权接口返回引用和受限栅格缩略图。复用现有图片读取的鉴权传输；若采用二进制需验证手机 Bearer fetch。远端不可验证根时标为不可用。
- **依赖、风险与验收** · 验证同名文件、嵌套结构、大小/像素限制和登录。阻断绝对/盘符/UNC/ADS、穿越、junction/符号链接逃逸、检查后换路径与 ComfyUI 的 [output]/[temp] 注解。非图资源可以列出。ControlNet 只能选择可解码栅格图，预览不能以内联 SVG/HTML 绕过安全限制。

### DATA-02 · 控制图归档与关联

- **来源、阶段与负责人** · my_input 三种状态和双图独立评价。阶段 2，Data。
- **文件与方案** · 拟新增 bridge/controlnet_archive.py，扩充 image_archive.py 的可选关联。当前没有插件关系数据库，沿用 JSON 和媒体。以稳定 asset_id 记录受限来源或上传摘要、实际预处理参数、分支及任务，按任务/分支/产物槽幂等。媒体归于 input/my_input/{unevaluated,favourite,pass}，生成目录仍用现有 unevaluate。每个结果图槽保持可选 controlnets 关系，仅本次新产物亮标。
- **依赖、风险与验收** · 依赖 WF-01 对产物节点的约定。锁、同盘临时文件和摘要校验后写关联；状态移动和任务路径独立。处理重复、部分失败、取消、孤立资产、旧数据及一方缺图。评价互不级联，旧 JSON 可继续读取。首发保留可复用资产。

### BE-02 · 单次 ControlNet 绑定与处理产物回收

- **来源、阶段与负责人** · 新建任务的原图/已处理模式及生成关联。阶段 3，Backend。
- **文件与方案** · main.py、bridge/client.py、service.py、bridge/studio/studio_settings.py、remote_studio.py。任务携带每分支的类型、处理选择和资源 ID/上传，与普通重绘图和遮罩分开。仅当前任务副本绑定允许的具体节点。工作流同一次执行的明确辅助输出可采集真实控制图，辅助节点不进入常规输出集合。可移动的已有资产入队用受控快照或同等租约，终态后清理。两种新建任务入口校验一致。
- **依赖、风险与验收** · 依赖 WF-01、BE-01、DATA-02。额外预览不能计入普通图片限额、QQ 回传、图片槽或 LoRA 追溯。验证各分支处理与直用、关闭、双分支、遮罩并用、并发评价与取消。生成成功而控制图归档失败时保留正常结果并报告可重试告警。

### FE-02 · 独立创建页及 input 选图

- **来源、阶段与负责人** · 手机和桌面独立新建任务。阶段 3，Frontend。
- **文件与方案** · views/workbench/index.html、app.js、style.css、image_review.js、remote.js。保留结构化和命令表单、账号、预设、模板、上传、收藏及遮罩，拆开队列轮询与创建状态。复用树浏览、面包屑和预览。依据后端 capability 展示分支开关、类型和已处理/预处理，切换工作流清除旧参数。
- **依赖、风险与验收** · 依赖 BE-01、BE-02。兼容现有手机命令 multipart 和 JSON，遮罩可见性与数量上限不回归。桌面和手机验证选择、错误、触摸布局、提交后回队列。手机远程实例需要获准启用或另用隔离环境。

### BE-04 · 控制图列表、预览和评价接口

- **来源、阶段与负责人** · my_input 管理及配对独立评价。阶段 3，Backend。
- **文件与方案** · main.py、bridge/studio/studio_settings.py、remote_studio.py。为三个状态提供鉴权分页、按稳定 ID 预览和明确目标状态的评价。沿用工作台双入口传输。只读输入树和生成图接口各自保留。
- **依赖、风险与验收** · 依赖 BE-01、DATA-02，提供 FE-03 所需的接口。核对登录、状态权限、越界 ID、文件移动竞态、重复评价、安全预览、相同资产跨结果共享和一方缺失。在手机路由验证与嵌入工作台一致。

### FE-03 · 控制图图集与配对评价

- **来源、阶段与负责人** · 新图标识、配对预览和控制图状态管理。阶段 3，Frontend；Backend 提供路由，Data 提供状态。
- **文件与方案** · views/workbench/image_review.js、index.html、app.js、style.css。新产物在待评图卡标识。生成图与对应控制图同一弹窗，桌面并排、手机上下，独立状态与评价，每分支独立呈现。my_input 的三个状态可浏览、预览、切换和用于后续任务。
- **依赖、风险与验收** · 依赖 FE-01、DATA-02、BE-02、BE-04。旧控制图复用不亮新标。评分一方不能级联另一方，共用资产状态一致，预览缺一方保留另一方。验证分页、刷新、重复评价和手机交互。

### WF-03 · 首次布局的字段发现与依赖排序

- **来源、阶段与负责人** · 自动读取新工作流。阶段 4，Workflow。
- **文件与方案** · bridge/workflows/workflow_fields.py、workflow.py。复用 object_info 和实际 API 字面字段。稳定拓扑排序按连线依赖分组，节点 ID 只用于并列排序。连线输入只展示其上游可编辑的字面字段。对于未知、动态输入和分支维持 schema 约束，通用图避免误用 Anima 固定 ID 标签。
- **依赖、风险与验收** · 作为 BE-03 契约。用打乱 JSON key、多个输出、旁路、子图、缺 schema 与动态枚举验证。布局不改变字段值、连线或分支。

### BE-03 · 导入一次并保护人工布局

- **来源、阶段与负责人** · 自动布局时机和手工布局不可覆盖。阶段 4，Backend；Workflow 写工作流存储模块。
- **文件与方案** · bridge/studio/studio_settings.py，bridge/workflows/workflow_archive.py、workflow_store.py。新自定义图首次成功导入保存版本化布局，按 node/field 键引用。目录直接导入走同一个受控首次接纳流程。刷新、重载、命名配置、普通覆盖导入、ZIP 均保留既有布局；需要恢复时使用显式入口。缺 schema 显示可靠字段，可补齐首次初始化状态。
- **依赖、风险与验收** · 依赖 WF-03。现有 ZIP 可替换 Anima 模板，命名配置携完整 profile，需分别防止覆盖工作台布局和关联模板的人工设计。导入、重复、同名覆盖、ZIP 往返、旧布局、配置切换、版本冲突和服务离线恢复全部验收。旧工作流不触发自动重排。

### FE-04 · 展示新工作流布局

- **来源、阶段与负责人** · 自动发现后的可编辑展示。阶段 4，Frontend。
- **文件与方案** · views/workbench/app.js、index.html、style.css。复用字段控件、搜索和旁路显隐，按持久顺序渲染。首发按维护配置手调。若批准网页拖拽，则增加有版本检查的显式保存。
- **依赖、风险与验收** · 依赖 WF-03、BE-03。验证专用优先表不会重排新布局，失效字段可忽略，保存错误可见，手机无溢出。人工微调后刷新、重启、重导均保留。

### FE-05 · 人工整理已有工作流参数

- **来源、阶段与负责人** · 插件优化。阶段 4，Frontend，Backend 负责服务端专用分组。
- **文件与方案** · views/workbench/app.js、style.css、bridge/studio/studio_settings.py。现有工作流按模型、文本/参考、采样、局部修复、放大/滤镜及输出人工微调。范围为网页参数布局。Anima 画布分支成员依赖坐标与组边界，若以后调整画布位置需另校验组成员及 API。
- **依赖、风险与验收** · 不依赖自动生成旧布局，与 FE-04 串行集成共享文件。逐工作流验收参数值、搜索、开关、模型候选和执行图，手机分组可读。

### REL-01 · 集成、测试和发布

- **来源、阶段与负责人** · 每阶段与长期管理。Architect 管发布，Reviewer 独立审查。
- **文件与方案** · build_zip.py、README.md、metadata.yaml、docs 和用户文档。现有 ZIP 白名单仍指向迁移前 docs 下的两份用户文档，当前 checkout 缺历史 tests/。在阶段 1 先修正打包路径并建立最小回归证据，再按每阶段派工 → 整合 → Reviewer → 测试 → Git Diff → 更新文档和汇报的顺序推进。新增模块、前端静态资源纳入包和手机白名单。记录版本与迁移回退。
- **依赖、风险与验收** · ZIP 默认写项目父目录，构建和隔离测试用获准位置。区分源码测试、实际 ComfyUI 对照、实际手机和 QQ 投递。兼容功能整合发布拟为 Minor v2.25.0，单独 Bug 修复可为 Patch，取决于实际发布范围。正式更新的一行 Git Commit Message 示例为 feat: add ControlNet task creation and gallery controls。提交、推送、同步安装和正式运行图导入须有授权。

## 实施取舍

1. FE-04 按用户批准提供工作台拖拽排序和显式保存，兼容触摸与按键操作。
2. LoRA 筛选默认保留任一命中，增加可切换的「全部匹配」。
3. my_input 首发提供预览、选择和三状态切换。若要物理删除，先约定被已有生成图引用时如何处理。
4. ControlNet 首批拟交付 V40 两支及 Anima T2I LLLite，同时核对 AIO 与 WAI。LLLite 先用该节点已验证类型及原图预处理；AIO 的独立控制图和 WAI 外部图须补支路再验收，否则保留原入口。若希望这些能力同批交付，可在批准时调整顺序。
5. WF-01、WF-02、DATA-01 的生成对照用隔离测试素材和输出。实际手机入口、正式运行图同步、数据迁移和发布按批准范围安排。
