# AstrBot ComfyUI Bridge 配置说明

适用插件 v2.12.0。表中的工作流节点和参数以随包 API 图为基准。插件面板的全局配置、工作台里的工作流参数、QQ 会话设置是不同层级。在本机保存后以实际值为准。

## 1. 插件面板的全局配置

面板按「连接与权限」「默认工作流」「词库与提示词」「手机远程工作台」「任务队列与超时」「媒体回传与归档」「AI 绘图工具」「高级设置」分块。升级后，插件首次启用时会把旧版配置迁入对应区块。表中的配置键是区块内的字段名。

### 连接、权限与默认工作流

| 面板名称 | 配置键 | 默认值 | 含义 |
| --- | --- | --- | --- |
| 启用 ComfyUI 工作台 | `enabled` | 开 | 控制 QQ 指令、AI 工具和工作台提交任务。关闭后仍可登录工作台查看或编辑配置。 |
| ComfyUI 服务地址 | `comfyui_url` | `http://127.0.0.1:8188` | 插件访问 ComfyUI API 的基地址。用 HTTP 或 HTTPS，填写服务地址。账号密码、查询参数和 URL 片段不能写进地址。PixAI 和本地 WD14 反推要求主机名为 `127.0.0.1`、`localhost` 或 `::1`。 |
| 认证令牌 | `api_token` | 空 | 填写后通过 `Authorization: Bearer …` 发给 ComfyUI 或其反向代理。普通本机服务可留空。 |
| 默认工作流名称 | `default_workflow` | `Anima_T2I_AstrBot` | 没有显式指定、且当前用户在当前会话没有有效选择时使用。默认 Anima 无图走 T2I，有附图或引用图走 I2I AIO。名称使用 JSON 文件名主体。源码在配置键完全缺失时会回退到 `SDXL_Turbo_T2I_AstrBot`。 |
| Anima 画布所在的 ComfyUI 目录 | `anima_workspace` | `G:\ComfyUI` | AstrBot 所在机器可访问的 ComfyUI 目录。用于读取 Anima 画布并调用该目录的 Python 导出分支，也用于扫描 Anima LoRA、检查本地反推和增强模型。此路径与上面的 API 地址分别配置。 |
| 旧版归档与视频收藏文件夹路径 | `favorites_directory` | 空 | 留空使用本机 ComfyUI 的 `output/Favorites/`，本机输出目录不可用时使用插件数据目录下的 `outputs/Favorites/`。填写 AstrBot 所在电脑的完整路径可覆盖默认值，重载后生效。 |
| 文生视频默认工作流 | `default_t2v_workflow` | `WAN22_T2V_AstrBot` | `/comfy gen --wf t2v` 没有指定工作流，且当前选择不是文生视频时使用。 |
| 图生视频默认工作流 | `default_i2v_workflow` | `WAN22_I2V_AstrBot` | `/comfy gen --wf i2v` 没有指定工作流，且当前选择不是图生视频时使用。随包工作流需要当前消息或引用消息的图片。 |
| 启用自然语言图片与视频工具 | `enable_llm_tools` | 开 | 允许当前聊天模型调用插件工具，包括生成、工作流查询、反推、任务查询和 Anima 会话设置。聊天模型需支持工具调用。关闭后仍可使用 QQ 指令和工作台。 |
| 仅限 AstrBot 管理员使用 | `admin_only` | 关 | 开启后，QQ 指令和 AI 工具按 AstrBot 的管理员身份检查。面板工作台用 AstrBot 登录，独立工作台用独立口令。 |
| 启用手机远程工作台 | `remote_studio_enabled` | 关 | 打开并设置口令后，重载插件启动独立网页。 |
| 远程工作台监听 IP | `remote_studio_host` | `0.0.0.0` | 监听本机各 IPv4 地址。也可填具体局域网或 VPN 地址以限制入口。 |
| 远程工作台端口 | `remote_studio_port` | `8790` | 取值 1024–65535。手机访问时使用电脑实际 IP 和本端口。 |
| 远程工作台独立口令 | `remote_studio_token` | 空 | 使用 6 位随机数字，或 24–128 位字母、数字、下划线或连字符。5 分钟内输错 5 次后，新的登录需等到最早一次错误满 5 分钟。 |

### 提示词

| 面板名称 | 配置键 | 默认值 | 含义 |
| --- | --- | --- | --- |
| 提示词词库路径 | `prompt_library_directory` | 空 | 留空查找插件同级的 `prompt_library/`。也可指定绝对路径或相对插件代码目录的路径。保存后重载插件。 |
| 指令描述自动整理成英文提示词 | `translate_command_prompt` | 开 | 生成类 QQ 指令会把当次描述整理成英文。已经保存的预设原样拼接，工作台直接提交原文。单次用 `--raw` 跳过整理，整理失败时提示并使用原文。 |
| 提示词整理模型 ID | `prompt_provider_id` | 空 | 填 AstrBot 已配置的提供商 ID。留空时使用当前会话的聊天模型，专用于上述指令整理。 |
| 全局正向提示词前缀 | `positive_prefix` | 空 | 追加到插件提交的图片和视频正向提示词前。工作流自己的前缀与插件补入的 LoRA 触发词还会继续叠加。 |
| 提示词整理超时 | `prompt_timeout` | 30 秒 | 等待整理模型返回的最长时间，范围 2–120 秒。 |

### 请求、队列与回传

整数配置超出表内范围时会被限制到边界，无法转为整数时采用默认值。改了服务地址、令牌、请求超时、并发或文件大小上限后，重载插件以重建连接和运行配置。

