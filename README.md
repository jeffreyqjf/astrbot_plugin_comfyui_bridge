# ComfyUI 工作台

AstrBot 插件，支持 QQ（aiocqhttp / OneBot V11）文生图、附图重绘、WAN 2.2 视频、手机工作台和自动回传。适用于 AstrBot 4.29.0+、Python 3.10+。插件 v3.25.0。

v3 新建任务按工作流选择本次启用的功能，支持 Advanced Gemma V40 的 RGB 区域遮罩与整套区域提示词预设。见[使用教程](user%20docs/REGIONAL_PROMPT.md)。

v3.7 新建任务的提示词预设支持长按预览效果图；任务队列点击「查看配置」可查看本次提示词、模型、LoRA 模型／CLIP 强度和节点参数。

简易添加的「人物遍历＋固定叠加」将所选 S／O 类 LoRA 固定叠加，每次搭配一个 C 类人物；未选人物时遍历全部 C 类。命令添加可独立选择预设所属用户。

管理侧边栏的「反推记录」自动保存后续成功反推的提示词和对应图片，长期保留、不设数量上限，支持分页、复制、原图查看和手动删除。

## 安装和上手

1. 在 AstrBot 插件管理中安装或更新 `astrbot_plugin_comfyui_bridge.zip`。
2. 在插件配置填写 ComfyUI 服务地址，同机默认 `http://127.0.0.1:8188`。ComfyUI 工作目录用于 Anima 画布、LoRA 和本机反推资源定位。
3. 保存并重载插件。打开插件详情中的创作工作台查看可用工作流和参数。
4. 在 QQ 发送 `/comfy help` 查看入口，或用 `/comfy wf check` 检查当前工作流。

```text
/comfy gen 一只窗边的猫
/comfy gen --wf i2i 改成水彩 --denoise 0.55
/comfy gen --wf lightning 镜头缓慢推进 --segments 2
/comfy prompt
```

重绘、图生视频和反推需要附图或回复图片。当前消息附图优先，默认第一张。生成选图用 `--image 2`，反推选图用 `/comfy prompt 2`。

## QQ 指令入口

| 指令 | 用法 |
| --- | --- |
| `/comfy gen` | 生成图片或视频，可用 `--wf` 指定工作流 |
| `/comfy prompt` | 反推，或用 `prompt preset` 管理个人预设 |
| `/comfy wf` | 列表、`use` 切换、`check` 检查、`reload` 重读 |
| `/comfy lora` | 随当前工作流查看 LoRA，可显式指定 `anima`、`wai`、`video` |
| `/comfy set` | 查看和修改 Anima T2I 当前会话设置 |
| `/comfy job` | 队列、取消、结果查询和补发 |
| `/comfy archive` | 图片归档和媒体收藏 |
| `/comfy help` | 总览，任意子指令加 `--help` 查看用法 |

各层指令都可加 `--help`，例如 `/comfy lora wai use --help`。查看单个工作流用 `/comfy gen --wf wai --help`，也可用 `/comfy wf wai --help`。`wai` 可换成简称、完整名称或 `/comfy wf` 里的编号。原有指令仍可用，完整示例见 [QQ 指令集](user%20docs/COMMANDS.md)。

## 内置工作流

Anima Detailer 已独立接入，支持图集参考图、遮罩、新建任务可选功能和 Anima LoRA。详见 [使用说明](user%20docs/ANIMA_DETAILER.md)。

MiniMax H3 的 `h3-v3` 是独立的 Seed Hunter v3 完整版，可在工作台配置原版采样、模型和生成分支。`h3` 和 `h3-final` 继续提供搜种与放大定稿。详见 [Seed Hunter 使用教程](user%20docs/MINIMAX_H3_SEED_HUNTER.md)。

