# 插件工作流执行顺序

以下为 2026-11-16 调查时的运行图快照。v2.25.0 随包和 AstrBot 画布的修脚及控制分支变化见 [工作流分析](workflow_analysis.md)。

本表核对当前安装配置选择的 11 份运行 API 图、同名随包图、现有手动 API 和对应画布，并单列 WD14 辅助图。分析通过本机节点定义和实际输入连线进行。ComfyUI 按依赖调度，同一层可按任意顺序执行，缓存会跳过已有结果。下表层号表示依赖深度，用户级顺序还会由单次覆盖改变。

主顺序按本机保存的默认配置生成。下方“加入、移出、连线”取各分支从同一基线单独切换后的差异。它们是静态编译结果，验证模型兼容性和视觉效果仍需实际运行。手动 API 用于核对画布默认导出，插件运行 API 的旁路和覆盖由适配层控制。无活动参考图的 AIO 基线使用纯文生图。

## 主链速查

| 工作流 | 主链与分支位置 |
| --- | --- |
| Advanced Gemma V40 | 模型、LoRA、文本/扩写、参考和控制条件 → #114 主采样 → 可选 #81 二采 → #106 解码 → 局部修复（手 → NSFW → 脸 → 眼 → 可选其他检测 → 脚）→ 放大和滤镜后处理 → #501。OpenPose、Any 接在主条件侧，关闭时直接绕过。 |
| Anima I2I AIO | 模型/LoRA/文本 → 整图、遮罩或空 latent → #118 → #119 → 可选三种放大及清理 → #1649。Reference/Depth LLLite 走 #1038，Inpaint 用 #1039 且需遮罩。 |
| Anima 反推 | #398 → #416 PixAI → #443 文本清理，可与 #400 TIPO 结果在 #444 合并 → #445。运行配置已开 TIPO。 |
| Anima T2I | 基础模型/LoRA/文本，条件和可选 #120 LLLite → #27 主采样 → 可选 #51 二次采样 → #73 解码 → #53 手 → #54 NSFW → #55 脸 → #56 眼 → #514 脚 → 可选放大、滤镜、去背景、签名 → #510。 |
| Detailer V40 | 输入 #2 → 可选去水印、Hires、Inpaint、Outpaint → 局部细化 #37、可选 #68 → #55 手 → #56 NSFW → #57 脸 → #58 眼 → 可选全局放大、滤镜和去背景 → #88 画布汇合 → #499 脚（#500 控制旁路）→ #32。当前运行全局分支关，编译后 #499 直接取 #58。 |
| SDXL Turbo | #20 checkpoint、空 latent 和正负编码 → #22 Turbo 调度 → #13 单独采样 → #8 解码 → #27。只见 original 画布和随包/运行 API。 |
| WAI-Illustrious | #245 → #244 → #247 初段采样 → #118 解码 → #24 放大 → #211 修脸 → #185 编码和 #146 控制 → #230 重采样 → #13 解码 → #174 修眼 → #37。运行版启用的 ControlNet 取自身已生成图。随包默认与本机修脸开关不同。 |
| WAN 2.2 I2V | 参考图 #15、文本和高低噪声模型 → #7 参考图视频条件 → #10 高噪声 → #11 低噪声 → #12 分块解码 → #13 视频 → #14 保存。 |
| WAN 2.2 Lightning | 首段 #1252:1248 条件 → #1252:1238 高噪声 → #1252:1239 低噪声 → #1252:1249 解码。续写用前段尾帧重新缩放，拼接后按设置校色、增强、放大、插帧 → #1039。 |
| WAN 2.2 SVI | 首段 #562:554 条件 → #562:559、#562:556、#562:557 三相采样 → #562:561 解码。续写传前段 latent，重叠拼接，可切双相、模型格式、放大与插帧 → #512。 |
| WAN 2.2 T2V | 文本和高低噪声模型、#7 空视频 latent → #10 高噪声 → #11 低噪声 → #12 分块解码 → #13 → #14。 |
| WD14 辅助图 | #1 加载 → #2 AstrBotLocalTagger → #3 PreviewAny。 |

Detailer 修脚目前跟在画布的全局后处理汇合后。只有启用那些后处理时才会暴露顺序差异。本轮建议将它放到局部修复阶段，须先验证实际结果和旧分支设置。Anima 和 Advanced V40 的当前连线已在全局后处理前修脚。

## Advanced_Gemma_V40_AstrBot

画布 `AstrBot/Advanced_Gemma_V40_AstrBot.json`，203 个顶层节点，手动 API 文件 Advanced_Gemma_V40_AstrBot_API.json 有 34 个节点。随包 192 节点，运行文件 192 节点，默认可达 46，输出 #501。

随包与运行默认可达节点差异。运行独有 12 个，随包独有 0 个。
原 API 图差异节点 ID。#16, #500。

当前画布模式。正常 67，旁路 136，静音 0。子图展开后 API ID 使用 `父节点:子节点`。

<details>
<summary>默认 DAG 的完整节点顺序与关键输入连线</summary>

01. `#108 CheckpointLoaderSimple` · `#11 SAMLoader` · `#13 UltralyticsDetectorProvider` · `#14 UltralyticsDetectorProvider` · `#15 UltralyticsDetectorProvider` · `#16 UltralyticsDetectorProvider` · `#28 UltralyticsDetectorProvider` · `#497 UltralyticsDetectorProvider` · `#63 Input Parameters (Image Saver)` · `#68 PrimitiveFloat` · `#71 PrimitiveFloat` · `#73 easy int` · `#75 PrimitiveFloat` · `#77 easy int` · `#82 PrimitiveBoolean` · `#85 easy int`
02. `#102 EmptyLatentImage` · `#60 easy wildcards` · `#62 easy wildcards` · `#83 easy showAnything` · `#84 easy showAnything` · `#88 CLIPSetLastLayer`
03. `#61 Lora Loader (LoraManager)`
04. `#100 TriggerWord Toggle (LoraManager)` · `#89 CLIPNegPip`
05. `#112 CLIPTextEncode` · `#66 DifferentialDiffusion` · `#86 StringConcatenate` · `#87 StringConcatenate`
06. `#101 easy textSwitch`
07. `#90 RegexReplace`
08. `#107 CLIPTextEncode`
09. `#114 KSampler` · `#31 ToDetailerPipe`
10. `#106 VAEDecode` · `#19 EditDetailerPipe` · `#20 EditDetailerPipe` · `#21 EditDetailerPipe` · `#22 EditDetailerPipe` · `#498 EditDetailerPipe`
11. `#34 FaceDetailerPipe`
12. `#35 FaceDetailerPipe`
13. `#36 FaceDetailerPipe`
14. `#37 FaceDetailerPipe`
15. `#499 FaceDetailerPipe`
16. `#501 SaveImage`

- `#114 KSampler` ← model ← #89:0, seed ← #63:0, steps ← #63:1, cfg ← #63:2, sampler_name ← #83:0, scheduler ← #84:0, positive ← #107:0, negative ← #112:0, latent_image ← #102:0, denoise ← #63:5。
- `#106 VAEDecode` ← samples ← #114:0, vae ← #108:2。
- `#31 ToDetailerPipe` ← model ← #66:0, clip ← #89:1, vae ← #108:2, positive ← #107:0, negative ← #112:0, bbox_detector ← #28:0, sam_model_opt ← #11:0。
- `#19 EditDetailerPipe` ← detailer_pipe ← #31:0, bbox_detector ← #13:0。
- `#34 FaceDetailerPipe` ← image ← #106:0, detailer_pipe ← #19:0, guide_size ← #71:0, max_size ← #68:0, seed ← #63:0, cfg ← #63:2, sampler_name ← #83:0, scheduler ← #84:0, bbox_crop_factor ← #75:0, tiled_encode ← #82:0, tiled_decode ← #82:0。
- `#20 EditDetailerPipe` ← detailer_pipe ← #31:0, bbox_detector ← #14:0, segm_detector ← #14:1。
- `#35 FaceDetailerPipe` ← image ← #34:0, detailer_pipe ← #20:0, guide_size ← #71:0, max_size ← #68:0, seed ← #63:0, cfg ← #63:2, sampler_name ← #83:0, scheduler ← #84:0, bbox_crop_factor ← #75:0, tiled_encode ← #82:0, tiled_decode ← #82:0。
- `#21 EditDetailerPipe` ← detailer_pipe ← #31:0, bbox_detector ← #15:0。
- `#36 FaceDetailerPipe` ← image ← #35:0, detailer_pipe ← #21:0, guide_size ← #71:0, max_size ← #68:0, seed ← #63:0, cfg ← #63:2, sampler_name ← #83:0, scheduler ← #84:0, bbox_crop_factor ← #75:0, tiled_encode ← #82:0, tiled_decode ← #82:0。
- `#22 EditDetailerPipe` ← detailer_pipe ← #31:0, bbox_detector ← #16:0。
- `#37 FaceDetailerPipe` ← image ← #36:0, detailer_pipe ← #22:0, guide_size ← #71:0, max_size ← #68:0, seed ← #63:0, cfg ← #63:2, sampler_name ← #83:0, scheduler ← #84:0, bbox_crop_factor ← #75:0, tiled_encode ← #82:0, tiled_decode ← #82:0。
- `#498 EditDetailerPipe` ← detailer_pipe ← #31:0, bbox_detector ← #497:0。
- `#499 FaceDetailerPipe` ← image ← #37:0, detailer_pipe ← #498:0, guide_size ← #71:0, max_size ← #68:0, seed ← #63:0, cfg ← #63:2, sampler_name ← #83:0, scheduler ← #84:0, bbox_crop_factor ← #75:0, tiled_encode ← #82:0, tiled_decode ← #82:0。
- `#501 SaveImage` ← images ← #499:0。

</details>

### 已保存分支及单开关差异