| 面板名称 | 配置键 | 默认值 / 范围 | 含义 |
| --- | --- | --- | --- |
| 单次网络请求超时 | `request_timeout` | 20 秒 / 2–120 | 单次访问 ComfyUI API 的时间上限，覆盖提交、上传、轮询或下载等请求。 |
| ComfyUI 排队与执行总超时 | `generation_timeout` | 500 秒 / 5–3600 | 图片和反推提交成功后，等待 ComfyUI 排队与执行的时间。插件本地等候执行位置、参考图上传和结果下载各走自己的流程。 |
| 视频排队与生成总超时 | `video_generation_timeout` | 1500 秒 / 5–7200 | 视频提交成功后等待 ComfyUI 排队与执行的时间。 |
| 本地反推任务的队列等待上限 | `queue_timeout` | 120 秒 / 5–3600 | WD14 或 PixAI 反推等待插件执行位置的时间。已受理的普通生成任务在插件队列中等候空位。 |
| 并发执行任务数 | `max_concurrent` | 1 / 1–4 | 同时持有插件执行位置的任务数。生成与反推共享执行位置。 |
| 最多受理任务数 | `max_pending` | 16 / 1–128 | QQ 和工作台共享的生成队列容量，包含等待和运行中的生成任务。工作台一次提交的生成批次也受此值和剩余位置限制。 |
| 按工作流设置队列上限 | `workflow_queue_limits` | `{}` | 例如 `{"wai": 12, "lightning": 4}`。每个工作流和插件总队列都必须有空位。 |
| AI 按任务 ID 查询时的等待秒数 | `tool_wait_seconds` | 20 秒 / 1–45 | AI 工具带任务 ID 查询时，可在该时限内等待回传。查询最近任务会立即返回当前状态。 |
| 单任务最多回传图片数 | `max_images` | 4 / 1–16 | 每个任务最多下载并回传几张图片。工作流的 `batch_size` 控制实际生成数量。 |
| 单任务最多回传视频数 | `max_videos` | 1 / 1–4 | 每个任务最多下载并回传几个视频。 |
| 单个视频下载大小上限 | `max_video_mb` | 100 MiB / 1–1024 | 每个视频文件的下载上限，按 1024² 字节换算，视频会流式写入缓存。聊天平台可能有自己的上限。 |
| 单张下载图片大小上限 | `max_image_mb` | 20 MiB / 1–100 | 同时限制单张结果图片下载和单张参考图片上传。 |
| 本地回传图片缓存保留小时数 | `output_retention_hours` | 24 小时 / 1–720 | 清理插件在 `outputs/` 中写入的过期回传缓存。新视频在 `vedio/` 中保留，可通过「管理 → 生成视频」删除。 |

### 节点映射

| 面板名称 | 配置键 | 默认值 | 含义 |
| --- | --- | --- | --- |
| 高级：按工作流名指定节点映射 | `node_mappings` | `{}` | JSON 对象，外层是工作流名称，内层指定插件要写入的节点字段。模板工作流已经预设映射或可自动识别。改了复杂文本链、种子源或参考图入口时才需要填写。保存后重载插件。 |

| 映射项 | 含义 |
| --- | --- |
| `positive` | 写入正向提示词的字符串字段。可有多个，例如正向条件分支共用同一提示词。 |
| `negative` | 写入负向提示词的字符串字段。省略本次负向词时保留工作流内容。正负映射须分开。 |
| `seed` | 写入本次统一种子的字段。WAN 两个采样阶段共享同一个种子值。 |
| `image` | 显式选中聊天参考图要替换的 `LoadImage.image`。普通自定义工作流一次选择一个替换入口。 |
| `optional_image` | 在没有普通 `image` 输入时，选取实际连接到输出的可替换参考节点。Anima T2I 用它定位 `21.image` 和 `129.image`，启用两个分支时可共享选中的图。实际是否必填由参考图来源和工作流决定。 |

数组项用 `节点ID.输入字段` 表示，例如 `{"SDXL_Turbo_T2I_AstrBot":{"positive":["29.string"],"negative":["7.text"],"seed":["13.noise_seed"]}}`。字段须出现在当前工作流连接到输出的路径上。普通工作流先自动追踪 CLIP 文本、`seed` / `noise_seed` 和 `LoadImage`。Anima T2I 的自定义映射按键覆盖内置映射，其他工作流的自定义映射以该工作流对应对象为准。

[全局配置定义](../_conf_schema.json) · [任务和队列实现](../bridge/service.py) · [API 请求与大小限制](../bridge/client.py) · [节点识别规则](../bridge/workflows/workflow.py)

## 2. 工作流清单

下表的 `#数字` 是 ComfyUI API 节点 ID，可在工作台按编号搜索。正向词、参考图和种子等入口由插件在提交时按映射填写。

| 简称 | 工作流文件名主体 | 主要入口与输出 |
| --- | --- | --- |
| `t2i` | `Anima_T2I_AstrBot` | 正向 `504.text`，负向 `507.text`，种子 `50.seed`，可选参考 `21.image` / `129.image`，保存节点 #510。 |
| `i2i` | `Anima_I2I_AIO_AstrBot` | 正向 `1610.String`，负向 `1611.String`，种子 `118.seed`，参考图 `1608.image`，保存节点 #1649。 |
| `wai` | `WAI-Illustrious_T2I_AstrBot` | 正向 `98.text`，负向 `100.text`，主种子 `109.value`，保存节点 #37。 |
| `sdxl` | `SDXL_Turbo_T2I_AstrBot` | 正向 `29.string`，负向 `7.text`，种子 `13.noise_seed`，输出 #27。 |
| `wan-t2v` | `WAN22_T2V_AstrBot` | 正负 `4.text` / `5.text`，种子 `10.noise_seed` / `11.noise_seed`，空视频 latent #7，输出 #14。 |
| `wan-i2v` | `WAN22_I2V_AstrBot` | 正负和种子与普通 T2V 一致，图片入口 `15.image`，输出 #14。 |
| `svi` | `WAN22_SVI_I2V_AstrBot` | 正负 `901.value` / `902.value`，种子 `900.value`，QQ 图片入口 `62.image`，输出 #512。 |
| `lightning` | `WAN22_Lightning_Long_I2V_AstrBot` | 正负 `901.value` / `902.value`，种子 `900.value`，QQ 图片入口 `97.image`，输出 #1039。 |
| `reverse` | `Anima_Reverse_AstrBot` | `/comfy prompt` 调用。图片 `398.image` → PixAI #416 → 标签处理 #443，可加 TIPO #400 与拼接 #444，输出 #445。 |
| — | `templates/Anima_WD14_Caption_AstrBot.json` | `/comfy prompt wd14` 调用。#1 接收参考图，#2 运行 AstrBotLocalTagger，#3 输出文字。 |

在 QQ 用 `/comfy wf` 查看简称和编号，`/comfy wf wai --help` 查看对应工作流的输入、指令参数和示例。`/comfy gen --wf t2v` 和 `--wf i2v` 先尝试当前同类视频工作流，再用插件面板配置的对应默认值。指定 `wan-t2v` 或 `wan-i2v` 可直达随包的普通 WAN 2.2 流程。

插件从 AstrBot 数据目录的 `plugin_data/astrbot_plugin_comfyui_bridge/workflows/` 读取运行用的 API JSON。启动时只补齐缺失的随包文件。ComfyUI 中的画布 JSON 用于编辑，供插件运行时须导出为 API 格式。Anima T2I 优先使用 ZIP 导入的画布，其次读取 ComfyUI 工作流目录中的画布，最后使用随包画布。旧版重绘文件迁移至数据目录的 `workflow_backup/`。


## 3. 工作台的共用选项

