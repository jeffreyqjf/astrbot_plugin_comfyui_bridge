# 工作流分析

| 版本 | 典型位置 | 操作 |
| --- | --- | --- |
| original | ComfyUI `user/default/workflows/main/`、`WAN2.2-N/` 或对应来源 | 用户调试和追溯，禁止修改 |
| AstrBot | ComfyUI `user/default/workflows/AstrBot/` | 实际维护的适配画布 |
| API | ComfyUI `user/default/workflows/api/` 和插件 `workflows/` | 从 AstrBot 画布导出，随包图保留必要的 `astrbot` 配置 |

本机 AstrBot 运行图位于插件数据目录的 `workflows/`。发布随包图后，已有运行图仍需按批准的合并方式和重读流程同步。运行时设置与节点映射可覆盖图中的默认值。

[workflow.py](../bridge/workflows/workflow.py) 处理 API 图或带 `prompt` 和 `astrbot` 的配置，从输出逆向追踪依赖，映射提示词、种子和参考图等字段。[workflow_fields.py](../bridge/workflows/workflow_fields.py) 将本机节点 schema 与图中字面值结合，判定可编辑字段。连线输入由上游控制，必要时读取 `/object_info/<class>` 核对节点类型与有效选项。

| 家族 | 维护入口 | 核对重点 |
| --- | --- | --- |
| Anima T2I、I2I AIO | `anima_settings.py`、`anima_export.py`、`anima_aio.py` | 分支旁路、遮罩与整图、LoRA 槽和输出 |
| Advanced Gemma V40、Detailer V40 | `v40.py`、`detailer.py` | 扩写、局部修复、参考图或遮罩、两阶段采样 |
| WAI、SDXL | `illustrious.py`、通用 `workflow.py` | WAI LoRA 分族、重采样先决条件与 Union ControlNet、SDXL 提示词和输出 |
| WAN 2.2 普通与分段视频 | 通用 `workflow.py`、`svi.py`、`lightning.py` | 高低噪声阶段、原段编号、参考图、视频输出 |
| MiniMax H3 Seed Hunter | `minimax_h3.py`、两份简化版 API 和一份 v3 完整版配置 | 基准种子映射、三路候选偏移、可选参考图、潜空间放大和带音频 MP4 |
| PixAI 和 WD14 | 反推工作流与 `templates/Anima_WD14_Caption_AstrBot.json` | 文本输出、参考图序号、可选扩写 |

正式更新依次修改 AstrBot 画布、导出 API、同步随包文件。记录画布、API 和随包路径，核对节点 ID、`class_type`、端口与连线、条件分支、模型和输出可达性。涉及参考图时核对入口、预处理与目标节点。涉及分段视频时核对单段及非顺序多段。必要的实际生成纳入当轮验证记录。

## v2.25.0 适配变化

- V40 OpenPose、Any 和 Anima T2I LLLite 有独立的工作台单次输入。V40 Any 先校验 Canny/Depth 与对应模型。Anima T2I 深度使用 `ModelPatchLoader` 枚举的深度模型。保存分支及普通重绘图可与 ControlNet 分开处理。
- Detailer V40 的修脚在修眼之后、全局后处理之前。脚分支关闭时沿用修眼后的图片。默认手动 API 裁剪关闭的分支，随包文件保留可启用的分支。兼容升级只重连匹配旧图特征的节点。
- 已核对并同步三个 AstrBot 画布、手动 API 和随包图。当前安装副本和其正式工作流运行配置未同步。

## v2.33.0 · MiniMax H3 Seed Hunter

