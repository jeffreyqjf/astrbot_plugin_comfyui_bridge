# AstrBot ComfyUI Bridge 维护指南

本文件给修改插件或配套 ComfyUI 工作流的 AI 和维护者使用。先读本文件，再按任务查阅 [README](README.md)、[QQ 指令集](docs/COMMANDS.md) 和 [模型与参数说明](docs/CONFIGURATION.md)。用户本轮明确提出的要求优先。修改 ComfyUI 文件时，另读 `G:\ComfyUI\AGENTS.md` 和目标目录下适用的说明。

## 开始前核对

- 分别查看插件和 ComfyUI 的工作区状态。保留现有改动，按本轮任务选择最小修改范围。下文路径对应当前电脑，新会话先确认运行实例和实际配置。
- 先确认目标是哪条工作流、当前 QQ 入口、是否需要参考图、需要暴露哪些参数，以及要更新源码、随包工作流还是本机正在使用的副本。
- 画布、API 图、插件运行配置各自独立。遇到「面板正常、QQ 行为没变」或「更新后还是旧图」时，优先核对运行副本和配置覆盖。

| 位置 | 用途 |
| --- | --- |
| `D:\QQbot\插件\astrbot_plugin_comfyui_bridge\` | 插件源码、随包图、测试和维护文档 |
| `G:\ComfyUI\user\default\workflows\` | ComfyUI 用户画布。现有原始画布多在 `main\` 和 `WAN2.2-N\`，适配版在 `AstrBot\`，手动导出的 API 图在 `api\` |
| 插件 `bridge/` | 内部 Python 模块，按工作流、QQ 和网页工作台归类 |
| 插件 `docs/` | 指令、配置说明和参考资料 |
| 插件 `workflows/` | 随包运行的 API 图或带 `prompt`、`astrbot` 的配置文件，使用规范文件名 |
| 插件 `templates/` | Anima T2I 同步画布、I2I AIO 参考画布、本机 WD14 辅助 API |
| AstrBot 实例 `core\data\plugins\astrbot_plugin_comfyui_bridge\` | 本机已安装的插件代码 |
| AstrBot 实例 `core\data\plugin_data\astrbot_plugin_comfyui_bridge\` | 实际运行的 `workflows\`、面板设置、LoRA 顺序与附带词、预设、任务回传缓存等 |
| AstrBot 实例 `core\data\config\astrbot_plugin_comfyui_bridge_config.json` | 本机插件配置。检查所需字段即可，凭据保留在本机 |

本机 AstrBot Launcher 实例位于 `%USERPROFILE%\.astrbot_launcher\instances\`，开发测试可使用该实例的 `venv\Scripts\python.exe`。默认 ComfyUI 地址为 `http://127.0.0.1:8188`，以本机插件配置为准。

## QQ 指令怎么加

1. 优先放进已有分组。`gen` 生成，`prompt` 反推与提示词预设，`wf` 管理工作流，`lora` 管理 LoRA，`set` 设置 Anima T2I 会话参数，`job` 管理任务，`archive` 归档和收藏，`help` 查看用法。新模型优先用 `/comfy gen --wf 简称` 接入。`/绘图`、已有短命令和旧参数继续兼容。
2. 在 [qq_commands.py](bridge/qq/qq_commands.py) 的 `route_command` 处理路由，按需补 `TOPICS`、`SUBCOMMAND_HELP` 和 `WORKFLOW_HELP`。各层都支持 `--help`，例如 `/comfy archive fav --help` 和 `/comfy gen --wf wai --help`。帮助沿用插件全局权限，查看时不执行对应操作。操作专属权限由实际指令处理器校验。
3. 在 [main.py](main.py) 的 `command` 接业务。生成类选项由 `OPTION` 和 `parse_generation` 统一解析，兼容 `--参数 值` 与 `--参数=值`。带空格的参数使用英文引号。把解析后的值交给对应工作流校验，只覆盖用户指定的字段。会话或面板默认值由原来的路径解析。
4. 更新 [COMMANDS.md](docs/COMMANDS.md) 和相关帮助。用户能从工作台或 AI 工具看到的命令示例也一起核对。新增工作流简称在 [workflow_store.py](bridge/workflows/workflow_store.py) 登记，文件名和已有别名作为兼容入口。
5. 在 [qq_messages.py](bridge/qq/qq_messages.py) 保持任务回执简短。显示工作流、8 位任务短 ID、实际生效的 LoRA 和已启用的修手、修脚、修脸、修眼等功能。步数和图片尺寸留在工作台。图片回传的 `ID … · 图 N` 用于收藏定位，调整文案时一并检查引用旧图、批量回传和补发。