- second_sampler 默认关，关联 #81, #74, #70。加入 #70 PrimitiveFloat, #74 easy int, #81 KSampler，连线 #106.samples #114:0 → #81:0。
- 4 默认关，关联 #162, #144, #137, #120, #119。加入 #119 LoadImage, #120 PrepImageForClipVision, #137 CLIPVisionEncode, #144 unCLIPConditioning, #162 CLIPVisionLoader，连线 #114.positive #107:0 → #144:0。
- 5 默认关，关联 #168, #161, #160, #159, #118, #117, #116。加入 #116 LoadImage, #117 LoadImage, #118 IPAdapterStyleComposition, #159 CLIPVisionLoader, #160 IPAdapterModelLoader, #161 PrepImageForClipVision, #168 PrepImageForClipVision，连线 #114.model #89:0 → #118:0。
- hands 默认开，关联 #34, #19, #13。移出 #13, #19, #34，连线 #35.image #34:0 → #106:0。
- nsfw_repair 默认开，关联 #35, #20, #14。移出 #14, #20, #35，连线 #36.image #35:0 → #34:0。
- face 默认开，关联 #36, #21, #15。移出 #15, #21, #36，连线 #37.image #36:0 → #35:0。
- eyes 默认开，关联 #37, #22, #16。移出 #16, #22, #37，连线 #499.image #37:0 → #36:0。
- upscale_post 默认关，关联 #186, #170, #158, #156, #150, #147, #140, #130, #129, #128。加入 #129 UpscaleModelLoader, #130 UltimateSDUpscale, #140 ControlNetLoader, #147 ComfyMathExpression, #150 ComfyMathExpression, #156 GetImageSize, #158 easy float, #170 ControlNetApplyAdvanced, #186 Canny，连线 #501.images #499:0 → #130:0。
- 14 默认关，关联 #132。加入 #132 ColorMatchV2，连线 #501.images #499:0 → #132:0。
- 17 默认关，关联 #177, #171, #164, #163, #121。加入 #121 LoadImage, #163 ControlNetApplyAdvanced, #171 ControlNetLoader, #177 OpenposePreprocessor，连线 #114.negative #112:0 → #163:1, #114.positive #107:0 → #163:0。
- 18 默认关，关联 #109。加入 #109 easy hiresFix，连线 #34.image #106:0 → #109:1。
- 21 默认关，关联 #113。加入 #113 VAELoader，连线 #106.vae #108:2 → #113:0, #31.vae #108:2 → #113:0。
- 22 默认关，关联 #133。加入 #133 JPEG artifacts removal FBCNN，连线 #501.images #499:0 → #133:0。
- 23 默认关，关联 #178, #172, #166, #165, #123。加入 #123 LoadImage, #165 ControlNetApplyAdvanced, #172 AIO_Preprocessor, #178 ControlNetLoader，连线 #114.negative #112:0 → #165:1, #114.positive #107:0 → #165:0。
- 24 默认关，关联 #51, #50, #49, #48, #47, #43, #41, #40, #39, #33, #30, #27, #26, #18, #7, #6, #5, #4, #3, #2, #1。加入 #1 LoadImage, #18 ConditioningSetAreaStrength, #2 LoadImage, #26 ConditioningSetAreaStrength, #27 ConditioningSetAreaStrength, #3 LoadImage, #30 SolidMask, #33 ImageResizeKJv2, #39 ImageToMask, #4 ImpactWildcardProcessor, #40 ImageToMask, #41 ImageToMask, #43 ImageResizeKJv2, #47 ImageResizeKJv2, #48 CLIPTextEncode, #49 CLIPTextEncode, #5 ImpactWildcardProcessor, #50 CLIPTextEncode, #51 AttentionCouplePPM, #6 ImpactWildcardProcessor, #7 ConditioningSetAreaStrength，连线 #114.model #89:0 → #51:0。
- 25 默认关，关联 #79, #72。加入 #72 ModelSamplingDiscrete, #79 Mahiro，连线 #114.model #89:0 → #79:0, #66.model #89:0 → #79:0。
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
- 26 默认关，关联 #154, #153。加入 #153 easy imageRemBg，连线 #501.images #499:0 → #153:0。
- 27 默认关，关联 #190, #183, #175, #174, #173。加入 #173 LoadImage, #174 CLIPVisionLoader, #175 IPAdapterAdvanced, #183 IPAdapterModelLoader, #190 PrepImageForClipVision，连线 #114.model #89:0 → #175:0。
- 28 默认开，关联 #11。移出 #11，连线 #31.sam_model_opt #11:0 → 无连线。
- 29 默认关，关联 #152, #151, #148, #145, #143, #142, #141, #138, #136, #135, #134。加入 #134 LoadImage, #135 easy int, #136 InvertMask, #138 MathExpression|pysssss, #141 MathExpression|pysssss, #142 easy int, #143 MathExpression|pysssss, #145 JoinImageWithAlpha, #148 ImageResizeKJv2, #151 easy int, #152 ImageCompositeMasked，连线 #501.images #499:0 → #152:0。
- 33 默认关，关联 #65。加入 #65 Epsilon Scaling，连线 #114.model #89:0 → #65:0, #66.model #89:0 → #65:0。
- 34 默认开，关联 #88。移出 #88，连线 #61.clip #88:0 → #108:1。
- 35 默认关，关联 #69。加入 #69 CFGZeroStar，连线 #114.model #89:0 → #69:0, #66.model #89:0 → #69:0。
- img2img 默认关，关联 #46, #45。加入 #0 LoadImage, #45 ImageResizeKJv2, #46 VAEEncode，移出 #102, #85，连线 #114.latent_image #102:0 → #46:0。
- 40 默认关，关联 #110。加入 #110 easy hiresFix，连线 #501.images #499:0 → #110:1。
- full_detailer 默认关，关联 #57, #54, #53。加入 #53 SolidMask, #54 MaskToSEGS, #57 DetailerForEach，连线 #34.image #106:0 → #57:0。
- 43 默认关，关联 #184, #169, #157, #155, #149, #146, #139, #126, #125。加入 #125 UpscaleModelLoader, #126 UltimateSDUpscale, #139 ControlNetLoader, #146 ComfyMathExpression, #149 ComfyMathExpression, #155 GetImageSize, #157 easy float, #169 ControlNetApplyAdvanced, #184 Canny，连线 #34.image #106:0 → #126:0。
- 101 默认关，关联 #182。加入 #182 Morphology，连线 #501.images #499:0 → #182:0。
- 102 默认关，关联 #180:214, #180:215, #180:216, #180:217。加入 #180:214 GLSLShader, #180:215 PrimitiveFloat, #180:216 PrimitiveFloat, #180:217 PrimitiveInt，连线 #501.images #499:0 → #180:214:0。
- 103 默认关，关联 #191。加入 #191 ImageQuantize，连线 #501.images #499:0 → #191:0。
- 104 默认关，关联 #188:413, #188:414, #188:415。加入 #188:413 GLSLShader, #188:414 PrimitiveFloat, #188:415 CustomCombo，连线 #501.images #499:0 → #188:413:0。
- 105 默认关，关联 #192。加入 #192 ImageSharpen，连线 #501.images #499:0 → #192:0。
- 106 默认关，关联 #181:208, #181:209, #181:210, #181:211, #181:212, #181:213。加入 #181:208 GLSLShader, #181:209 CustomCombo, #181:210 PrimitiveFloat, #181:211 PrimitiveFloat, #181:212 PrimitiveFloat, #181:213 PrimitiveFloat，连线 #501.images #499:0 → #181:208:0。
- 107 默认关，关联 #189。加入 #189 GLSLShader，连线 #501.images #499:0 → #189:0。
- 108 默认关，关联 #193。加入 #193 GLSLShader，连线 #501.images #499:0 → #193:0。
- 109 默认关，关联 #194。加入 #194 GLSLShader，连线 #501.images #499:0 → #194:0。
- 110 默认关，关联 #195。加入 #195 GLSLShader，连线 #501.images #499:0 → #195:0。
- 111 默认关，关联 #197。加入 #197 GLSLShader，连线 #501.images #499:0 → #197:0。
- 112 默认关，关联 #198。加入 #198 GLSLShader，连线 #501.images #499:0 → #198:0。
- 114 默认关，关联 #179。加入 #179 AdjustContrast，连线 #501.images #499:0 → #179:0。
- mask 默认关，关联 #56, #52。加入 #0 LoadImage, #52 MaskToSEGS, #56 DetailerForEach，连线 #34.image #106:0 → #56:0。
- sam_detailer 默认关，关联 #58, #55, #29, #25, #12。加入 #12 CheckpointLoaderSimple, #25 CLIPTextEncode, #29 SAM3_Detect, #55 MaskToSEGS, #58 DetailerForEach，连线 #34.image #106:0 → #58:0。
- 117 默认开，关联 #89。移出 #89，连线 #107.clip #89:1 → #61:1, #112.clip #89:1 → #61:1, #114.model #89:0 → #61:0, #31.clip #89:1 → #61:1, #66.model #89:0 → #61:0。
- 118 默认关，关联 #131。加入 #131 RTXVideoSuperResolution，连线 #501.images #499:0 → #131:0。
- free_detailer 默认关，关联 #38, #23, #17。加入 #17 UltralyticsDetectorProvider, #23 EditDetailerPipe, #38 FaceDetailerPipe，连线 #499.image #37:0 → #38:0。
- 121 默认关，关联 #44, #42, #32, #8。加入 #32 PrimitiveStringMultiline, #42 CLIPLoader, #44 CLIPTextEncode, #8 TextGenerate，移出 #107，连线 #114.positive #107:0 → #44:0, #31.positive #107:0 → #44:0。
- feet 默认开，关联 #497, #498, #499。移出 #497, #498, #499，连线 #501.images #499:0 → #37:0。
- metadata_saver 默认开，关联 #127, #128。可达节点和连线不变。

## Anima_I2I_AIO_AstrBot

画布 `AstrBot/Anima_I2I_AIO_AstrBot.json`，79 个顶层节点，手动 API 文件 Anima_I2I_AIO_AstrBot_API.json 有 12 个节点。随包 36 节点，运行文件 36 节点，默认可达 11，输出 #1649。