- 原画布位于 `MiniMaxH3/FoxFurEssence H3 Seed Hunter v3.json`。首轮三套采样共享模型、提示词和音视频潜空间，使用基准种子及两个偏移值。首轮视频和音频分别解码并由 VHS 合流。原图另有可切换的定稿、参考视频续写、音频、插帧及参考引导分支。
- AstrBot 版将首轮搜种和放大定稿拆成两张显式连线画布。`h3` 在 15、35、55 输出候选，`h3-final` 以选中的实际种子重建首轮、放大去噪潜空间并运行二轮采样，节点 67 输出。两图映射 `5.prompt` 和 `16.value`，单张参考图由插件按需接到 `5.ref_images.ref_image_0`。
- `h3-v3` 复制 FoxFurEssence v3 画布的 168 个节点，保留子图和节点 ID。将 UE 记录中的连接显式化，补齐首轮子图采样器、Sigma 和视频 VAE。用 ComfyUI 原生导出收集不同分支的执行图，随包配置通过生成模式选择执行图，并按节点 ID 和字段名保存共用参数。搜种返回 #18/#134/#144，定稿和续写返回 #34。额外素材由 #416 分发，临时上传图接原画布 Picture 1 的消费者。
- 两张画布保存在 ComfyUI 的 `AstrBot/`，用已安装的转换器和本机节点定义导出到 `api/`，随后同步插件 `workflows/`。操作与权重清单见 [Seed Hunter 使用教程](../user%20docs/MINIMAX_H3_SEED_HUNTER.md)。

## Anima T2I 任务功能补全（v3.3.0）

| 任务功能 | 分支 | 实际执行节点 |
| --- | --- | --- |
| Regional Prompting | 119 | RGB `0/1/2 → 11/15/16 → 12/13/14`；提示词 `3/4/5 → 17/18/19 → 6/7/8`，基底强度 9 与遮罩 10 汇入 AttentionCouplePPM 20 |
| Hires PreDetailer | 13 | easy hiresFix 93 |
| Hires PostDetailer | 14 | easy hiresFix 94 |
| 2ndSampler | 15 | KSampler 51，输入 latent 来自主 KSampler 27，输出经 VAEDecode 73 |
| Ultimate SD Upscaler | 19 | UpscaleModelLoader 90、UltimateSDUpscale 91，图像尺寸与计算辅助 134/100/118 |

启用全部五项、局部修复保持随包默认关闭时，区域条件作用于主采样 27 和二次采样 51，图像输出走 `73 → 93 → 91 → 94 → 497 → 510`。关闭分支由原画布旁路连线接续；保留原有节点 ID 和布局，不额外插入模型或修复节点。32 种组合检查节点开关和输出依赖，验证全局提示词不会覆盖三个区域文本。

随包模板已实际导出为 API，默认执行图除能力声明外无变化。本机 AstrBot 画布和现有 API 的默认分支／参数原本存在差异，本次只同步能力声明，保留两者各自的默认值；没有用一次全量导出覆盖本机独立调参。原版画布和运行实例均未改动。

## Detailer V40 新建任务分支（v3.4.0）

| 功能 | 分支 | 实际节点和输入 |
| --- | --- | --- |
| HiresFix | 15 | easy hiresFix #7，图像从 #2 接入，参数沿用保存值 |
| Inpaint | 27 | #43/#49 预处理与 ControlNet、#71 VAEEncode、#75 SetLatentNoiseMask、#77 KSampler、#72 VAEDecode；遮罩为 `2:1`，模型 #35 |
| Outpaint | 28 | #50 ImagePadForOutpaint 生成扩展图与遮罩，#44/#69 ControlNet、#83/#90/#96/#84 采样与解码；遮罩为 `50:1`，模型 #36 |
| Mask Detailer | mask | #37 MaskDetailerPipe，使用 `2:1` 遮罩；#12 步数、#25 降噪 |
| Ultimate SD Upscale | 30 | #33 UltimateSDUpscale，放大模型 #24；#51 Canny 与 #34 ControlNet（模型 #18）、#38/#39 图块尺寸及 #41/#46/#52 参数 |

五项全开、其余分支沿用随包默认时，图像主线为 `2 → 7 → 71/75/77/72 → 50/83/90/96/84 → 37 → 57（Face Detailer 默认开启）→ 33 → 32`。分支关闭使用原始旁路映射接续，32 组合均检查必要节点可达及输入依赖，不重排修复步骤或画布布局。

本机实际节点 schema 核对：HiresFix、Mask Detailer、Ultimate SD Upscale 的默认图可校验；Inpaint／Outpaint 默认 #35／#36 的 `noobaiInpainting_v10.safetensors` 缺失，需用户通过工作流参数选择可用的匹配模型。未替换或下载模型，提交时明确拒绝缺失项。测试中的该模型使用隔离 schema 验证构图，不能据此认定本机模型已就绪。