| 简称 | 工作流 | 随包用途 |
| --- | --- | --- |
| `t2i` | Anima T2I | 文生图，支持修手、修脚、修脸、修眼及会话参数 |
| `i2i` | Anima I2I AIO | QQ 重绘、透明 PNG 遮罩和工作台增强分支 |
| `v40` | Advanced Gemma V40 | Illustrious 文生图、Gemma 提示词扩写、局部修复和后处理 |
| `anima-detailer` | Anima Detailer | Anima 参考图遮罩细化、手脸眼修复、Hires、In/Outpaint 和放大 |
| `detailer` | Detailer V40 | 参考图局部重绘、面部细化、可选修脚和网页遮罩编辑 |
| `wai` | WAI-Illustrious T2I | 文生图、独立 LoRA、放大重采样和 Union ControlNet |
| `sdxl` | SDXL Turbo | 单步文生图 |
| `wan-t2v` | WAN 2.2 T2V | 普通文生视频 |
| `wan-i2v` | WAN 2.2 I2V | 普通图生视频 |
| `svi` | WAN 2.2 SVI | 1–12 段图生视频，支持两或三阶段采样 |
| `lightning` | WAN 2.2 Lightning | 1–4 段图生视频，支持 GGUF 或 FP8 |
| `reverse` | Anima 反推流 | 用 `prompt` 调用 PixAI，可启用 TIPO 扩写 |

默认 Anima 自动按有无参考图选择 T2I 或 I2I AIO。`--wf t2i` 可明确只做文生图。`--wf t2v` 和 `--wf i2v` 先匹配当前选择，再用插件对应的视频默认值。工作台显示每个工作流实际保存的参数。模型权重及自定义节点需安装在 ComfyUI，详见 [模型与参数说明](user%20docs/CONFIGURATION.md)。

## LoRA 怎么选

- `/comfy lora anima` 和 `/comfy lora wai` 各按人物 C、风格 S、其他 O 编号，对应 `models/loras/anima/` 和 `models/loras/illustrious/`。在工作台「LoRA 编号」可从列表上方切换显示分类，点模型名称可调整归属分类、默认权重和附带提示词，也可在组内调整顺序。
- Anima T2I 或 WAI 可以用 `lora … use C1:0.85` 预约下一次，或用 `gen … --lora C1:0.85` 指定本次。Anima I2I AIO 在工作台配置 LoRA 槽位。
- `/comfy lora video` 查看 SVI 和 Lightning 的视频 LoRA，使用文件名。`--lora "3=high:文件名:0.8"` 给第 3 段附加高噪声 LoRA，`--stages 3,1` 按原段号顺序执行。省略时沿用工作台的逐段配置。

## 创作工作台与数据

工作台按工作流独立保存模型、节点参数、分支和固定种子设置。保存失败会在当前视口显示错误。尝试切换工作流时，右下角会列出未保存的改动并定位第一项，可点击其他项跳转，也可在弹窗中保存或放弃修改。任务队列可查看近期结果、提交无需 QQ 参考图的任务并按工作流设置 QQ 等待超时。

可用鼠标上下拖动「工作流」和「管理」里的按钮。松手后自动保存显示顺序，AstrBot 面板和远程工作台共用。

### V40 工作流与遮罩

在工作台选择 Advanced Gemma V40 或 Detailer V40，通过「分支开关」启用功能，再按分类调整参数。开启「显示旁路参数」可预先设置关闭中的分支。Advanced Gemma V40 默认文生图，Gemma 扩写需要本地 Gemma 4 权重。QQ 可用 `/comfy gen --wf v40 --feet on 1girl, full body --raw`。

在「管理 → 新建任务 → 简易添加」选 Detailer V40，从本地上传或从收藏选图。点击「编辑遮罩」，把要局部重绘的位置涂绿，应用遮罩后加入队列。支持画笔、橡皮、强度、硬度、撤销重做、反选、清空和缩放移动。遮罩按原图像素保存，可在提交前重复编辑。

QQ 可附图或回复图片并发送 `/comfy gen --wf detailer detailed face --raw`。默认执行遮罩重绘，再做面部细化。普通不透明图片的手绘遮罩为空，保留自动面部细化。两段采样参数可在工作台的 Detailer V40 参数页调整。

Detailer V40 和 Anima Detailer 的新任务保存输入原图与结果的关联。在新建任务从图集选图，修复完成后将满意的结果「移入高清」，所选原图也会从原图集移走，与结果在高清图集中成组展示。打开结果可对照修复前后、分别下载；本地上传或 QQ 附图也保存输入副本，仅在唯一匹配本会话图集原图时联动移动。旧结果不追溯补关联。

视频生成等选图窗口切换到「高清图集」后，可同时选择高清结果和标记「修复前原图」的低分辨率版本。打开结果，在输入原图下点击「解除关联」并确认，两张图即可独立整理；高清图集卡片支持单独删除结果，原图保留。批量结果逐张解除，不影响其他结果；上传输入或原文件已丢失时，解除前先保留输入快照。