随包与运行默认可达节点差异。运行独有 0 个，随包独有 0 个。
原 API 图差异节点 ID。无。

当前画布模式。正常 53，旁路 26，静音 0。子图展开后 API ID 使用 `父节点:子节点`。

<details>
<summary>默认 DAG 的完整节点顺序与关键输入连线</summary>

01. `#1073 CLIPLoader` · `#1074 VAELoader` · `#1427 EmptyLatentImage` · `#1610 String` · `#1611 String` · `#1758 UNETLoader`
02. `#1636 CLIPTextEncode` · `#1638 CLIPTextEncode`
03. `#118 KSampler`
04. `#119 VAEDecode`
05. `#1649 SaveImage`

- `#118 KSampler` ← model ← #1758:0, positive ← #1636:0, negative ← #1638:0, latent_image ← #1427:0。
- `#119 VAEDecode` ← samples ← #118:0, vae ← #1074:0。
- `#1649 SaveImage` ← images ← #119:0。

</details>

### 图生图、模型及输出选择

- 带参考图。加入 #1426 VAEEncode, #1608 LoadImage，移出 #1427，连线 #118.latent_image #1427:0 → #1426:0。
- loader = Booster。加入 #1077 AnimaBoosterLoader，移出 #1758，连线 #118.model #1758:0 → #1077:0。
- latent = 遮罩重绘。加入 #1424 VAEEncodeForInpaint, #1608 LoadImage，移出 #1427，连线 #118.latent_image #1427:0 → #1424:0。
- size = 比例与像素数。加入 #1425 ResolutionSelector, #1428 EmptyLatentImage，移出 #1427，连线 #118.latent_image #1427:0 → #1428:0。
- control = 参考图 LLLite。加入 #1038 AnimaLLLiteApply_sdscripts, #1426 VAEEncode, #1608 LoadImage，移出 #1427，连线 #118.latent_image #1427:0 → #1426:0, #118.model #1758:0 → #1038:0。
- control = 深度 LLLite。加入 #1038 AnimaLLLiteApply_sdscripts, #1370 AIO_Preprocessor, #1426 VAEEncode, #1608 LoadImage，移出 #1427，连线 #118.latent_image #1427:0 → #1426:0, #118.model #1758:0 → #1038:0。
- control = Inpaint LLLite。加入 #1039 AnimaLLLiteApply_sdscripts, #1424 VAEEncodeForInpaint, #1608 LoadImage，移出 #1427，连线 #118.latent_image #1427:0 → #1424:0, #118.model #1758:0 → #1039:0。
- upscale = Ultimate SD Upscale。加入 #1665 UltimateSDUpscale, #279 UpscaleModelLoader，连线 #1649.images #119:0 → #1665:0。
- upscale = RTX VSR。加入 #1818 RTXVideoSuperResolution，连线 #1649.images #119:0 → #1818:0。
- upscale = VOSR2。加入 #1824 VOSR2Upscale, #1825 VOSR2ModelLoader，连线 #1649.images #119:0 → #1824:0。
- 切换 teacache。加入 #1076 AnimaTeaCache，连线 #118.model #1758:0 → #1076:0。
- 切换 sage。加入 #1687 PathchSageAttentionKJ，连线 #118.model #1758:0 → #1687:0。
- 切换 artists。加入 #1689 AnimaArtistOptions, #1690 AnimaArtistPack, #1691 AnimaArtistAdapterMixer，移出 #1636，连线 #118.model #1758:0 → #1691:0, #118.positive #1636:0 → #1691:1。
- 切换 cleanup。加入 #1011 VRAMCleanup，连线 #1649.images #119:0 → #1011:0。
- 切换 1846。加入 #1846 LoraLoader，连线 #118.model #1758:0 → #1846:0, #1636.clip #1073:0 → #1846:1, #1638.clip #1073:0 → #1846:1。
- 切换 1850。加入 #1850 LoraLoader，连线 #118.model #1758:0 → #1850:0, #1636.clip #1073:0 → #1850:1, #1638.clip #1073:0 → #1850:1。
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 137)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 108)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 107)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 106)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 105)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 104)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 92)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 81)
Could not map widget_values for unknown node type 'Image Comparer (rgthree)' (node 80)
Could not map widget_values for unknown node type 'easy showAnything' (node 69)
Could not map widget_values for unknown node type 'easy showAnything' (node 68)
- 切换 1849。加入 #1849 LoraLoader，连线 #118.model #1758:0 → #1849:0, #1636.clip #1073:0 → #1849:1, #1638.clip #1073:0 → #1849:1。
- 切换 1847。加入 #1847 LoraLoader，连线 #118.model #1758:0 → #1847:0, #1636.clip #1073:0 → #1847:1, #1638.clip #1073:0 → #1847:1。
- 切换 1848。加入 #1848 LoraLoader，连线 #118.model #1758:0 → #1848:0, #1636.clip #1073:0 → #1848:1, #1638.clip #1073:0 → #1848:1。

## Anima_Reverse_AstrBot

画布 `AstrBot/Anima_反推流_AstrBot.json`，7 个顶层节点，手动 API 文件 Anima_反推流_AstrBot_API.json 有 4 个节点。随包 6 节点，运行文件 6 节点，默认可达 6，输出 #445。

随包与运行默认可达节点差异。运行独有 2 个，随包独有 0 个。
原 API 图差异节点 ID。#400。

当前画布模式。正常 4，旁路 0，静音 3。

<details>
<summary>默认 DAG 的完整节点顺序与关键输入连线</summary>

01. `#398 LoadImage`
02. `#416 PixAITaggerPlus`
03. `#400 TIPO` · `#443 RegexReplace`
04. `#444 StringConcatenate`
05. `#445 PreviewAny`

- `#445 PreviewAny` ← source ← #444:0。

</details>

### 可选 TIPO 扩写

- 切换 expand_caption。移出 #400, #444，连线 #445.source #444:0 → #443:0。

## Anima_T2I_AstrBot

画布 `AstrBot/Anima_T2I_AstrBot.json`，144 个顶层节点，对应手动 API 文件未找到。随包 24 节点，运行文件 47 节点，默认可达 47，输出 #510。

随包与运行默认可达节点差异。运行独有 23 个，随包独有 0 个。
原 API 图差异节点 ID。#28, #29, #31, #32, #33, #34, #36, #37, #38, #39, #41, #497, #512, #513, #514, #52, #53, #54, #55, #56, #62, #66, #67, #71, #74, #76。

当前画布模式。正常 50，旁路 93，静音 1。子图展开后 API ID 使用 `父节点:子节点`。

<details>
<summary>默认 DAG 的完整节点顺序与关键输入连线</summary>

01. `#22 UNETLoader` · `#28 UltralyticsDetectorProvider` · `#29 SAMLoader` · `#31 UltralyticsDetectorProvider` · `#32 UltralyticsDetectorProvider` · `#33 UltralyticsDetectorProvider` · `#34 UltralyticsDetectorProvider` · `#40 CLIPLoader` · `#48 VAELoader` · `#50 Input Parameters (Image Saver)` · `#512 UltralyticsDetectorProvider` · `#62 PrimitiveFloat` · `#66 PrimitiveFloat` · `#67 easy int` · `#71 PrimitiveFloat` · `#74 easy int` · `#76 PrimitiveBoolean` · `#77 easy int`
02. `#26 Lora Loader (LoraManager)` · `#504 easy wildcards` · `#507 easy wildcards` · `#68 easy showAnything` · `#69 easy showAnything` · `#85 EmptyLatentImage`
03. `#499 Any Switch (rgthree)` · `#65 TriggerWord Toggle (LoraManager)` · `#84 CLIPNegPip`
04. `#52 DifferentialDiffusion` · `#78 StringConcatenate` · `#83 CLIPTextEncode`
05. `#82 RegexReplace`
06. `#79 CLIPTextEncode`
07. `#27 KSampler` · `#41 ToDetailerPipe`
08. `#36 EditDetailerPipe` · `#37 EditDetailerPipe` · `#38 EditDetailerPipe` · `#39 EditDetailerPipe` · `#513 EditDetailerPipe` · `#73 VAEDecode`
09. `#53 FaceDetailerPipe`
10. `#54 FaceDetailerPipe`
11. `#55 FaceDetailerPipe`
12. `#56 FaceDetailerPipe`
13. `#514 FaceDetailerPipe`
14. `#497 Any Switch (rgthree)`
15. `#510 SaveImage`

- `#27 KSampler` ← model ← #84:0, seed ← #50:0, steps ← #50:1, cfg ← #50:2, sampler_name ← #69:0, scheduler ← #68:0, positive ← #79:0, negative ← #83:0, latent_image ← #499:0, denoise ← #50:5。
- `#73 VAEDecode` ← samples ← #27:0, vae ← #48:0。
- `#41 ToDetailerPipe` ← model ← #52:0, clip ← #84:1, vae ← #48:0, positive ← #79:0, negative ← #83:0, bbox_detector ← #28:0, sam_model_opt ← #29:0。
- `#36 EditDetailerPipe` ← detailer_pipe ← #41:0, bbox_detector ← #31:0。
- `#53 FaceDetailerPipe` ← image ← #73:0, detailer_pipe ← #36:0, guide_size ← #66:0, max_size ← #62:0, seed ← #50:0, cfg ← #50:2, sampler_name ← #69:0, scheduler ← #68:0, bbox_crop_factor ← #71:0, tiled_encode ← #76:0, tiled_decode ← #76:0。
- `#37 EditDetailerPipe` ← detailer_pipe ← #41:0, bbox_detector ← #32:0, segm_detector ← #32:1。
- `#54 FaceDetailerPipe` ← image ← #53:0, detailer_pipe ← #37:0, guide_size ← #66:0, max_size ← #62:0, seed ← #50:0, cfg ← #50:2, sampler_name ← #69:0, scheduler ← #68:0, bbox_crop_factor ← #71:0, tiled_encode ← #76:0, tiled_decode ← #76:0。
- `#38 EditDetailerPipe` ← detailer_pipe ← #41:0, bbox_detector ← #33:0。
- `#55 FaceDetailerPipe` ← image ← #54:0, detailer_pipe ← #38:0, guide_size ← #66:0, max_size ← #62:0, seed ← #50:0, cfg ← #50:2, sampler_name ← #69:0, scheduler ← #68:0, bbox_crop_factor ← #71:0, tiled_encode ← #76:0, tiled_decode ← #76:0。
- `#39 EditDetailerPipe` ← detailer_pipe ← #41:0, bbox_detector ← #34:0。
- `#56 FaceDetailerPipe` ← image ← #55:0, detailer_pipe ← #39:0, guide_size ← #66:0, max_size ← #62:0, seed ← #50:0, cfg ← #50:2, sampler_name ← #69:0, scheduler ← #68:0, bbox_crop_factor ← #71:0, tiled_encode ← #76:0, tiled_decode ← #76:0。
- `#513 EditDetailerPipe` ← detailer_pipe ← #41:0, bbox_detector ← #512:0。
- `#514 FaceDetailerPipe` ← image ← #56:0, detailer_pipe ← #513:0, guide_size ← #66:0, max_size ← #62:0, seed ← #50:0, cfg ← #50:2, sampler_name ← #69:0, scheduler ← #68:0, bbox_crop_factor ← #71:0, tiled_encode ← #76:0, tiled_decode ← #76:0。
- `#510 SaveImage` ← images ← #497:0。