| 选项 | 含义 |
| --- | --- |
| 正向提示词前缀 | 单个工作流的前缀，最多 4000 字符。实际拼接顺序为工作流前缀、适用的 LoRA 附带词、全局前缀、本次正向提示词。使用预设时，本次正向内容先由预设加补充组成。 |
| 使用面板里的固定种子 | 开启时，省略单次种子的任务使用工作流映射到的第一项种子。关闭时默认随机。QQ `--seed -1` 强制随机，`--seed 0` 有效，非负数上限为 `9223372036854775807`。工作台一次提交多批任务时，各任务随机取种子。 |
| 负向提示词 | 编辑工作流默认负向。QQ `--negative "…"` 覆盖本次，`--negative ""` 清空本次。工作台队列和 AI 工具的空负向会沿用预设或工作流。 |
| 图片来源（Anima T2I） | `qq` 只用本次附图或引用图。 `auto` 优先 QQ，缺图时读面板指定素材。 `local` 使用面板中的素材。QQ 优先取当前消息的附图，没有才看引用，`--image N` 从 1 开始。I2I AIO 重绘与 WAN I2V 有独立的 QQ 输入路径。 |
| 显示旁路分支的参数 | 在 Anima T2I 编辑器显示可识别的已旁路节点控件，便于预先配置，分支接入后才生效。 |
| 查找参数 | 按标题、字段或节点 ID 过滤本页列表。 |
| 分支与模型 / 检查全部分支 | 逐个尝试导出对应分支，检查节点和模型、素材是否可用。 |
| 工作流配置 | 选择命名配置后立即加载。「保存设置」会同时写入当前参数和所选配置。Anima T2I 同时保留画布和旁路参数。配置仍可重命名，并在「管理 → 导入导出」下载或恢复。 |
| 命令简称 | 每个工作流可设置 1–32 个字符的简称，以英文字母开头。原有内置简称可继续使用。可在 `gen --wf`、`wf use`、`lora --wf` 和 `sweep lora --wf` 中指定。 |
| 保存设置 / 同步 ComfyUI 画布 | 保存更新的是插件数据目录里的 API 图和工作流配置。同步会重新从画布导出，再应用面板保存的分支与字段覆盖。 |

节点字段来自当前 ComfyUI 的 `/object_info` 和已保存的 API 图。下拉选项及数值范围由相应节点提供。已经连线的输入由上游节点控制，面板通常只显示原有的可编辑字面值。画布的便签、对比预览和浏览器专用控件按 ComfyUI 画布使用。

## 4. Anima T2I

随包主采样为 **1024 × 1536、批量 1、30 步、CFG 4、`er_sde`、`simple`、降噪 1.0**。随包模型是 `anima-aesthetic-v1.1.safetensors`、`qwen_3_06b_base.safetensors` 和 `qwen_image_vae.safetensors`。分支以工作台已保存的设置为准。

### 基础与采样参数

| 节点或字段 | 含义 |
| --- | --- |
| #22 `unet_name` / `weight_dtype` | 扩散模型与加载精度。 `default` 使用 ComfyUI 对该模型的默认策略。 |
| #40 `clip_name` / `type` / `device` | 文本编码器权重、加载类型与设备策略。 |
| #48 `vae_name` | 在图像和 latent 之间编码、解码的权重。 |
| #67、#74、#77 的 `value` | 分别是生成宽度、高度和单任务的图像批量。 |
| #50 `seed` / `steps` / `cfg` | 噪声种子、主采样步数、文本引导强度。 |
| #50 `sampler` / `scheduler` / `denoise` | 采样算法、噪声时间表、采样从哪个噪声水平开始。无参考图的默认降噪是 1.0。小于 1 会跳过开头的高噪声阶段，和用参考图重绘的效果不同。 |
| #51 `steps` / `denoise` | 启用二次采样后的额外步数和重绘幅度。 |
| #52 `strength` | Differential Diffusion 强度，用于工作流里接入该模型路径的遮罩细化。 |
| #507 `text`、#504/#507 `multiline_mode` | 默认负向词，以及通配词节点的多行模式。正向 #504 的文字由当次任务写入。 |
| #26 `loras`、#65 `toggle_trigger_words` | 沿用画布时，分别是画布 LoRA 列表和触发词列表。列表行的 `name`、`active`、`strength`、可选 `clipStrength` 表示模型、启用状态和权重强度。 `group_mode`、`default_active`、`allow_strength_adjustment` 控制画布触发词节点的分组、默认选中与强度调整。 |
| #78 `delimiter` 与 #82 `regex_pattern` / `replace` / `case_insensitive` / `multiline` / `dotall` / `count` | 文本拼接的分隔符，以及拼接结果的正则清理。字段依次是匹配式、替换文本、忽略大小写、按行匹配、让点号匹配换行、替换次数（0 表示全部）。 |
| #510 `filename_prefix` | ComfyUI 保存图片的文件名前缀。插件提交图片任务时会按归档规则调整目录部分。 |

### 分支开关

| 分类 | 编号与效果 |
| --- | --- |
| 参考与构图 | **3 图生图参考图**，读图、缩放、VAE 编码后从参考 latent 开始。**119 分区提示词**，给指定遮罩区域单独附加提示词。**120 ControlNet LLLite**，用参考图或预处理结果约束构图，可与文生图一起用。 |
| 局部修复 | **5 修手**、**7 NSFW 修复**、**8 修脸**、**9 修眼**、**123 修脚**，由各自的检测器定位再局部采样。修脚默认旁路，检测模型为 `models/ultralytics/bbox/foot_anime_yolo11m_v3.pt`。**10 细化使用 SAM**，为细化提供 SAM 分割。**12 整图细化**，用整图遮罩细化。**100 遮罩细化**，使用已有遮罩生成修复区域。**118 SAM 3.1 细化**，由 SAM 3.1 分割结果生成局部修复区域。 |
| 采样与放大 | **13 细化前放大**、**14 细化后放大**，分别在局部处理之前或之后放大。**15 二次采样**，对首次结果再采样。**19 Ultimate SD 放大**，放大后分块扩散细化。**99 CFGZeroStar**，切换到该引导补丁。**121 CLIP NegPip**，启用该节点的提示词权重处理。**122 RTX 超分**，使用 NVIDIA RTX VSR。 |
| 色彩与滤镜 | **21 颜色匹配**，把结果的色彩统计向参考图靠拢。**102 Image Levels** 调黑白场与 Gamma，**103 ImageMorphology** 做形态学处理，**104 Edge-Preserving Blur** 保边模糊，**105 ImageQuantize** 减少颜色，**106 Chromatic Aberration** 色差，**107 ImageSharpen** 锐化，**108 Film Grain** 胶片颗粒。**109 VHS TV**、**110 Pixelation**、**111 Digital Glitch**、**112 Night Vision**、**113 Blueprint**、**114 Frosted Glass**、**115 Gameboy** 分别是对应的着色器滤镜。**117 Contrast** 调对比度。 |
| 输出 | **4 保存 ComfyUI 原图**，启用插件用来读取结果的 #510 输出。**16 签名**，合成带遮罩的签名图。**17 去背景**，按去背景模型处理图像。 |