两条 V40 的修脚均默认关闭。可在工作流的「局部修复 → 修脚」启用，也可在 QQ 指令加 `--feet on` 临时开启。使用 Impact Subpack 的 `models/ultralytics/bbox/foot_anime_yolo11m_v3.pt` 检测脚部，再以当前模型重绘检测区域。

### 手机访问

在「管理 → 新建任务 → 简易添加」选择视频工作流后，可以直接输入「视频时长（秒）」。留空使用工作流默认值。选图窗口和控制图集会分别恢复上次选择的图集或状态。

1. 在 AstrBot 插件配置的「手机远程工作台」中开启功能，设置 6 位随机数字或长口令，保存后重载插件。默认监听 `0.0.0.0:8790`。
2. 手机与电脑连接同一局域网或 VPN。在手机浏览器打开 `http://电脑实际IP:8790/`，输入工作台口令。若 Windows 防火墙拦截，只对受信任的局域网或 VPN 放行该 TCP 端口。
3. 在「管理 → 新建任务」选择「命令添加」或「简易添加」。命令添加可粘贴 `/comfy gen --wf wai watercolor landscape`，图生图或图生视频可从收藏缩略图选参考图，也可上传本地图片。两种添加方式都使用该工作流的「QQ 任务等待超时」设置。
4. 在「提示词预设」选择 QQ 用户，打开「提示词词库」，按中文、英文或分类查找标签。长按词条或加词按钮查看缩略图，也可点词名预览。用「＋正向」「＋负向」加入后，点击「保存预设」。保存后同一个 QQ 账号可直接用 `--preset` 调用。

独立工作台口令拥有参数、队列和各用户预设的管理权限。请通过受信任的局域网或加密 VPN 访问，避免将 HTTP 端口直接转发到公网。

在「简易添加」选择支持 LoRA 的工作流后，展开「LoRA」即可添加多个模型。每项强度可拖动滑条或输入数值。「叠加」会在同一张图上使用所选 LoRA。「逐个遍历」每张图使用一个 LoRA，留空会遍历目录内全部人物 LoRA，同一批次使用相同种子。

在「管理 → 导入导出」统一备份和恢复工作流 JSON 或 ZIP、指定用户的提示词预设、已保存的常用命令和 LoRA 附带词。工作流文件包含已保存的参数，ZIP 还包含 Anima T2I 画布。工作流和常用命令默认跳过同名项，可勾选覆盖。预设同名时逐项确认，LoRA 附带词按模型哈希合并。

「管理 → 导入导出 → 图集」可按状态分别下载生成图和控制图的整份原图 ZIP。生成图保留图集内的目录结构，导出范围为所选状态的全部原图。

每个工作流的「工作流配置」可将已保存的参数另存为「快速出图」「精细修复」等命名配置。选中即加载，「保存设置」同步更新所选配置。在「管理 → 导入导出 → 工作流配置」可备份和恢复配置。

在工作流的「命令简称」设置自己的 `--wf` 值。具备可接入采样模型的自定义文生图工作流，选择 LoRA 目录后即可用该简称查询、预约和扫图。提示词预设列表每页显示 12 条，翻页沿用全局编号，页间可用上下箭头移动预设。可从收藏选择效果图，列表显示小图，点开预览可查看原图。

工作流参数页会按可用宽度并排显示简短参数组，长文本和复杂选项各占一行。「调整参数布局」可拖拽分类和字段顺序，或用上下箭头调整后保存。新导入的自定义工作流按节点依赖生成初始顺序，后续同名导入和命名配置切换保留已保存的布局。

### ControlNet 选图与评价