</details>

### 画布旁路组及重导出差异

- #3 Load Image，保存默认关，画布节点 #59, #57, #21。 加入 #21 LoadImage, #57 ImageResizeKJv2, #59 VAEEncode，连线 #499.any_01 无连线 → #59:0。
- #4 Save Image，保存默认开，画布节点 #510。 可达节点和连线不变。
- #5 Hand ADetailer，保存默认开，画布节点 #53, #36, #31。 移出 #31, #36, #53，连线 #54.image #53:0 → #73:0。
- #7 NSFW ADetailer，保存默认开，画布节点 #54, #37, #32。 移出 #32, #37, #54，连线 #55.image #54:0 → #53:0。
- #8 Face ADetailer，保存默认开，画布节点 #55, #38, #33。 移出 #33, #38, #55，连线 #56.image #55:0 → #54:0。
- #9 Eyes ADetailer，保存默认开，画布节点 #56, #39, #34。 移出 #34, #39, #56，连线 #514.image #56:0 → #55:0。
- #123 Feet ADetailer / 修脚，保存默认开，画布节点 #512, #513, #514。 移出 #512, #513, #514，连线 #497.any_01 #514:0 → #56:0, #497.any_02 #514:0 → #56:0。
- #10 Use SAMLoader，保存默认开，画布节点 #29。 移出 #29，连线 #41.sam_model_opt #29:0 → 无连线。
- #12 Detailer，保存默认关，画布节点 #47, #45, #44。 加入 #44 SolidMask, #45 MaskToSEGS, #47 DetailerForEach，连线 #53.image #73:0 → #47:0。
- #13 Hires PreDetailer，保存默认关，画布节点 #93。 加入 #93 easy hiresFix，连线 #53.image #73:0 → #93:1。
- #14 Hires PostDetailer，保存默认关，画布节点 #94。 加入 #94 easy hiresFix，连线 #497.any_01 #514:0 → #94:1, #497.any_02 #514:0 → #94:1。
- #15 2ndSampler，保存默认关，画布节点 #51。 加入 #51 KSampler，连线 #73.samples #27:0 → #51:0。
- #16 Apply Signature，保存默认关，画布节点 #135, #133, #132, #128, #127, #126, #125, #121, #117, #116, #115。 加入 #115 LoadImage, #116 easy int, #117 InvertMask, #121 ImageCompositeMasked, #125 MathExpression|pysssss, #126 MathExpression|pysssss, #127 easy int, #128 MathExpression|pysssss, #132 JoinImageWithAlpha, #133 ImageResizeKJv2, #135 easy int，连线 #497.any_01 #514:0 → #121:0。
- #17 Remove Background，保存默认关，画布节点 #124。 加入 #124 easy imageRemBg，连线 #497.any_01 #514:0 → #124:0, #497.any_02 #514:0 → #124:0。
- #19 Ultimate SD Upscaler，保存默认关，画布节点 #134, #118, #100, #91, #90。 加入 #100 ComfyMathExpression, #118 ComfyMathExpression, #134 GetImageSize, #90 UpscaleModelLoader, #91 UltimateSDUpscale，连线 #497.any_01 #514:0 → #91:0, #497.any_02 #514:0 → #91:0。
- #21 Color Match，保存默认关，画布节点 #123。 加入 #123 ColorMatchV2，连线 #497.any_01 #514:0 → #123:0, #497.any_02 #514:0 → #123:0。
- #99 CFGZeroStar，保存默认关，画布节点 #75。 加入 #75 CFGZeroStar，连线 #27.model #84:0 → #75:0, #52.model #84:0 → #75:0。
- #100 Mask Detailer，保存默认关，画布节点 #46, #43。 加入 #43 MaskToSEGS, #46 DetailerForEach，连线 #53.image #73:0 → #46:0。
- #102 Image Levels，保存默认关，画布节点 #96。 加入 #96:403 CustomCombo, #96:404 PrimitiveFloat, #96:405 PrimitiveFloat, #96:406 PrimitiveFloat, #96:407 PrimitiveFloat, #96:408 PrimitiveFloat, #96:409 GLSLShader，连线 #497.any_01 #514:0 → #96:409:0, #497.any_02 #514:0 → #96:409:0。
- #103 ImageMorphology，保存默认关，画布节点 #99。 加入 #99 Morphology，连线 #497.any_01 #514:0 → #99:0, #497.any_02 #514:0 → #99:0。
- #104 Edge-Preserving Blur，保存默认关，画布节点 #97。 加入 #97:410 GLSLShader, #97:411 PrimitiveFloat, #97:412 PrimitiveFloat, #97:413 PrimitiveInt，连线 #497.any_01 #514:0 → #97:410:0, #497.any_02 #514:0 → #97:410:0。
- #105 ImageQuantize，保存默认关，画布节点 #109。 加入 #109 ImageQuantize，连线 #497.any_01 #514:0 → #109:0, #497.any_02 #514:0 → #109:0。
- #106 Chromatic Aberration，保存默认关，画布节点 #101。 加入 #101:420 GLSLShader, #101:421 PrimitiveFloat, #101:422 CustomCombo，连线 #497.any_01 #514:0 → #101:420:0, #497.any_02 #514:0 → #101:420:0。
- #107 ImageSharpen，保存默认关，画布节点 #110。 加入 #110 ImageSharpen，连线 #497.any_01 #514:0 → #110:0, #497.any_02 #514:0 → #110:0。
- #108 Film Grain，保存默认关，画布节点 #98。 加入 #98:414 GLSLShader, #98:415 CustomCombo, #98:416 PrimitiveFloat, #98:417 PrimitiveFloat, #98:418 PrimitiveFloat, #98:419 PrimitiveFloat，连线 #497.any_01 #514:0 → #98:414:0, #497.any_02 #514:0 → #98:414:0。
- #109 VHS TV，保存默认关，画布节点 #102。 加入 #102 GLSLShader，连线 #497.any_01 #514:0 → #102:0, #497.any_02 #514:0 → #102:0。
- #110 Pixelation，保存默认关，画布节点 #103。 加入 #103 GLSLShader，连线 #497.any_01 #514:0 → #103:0, #497.any_02 #514:0 → #103:0。
- #111 Digital Glitch，保存默认关，画布节点 #112。 加入 #112 GLSLShader，连线 #497.any_01 #514:0 → #112:0, #497.any_02 #514:0 → #112:0。
- #112 Night Vision，保存默认关，画布节点 #113。 加入 #113 GLSLShader，连线 #497.any_01 #514:0 → #113:0, #497.any_02 #514:0 → #113:0。
- #113 Blueprint，保存默认关，画布节点 #114。 加入 #114 GLSLShader，连线 #497.any_01 #514:0 → #114:0, #497.any_02 #514:0 → #114:0。
- #114 Frosted Glass，保存默认关，画布节点 #119。 加入 #119 GLSLShader，连线 #497.any_01 #514:0 → #119:0, #497.any_02 #514:0 → #119:0。
- #115 Gameboy，保存默认关，画布节点 #120。 加入 #120 GLSLShader，连线 #497.any_01 #514:0 → #120:0, #497.any_02 #514:0 → #120:0。
- #117 Contrast，保存默认关，画布节点 #95。 加入 #95 AdjustContrast，连线 #497.any_01 #514:0 → #95:0, #497.any_02 #514:0 → #95:0。
- #118 Any Detailer (SAM 3.1)，保存默认关，画布节点 #63, #61, #60, #49, #42, #30。 加入 #30 CheckpointLoaderSimple, #42 CLIPTextEncode, #49 SAM3_Detect, #60 GrowMask, #61 MaskToSEGS, #63 DetailerForEach，连线 #53.image #73:0 → #63:0。
- #119 Regional Prompting，保存默认关，画布节点 #20, #19, #18, #17, #16, #15, #14, #13, #12, #11, #10, #9, #8, #7, #6, #5, #4, #3, #2, #1, #0。 加入 #0 LoadImage, #1 LoadImage, #10 SolidMask, #11 ImageResizeKJv2, #12 ImageToMask, #13 ImageToMask, #14 ImageToMask, #15 ImageResizeKJv2, #16 ImageResizeKJv2, #17 CLIPTextEncode, #18 CLIPTextEncode, #19 CLIPTextEncode, #2 LoadImage, #20 AttentionCouplePPM, #3 ImpactWildcardProcessor, #4 ImpactWildcardProcessor, #5 ImpactWildcardProcessor, #6 ConditioningSetAreaStrength, #7 ConditioningSetAreaStrength, #8 ConditioningSetAreaStrength, #9 ConditioningSetAreaStrength，连线 #27.model #84:0 → #20:0。
- #120 ControlNet LLLite，保存默认关，画布节点 #138, #131, #130, #129。 加入 #129 LoadImage, #130 AIO_Preprocessor, #131 AnimaLLLiteApply, #138 ModelPatchLoader，连线 #27.model #84:0 → #131:0, #52.model #84:0 → #131:0。
- #121 CLIP NegPip，保存默认开，画布节点 #84。 移出 #84，连线 #27.model #84:0 → #26:0, #41.clip #84:1 → #26:1, #52.model #84:0 → #26:0, #79.clip #84:1 → #26:1, #83.clip #84:1 → #26:1。
- #122 RTX Upscale，保存默认关，画布节点 #122。 加入 #122 RTXVideoSuperResolution，连线 #497.any_01 #514:0 → #122:0, #497.any_02 #514:0 → #122:0。