### 分支节点细项

| 节点或字段 | 含义 |
| --- | --- |
| #21、#129 `image` | 分别为重绘、ControlNet 的画布参考素材。若来源为 QQ，则由插件上传图片后填写。 |
| #57、#11/#15/#16、#133 的尺寸参数 | `width` / `height` 设置目标尺寸，`upscale_method` 是插值方式，`keep_proportion` 决定保持比例、裁切或补边，`pad_color` 是补边颜色，`crop_position` 是裁切位置，`divisible_by` 将尺寸对齐到指定倍数，`device` 决定缩放设备。接线的宽高由上游控制。 |
| #0–#2、#12–#14、#10、#6–#9、#3–#5、#17–#20 | 分区素材图、取遮罩的颜色通道、背景遮罩值、各区 `strength`、各区 `wildcard_text` / `populated_text` / `mode`、区域编码及 Attention Couple 合成。 `populated_text` 是展开后的词，`mode` 控制使用通配词或已有文本。 |
| #138 `name`<br>#130 `preprocessor` / `resolution`<br>#131 `strength` / `start_percent` / `end_percent` | LLLite 模型补丁、参考图预处理器及其分辨率、控制强度和生效的采样进度区间。 |
| #28、#31–#34 `model_name` 与 #29 `model_name` / `device_mode` | 局部修复的检测权重，以及 SAM 权重和运行设备。 |
| #53–#56、#46/#47/#63 的细化采样 | `steps`、`denoise` 是每块重采样设置，`cycle` 为重复轮数，`wildcard` 为该区域附加提示词。 `guide_size_for` 决定以检测框还是裁剪区域为引导尺寸，`force_inpaint` 强制执行细化，`inpaint_model` 启用 inpaint 模型用法。 |
| #66、#62、#71、#76 的 `value` | 依次是局部细化引导尺寸、最大尺寸、检测框裁剪倍率和是否使用分块 VAE 编解码。 |
| #53–#56 的检测框和 SAM 参数 | `bbox_threshold` 是检测置信度阈值，`bbox_dilation` 扩大检测框，`drop_size` 丢弃太小的区域。 `sam_detection_hint` 选择 SAM 提示点模式，`sam_dilation` 扩大 SAM 遮罩，`sam_threshold` 过滤 SAM 候选，`sam_bbox_expansion` 扩大传给 SAM 的框。 `sam_mask_hint_threshold`、`sam_mask_hint_use_negative` 控制遮罩提示筛选与负提示。 `refiner_ratio` 分配给已接入 refiner 的采样比例。 |
| 细化遮罩、#43/#45/#61 和 #60 | `feather` 平滑贴回边缘，`noise_mask` 限制加噪范围，`noise_mask_feather` 平滑加噪遮罩边缘。MaskToSEGS 的 `combined` 合并连通区域，`crop_factor` 放大裁剪，`bbox_fill` 填满检测框，`drop_size` 过滤小区域，`contour_fill` 填充轮廓。GrowMask 的 `expand` 扩张或收缩，`tapered_corners` 控制转角形状。 |
| #44 `value`、#30 `ckpt_name`、#42 `text`、#49 `threshold` / `refine_iterations` / `individual_masks` | 整图遮罩值、SAM 3.1 权重、分割目标描述、检测阈值、细化迭代数与是否分别输出各遮罩。 |
| #36–#39、#41 `wildcard` | 各局部修复分支的词，以及共享 Detailer Pipe 的默认词。 |
| #93/#94 放大 | `model_name` 为放大模型。 `rescale_after_model`、`rescale_method`、`rescale`、`percent`、`width`、`height`、`longer_side` 控制模型输出后的缩放方式和尺寸，`crop` 控制裁切。 `image_output`、`link_id`、`save_prefix` 是节点的输出模式、发送关联 ID 和保存前缀。 |
| #90/#91、#100/#118 | 放大模型与 Ultimate SD 采样设置。分块、遮罩与接缝字段见下文 AIO 的 Ultimate SD 条目。两个 `expression` 根据图像尺寸计算并限制瓦片宽高。 |
| #115、#116、#127、#135、#125/#126/#128、#121 | 签名素材、签名宽度的除数、横纵位置、计算位置的表达式和是否缩放合成源图。 |
| #124 去背景 | `rem_mode` 选算法，`image_output` 和 `save_prefix` 控制输出模式和前缀，`torchscript_jit` 选择节点的编译模式，`add_background` 设置附加背景，`refine_foreground` 细化前景边缘。 |
| #123 颜色匹配 | `method` 选算法，`strength` 设混合强度，`multithread` 启用并行处理。 |
| #96、#97、#98、#101 的滤镜子图 | 色阶的 `choice` 为 RGB 或单通道，五个 `value` 依次为输入黑点、输入白点、Gamma、输出黑点、输出白点。保边模糊三项数值依次为半径、边缘阈值、步长。胶片颗粒四项数值依次为强度、尺寸、彩色量、暗部偏重，`choice` 为噪声模式。色差的 `choice` 和 `value` 分别是模式和量。 |
| #99、#109、#110、#95 | 形态学 `operation` / `kernel_size` 控制算法与核大小。量化 `colors` / `dither` 控制色数与抖动。锐化 `sharpen_radius` / `sigma` / `alpha` 控制锐化范围与强度。对比度 `factor` 是对比度倍率。 |
| #102/#103/#112–#114/#119/#120 与 #122 | GLSL 滤镜的 `fragment_shader` 是效果代码，`size_mode` 选输出尺寸策略。RTX 超分的 `resize_type`、`resize_type.scale`、`quality`、`strength`、`image_encoding` 分别选择缩放方式、倍率、画质档、效果强度和输入编码处理。 |

### LoRA 编号、单次参数与会话设置

