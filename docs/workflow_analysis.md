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