## Detailer_V40_AstrBot

画布 `AstrBot/Detailer_V40_AstrBot.json`，137 个顶层节点，手动 API 文件 Detailer_V40_AstrBot_API.json 有 30 个节点。随包 140 节点，运行文件 140 节点，默认可达 44，输出 #32。

随包与运行默认可达节点差异。运行独有 16 个，随包独有 1 个。
原 API 图差异节点 ID。#17, #500。

当前画布模式。正常 48，旁路 89，静音 0。子图展开后 API ID 使用 `父节点:子节点`。

<details>
<summary>默认 DAG 的完整节点顺序与关键输入连线</summary>

01. `#101 PrimitiveBoolean` · `#102 PrimitiveFloat` · `#12 easy int` · `#14 UltralyticsDetectorProvider` · `#15 UltralyticsDetectorProvider` · `#16 UltralyticsDetectorProvider` · `#17 UltralyticsDetectorProvider` · `#2 LoadImage` · `#25 easy float` · `#497 UltralyticsDetectorProvider` · `#79 SeedNode` · `#82 SAMLoader` · `#91 CheckpointLoaderSimple` · `#92 PrimitiveFloat` · `#93 PrimitiveFloat` · `#94 PrimitiveFloat` · `#98 UltralyticsDetectorProvider`
02. `#1 easy wildcards` · `#20 GetImageSize` · `#3 Lora Loader (LoraManager)` · `#66 easy wildcards`
03. `#10 SolidMask` · `#108 CLIPTextEncode` · `#110 DifferentialDiffusion` · `#67 TriggerWord Toggle (LoraManager)`
04. `#104 StringConcatenate` · `#11 MaskToSEGS`
05. `#109 RegexReplace`
06. `#103 CLIPTextEncode`
07. `#113 ToBasicPipe` · `#114 ToDetailerPipe`
08. `#23 DetailerForEachPipe` · `#27 EditDetailerPipe` · `#28 EditDetailerPipe` · `#29 EditDetailerPipe` · `#30 EditDetailerPipe` · `#498 EditDetailerPipe`
09. `#37 MaskDetailerPipe`
10. `#55 FaceDetailerPipe`
11. `#56 FaceDetailerPipe`
12. `#57 FaceDetailerPipe`
13. `#58 FaceDetailerPipe`
14. `#499 FaceDetailerPipe`
15. `#32 SaveImage`

- `#23 DetailerForEachPipe` ← image ← #2:0, segs ← #11:0, guide_size ← #93:0, max_size ← #102:0, seed ← #79:0, cfg ← #94:0, basic_pipe ← #113:0, tiled_encode ← #101:0, tiled_decode ← #101:0。
- `#37 MaskDetailerPipe` ← image ← #23:0, mask ← #2:1, basic_pipe ← #113:0, guide_size ← #93:0, max_size ← #102:0, seed ← #79:0, steps ← #12:0, cfg ← #94:0, denoise ← #25:0, crop_factor ← #92:0。
- `#114 ToDetailerPipe` ← model ← #110:0, clip ← #3:1, vae ← #91:2, positive ← #103:0, negative ← #108:0, bbox_detector ← #98:0, sam_model_opt ← #82:0。
- `#27 EditDetailerPipe` ← detailer_pipe ← #114:0, bbox_detector ← #14:0。
- `#55 FaceDetailerPipe` ← image ← #37:0, detailer_pipe ← #27:0, guide_size ← #93:0, max_size ← #102:0, seed ← #79:0, cfg ← #94:0, bbox_crop_factor ← #92:0, tiled_encode ← #101:0, tiled_decode ← #101:0。
- `#28 EditDetailerPipe` ← detailer_pipe ← #114:0, bbox_detector ← #15:0, segm_detector ← #15:1。
- `#56 FaceDetailerPipe` ← image ← #55:0, detailer_pipe ← #28:0, guide_size ← #93:0, max_size ← #102:0, seed ← #79:0, cfg ← #94:0, bbox_crop_factor ← #92:0, tiled_encode ← #101:0, tiled_decode ← #101:0。
- `#29 EditDetailerPipe` ← detailer_pipe ← #114:0, bbox_detector ← #16:0。
- `#57 FaceDetailerPipe` ← image ← #56:0, detailer_pipe ← #29:0, guide_size ← #93:0, max_size ← #102:0, seed ← #79:0, cfg ← #94:0, bbox_crop_factor ← #92:0, tiled_encode ← #101:0, tiled_decode ← #101:0。
- `#30 EditDetailerPipe` ← detailer_pipe ← #114:0, bbox_detector ← #17:0。
- `#58 FaceDetailerPipe` ← image ← #57:0, detailer_pipe ← #30:0, guide_size ← #93:0, max_size ← #102:0, seed ← #79:0, cfg ← #94:0, bbox_crop_factor ← #92:0, tiled_encode ← #101:0, tiled_decode ← #101:0。
- `#498 EditDetailerPipe` ← detailer_pipe ← #114:0, bbox_detector ← #497:0。
- `#499 FaceDetailerPipe` ← image ← #58:0, detailer_pipe ← #498:0, guide_size ← #93:0, max_size ← #102:0, seed ← #79:0, cfg ← #94:0, bbox_crop_factor ← #92:0, tiled_encode ← #101:0, tiled_decode ← #101:0。
- `#32 SaveImage` ← images ← #499:0。

</details>

### 已保存分支及单开关差异

- 11 默认关，关联 #40。加入 #40 ColorMatchV2，连线 #499.image #58:0 → #40:0。
- 15 默认关，关联 #7。加入 #7 easy hiresFix，连线 #20.image #2:0 → #7:1, #23.image #2:0 → #7:1。
- 18 默认关，关联 #5。加入 #5 VAELoader，连线 #113.vae #91:2 → #5:0, #114.vae #91:2 → #5:0。
- 19 默认关，关联 #59。加入 #59 JPEG artifacts removal FBCNN，连线 #499.image #58:0 → #59:0。
- mask 默认开，关联 #37, #25, #12。移出 #12, #25, #37，连线 #55.image #37:0 → #23:0。
- hands 默认开，关联 #55, #27, #14。移出 #14, #27, #55，连线 #56.image #55:0 → #37:0。
- nsfw_repair 默认开，关联 #56, #28, #15。移出 #15, #28, #56，连线 #57.image #56:0 → #55:0。
- face 默认开，关联 #57, #29, #16。移出 #16, #29, #57，连线 #58.image #57:0 → #56:0。
- eyes 默认开，关联 #58, #30, #17。移出 #17, #30, #58，连线 #499.image #58:0 → #57:0。
- 26 默认关，关联 #73。可达节点和连线不变。
- 27 默认关，关联 #77, #75, #72, #71, #49, #43, #35, #21, #8。加入 #21 easy float, #35 ControlNetLoader, #43 InpaintPreprocessor, #49 ControlNetApplyAdvanced, #71 VAEEncode, #72 VAEDecode, #75 SetLatentNoiseMask, #77 KSampler, #8 easy int，连线 #20.image #2:0 → #72:0, #23.image #2:0 → #72:0。
- 28 默认关，关联 #96, #90, #84, #83, #69, #50, #44, #36, #22, #9。加入 #22 easy float, #36 ControlNetLoader, #44 InpaintPreprocessor, #50 ImagePadForOutpaint, #69 ControlNetApplyAdvanced, #83 VAEEncode, #84 VAEDecode, #9 easy int, #90 SetLatentNoiseMask, #96 KSampler，连线 #20.image #2:0 → #84:0, #23.image #2:0 → #84:0。
- 29 默认关，关联 #63, #62, #61, #60, #54, #53, #47, #26, #6。加入 #26 SegmDetectorSEGS, #47 ControlNetLoader, #53 InpaintPreprocessor, #54 SegsToCombinedMask, #6 UltralyticsDetectorProvider, #60 ControlNetApplyAdvanced, #61 VAEEncodeForInpaint, #62 KSampler, #63 VAEDecode，连线 #20.image #2:0 → #63:0, #23.image #2:0 → #63:0。
- 30 默认关，关联 #52, #51, #46, #41, #39, #38, #34, #33, #24, #18。加入 #18 ControlNetLoader, #24 UpscaleModelLoader, #33 UltimateSDUpscale, #34 ControlNetApplyAdvanced, #38 MathExpression|pysssss, #39 MathExpression|pysssss, #41 easy float, #46 easy int, #51 Canny, #52 easy float，连线 #499.image #58:0 → #33:0。
- 31 默认开，关联 #82。移出 #82，连线 #114.sam_model_opt #82:0 → 无连线。
- 32 默认关，关联 #74, #64。加入 #64 ModelSamplingDiscrete, #74 Mahiro，连线 #110.model #3:0 → #74:0。
- 33 默认关，关联 #48。加入 #48 CLIPSetLastLayer，连线 #3.clip #91:1 → #48:0。
- 36 默认关，关联 #76。加入 #76 easy imageRemBg，连线 #499.image #58:0 → #76:0。
- 37 默认关，关联 #97。加入 #97 Epsilon Scaling，连线 #110.model #3:0 → #97:0。
- 38 默认关，关联 #80。加入 #80 CFGZeroStar，连线 #110.model #3:0 → #80:0。
- 39 默认关，关联 #117, #116, #115, #107, #105, #100, #95, #81, #78, #70。加入 #100 ImageResizeKJv2, #105 InvertMask, #107 MathExpression|pysssss, #115 MathExpression|pysssss, #116 MathExpression|pysssss, #117 ImageCompositeMasked, #70 easy int, #78 easy int, #81 easy int, #95 LoadImage，连线 #499.image #58:0 → #117:0。
- full_detailer 默认开，关联 #23, #20, #11, #10。移出 #10, #11, #20, #23，连线 #37.image #23:0 → #2:0。
- 117 默认关，关联 #122。加入 #122 Morphology，连线 #499.image #58:0 → #122:0。
- 118 默认关，关联 #120:190, #120:191, #120:192, #120:193。加入 #120:190 GLSLShader, #120:191 PrimitiveFloat, #120:192 PrimitiveFloat, #120:193 PrimitiveInt，连线 #499.image #58:0 → #120:190:0。
- 119 默认关，关联 #125。加入 #125 ImageQuantize，连线 #499.image #58:0 → #125:0。
- 120 默认关，关联 #123:413, #123:414, #123:415。加入 #123:413 GLSLShader, #123:414 PrimitiveFloat, #123:415 CustomCombo，连线 #499.image #58:0 → #123:413:0。
- 121 默认关，关联 #126。加入 #126 ImageSharpen，连线 #499.image #58:0 → #126:0。
- 122 默认关，关联 #121:184, #121:185, #121:186, #121:187, #121:188, #121:189。加入 #121:184 GLSLShader, #121:185 CustomCombo, #121:186 PrimitiveFloat, #121:187 PrimitiveFloat, #121:188 PrimitiveFloat, #121:189 PrimitiveFloat，连线 #499.image #58:0 → #121:184:0。
- 123 默认关，关联 #124。加入 #124 GLSLShader，连线 #499.image #58:0 → #124:0。
- 124 默认关，关联 #127。加入 #127 GLSLShader，连线 #499.image #58:0 → #127:0。
- 125 默认关，关联 #128。加入 #128 GLSLShader，连线 #499.image #58:0 → #128:0。
- 126 默认关，关联 #129。加入 #129 GLSLShader，连线 #499.image #58:0 → #129:0。
- 127 默认关，关联 #131。加入 #131 GLSLShader，连线 #499.image #58:0 → #131:0。
- 128 默认关，关联 #132。加入 #132 GLSLShader，连线 #499.image #58:0 → #132:0。
- 130 默认关，关联 #119。加入 #119 AdjustContrast，连线 #499.image #58:0 → #119:0。
- sam_detailer 默认关，关联 #68, #65, #45, #31, #13。加入 #13 CheckpointLoaderSimple, #31 CLIPTextEncode, #45 SAM3_Detect, #65 GrowMask, #68 MaskDetailerPipe，连线 #55.image #37:0 → #68:0。
- 132 默认关，关联 #19。加入 #19 RTXVideoSuperResolution，连线 #499.image #58:0 → #19:0。
- feet 默认开，关联 #497, #498, #499。移出 #497, #498, #499，连线 #32.images #499:0 → #58:0。