在「管理 → ControlNet 配置」选择工作流和分支，可为不同控制类型保存模型文件、预处理器、分辨率、强度和生效区间。同一类型可保存多个预设。模型和预处理选项从 ComfyUI 读取，保存后在「新建任务」选类型与预设即可使用。文件格式和手动编辑方法见 [ControlNet 预设](user%20docs/CONFIGURATION.md#controlnet-预设)。

未配置预设的分支继续使用内置类型，包含 Advanced Gemma V40 的 OpenPose、Any（Canny 或 Depth），以及 Anima T2I 的深度 LLLite。命令添加根据解析出的工作流显示控制分支，例如 `/comfy gen --wf v40 全身像`。用 `sweep lora` 或 `sweep presets` 时，整批任务使用表单中同一组 ControlNet 设置。

- 电脑的 AstrBot 插件内嵌工作台显示「浏览 ComfyUI input」，在 Windows 主机上打开系统文件选择窗口，初始位置是 ComfyUI 的 input。非 Windows 主机使用网页选图。
- 手机和远程工作台显示「网页浏览」，在当前设备按原目录查看缩略图和选图。
- 「上传本地图片」打开当前设备的文件选择器，手机从手机选图。也可复用控制图集的图。重绘参考与遮罩使用各自的入口。
- 「从图集选图」可浏览收藏、Pass 和待评价的生成图，沿用各图集支持的分类、预设、工作流和 LoRA 筛选，以及 LoRA 全部匹配。点开缩略图预览后确认使用。直接使用模式也可选择匹配当前类型的控制图。选好后，参考图和控制图会在各自表单中按原比例显示小预览。

新产生的控制图保存到 `input/my_input/unevaluated`。对应生成图在待评价列表标出新控制图，打开预览可分别评价生成图与控制图。控制图集可在待评价、收藏和通过之间切换，也可选为后续任务的已处理图。同机 ComfyUI 默认读取工作目录的 `input`，自定义输入根可在插件设置填写实际绝对路径。

「管理 → 生成视频」可播放和删除视频。插件提交的视频工作流统一输出到 ComfyUI 的 `output/vedio/`。原有 `output/video/` 下的本机视频也可浏览。AstrBot 无法直接读取原片时，将视频保存到插件数据目录的 `outputs/vedio/`。

| 位置 | 内容 |
| --- | --- |
| [workflows/](workflows/) | 随包 API 工作流及其默认配置 |
| [templates/](templates/) | Anima T2I 同步画布、I2I AIO 参考画布、本机 WD14 辅助 API |
| 插件同级的 `prompt_library/` | 独立词库目录，存放 Prompt_Lib、旧词库和中文标签补全表 |
| AstrBot 的 `data/plugin_data/astrbot_plugin_comfyui_bridge/` | 实际使用的 API 图、面板设置、预设、会话选择和回传缓存 |
| ComfyUI 的 `user/default/workflows/` | 可编辑画布和手动导出的 API 图 |

升级时补齐缺失的随包工作流，日常设置保存在 AstrBot 数据目录。旧版内置工作流名称会按当前名称迁移，旧重绘图保存在 `workflow_backup/`。复制 ComfyUI 画布用于 QQ 时，先准备对应的 API 格式工作流。

### 提示词词库

词库独立于插件保存。在 AstrBot 插件配置的「词库与提示词」中填写「提示词词库路径」，保存并重载插件。可以填写包含 `Prompt_Lib/`、`builtin.json` 和中文补全表的上层目录，也可以直接填写含有 `dict/`、`dictnsfw/`、`preview/` 的 Prompt_Lib 目录。相对路径以插件代码目录为起点。

路径留空时先找插件同级的 `prompt_library/`，同级目录缺失时兼容旧版插件内的词库。工作台会显示实际使用的主词库路径。词库文件有改动时，点「重新读取词库」即可刷新。

把补充词库复制到网页显示的「补充词库目录」（AstrBot 的 `data/plugin_data/astrbot_plugin_comfyui_bridge/prompt_library/`），再点「重新读取词库」。文件保存在插件数据目录，更新插件不会覆盖。支持：

- 魔导书文件夹或 ZIP：根目录下放 `dict/*.txt`，可另放 `dictnsfw/*.txt` 和 `preview/`。词条格式为 `中文=英文`；示例图以英文标签命名，支持 JPG、PNG、WebP。ZIP 内可以有一层外包装目录。RAR 先解压再复制文件夹。
- 中文补全 CSV：每行四列，依次为英文标签、分类、使用量、中文。也支持 `builtin.json` 格式的分组词库。

词库文本使用 UTF-8。网页仅在查看预览时读取示例图。

## 预设、归档与回传

- 私聊用 `/comfy prompt preset` 管理个人预设。工作台用户预设库可导入 JSON，同名预设可选择保留哪一份。生成时用 `--preset`，并可追加本次描述。
- 生成图进入 ComfyUI 输出目录的 `unevaluate/SFW` 或 `unevaluate/NSFW`。工作台「待评价图片」默认显示最早的 5 个待评价任务，收藏或跳过后移入 `favourite` 或 `pass`，下一项任务自动补位。
- 手动放入 `unevaluate` 的 PNG、JPEG、WebP 和 GIF 也可在工作台评价。放在 `NSFW` 子目录的图片归为 NSFW，其余默认 SFW。
- 「收藏图集」和「Pass 图集」按分类分页显示 WebP 缩略图。点开原图可在两个图集之间移动图片。生成图和控制图预览右上方的向下箭头可下载原图。「生成缺失缩略图」会扫描当前生成图集，包括手动放入的图片，并跳过已有缩略图。在 QQ 回复生成图并发送 `/comfy archive fav`，会收藏该图，并跳过同一用户在本会话中排在它前面的待评价图片。
- 「待评价图片」「收藏图集」和「Pass 图集」共用筛选入口。预设、工作流和 LoRA 可多选，跨类取交集。筛选项使用圆角标签，选中以紫色显示；预设不显示所属用户，同名项只附短编号区分，选图弹窗沿用相同样式。勾选「匹配所有已选 LoRA」可要求同一张图含全部所选 LoRA。原图预览提供前后箭头和页码跳转。点开图片可查看生成信息，再点击预设名可打开当前预设，改名或调整编号后仍可定位。
- 待评价图片和 Pass 图集可删除归档原图，点击后先确认。
- 「新建任务」的命令表单内置扫图、LoRA 选择和生成模板。保存的模板由同一 AstrBot 实例的工作台共享，可编辑或删除。
- 「任务队列」可取消全部插件任务。运行中的任务逐项向 ComfyUI 确认取消。
- 固定一组 LoRA 遍历预设用 `/comfy sweep presets --wf wai --lora "C1:0.85,S1"`。让多个预设分别遍历人物 LoRA 用 `/comfy sweep lora --wf v40 --preset 1,2 雨夜街头`。可把 `v40` 换成已配置人物 LoRA 目录的工作流简称。任务追溯记录写到 `generation_metadata/`。
- 生成请求先返回短任务 ID。任务完成后自动回传图片或视频，用 `/comfy job result` 查询或重试失败回传。
- 图片与视频分别有超时及下载上限。AstrBot 会按保留期限清理回传缓存，ComfyUI 原始输出由 ComfyUI 管理。

## 自然语言与扩展

启用支持工具调用的聊天模型后，可用自然语言绘图、重绘、做视频、反推和查结果。插件提供 `comfyui_list_workflows`、`comfyui_execute`、`comfyui_query_wait`、`comfyui_reverse_prompt` 和 `comfyui_anima_state`。可在工作台编辑绘图人格，详见 [参数与权限](user%20docs/CONFIGURATION.md)。

自定义 API 工作流放入插件数据目录的 `workflows/`，然后用 `/comfy wf reload` 重新读取。通常可自动识别正负提示词、种子和参考图。复杂图可在高级配置中显式填 `node_mappings`。

## 常见问题

- 工作流缺少节点或模型时，先用 `/comfy wf check wai`（将 `wai` 换成目标工作流），再到工作台核对节点和模型文件名。
- PixAI 反推需要本机 ComfyUI 提供 PixAITaggerPlus。开启 TIPO 扩写时，还要确认本机已加载 TIPO 节点，且 GGUF 模型位于 `models/kgen/`。也可关闭工作台里的「启用 TIPO 扩写」继续用 PixAI 标签。
- 视频执行超时时，在工作台为该工作流设置「QQ 超时」。回传失败可用 `/comfy job result 短ID` 补发。重载插件会结束当前后台回传，旧任务 ID 随之失效。

## 开发与验证

插件入口为 `main.py`。内部代码在 [bridge/](bridge/)，其中 `workflows/` 管理工作流，`qq/` 处理 QQ 指令和消息，`studio/` 提供网页工作台。使用文档在 [user docs/](user%20docs/)，页面资源在 [views/workbench/](views/workbench/)。

- 生成安装 ZIP：`python build_zip.py`。
- 回归测试使用 `python -m unittest discover -s tests`。
- 隔离安装验证先用 `python build_zip.py --output <ZIP 路径>` 打包，再在 AstrBot 的 Python 环境运行 `python tests/check_astrbot_runtime.py --astrbot-core <AstrBot core 路径> --archive <ZIP 路径>`。

[QQ 指令集](user%20docs/COMMANDS.md) · [模型与参数说明](user%20docs/CONFIGURATION.md)