图生图、图生视频和反推复用 [reference.py](bridge/qq/reference.py)。生成优先取本条消息的附图，再取引用图。`--image N` 从 1 开始。反推使用位置参数，收藏只取引用的图片。OneBot 补取引用消息、上传到 ComfyUI 和回传结果各走已有路径。

## 接入或修改 ComfyUI 工作流

1. **保留来源。** 先复制原始画布到 `AstrBot\`，按 `<模型>_<用途>_AstrBot.json` 命名或沿用该模型既有规范。除非用户要求同时更新原画布，否则把 QQ 适配放在副本。新功能优先改画布和插件适配层。修改 ComfyUI 核心或第三方节点时，按其独立规则处理。
2. **确定节点契约。** 先标出正向词、负向词、种子、参考图及最终输出对应的节点和字段。保留稳定的节点 ID。变更 ID 或连线时，同步核对代码映射、工作台和 API 图。模型、CLIP、VAE、自定义节点与可选分支以本机实际安装为准。遇到「节点不可用」，先用本机 `/object_info/<节点类名>` 核对节点是否注册、字段是否变化，以及下拉项是否包含所需模型。
3. **导出 API。** 通过 ComfyUI 导出 API 格式，核对 `class_type`、`inputs` 和连线。`api\` 中的手动导出可用 `_API.json` 后缀，插件 `workflows/` 文件名主体就是工作流名称。Anima T2I 的旁路分支由 [anima_settings.py](bridge/workflows/anima_settings.py) 和 [anima_export.py](bridge/workflows/anima_export.py) 从画布导出，输出通常是 `#510`，需要用该工作流的同步逻辑保留分支与已保存的覆盖。
4. **先试通用加载。** 自定义 API 图可以导入工作台或放到插件数据目录的 `workflows/`。[workflow.py](bridge/workflows/workflow.py) 负责识别输出及常见的提示词、种子和参考图字段，歧义用 `node_mappings` 明确。工作台由 [workflow_fields.py](bridge/workflows/workflow_fields.py) 与 [studio_settings.py](bridge/studio/studio_settings.py) 结合 `/object_info` 展示字面输入。已连线的输入由上游节点控制。字段可编辑性和可选项以本机节点定义为准。
5. **复杂图加专用逻辑。** 多采样阶段、可选分支、多个 QQ 输入候选或逐段 LoRA，参考对应模型的现有实现。维护者在适配时明确参数语义，QQ 单次选项只暴露有明确映射的参数。普通模型导入后走通用流程。工作流的自动帮助与工作台字段自动发现分开考虑。
6. **核对三个副本。** ComfyUI 画布、本次导出的 API 和插件实际运行的图应实现相同功能。`/comfy wf reload` 重读插件数据目录中的 API 图。随包图在初始化时补齐缺失项。更新已有运行图时，先用工作台导出备份，再按需合并图或显式导入覆盖，保留已保存的节点值、工作流前缀、分支、超时和 LoRA 设置。

| 工作流 | 维护入口和容易漏掉的检查 |
| --- | --- |
| `t2i` · Anima T2I | `anima_settings.py`、`anima_export.py`、画布和模板。同步校验开关、分支连线、检测器及回执。修脚对应分支 123 和 `foot_anime_yolo11m_v3.pt` |
| `i2i` · Anima I2I AIO | `anima_aio.py`。QQ 使用参考图，工作台支持无图。核对降噪、整图与遮罩路径、LoRA 槽和增强分支 |
| `wai` · WAI-Illustrious | `illustrious.py`。独立 LoRA 目录。`--controlnet-type` 对应 Union ControlNet，需启用放大后重采样和重采样 ControlNet |
| `sdxl` · SDXL Turbo | 通用文生图路径。核对正负提示词、种子及实际输出节点 |
| `wan-t2v` / `wan-i2v` · 普通 WAN | `--wf t2v/i2v` 会走当前同类或配置默认。用 `wan-t2v/wan-i2v` 精确指定随包图。图生视频检查 QQ 读图，高低噪声采样检查步数衔接 |
| `svi` / `lightning` · 分段视频 | `svi.py`、`lightning.py`。检查选段顺序、续写衔接、按段覆盖、FP8/GGUF、视频输出和可选插帧 |
| `reverse` / WD14 | `/comfy prompt` 用 PixAI，可选 TIPO。`/comfy prompt wd14` 使用本机辅助 API 模板。分别验证输出文字、模型、参考图序号 |