- 在工作台「LoRA 编号」按模型目录管理编号、分类、默认权重和附带提示词。Anima 和 WAI 各自按人物 C、风格 S、其他 O 编号。将兼容的 `.safetensors` 放在模型目录下的 `characters/`、`styles/`、`other/` 可自动分组，也可在编号页为单个文件调整分类。
- `/comfy gen --wf t2i 描述 --lora 2:0.8,5:0.6` 用英文逗号分隔，本次使用该组合。 `/comfy lora anima use 2:0.8 5:0.6` 用空格分隔，预约下一次适用的 T2I。编号可换成目录 ID，省略强度时使用「LoRA 编号」的默认权重，初始值为 1。 `--lora off` 单次关闭，`/comfy lora anima off` 预约关闭，`/comfy lora anima clear` 清除待用选择。
- Anima T2I 的 LoRA 优先级为本次指定、待用预约、会话设置、画布。待用项在实际采用它的任务受理后消耗。
- 分支和降噪按本次覆盖、会话覆盖、面板值解析。 `--hands`、`--face`、`--eyes`、`--feet`、`--nsfw-repair` 可用 `on` 或 `off` 切换本次的修手、修脸、修眼、修脚、NSFW 修复。NSFW 修复指令仅管理员私聊可用。 `/comfy set` 查看生效来源，`/comfy set show all` 展开分支，`/comfy set 修脚=on` 为当前用户在当前会话开启修脚。 `/comfy set 修脚=default` 恢复该分支的面板值，`/comfy set reset` 恢复整套面板设置并清除待用 LoRA。
- T2I 会话如果仍保存旧的 `denoise=0.7`，空 latent 文生图会按 0.7 起步，可能导致画面整体偏暗。可用 `--denoise 1` 单次验证，再按上条清除会话覆盖。

[T2I API 图](../workflows/Anima_T2I_AstrBot.json) · [T2I 画布与旁路分支](../templates/Anima_T2I_AstrBot.json) · [分支和 LoRA 实现](../bridge/workflows/anima_settings.py)

## 5. Anima I2I AIO

随包主采样为 **21 步、CFG 4.4、`euler`、`simple`、重绘降噪 0.55**。三组权重和 T2I 随包值相同。带图重绘用参考图编码后的 latent，工作台无图生成时用空 latent 并强制降噪为 1.0。QQ `/comfy gen --wf i2i 描述 --denoise 0.55` 可临时指定重绘幅度。

| 工作台选项 | 随包默认值 | 含义 |
| --- | --- | --- |
| 扩散模型加载器 `aio.loader` | 原生 | 原生用 #1758 `unet_name`、`weight_dtype`。Booster 用 #1077 `model_name`，可配置 `sage_attention` 和 `torch_compile`。 |
| QQ 图片重绘方式 `aio.latent` | 整图重绘 | 整图重绘走 #1426。遮罩重绘用 #1424 的图和遮罩编码，`grow_mask_by` 默认扩张 22 像素。遮罩来自 #1608 读图输出。 |
| 文生图尺寸模式 `aio.size` | 手动宽高 | 只用于无图。手动尺寸由 #1427 的 `width`、`height`、`batch_size` 决定，默认为 1024 × 1024、批量 1。比例模式用 #1425 的 `aspect_ratio`、`megapixels`、`multiple` 算宽高，默认 9:16、1 MP、对齐到 8，批量取 #1428。 |
| WD14 标签置信度 `aio.threshold` | 0.35 | `/comfy prompt wd14` 的标签过滤阈值，范围 0–1，越高通常保留的标签越少。 |
| LLLite 控制 `aio.control` | 关闭 | 参考图 LLLite 直接用原图，深度 LLLite 用 #1370 生成深度图，Inpaint LLLite 要配合遮罩重绘。只在有图时接入。深度模式需要本地 Depth Anything V2 权重。 |
| LoRA 槽 `aio.1846` / `1850` / `1849` / `1847` / `1848` | 全关 | 分别为人物、画风质量、动漫、写实、杂项槽，按该顺序串联。槽名用于组织，可选择匹配的 LoRA 文件。每槽有 `lora_name`、`strength_model`、`strength_clip`，模型与文本编码器强度分别生效，随包预填 0.8 和 0.8。 |
| TeaCache `aio.teacache` | 关 | 接入 #1076，在采样期间按差异阈值复用部分模型计算。 |
| SageAttention `aio.sage` | 关 | 接入 #1687，可配置注意力实现和 `allow_compile`。 |
| 画师混合 `aio.artists` | 关 | 接入 #1690 画师串与 #1691 Adapter Mixer。高级参数来自 #1689。 |
| 放大方式 `aio.upscale` | 关闭 | 选 Ultimate SD Upscale、RTX VSR 或 VOSR2，分别接入对应输出分支。RTX VSR 依赖支持的 NVIDIA 环境，VOSR2 需要安装对应本地模型包。 |
| 生成后清理显存 `aio.cleanup` | 关 | 让结果经过 #1011。 `offload_model` 控制卸载模型，`offload_cache` 控制清理缓存。 |

| 节点或字段 | 含义 |
| --- | --- |
| #1073、#1074、#1611 | 分别是文本编码器、VAE 和默认负向词。字段含义与 T2I 对应。 |
| #1038/#1039 `lllite_name` / `strength` / `start_percent` / `end_percent` / `preserve_wrapper` | LLLite 权重、控制强度、生效采样区间和是否保留已有的模型包装。深度预处理器由流程固定为 Depth Anything V2，#1370 可改 `resolution`。 |
| #118 `seed` / `steps` / `cfg` / `sampler_name` / `scheduler` / `denoise` | 主采样种子、步数、引导、算法、时间表与降噪。 `denoise` 在有图时取面板或当次覆盖值。 |
| #1076 TeaCache | `threshold` 控制复用判断，`teacache_version` 选实现，`adaptive_mode` 启用分阶段调整。 `early_steps_factor`、`late_steps_factor` 是早期和后期调整因子，`start_percent`、`end_percent` 是生效区间，`cache_device` 选缓存位置。 |
| #1690 `artist_chain` 与 #1691 `enabled` / `strength` / `normalize_weights` / `alignment_mode` | 画师链文本、Mixer 自身启用、整体强度、权重归一化、对齐模式。 `apply_to_uncond`、`uncond_strength` 对应无条件分支的开关和强度，实际支持取决于本机 Mixer 节点版本。 |
| #1689 的 Anchor-Q 设置 | `artist_anchor_q` 开启跨种子风格稳定。 `anchor_seed_list` 是逗号分隔的固定锚点种子，留空时使用 `anchor_seeds_count` 个随机锚点。 `anchor_user_blend` 控制锚点与任务噪声的混合，`anchor_deep_layer_threshold` 是切换到任务噪声的层阈值，`stabilizer_end_percent` 决定停止位置。 |
| #1689 的缓存和通用画师选项 | `anchor_refresh_mode` 选择一次快照或预热缓存，`anchor_cache_points` 是预热保留的关键帧数，`anchor_keyframe_mode` 选取帧策略。 `start_block`、`end_block`、`layer_filter` 控制层范围，`start_percent`、`end_percent` 控制步区间，`normalize_weights` 为归一化。 `artist_ema_alpha` 是跨步平滑，`lowrank_k` 是低秩阶数，`artist_static_capture`、`static_capture_k` 控制前几步捕获后冻结。层范围、EMA、低秩和静态捕获是该节点给 Cross-Attn 路径的通用字段，随包的 Adapter Mixer 路径主要使用 Anchor-Q 系列。 |
| #279 与 #1665 Ultimate SD Upscale | `model_name` 选放大权重，`upscale_by` 选放大倍数。 `steps`、`cfg`、`sampler_name`、`scheduler`、`denoise` 控制分块重采样。 `mode_type` 选瓦片处理顺序，`tile_width`、`tile_height` 是瓦片尺寸，`tile_padding` 增加周边上下文，`mask_blur` 平滑贴回边缘，`force_uniform_tiles` 使用统一瓦片尺寸。 |
| #1665 的接缝与解码 | `seam_fix_mode`、`seam_fix_denoise`、`seam_fix_width`、`seam_fix_mask_blur`、`seam_fix_padding` 分别控制接缝算法、重绘幅度、修复带宽度、遮罩模糊和周边上下文。 `tiled_decode` 用分块 VAE 解码，`batch_size` 是此节点的批量参数。 |
| #1818 RTX VSR | `resize_type` 选缩放方式，`resize_type.scale` 是倍率，`quality` 为质量档。随包为 2 倍、ULTRA。 |
| #1825/#1824 VOSR2 | `model` 是 `models/vosr2/` 下的模型包，`dtype` 是精度。 `upscale` 是倍率，`color_alignment` 是颜色校正方式，`tile_size` / `tile_overlap` 是模型的瓦片尺寸和重叠，`vae_tile_size` / `vae_tile_overlap` 是 VAE 分块设置。 |
| #1649 `filename_prefix` | 输出文件名前缀，目录部分由归档规则决定。 |