本机 AstrBot 画布先补能力声明并实际导出至检查产物，现有手动 API 与当前画布已有参数／分支差异，保留各自值，仅同步声明。随包 API 保留全部可选分支和原参数，由 V40 适配器按本次选择裁剪；原版工作流未修改。

## Anima Detailer 接入（v3.5.0）

来源为 `main/AnimaDetailer.json`。独立保存 AstrBot 画布、随包模板、默认 API 和保留全部分支的插件 API 配置。保留原版节点 ID、坐标、尺寸、分组与默认分支；#2 改任务占位，#15 由 Image Saver Simple 改 SaveImage，移除 metadata 连线。旧 Image Saver 专用元数据／文件名不作为可执行插件参数，图片归档复用插件服务。

默认主线为 `2 → 36（Mask Detailer）→ 43（手）→ 44（NSFW）→ 45（脸）→ 46（眼）→ 15`；#79 位于遮罩细化前，#48 位于修眼后，#80 位于 Ultimate 后。#126 In/Outpaint 分支开启时，参考图先经 #95 扩展、#77 编码，#91 合并扩展遮罩与参考图遮罩，再经 #78/#87/#90 与 LLLite #89（模型 #103）采样解码，送入后续细化。按实际连接核对，不按节点标题猜测。

模型路径为 `1 UNETLoader → 5 LoRA → 42 DifferentialDiffusion`，分别供 ToDetailerPipe #25、DetailerForEach、LLLite 和 Ultimate 使用。单次／遍历 LoRA 在原 #5 上游串联 ModelOnly 加载器，清空原版 LoRA 列表，附带词进入提示词前缀；不会仅覆盖部分细化节点。提示词映射 #3/#41、种子 #49、参考图 #2、输出 #15。LoRA 目录为 Anima。

复用 V40 的分支裁剪及参数面板协议，独立配置 32 个有效分组，前端可选功能仅包含 Hires Pre/PostDetailer、In/Outpaint、Mask Detailer、Ultimate SD Upscaler。没有原版修脚、Regional Prompt 或独立 2ndSampler，因此不加入这些选项。旁路映射依据实际端口类型及连线生成，子图按已安装转换器展开，动态输入保留 RTX／GLSL 分支定义。

默认 38 个输出可达节点通过本机 schema 检查；32 种可选功能组合均通过节点及连线检查。In/Outpaint 原模型 `anima-lllite-inpainting-v2.safetensors` 在当前 ModelPatchLoader 列表中缺失，保留原值并在启用提交时明确报错。尚未执行 GPU 或 QQ 投递验证。

## 主要修复比较节点（v3.6.0）

按用户明确授权更新两个原版与两个 AstrBot 版，新增范围最终以“主要修复处，参照 Advanced Gemma V40”为准。

| 画布 | 新增比较的处理节点 | 复用 |
| --- | --- | --- |
| Detailer V40 original／AstrBot | #23 Detailer、#37 Mask Detailer、#68 SAM Detailer、#55 手、#56 NSFW、#57 脸、#58 眼、#499 脚、#33 Ultimate | 原有 #73 全局比较保留 |
| Anima Detailer original／AstrBot | #36 Mask Detailer、#37 Detailer、#56 SAM Detailer、#43 手、#44 NSFW、#45 脸、#46 眼 | #54 Ultimate 对比复用，#55 全局比较保留 |

新增比较 A 接处理后、B 接该步骤真实 image 输入，使用 Slide 模式，保持与参考工作流一致。V40 脚节点虽为 mode=0，原 #500 可关闭其执行，因此比较 A 接 #500 结果、B 接对应 on_false 原图，未绕过现有选择器。其他原始模式、模型、分组边界、节点位置和处理连线均保留。

比较框放在相应处理列下方的空白区域，并避开现有分组，避免影响按位置计算的旁路分组归属。没有给预处理、Pad／Resize、Hires、解码或滤镜逐个加比较框。新的 Viewer 空预览在再次执行画布后生成，不携带参考工作流的旧图片 URL。

两份 AstrBot 模板随包保存。实际导出四份修改前／后的图，去掉比较终端后，全部处理 API 节点及输入相同；插件执行 API 保持原值。`scripts/add_detailer_comparisons.py` 可在明确授权下补齐主要节点，复用已有成对连接，重复执行不重复添加。