## SDXL_Turbo_T2I_AstrBot

画布 `main/sdxlturbo.json`，11 个顶层节点，对应手动 API 文件未找到。随包 10 节点，运行文件 10 节点，默认可达 10，输出 #27。

随包与运行默认可达节点差异。运行独有 0 个，随包独有 0 个。
原 API 图差异节点 ID。无。

当前画布模式。正常 11，旁路 0，静音 0。

<details>
<summary>默认 DAG 的完整节点顺序与关键输入连线</summary>

01. `#14 KSamplerSelect` · `#20 CheckpointLoaderSimple` · `#29 Primitive string [Crystools]` · `#5 EmptyLatentImage`
02. `#22 SDTurboScheduler` · `#6 CLIPTextEncode` · `#7 CLIPTextEncode`
03. `#13 SamplerCustom`
04. `#8 VAEDecode`
05. `#27 SaveImage`

- `#14 KSamplerSelect` ← 。
- `#8 VAEDecode` ← samples ← #13:0, vae ← #20:2。
- `#27 SaveImage` ← images ← #8:0。

</details>

## WAI-Illustrious_T2I_AstrBot

画布 `AstrBot/WAI-Illustrious_T2I_AstrBot.json`，47 个顶层节点，手动 API 文件 WAI-Illustrious_T2I_AstrBot_API.json 有 38 个节点。随包 47 节点，运行文件 47 节点，默认可达 45，输出 #37。

随包与运行默认可达节点差异。运行独有 7 个，随包独有 0 个。
原 API 图差异节点 ID。#244, #245, #247。

当前画布模式。正常 45，旁路 2，静音 0。

<details>
<summary>默认 DAG 的完整节点顺序与关键输入连线</summary>

01. `#100 ttN text` · `#107 EmptyLatentImage` · `#109 PrimitiveInt` · `#120 UpscaleModelLoader` · `#125 UltralyticsDetectorProvider` · `#128 ControlNetLoader` · `#195 ttN text` · `#206 SAMLoader` · `#213 UltralyticsDetectorProvider` · `#227 RandomNoise` · `#228 KSamplerSelect` · `#88 CheckpointLoaderSimple` · `#98 ttN text`
02. `#105 CLIPTextEncode` · `#126 ModelSamplingDiscrete` · `#129 SetUnionControlNetType` · `#172 CLIPTextEncodeWithWeight //Inspire` · `#198 CLIPTextEncode` · `#205 CLIPTextEncodeWithWeight //Inspire` · `#218 smZ CLIPTextEncode` · `#219 smZ CLIPTextEncode`
03. `#173 ConditioningCombine` · `#204 ConditioningCombine` · `#87 ToBasicPipe`
04. `#180 ToDetailerPipe` · `#202 ToDetailerPipe` · `#245 ImpactKSamplerAdvancedBasicPipe`
05. `#244 ImpactKSamplerAdvancedBasicPipe`
06. `#247 ImpactKSamplerAdvancedBasicPipe`
07. `#118 VAEDecode`
08. `#22 ImageUpscaleWithModel`
09. `#24 ImageScale`
10. `#211 FaceDetailerPipe`
11. `#185 VAEEncode` · `#astrbot_wai_canny Canny`
12. `#146 ControlNetApply`
13. `#138 ToBasicPipe`
14. `#237 FromBasicPipe`
15. `#229 BasicScheduler` · `#255 Automatic CFG`
16. `#238 DualCFGGuider`
17. `#230 SamplerCustomAdvanced`
18. `#13 VAEDecode`
19. `#174 FaceDetailerPipe`
20. `#37 SaveImage`

- `#245 ImpactKSamplerAdvancedBasicPipe` ← basic_pipe ← #87:0, latent_image ← #107:0。
- `#244 ImpactKSamplerAdvancedBasicPipe` ← basic_pipe ← #245:0, latent_image ← #245:1。
- `#247 ImpactKSamplerAdvancedBasicPipe` ← basic_pipe ← #244:0, latent_image ← #244:1。
- `#118 VAEDecode` ← samples ← #247:1, vae ← #88:2。
- `#180 ToDetailerPipe` ← model ← #126:0, clip ← #88:1, vae ← #88:2, positive ← #173:0, negative ← #105:0, bbox_detector ← #213:0, sam_model_opt ← #206:0。
- `#211 FaceDetailerPipe` ← image ← #24:0, detailer_pipe ← #180:0, seed ← #109:0。
- `#146 ControlNetApply` ← conditioning ← #218:0, control_net ← #129:0, image ← #astrbot_wai_canny:0。
- `#238 DualCFGGuider` ← model ← #255:0, cond1 ← #237:3, cond2 ← #218:0, negative ← #237:4。
- `#228 KSamplerSelect` ← 。
- `#13 VAEDecode` ← samples ← #230:0, vae ← #237:2。
- `#202 ToDetailerPipe` ← model ← #126:0, clip ← #88:1, vae ← #88:2, positive ← #204:0, negative ← #105:0, bbox_detector ← #125:0。
- `#174 FaceDetailerPipe` ← image ← #13:0, detailer_pipe ← #202:0, seed ← #109:0。
- `#37 SaveImage` ← images ← #174:0。

</details>

### 放大、重采样和修复分支

- external_vae 默认关。加入 #91 VAELoader，连线 #118.vae #88:2 → #91:0, #138.vae #88:2 → #91:0, #180.vae #88:2 → #91:0, #185.vae #88:2 → #91:0, #202.vae #88:2 → #91:0, #87.vae #88:2 → #91:0。
- upscale 默认开。移出 #120, #22, #24，连线 #211.image #24:0 → #118:0。
- face 默认开。移出 #172, #173, #180, #206, #211, #213, #219，连线 #185.pixels #211:0 → #24:0, #astrbot_wai_canny.image #211:0 → #24:0。
- refine 默认开。移出 #128, #129, #13, #138, #146, #185, #227, #228, #229, #230, #237, #238, #255, #astrbot_wai_canny，连线 #174.image #13:0 → #211:0。
- control 默认开。移出 #128, #129, #146, #astrbot_wai_canny，连线 #138.positive #146:0 → #218:0。
- detail_daemon 默认关。加入 #231 DetailDaemonSamplerNode，连线 #230.sampler #228:0 → #231:0。
- eyes 默认开。移出 #125, #174, #195, #198, #202, #204, #205，连线 #37.images #174:0 → #13:0。

## WAN22_I2V_AstrBot

画布 `AstrBot/WAN22_I2V_AstrBot.json`，16 个顶层节点，手动 API 文件 WAN22_I2V_AstrBot_API.json 有 15 个节点。随包 15 节点，运行文件 15 节点，默认可达 15，输出 #14。