I2I AIO 的增强和多 LoRA 槽由工作台配置。QQ 单次重绘支持覆盖 `denoise`。放大节点 #1665 与 #1824 的种子在 AIO 面板中隐藏，主种子由 #118 的映射处理。

[AIO API 图](../workflows/Anima_I2I_AIO_AstrBot.json) · [分支接线](../bridge/workflows/anima_aio.py) · [面板字段与模型检查](../bridge/studio/studio_settings.py)

## 6. PixAI 反推、TIPO 扩写和 WD14

`/comfy prompt [图片序号]` 使用反推流，`/comfy prompt wd14 [图片序号]` 使用独立的本机 WD14 模板，省略序号时取第一张。反推不需要填写生成提示词。TIPO 随包默认关闭，可在工作台启用。

| 节点或选项 | 随包默认值 | 含义 |
| --- | --- | --- |
| #416 `model` / `device` / `config_override` | PixAI v1.0 / auto / auto | 反推模型、设备和模型配置。PixAI v1.0 本机需有 `models/pixai_tagger/pixai-tagger-v1.0/` 下的 `model.safetensors` 和 `config.json`。 |
| #416 `threshold_mode` | custom | `custom` 使用六类自定义阈值，`optimal_calibrated` 使用模型自带的逐标签阈值。 |
| #416 `general_threshold` / `character_threshold` / `copyright_threshold` | 0.17 / 0.27 / 0.24 | 通用内容、角色、作品标签的置信度门槛，范围 0–1。 |
| #416 `style_threshold` / `meta_threshold` / `rating_threshold` | 0.15 / 0.17 / 0.41 | 画风、元标签、分级标签的置信度门槛，范围 0–1。 |
| #416 `include_style` / `include_meta` / `include_rating` | 开 / 关 / 关 | 是否把三类标签加入文本结果。 |
| #416 `sort_by_confidence` / `character_first` / `replace_underscore` / `exclude_tags` | 开 / 关 / 开 / 空 | 是否按置信度排序、优先列角色和作品、把下划线转为空格，以及从结果排除的标签。 |
| 启用 TIPO 扩写 `expand_caption` | 关 | 开启后从 #444 输出扩写结果，关闭时输出处理后的 PixAI 标签。工作台只列出能在本机定位的 TIPO 模型文件，放在 `models/kgen/`。 |
| #400 `tipo_model` / `device` / `seed` | TIPO v2.1 1B f16 / cuda / 1367 | 扩写权重、运行设备和图里保存的种子。实际是否随机由固定种子开关决定。 |
| #400 `width` / `height` / `format` / `nl_prompt` / `ban_tags` | 1024 × 1024 / `<\|extended\|>` / 空 / 空 | 给 TIPO 的目标尺寸信息、输出模板、扩写参考描述和禁止生成的标签。尺寸用于扩写条件。 |
| #400 `tag_length` / `nl_length` | long / long | 目标标签量和自然语言描述长度档。 |
| #400 `temperature` / `top_p` / `min_p` / `top_k` | 0.5 / 0.95 / 0.05 / 80 | 分别控制抽样随机度、累计概率截断、相对最低概率筛选和最多保留的候选数。 |
| #444 `delimiter` | 换行 | 拼接标签与扩写内容的分隔符。 |
| WD14 #2 `threshold` | 0.35 | 从 I2I AIO 的 WD14 标签置信度读取。依赖 AstrBotLocalTagger 和本机 WD14 权重及标签表。 |

[PixAI / TIPO API 图](../workflows/Anima_Reverse_AstrBot.json) · [WD14 模板](../templates/Anima_WD14_Caption_AstrBot.json)

## 7. WAI-Illustrious T2I

使用 `WAI-Nsfw-Illustrious-17.safetensors`，默认沿用 checkpoint 内的 VAE。基础画布 **832 × 1216、批量 1**，主采样 **30 步、CFG 10、Euler ancestral / normal**。随包启用模型放大、放大后重采样、重采样 ControlNet 和修眼。修脸、外部 VAE 和 Detail Daemon 默认关闭。

| 节点或选项 | 含义 |
| --- | --- |
| #88 `ckpt_name`、#91 `vae_name`、#126 `sampling` / `zsnr` | 选择 checkpoint、可选外部 VAE（随包 `taesdxl`）和扩散采样参数。 |
| #107 `width` / `height` / `batch_size` | 基础宽高和批量。 |
| #245/#244/#247 的采样字段 | 主采样三段默认从 0→10、10→20、20→末步。步数、切换点、CFG、采样器和调度器可以编辑。 |
| #218/#219、#98/#100 | 正负提示词的 smZ 编码模式，以及写入文字的节点。 |
| #120/#24 | 放大模型 `RealESRGAN_x4plus.pth` 与目标尺寸 **1248 × 1824**。 |
| #128/#129/#146 | ControlNet 权重 `diffusion_pytorch_model.safetensors`、Union 类型（默认 `canny/lineart/anime_lineart/mlsd`）和强度（默认 0.3）。需开启「放大后重采样」及「重采样 ControlNet」。 |
| #228/#229/#238/#231 | 重采样算法、步数和降噪（默认 8、0.5）、两组 CFG 和可选 Detail Daemon。 |
| #213/#211、#125/#174 | 脸和眼检测器及各自的修复采样设置。随包检测权重为 `bbox/face_yolov9c.pt` 和 `bbox/Eyeful_v2-Paired.pt`。 |