## 需要保留的行为

- **LoRA 分族。** Anima 使用 `models/loras/anima/`，Illustrious 使用 `models/loras/illustrious/`。目录编号、排序、待用预约和附带词分别处理。增加新模型族时，从 [lora_settings.py](bridge/lora_settings.py) 和工作台族注册处扩展。当前工作流决定 `/comfy lora` 的默认目录，显式目录可随时切换。图片的单次 LoRA 优先于预约。只有实际采用预约的任务成功受理后才消耗。
- **视频 LoRA 按原段号。** `--stages 3,1` 用原段号决定执行顺序。`--lora "3=high:文件名:0.8"` 按段覆盖，可重复指定不同段，兼容 `--stage-lora`。SVI 和 Lightning 有各自的阶段限制。`--lora off` 清空这次的逐段附加项，全局模型 LoRA 仍按图配置。工作台与 QQ 共用同一解析和校验逻辑。
- **队列和超时。** [service.py](bridge/service.py) 管任务状态、所有者和超时，[client.py](bridge/client.py) 管 ComfyUI API 和媒体下载。保留 QQ 每个工作流的持久超时覆盖，以及图片、视频各自的默认值。取消限于对应任务，继续使用按任务取消的接口。受理、生成完成、回传成功分别记录，补发只处理未确认的媒体。
- **归档和收藏。** [image_archive.py](bridge/image_archive.py) 管标签归档与 `Favorites`。`/comfy archive fav` 通过引用、发送者和任务记录定位原图。移动前校验路径、所有权和内容，重试时避免覆盖同名文件。跨盘先完整复制并校验，之后移除源文件。收藏目录通过插件设置 `favorites_directory` 指定，留空用本机 `output/Favorites/` 或插件 `outputs/Favorites/`。
- **工作台和持久数据。** 修改设置时要兼容现有 JSON。读写工作流配置复用 `workflow_store.py` 的路径校验和原子写入，ZIP 导入导出复用 [workflow_archive.py](bridge/workflows/workflow_archive.py)。控件保存失败应在当前视口可见。新增可编辑节点参数优先复用现有 schema 渲染，按所需节点查 schema，避免给每次打开工作流增加全量扫描。

## 验证和交付

- 按改动实际验证。指令改动覆盖正常输入、帮助和兼容别名。工作流改动至少核对输出可达、必要节点、映射、参考图和本次覆盖。新增分支同时验证启用与关闭，视频验证至少单段和非顺序多段。使用本机 ComfyUI 时，优先做轻量检查，必要时再跑实际生成。
- 日常检查在插件根目录运行。按项目依赖使用 Python 3.10+。本机也可用 ComfyUI 环境的 `ruff.exe`。

```powershell
ruff check .
git diff --check
python -m unittest discover -s tests -p test_bridge.py
python build_zip.py
python tests/check_astrbot_runtime.py --astrbot-core "<本机 AstrBot 实例的 core 路径>"
```

- `test_bridge.py` 用本机模拟服务检查插件行为。`check_astrbot_runtime.py` 用真实 AstrBot 在隔离目录加载 ZIP。分别说明自动测试、真实 ComfyUI 生成和 QQ 实际投递验证到了哪一步。
- 功能发布时按要求更新 `metadata.yaml` 和相关用户文档。`build_zip.py` 使用运行文件白名单，新增模块、模板或前端资源时核对是否进包。测试和本维护指南留在源码目录。
- 用户要求更新本机时，先检查安装目录是否有独立改动，核对后再同步本次涉及的文件并验证版本。插件重载负责应用 Python 代码和配置，`/comfy wf reload` 用于重读工作流。报告本机文件已同步、插件是否已重载，以及运行图是否已更新。