随包与运行默认可达节点差异。运行独有 0 个，随包独有 0 个。
原 API 图差异节点 ID。#14。

当前画布模式。正常 16，旁路 0，静音 0。

<details>
<summary>默认 DAG 的完整节点顺序与关键输入连线</summary>

01. `#1 UNETLoader` · `#15 LoadImage` · `#2 UNETLoader` · `#3 CLIPLoader` · `#6 VAELoader`
02. `#4 CLIPTextEncode` · `#5 CLIPTextEncode` · `#8 ModelSamplingSD3` · `#9 ModelSamplingSD3`
03. `#7 WanImageToVideo`
04. `#10 KSamplerAdvanced`
05. `#11 KSamplerAdvanced`
06. `#12 VAEDecodeTiled`
07. `#13 CreateVideo`
08. `#14 SaveVideo`

- `#7 WanImageToVideo` ← positive ← #4:0, negative ← #5:0, vae ← #6:0, start_image ← #15:0。
- `#10 KSamplerAdvanced` ← model ← #8:0, positive ← #7:0, negative ← #7:1, latent_image ← #7:2。
- `#11 KSamplerAdvanced` ← model ← #9:0, positive ← #7:0, negative ← #7:1, latent_image ← #10:0。
- `#12 VAEDecodeTiled` ← samples ← #11:0, vae ← #6:0。
- `#14 SaveVideo` ← video ← #13:0。

</details>

## WAN22_Lightning_Long_I2V_AstrBot

画布 `AstrBot/WAN22_Lightning_Long_I2V_AstrBot.json`，106 个顶层节点，手动 API 文件 WAN22_Lightning_Long_I2V_AstrBot_API.json 有 29 个节点。随包 69 节点，运行文件 69 节点，默认可达 25，输出 #1039。

随包与运行默认可达节点差异。运行独有 3 个，随包独有 3 个。
原 API 图差异节点 ID。#1039, #1285, #1287。

当前画布模式。正常 102，旁路 4，静音 0。子图展开后 API ID 使用 `父节点:子节点`。

<details>
<summary>默认 DAG 的完整节点顺序与关键输入连线</summary>

01. `#1221 UpscaleModelLoader` · `#604 FloatConstant` · `#606 FloatConstant` · `#900 PrimitiveInt` · `#901 PrimitiveString` · `#902 PrimitiveStringMultiline` · `#916 VAELoader` · `#919 UnetLoaderGGUF` · `#920 UnetLoaderGGUF` · `#921 CLIPLoader` · `#97 LoadImage`
02. `#1252:1244 CLIPTextEncode` · `#1252:1245 CLIPTextEncode` · `#1252:1246 ModelSamplingSD3` · `#1252:1247 ModelSamplingSD3` · `#607 FindPerfectResolution`
03. `#1252:1248 PainterI2VAdvanced`
04. `#1252:1238 KSamplerAdvanced`
05. `#1252:1239 KSamplerAdvanced`
06. `#1252:1249 VAEDecode`
07. `#1284 ImageFromBatch`
08. `#1285 ColorTransfer`
09. `#1224 ImageUpscaleWithModel`
10. `#1223 ImageScaleBy`
11. `#1039 VHS_VideoCombine`

- `#1252:1238 KSamplerAdvanced` ← model ← #1252:1246:0, noise_seed ← #900:0, positive ← #1252:1248:0, negative ← #1252:1248:1, latent_image ← #1252:1248:4。
- `#1252:1239 KSamplerAdvanced` ← noise_seed ← #900:0, model ← #1252:1247:0, positive ← #1252:1248:2, negative ← #1252:1248:3, latent_image ← #1252:1238:0。
- `#1252:1249 VAEDecode` ← samples ← #1252:1239:0, vae ← #916:0。
- `#1284 ImageFromBatch` ← image ← #1252:1249:0。
- `#1039 VHS_VideoCombine` ← images ← #1223:0。

</details>

### 分段和后处理

当前保存段序 [1]，每段候选分支见下。默认 `gguf`，2 阶段采样，放大 True，插帧 False。后接段使用前段生成的状态，插帧时倍率也应用至输出帧率。

- 原段 1 单独运行。#1252:1238 KSamplerAdvanced → #1252:1239 KSamplerAdvanced → #1252:1249 VAEDecode。
- 原段 2 单独运行。#1262:1254 KSamplerAdvanced → #1262:1255 KSamplerAdvanced → #1262:1258 VAEDecode。
- 原段 3 单独运行。#1272:1268 KSamplerAdvanced → #1272:1264 KSamplerAdvanced → #1272:1269 VAEDecode。
- 原段 4 单独运行。#1280:1276 KSamplerAdvanced → #1280:1273 KSamplerAdvanced → #1280:1278 VAEDecode。
- {'stages': [3, 1]}。加入 #1272:1264 KSamplerAdvanced, #1272:1265 CLIPTextEncode, #1272:1266 PainterI2VAdvanced, #1272:1267 CLIPTextEncode, #1272:1268 KSamplerAdvanced, #1272:1269 VAEDecode, #605 INTConstant, #lightning_join_1 ImageBatchMulti, #lightning_last_1 VHS_SelectImages, #lightning_resize_1 ImageScaleBy，连线 #1252:1238.latent_image #1252:1248:4 → #1252:1248:2, #1252:1239.negative #1252:1248:3 → #1252:1248:1, #1252:1239.positive #1252:1248:2 → #1252:1248:0, #1252:1248.correct_strength #606:0 → 无连线, #1252:1248.initial_reference_image 无连线 → #97:0, #1252:1248.motion_frames 无连线 → #605:0, #1252:1248.previous_video 无连线 → #lightning_resize_1:0, #1252:1248.start_image #97:0 → 无连线, #1284.image #1252:1249:0 → #lightning_join_1:0, #1285.image_target #1252:1249:0 → #lightning_join_1:0。
- 保存配置 upscale = False。移出 #1221, #1223, #1224，连线 #1039.images #1223:0 → #1285:0。
- 保存配置 interpolate = True。加入 #1059 FL_RIFE，连线 #1039.images #1223:0 → #1059:0。
- 保存配置 model_format = fp8。加入 #1282 LoraLoaderModelOnly, #1283 LoraLoaderModelOnly, #917 UNETLoader, #918 UNETLoader，移出 #919, #920，连线 #1252:1246.model #919:0 → #1282:0, #1252:1247.model #920:0 → #1283:0。
- 逐段 LoRA 按原段号插到对应采样相位的模型端。SVI 支持高噪声、中间 SVI 相位和低噪声，三阶段才读取 SVI 高相位，Lightning 支持高、低或同时。
- 亮度校正 #1285 与后续帧增强 #1287 为基于强度的后处理。当前强度分别为 1 与 0。
- #1285.strength = 0。移出 #1284, #1285，连线 #1224.image #1285:0 → #1252:1249:0。
- #1287.method.strength = 0.5。加入 #1286 VHS_SplitImages, #1287 ImageSharpenKJ, #1288 ImageBatchMulti，连线 #1224.image #1285:0 → #1288:0。

## WAN22_SVI_I2V_AstrBot

画布 `AstrBot/WAN22_SVI_I2V_AstrBot.json`，257 个顶层节点，手动 API 文件 WAN22_SVI_I2V_AstrBot_API.json 有 27 个节点。随包 195 节点，运行文件 195 节点，默认可达 27，输出 #512。

随包与运行默认可达节点差异。运行独有 0 个，随包独有 0 个。
原 API 图差异节点 ID。#512。

当前画布模式。正常 241，旁路 16，静音 0。子图展开后 API ID 使用 `父节点:子节点`。

<details>
<summary>默认 DAG 的完整节点顺序与关键输入连线</summary>

01. `#193 INTConstant` · `#194 INTConstant` · `#195 INTConstant` · `#314 FloatConstant` · `#368:353 VAELoader` · `#368:355 CLIPLoader` · `#369 UnetLoaderGGUF` · `#370 UnetLoaderGGUF` · `#62 LoadImage` · `#900 PrimitiveInt` · `#901 PrimitiveString` · `#902 PrimitiveStringMultiline`
02. `#110 FindPerfectResolution` · `#368:356 LoraLoaderModelOnly` · `#368:364 ModelSamplingSD3` · `#562:552 CLIPTextEncode` · `#562:553 CLIPTextEncode`
03. `#368:365 LoraLoaderModelOnly` · `#368:366 LoraLoaderModelOnly` · `#562:558 VAEEncode`
04. `#368:359 LoraLoaderModelOnly` · `#562:554 WanImageToVideoSVIPro`
05. `#562:559 KSamplerAdvanced`
06. `#562:556 KSamplerAdvanced`
07. `#562:557 KSamplerAdvanced`
08. `#562:561 VAEDecode`
09. `#512 VHS_VideoCombine`

- `#562:554 WanImageToVideoSVIPro` ← positive ← #562:552:0, negative ← #562:553:0, anchor_samples ← #562:558:0。
- `#562:559 KSamplerAdvanced` ← model ← #368:366:0, noise_seed ← #900:0, steps ← #195:0, cfg ← #314:0, positive ← #562:554:0, negative ← #562:554:1, latent_image ← #562:554:2, end_at_step ← #193:0。
- `#562:556 KSamplerAdvanced` ← model ← #368:359:0, noise_seed ← #900:0, steps ← #195:0, positive ← #562:554:0, negative ← #562:554:1, latent_image ← #562:559:0, start_at_step ← #193:0, end_at_step ← #194:0。
- `#562:557 KSamplerAdvanced` ← model ← #368:365:0, noise_seed ← #900:0, steps ← #195:0, positive ← #562:554:0, negative ← #562:554:1, latent_image ← #562:556:0, start_at_step ← #194:0。
- `#562:561 VAEDecode` ← samples ← #562:557:0, vae ← #368:353:0。
- `#512 VHS_VideoCombine` ← images ← #562:561:0。

</details>

### 分段和后处理

当前保存段序 [1]，每段候选分支见下。默认 `gguf`，3 阶段采样，放大 False，插帧 False。后接段使用前段生成的状态，插帧时倍率也应用至输出帧率。