`/comfy gen --wf wai 描述 --face on --eyes off --controlnet-type depth` 可覆盖当次设置。ControlNet 类型选项以本机节点为准，`canny` 等组内简称也可用。WAI LoRA 从 `models/loras/illustrious/` 管理，可在工作台「LoRA 编号」管理。没有指定或预约 LoRA 时，WAI 直接使用基模。QQ `/comfy lora wai` 查独立编号，`--lora 2:0.8,5:0.6` 覆盖本次。

WAI 默认线稿型 Union ControlNet 的输入先做 Canny 边缘检测。选中本机 `pixel-Illustrious` LoRA 时使用像素画路径，直接保留主采样结果，支持与人物 LoRA 叠加。QQ 显式开启修复或 ControlNet 时按本次指令处理。

[WAI API 图](../workflows/WAI-Illustrious_T2I_AstrBot.json) · [分支与参数应用](../bridge/workflows/illustrious.py)

## 8. WAN 2.2 文生视频与图生视频

两条随包工作流都使用 **512 × 288、49 帧、16 FPS、批量 1、总步数 20**。T2V 从空视频 latent 开始，I2V 从 QQ 参考图初始化。两条图都使用对应任务类型的 WAN 2.2 A14B 高、低噪声模型，加文本编码器 `umt5_xxl_fp8_e4m3fn_scaled.safetensors` 和 VAE `wan_2.1_vae.safetensors`。

| 节点或字段 | 含义 |
| --- | --- |
| #1 / #2 `unet_name`、`weight_dtype` | 高噪声和低噪声阶段的权重及加载精度。 |
| #3 `clip_name` / `type` / `device` 与 #6 `vae_name` | 文本编码器及加载配置，和视频 VAE。编码器类型随包为 `wan`。 |
| #5 `text` | 默认负向视频提示词。 |
| #7 `width` / `height` / `length` / `batch_size` | 视频尺寸、总帧数、同时生成的 latent 批量。大致片长可用帧数除以 FPS 估算。 |
| #8/#9 `shift` | 两阶段各自的采样时间偏移，随包都为 5。 |
| #10/#11 `noise_seed` / `steps` / `cfg` / `sampler_name` / `scheduler` | 两段共享本次种子，总步数默认 20。各段的 CFG、算法和调度器随包为 3.5、`euler`、`simple`。 |
| #10/#11 `start_at_step` / `end_at_step` | 高噪声默认 0→10，低噪声默认 10→20。面板编辑时，原本相等的总步数和衔接点会联动。低噪声阶段原本跑到总步数末尾时，修改总步数会同步其末步。 |
| #10/#11 `add_noise` / `return_with_leftover_noise` | 高噪声阶段默认加噪并传出剩余噪声，低噪声阶段接着降噪，默认不再加噪且输出最终去噪结果。 |
| #12 `tile_size` / `overlap` / `temporal_size` / `temporal_overlap` | 视频 VAE 解码的空间分块、空间重叠、时间分块和时间重叠，默认 256 / 64 / 16 / 4。 |
| #13 `fps` / `bit_depth` / `color_space` / `chroma_subsampling` / `codec` | 拼成视频时的帧率、位深、色彩空间、色度采样和节点的编码选项。随包为 16 / 8 / sRGB / 4:2:0 / none。 |
| #14 `filename_prefix` / `format` / `format.codec` / `format.codec.encoding` / `codec` | 文件名前缀、容器、编码器、编码方式和兼容字段。随包使用 MP4 / H.264，编码方式为自动。具体面板可选项由本机 SaveVideo 节点提供。 |
| #15 `image`（I2V） | QQ 图片入口，由插件替换成上传后的文件。 |

[WAN T2V API 图](../workflows/WAN22_T2V_AstrBot.json) · [WAN I2V API 图](../workflows/WAN22_I2V_AstrBot.json)

### WAN 2.2 SVI 分段图生视频

工作台中的「WAN 2.2 SVI · 分段图生视频」使用 `WAN22_SVI_I2V_AstrBot`。默认启用首段、三阶段采样、GGUF、81 帧、16 FPS。首段从 QQ 参考图开始，续写段继承上一段动作并混合重叠帧。段数包含首段，最多 12 段。每段可附加正向和负向提示词，帧数使用 4n+1。

「默认段号顺序」可填如 `3,1,7`，留空时使用前 N 段。每段的「附加 LoRA」可保存多项，并选择高噪声、低噪声或两者。QQ 的 `--lora "3=high:文件名:0.8"` 按段覆盖这些附加项。可重复指定多段，同段用逗号叠加。`--lora "3=off"` 清空本次该段，`--lora off` 清空本次所有附加项。全局 SVI 和 Lightning LoRA 在工作台的模型区配置。

面板可选 GGUF 或 FP8 高低噪声模型，并设置 UMT5、VAE、SVI 和 Lightning LoRA 的文件及强度。三阶段随包为总 7 步，在第 1 和 4 步切换（#193–#195）。两阶段为总 6 步，第 3 步切换（#564/#566）。默认 CFG 4（#314）。切换步必须递增并小于总步数。参考图按原比例调整到目标尺寸范围。输出使用 H.264 MP4。

放大和插帧默认关闭。插帧使用本机 Fill Nodes 的 RIFE，需预先在 `custom_nodes/comfyui_fill-nodes/nodes/cache/rife_models/` 放入选定的 `rife47.pth` 或 `rife49.pth`。启用后按插帧倍数同步提高输出帧率。模型放大默认选择本机的 `RealESRGAN_x4plus_anime_6B.pth`。

[SVI 插件 API 配置](../workflows/WAN22_SVI_I2V_AstrBot.json)

### WAN 2.2 Lightning 长视频

工作流 `WAN22_Lightning_Long_I2V_AstrBot` 通过 #97 接收 QQ 图片，首段使用 PainterI2VAdvanced，续写使用 PainterLongVideo。默认用上一段的末帧和原参考图继续生成。支持 1–4 段与自定义段号顺序，每段可设置帧数、附加提示词及高低噪声 LoRA。

默认 GGUF Lightning V2、两阶段共 4 步、81 帧、16 FPS。选择 FP8 时会加载高、低噪声 Lightning LoRA。参考图尺寸、采样切换点、色彩保护、参考帧索引和 MP4 画质可在工作台保存。放大、插帧默认关闭，RIFE 插帧使用与 SVI 相同的本地权重目录。QQ 逐段 LoRA 用法与 SVI 相同，使用 high、low 或 both。先用 `/comfy lora video` 查看本机文件。

