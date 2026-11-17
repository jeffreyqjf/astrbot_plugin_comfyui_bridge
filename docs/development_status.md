# 开发状态

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