- 原段 1 单独运行。#562:554 WanImageToVideoSVIPro → #562:559 KSamplerAdvanced → #562:556 KSamplerAdvanced → #562:557 KSamplerAdvanced → #562:561 VAEDecode。
- 原段 2 单独运行。#585:574 WanImageToVideoSVIPro → #585:573 KSamplerAdvanced → #585:578 KSamplerAdvanced → #585:579 KSamplerAdvanced → #585:584 VAEDecode。
- 原段 3 单独运行。#602:757 WanImageToVideoSVIPro → #602:756 KSamplerAdvanced → #602:761 KSamplerAdvanced → #602:762 KSamplerAdvanced → #602:767 VAEDecode。
- 原段 4 单独运行。#619:769 WanImageToVideoSVIPro → #619:768 KSamplerAdvanced → #619:773 KSamplerAdvanced → #619:774 KSamplerAdvanced → #619:779 VAEDecode。
- 原段 5 单独运行。#636:781 WanImageToVideoSVIPro → #636:780 KSamplerAdvanced → #636:785 KSamplerAdvanced → #636:786 KSamplerAdvanced → #636:791 VAEDecode。
- 原段 6 单独运行。#653:793 WanImageToVideoSVIPro → #653:792 KSamplerAdvanced → #653:797 KSamplerAdvanced → #653:798 KSamplerAdvanced → #653:803 VAEDecode。
- 原段 7 单独运行。#670:805 WanImageToVideoSVIPro → #670:804 KSamplerAdvanced → #670:809 KSamplerAdvanced → #670:810 KSamplerAdvanced → #670:815 VAEDecode。
- 原段 8 单独运行。#687:817 WanImageToVideoSVIPro → #687:816 KSamplerAdvanced → #687:821 KSamplerAdvanced → #687:822 KSamplerAdvanced → #687:827 VAEDecode。
- 原段 9 单独运行。#704:829 WanImageToVideoSVIPro → #704:828 KSamplerAdvanced → #704:833 KSamplerAdvanced → #704:834 KSamplerAdvanced → #704:839 VAEDecode。
- 原段 10 单独运行。#721:841 WanImageToVideoSVIPro → #721:840 KSamplerAdvanced → #721:845 KSamplerAdvanced → #721:846 KSamplerAdvanced → #721:851 VAEDecode。
- 原段 11 单独运行。#738:853 WanImageToVideoSVIPro → #738:852 KSamplerAdvanced → #738:857 KSamplerAdvanced → #738:858 KSamplerAdvanced → #738:863 VAEDecode。
- 原段 12 单独运行。#755:865 WanImageToVideoSVIPro → #755:864 KSamplerAdvanced → #755:869 KSamplerAdvanced → #755:870 KSamplerAdvanced → #755:875 VAEDecode。
- {'stages': [3, 1]}。加入 #602:756 KSamplerAdvanced, #602:757 WanImageToVideoSVIPro, #602:758 CLIPTextEncode, #602:759 CLIPTextEncode, #602:761 KSamplerAdvanced, #602:762 KSamplerAdvanced, #602:767 VAEDecode, #svi_join_1 ImageBatchExtendWithOverlap，连线 #512.images #562:561:0 → #svi_join_1:2, #562:554.prev_samples 无连线 → #602:762:0。
- {'samplers': 2}。加入 #562:551 KSamplerAdvanced, #562:555 WanImageToVideoSVIPro, #562:560 KSamplerAdvanced, #564 INTConstant, #566 INTConstant，移出 #193, #194, #195, #314, #562:554, #562:556, #562:557, #562:559，连线 #562:561.samples #562:557:0 → #562:551:0。
- 保存配置 upscale = True。加入 #509 ImageUpscaleWithModel, #510 UpscaleModelLoader, #511 ImageScaleBy，连线 #512.images #562:561:0 → #511:0。
- 保存配置 interpolate = True。加入 #507 FL_RIFE，连线 #512.images #562:561:0 → #507:0。
- 保存配置 model_format = fp8。加入 #37 UNETLoader, #56 UNETLoader，移出 #369, #370，连线 #368:356.model #370:0 → #56:0, #368:364.model #369:0 → #37:0。
- 逐段 LoRA 按原段号插到对应采样相位的模型端。SVI 支持高噪声、中间 SVI 相位和低噪声，三阶段才读取 SVI 高相位，Lightning 支持高、低或同时。

## WAN22_T2V_AstrBot

画布 `AstrBot/WAN22_T2V_AstrBot.json`，15 个顶层节点，手动 API 文件 WAN22_T2V_AstrBot_API.json 有 14 个节点。随包 14 节点，运行文件 14 节点，默认可达 14，输出 #14。

随包与运行默认可达节点差异。运行独有 0 个，随包独有 0 个。
原 API 图差异节点 ID。#14。

当前画布模式。正常 15，旁路 0，静音 0。

<details>
<summary>默认 DAG 的完整节点顺序与关键输入连线</summary>

01. `#1 UNETLoader` · `#2 UNETLoader` · `#3 CLIPLoader` · `#6 VAELoader` · `#7 EmptyHunyuanLatentVideo`
02. `#4 CLIPTextEncode` · `#5 CLIPTextEncode` · `#8 ModelSamplingSD3` · `#9 ModelSamplingSD3`
03. `#10 KSamplerAdvanced`
04. `#11 KSamplerAdvanced`
05. `#12 VAEDecodeTiled`
06. `#13 CreateVideo`
07. `#14 SaveVideo`

- `#10 KSamplerAdvanced` ← model ← #8:0, positive ← #4:0, negative ← #5:0, latent_image ← #7:0。
- `#11 KSamplerAdvanced` ← model ← #9:0, positive ← #4:0, negative ← #5:0, latent_image ← #10:0。
- `#12 VAEDecodeTiled` ← samples ← #11:0, vae ← #6:0。
- `#14 SaveVideo` ← video ← #13:0。

</details>

## WD14 本地反推辅助图

仅供 `/comfy prompt wd14` 使用。

01. `#1 LoadImage`
02. `#2 AstrBotLocalTagger`
03. `#3 PreviewAny`

## 手动 API 的最终输出连线

- Advanced_Gemma_V40_AstrBot。#501 SaveImage ← images #36:0。手导比运行原图少 158 个节点，多 0 个节点。
- Anima_I2I_AIO_AstrBot。#1649 SaveImage ← images #119:0。手导比运行原图少 24 个节点，多 0 个节点。
- Anima_Reverse_AstrBot。#445 PreviewAny ← source #443:0。手导比运行原图少 2 个节点，多 0 个节点。
- Detailer_V40_AstrBot。#32 SaveImage ← images #57:0。手导比运行原图少 110 个节点，多 0 个节点。
- WAI-Illustrious_T2I_AstrBot。#37 SaveImage ← images #174:0。手导比运行原图少 10 个节点，多 1 个节点。
- WAN22_I2V_AstrBot。#14 SaveVideo ← video #13:0。手导比运行原图少 0 个节点，多 0 个节点。
- WAN22_Lightning_Long_I2V_AstrBot。#1039 VHS_VideoCombine ← images #1059:0。手导比运行原图少 40 个节点，多 0 个节点。
- WAN22_SVI_I2V_AstrBot。#512 VHS_VideoCombine ← images #562:561:0。手导比运行原图少 168 个节点，多 0 个节点。
- WAN22_T2V_AstrBot。#14 SaveVideo ← video #13:0。手导比运行原图少 0 个节点，多 0 个节点。

## 文件范围

以下本机画布或导出作为来源、旧版或调试副本发现。仅当它们与上方运行工作流对应时才比较，不将它们计作插件能选择的独立工作流。

- `.`。`Anima_I2I_QQ.json`, `AnimaAdvancedV10_AI.json`, `AnimaAdvancedV10_Image_AstrBot.json`, `AnimaLocalCaption_AstrBot.json`, `vedio tmp.json`。
- `main`。`Anima_I2I_AIO.json`, `Anima_T2I.json`, `Anima_反推流.json`, `AnimaAdvancedV10-fix.json`, `AnimaAdvancedV10_NSFW.json`, `sdxlturbo.json`, `WAI-Illustrious.json`, `WAI-Illustrious2.json`, `Wan2.2_I2V_SVI_Workflow_Kenpechi_v3.5.json`, `WAN22_Klee_Live2D_10s.json`, `WAN22_Klee_Live2D_3s.json`。
- `ILV40`。`Advanced_Gemma_V40.json`, `Advanced_V40.json`, `Basic_V40.json`, `Detailer_V40.json`, `Standard_V40.json`。
- `WAN2.2-N`。`SVI-2-3-ksampler_WAN2.2_I2V.json`, `wan2.2-continuos-svi-latent-2ksampler-fixed.json`, `WAN2.2-I2V-Full-AutoPrompt-MMAudio-GGUF.json`, `WAN2.2-I2V-Full-AutoPrompt-MMAudio.json`, `wan2.2_LIGHTNING-EDITION_long-video_FP8GGUF.json`。
- `api`。`Advanced_Gemma_V40_AstrBot_API.json`, `Anima_I2I_AIO_AstrBot_API.json`, `Anima_I2I_QQ.json`, `Anima_反推流_AstrBot_API.json`, `AnimaAdvancedV10.json`, `AnimaAdvancedV10_AI.json`, `AnimaAdvancedV10_AstrBot_API.json`, `AnimaAdvancedV10_Image_AstrBot.json`, `AnimaLocalCaption_AstrBot.json`, `Detailer_V40_AstrBot_API.json`, `WAI-Illustrious_T2I_AstrBot_API.json`, `WAN22_I2V_AstrBot_API.json`, `wan22_klee_live2d_10s_api.json`, `wan22_klee_live2d_3s_api.json`, `WAN22_Lightning_Long_I2V_AstrBot_API.json`, `WAN22_SVI_I2V_AstrBot_API.json`, `WAN22_T2V_AstrBot_API.json`。