输出前用解码后的首帧做逐帧亮度和色彩校正，并对后续帧做自适应细节增强，再放大、插帧或编码。工作台「视频输出」中的「首帧亮度校正」默认 0.8，「后续帧细节增强」默认 0.32，两项可独立设为 0 关闭。

[Lightning 插件 API 配置](../workflows/WAN22_Lightning_Long_I2V_AstrBot.json)

## 9. SDXL Turbo

| 节点或字段 | 随包默认值 | 含义 |
| --- | --- | --- |
| #20 `ckpt_name` | `sd_xl_turbo_1.0_fp16.safetensors` | 加载包含扩散模型、CLIP 与 VAE 的 checkpoint。 |
| #5 `width` / `height` / `batch_size` | 512 × 512 / 1 | 空 latent 的尺寸和批量。 |
| #7 `text` | 工作流内置文本 | 默认负向提示词。正向由插件写入 #29。 |
| #13 `add_noise` / `noise_seed` / `cfg` | 开 / 0 / 1 | 是否加噪、种子和提示词引导。默认随机模式下插件会替换图里的种子。 |
| #14 `sampler_name` | `euler_ancestral` | 采样算法。 |
| #22 `steps` / `denoise` | 1 / 1.0 | SDTurbo 调度器的步数和降噪。 |
| #27 `filename_prefix` | 工作流内置前缀 | 保存的文件名前缀，目录按归档规则处理。 |

[SDXL Turbo API 图](../workflows/SDXL_Turbo_T2I_AstrBot.json)

## 10. 工作台管理

| 页面与选项 | 含义 |
| --- | --- |
| 图片归档 → 默认文件夹 | 无匹配标签时使用。随包默认 `SFW`。 |
| 图片归档 → 标签、目标文件夹 | 随包规则为 `NSFW → NSFW`、`SFW → SFW`。标签匹配不区分大小写，可写 `[标签]`。QQ 的 NSFW 归档标签仅管理员私聊可用。先匹配到的规则决定目录，识别到的归档标记从绘图描述中移除。目标是单层文件夹。ComfyUI 原图和 AstrBot 回传缓存各写入自己的对应分类目录。 |
| 待评价图片与收藏图集 | 本机原图存于 ComfyUI 工作目录的 `output/unevaluate/`、`output/favourite/` 和 `output/pass/`，各含 `SFW`、`NSFW`。自定义归档目录保留在 `SFW` 下。远程 ComfyUI 使用插件数据目录的 `outputs/`。索引保存在插件数据目录的 `image_reviews/`，缩略图保存在输出目录的 `.astrbot-thumbnails/`。 |
| 网页同时显示的待评价任务数 | `review_task_limit` 默认 5，范围 1–50。一个任务的图片全部评价后，下一项补位。 |
| 图集筛选 | 三个图集可按提示词预设、工作流和 LoRA 组合筛选，包含未使用或无记录的选项。生成记录使用预设 ID，旧任务若只有历史名称，则按历史名称显示。 |
| 绘图人格 → 绘图提示词 | 追加到支持工具的聊天模型上下文，用于指导工具调用、参数、回执和反推。最多 16000 字符。保存后下次 AI 请求读取新版。「载入默认提示词」先填入编辑器，再保存生效。 |
| LoRA 编号 → 拖动、上移、下移、刷新 | Anima 与 Illustrious 分开调整 QQ 编号并即时保存。新模型在各自已保存的顺序后追加。视频逐段 LoRA 在 SVI 或 Lightning 工作流中选文件。 |
| LoRA 编号 → 附带提示词 | 点击名称配置附带词，启用该 LoRA 且强度非零时可随正向词提交。默认词来自内置角色映射或模型的 `modelspec.trigger_phrase`。空字符串停用插件补词，「恢复默认」清除自定义。沿用 T2I 画布时，插件补自定义词，画布触发词节点按自己的设置处理。 |
| 管理 → 导入导出 → LoRA 附带词 | 对应关系按整个模型文件的 SHA-256 保存。导入时同哈希以导入词为准，本机缺少模型的记录会保留。导出内容是自定义词与停用项。可识别的旧名称映射会在读取目录时迁移。 |
| 提示词预设 → 用户、平台实例 ID、用户 ID | 按平台实例和用户隔离预设。QQ 私聊 `/comfy prompt preset` 可取得账号标识。旧版共享预设在后台作为独立库管理。 |
| 提示词预设 → 名称、正向、负向、顺序 | 名称 1–64 字符且同库内唯一。正向必填，负向可空，每项至多 8000 字符。顺序决定 QQ 中的编号。在「管理 → 导入导出」选择账号，可导入或导出整库，导入时可逐项处理同名冲突。 |
| 生成队列 → 工作流 | 选可直接在工作台提交的工作流。需要聊天附图的重绘和图生视频走 QQ。工作台选 AIO 时使用无图路径。 |
| 生成队列 → 预设所属用户、提示词预设 | 可加载指定库的预设。编辑框里的正向内容作为本次补充。 |
| 生成队列 → 正向、负向、生成批次 | 正向词按原文提交，负向为空时沿用预设或工作流。批次表示多个独立任务，和单个工作流的 `batch_size` 分开。多批各用随机种子，可以逐个取消。 |
| 生成队列 → QQ 超时 | 选择工作流并保存任务等待上限。留空使用插件的全局设置，初始值为图片 500 秒、视频 1500 秒。支持范围分别为 5–3600 秒、5–7200 秒。该设置保存在 `qq_generation_timeout.json`。 |
| 生成队列 → 状态、种子、结果、取消 | 显示近期任务及错误、实际种子和缓存结果。可取消单项或全部插件任务。运行中的任务按任务 ID 请求 ComfyUI 取消，面板显示未确认取消的任务。聊天里的「已完成」和「已发送」是不同状态。 |

工作流、归档、绘图人格、LoRA 和提示词预设的保存内容位于插件数据目录。对应文件是 `workflows/*.json`、`image_archive.json`、`drawing_persona.txt`、`lora_order.json`、`prompt_presets/`。QQ 工作流选择和 Anima 会话覆盖分别保存在 `selections.json` 和 `anima_state.json`。近期任务与待用 LoRA 保存在内存里，重载后会重新开始。保存或校验失败时，工作台会在页面浮出错误提示。

[工作台表单](../views/anima/index.html) · [工作台代码](../views/anima/app.js) · [设置存取](../bridge/studio/studio_settings.py)

生成任务的完整提交图和执行追溯记录保存在插件数据目录的 `generation_metadata/<完整任务ID>.json`，包含实际提示词、种子、模型、LoRA、参考图校验值和 ComfyUI 输出信息。支持嵌入的输出格式还会写入任务信息。QQ 转发压缩可能剥离内嵌字段，本机 JSON 可继续追溯。

[快速上手](../README.md) · [QQ 指令集](COMMANDS.md)
