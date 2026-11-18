# MiniMax H3 Seed Hunter 使用教程

## Seed Hunter v3 完整版

在插件工作台的工作流侧栏选择 **MiniMax H3 · Seed Hunter v3 完整版**（`h3-v3`）。在「生成模式与候选」选好模式并点击保存，面板会显示该模式对应的节点参数。模型、提示词、LoRA、尺寸、时长、采样和输出等共用参数会随模式保留。初次使用先确认扩散模型和 Text Encoder 下拉框中的文件在当前 ComfyUI 实例可用。

| 用途 | 参数设置 |
| --- | --- |
| 搜种 | 三路搜种可勾选返回的候选。候选 1、2、3 依次使用基准种子、基准种子 +1000、基准种子 +2000。 |
| 定稿 | 选「单 Pass 定稿」走首轮直出。选「二次采样与潜空间放大」时，在节点 #600 选择原候选所在的行（1、2 或 3），提交时沿用搜种的**基准种子**，另外可配置 #103 的二次采样种子。 |
| 高级设置 | 模式列表还包括显存优化与节点预览、独立放大 LoRA 与首尾帧、首帧参考、尾帧参考、自备音轨和 RefMods。切换模式后，相应的节点选项会出现在面板。 |
| 参考和续写 | QQ 指令或新建任务可临时附一张参考图。多参考和续写用 #416 的媒体配置，文件路径相对于 `ComfyUI/input`。续写需配置带音轨的参考视频。 |
| 对白 | 「语音克隆与对白」使用独立的模板、语气和时长字段。默认语音素材在 #535 选择，单次任务的提示词写入台词节点。独立音频文件由 ComfyUI 节点保存，插件继续回传视频。 |

### 使用 H3 Prompt IDE 编写提示词

选择 `h3-v3` 后，新建任务的提示词使用 H3 Prompt IDE。首次打开读取当前工作流选中的提示词编辑器，简易添加与命令添加共用本次编辑草稿。

H3 Prompt IDE 和 Fantastic H3 Media Loader 默认折叠，点击各自标题展开或收起。收起保留提示词、模板选择和素材设置，可直接提交本次任务。

- 支持 Rich text / Plain text 切换、模式选择、Sections 分区插入与结构检查、Dialogue 对白标签、Undo / Redo 和字号调整。Ctrl/Cmd+Space 打开上下文补全，点击引用标签可替换，Ctrl/Cmd+单击可替换方括号与 retention 标记，Ctrl/Cmd+Shift+D 选择下一处同词进行多处编辑。
- References 同步媒体加载器中已启用的图片、视频与音频。视频配对音轨排在独立音频之前，素材排序、启停与删除会更新引用编号和检查结果。检查提示用于编写参考，提交仍由工作流与 ComfyUI 校验。
- 在「编辑器设置」中配置自动补全、默认显示方式、补全后空格、对白语言和标记替换。这些偏好保存在当前浏览器。
- 在编辑器上方输入「模板名称」，点击「保存模板」保存完整提示词和当前编辑模式。选择已有模板后点击「加载」恢复；相同名称显示「更新模板」，也可删除所选模板。模板保存在插件数据目录，电脑和手机共用。多页面操作后可点击「刷新」读取最新列表。
- 在「管理 → 导入导出 → MiniMax H3 提示词与模板」中，「导出当前提示词」将当前草稿和编辑模式导出为 JSON，即使尚未保存为模板也可导出。「导出模板库」读取并导出服务器最新模板。点击「导入提示词／模板」导入 JSON，默认合并且跳过同名模板；勾选「导入时覆盖同名模板」后更新同名项，其他已有模板保留。导入后选择模板并加载。TXT 文件在编辑器已打开时直接载入并保留换行；尚未打开时按文件名保存为模板，之后可在编辑器加载。文件不超过 4 MB，单项提示词不超过 8000 字符。
- 完整版使用这里的结构化模板，任务表单隐藏普通提示词预设、负向提示词及独立单张参考图。参考素材统一在 Fantastic H3 Media Loader 中选择。两份简化版保留普通正向提示词和可用的单图参考入口。
- 简易添加使用编辑器文本作为正向提示词，仍可选择提示词预设。命令添加可填写 `/comfy gen --wf h3-v3 --seed 1000 --raw`，在下方 IDE 编写完整提示词。换行、引号和 `--` 文本按原文传给工作流。任务提示词沿用插件单项 8000 字符上限。

编辑器基于 H3 Prompt IDE 0.8.25。授权、上游来源、适配记录与可读源码随安装包提供，见 `views/workbench/h3_prompt_NOTICE.txt` 和 `h3_prompt_LICENSE.txt`。部分工具栏和检查信息沿用原节点英文。

### 在新建任务中添加参考素材

选择 `h3-v3` 后，新建任务会显示 **Fantastic H3 Media Loader**。简易添加与命令添加共用同一份本次素材草稿。

- 点击「添加文件」或空槽，可多选图片、视频和音频，也可拖入或粘贴文件。图片网格对应 Picture 1–9，右侧为 Video 1–3 和独立音频。
- 点击「从图集导入」，可切换待评价、收藏、跳过等图集，使用图集筛选与预览后选择图片。有控制图集时也可导入控制图。导入使用原图，可重复选择添加多张，之后继续在加载器内裁剪和排序。
- 点击图片放大预览，通过底部裁剪按钮编辑裁剪框、旋转、镜像和长边尺寸。视频可播放和截取片段，音频可播放并调整起止时间。素材的启用按钮、移除按钮和顺序调整会同步更新下方发送给模型的标签。
- 视频音轨可选关闭、与视频配对或作为独立音频。图片、视频、音频的数量与时长提示沿用原节点。
- 「素材预设」可以保存、加载、分类和删除整组素材。预设与 ComfyUI 原节点共用。读取已保存素材会恢复工作流 #416 中的默认设置，提交任务使用当前草稿。
- 视频「遮罩」入口提供原节点的多层遮罩、自动识别、手绘与关键帧编辑。Auto Mask 需要已安装的原节点与 SAM 模型，可在界面选择本机模型。缓存清理操作保留原节点的确认流程。

手机上图片与音视频分区纵向排列，显示已加载素材和一个新增槽位，左右箭头用于调整顺序。素材预览经已登录的插件服务访问，手机无需直接访问电脑上的 ComfyUI 地址。

媒体上传到 ComfyUI 原节点管理的 `input/minimax_h3`。图片大小采用插件的图片限制，视频和音频采用视频限制。执行裁剪、截取、音轨提取、预设和遮罩处理需要 ComfyUI 正在运行并安装 Fantastic H3 节点包。界面沿用该节点 MIT 授权的媒体编辑实现，部分高级菜单和状态信息保留原文。

以下 JSON 也可用于工作流参数页的 #416 媒体配置。

```json
[
  {"kind": "picture", "file": "references/character.png"},
  {"kind": "video", "file": "references/clip.mp4", "has_audio": true, "audio_mode": "paired"},
  {"kind": "audio", "file": "references/voice.wav"}
]
```

```text
/comfy gen --wf h3-v3 --seed 1000 A red fox walks through snow --raw
```

原版的节点布局、画布说明及浏览器内的专用控件可在 `AstrBot/MiniMax_H3_Seed_Hunter_V3_AstrBot.json` 中查看。插件使用保存后的模式与字段，任务提示词会写入当前选中的提示词编辑器（#593）。独立的 RIFE / AnimeCadence 插帧控件留在画布中，当前机器的 ComfyUI 没有注册原版使用的这两个节点。画布内的组开关组合可以在 ComfyUI 中继续切换。

## 两步简化版

先用 `h3` 看三个低分辨率视频候选，再用 `h3-final` 按选中的实际种子重跑首轮、放大潜空间并二次采样。两步都输出带音频的 MP4。

## 准备模型

启动支持 MiniMax H3 的 ComfyUI。工作流使用原生 H3 节点和 Video Helper Suite 的 `VHS_VideoCombine`。

| ComfyUI 目录 | 工作流预选文件 | 本机核对 |
| --- | --- | --- |
| `models/diffusion_models/` | `Minimax-h3_Singularity_ref2va_Pruned_v1.3_int8.safetensors` | 原画布的 Ref2VA 模型未出现在加载器列表 |
| `models/text_encoders/` | `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | 未出现在加载器列表 |
| `models/vae/` | `minimax_h3_video_vae_int8_convrot.safetensors`、`minimax_h3_audio_vae_fp32.safetensors` | 两项均可用 |
| `models/loras/MiniMaxH3/` | `minimax_h3_ref2v_turbo_silver_dareties_comfy_pruned_v2.safetensors` | 本机已有，默认强度 0.75 |
| `models/latent_upscale_models/` | `minimax_h3_latent_upscaler_3d_conv_v1_bf16.safetensors` | 本机文件在 `models/upscale_models/`，潜空间放大加载器尚未列出 |

模型加载器列出文件后，在工作台对应参数页确认选择并保存。两条工作流的首轮配置各自保存。换权重时，两边选同一套兼容的 **H3 Ref2VA** 扩散模型、文本编码器、VAE 和 LoRA。本机列表里的 FL2VA 权重对应首尾帧流程。

## 第一步 · 搜种

在「新建任务 → 命令添加」粘贴，或直接在 QQ 发送：

```text
/comfy gen --wf h3 --seed 1000 A red fox walks through a snowy pine forest. The camera follows at ground level. Soft wind and footsteps in snow. --raw
```

| 文件名前缀 | 实际种子 |
| --- | --- |
| `H3_Candidate_1` | 基准种子，例如 1000 |
| `H3_Candidate_2` | 基准种子 + 1000，例如 2000 |
| `H3_Candidate_3` | 基准种子 + 2000，例如 3000 |

数值到达种子上限时按 `2^63` 回绕。省略 `--seed` 时，任务详情会记录随机基准种子。QQ 的「单任务最多回传视频数」默认是 1，可设为 3 来收齐候选。三个 MP4 都可在工作台「生成视频」中查看，通常保存在 ComfyUI 的 `output/vedio/`。

「简易添加」也可以选 **MiniMax H3 · Seed Hunter**，输入描述并加一张可选参考图。QQ 使用带图消息或回复图片，工作台使用上传或收藏选图。参考图在描述中写作 `<Picture 1>`，例如 `Keep the fox from <Picture 1>, with a slow tracking shot through snow.`。

## 第二步 · 放大定稿

假设选中了候选 2，实际种子为 2000：

```text
/comfy gen --wf h3-final --seed 2000 A red fox walks through a snowy pine forest. The camera follows at ground level. Soft wind and footsteps in snow. --raw
```

保持同一提示词、参考图和首轮模型、LoRA、宽高、帧数、采样器、调度器及步数。定稿页的「Second pass seed (reroll here)」只影响第二轮细化。改变它可以从同一个候选生成不同的细化结果。定稿文件名前缀为 `H3_Final`。

| 参数 | 随包初始值 |
| --- | --- |
| 首轮画面 | 544 × 960，107 帧，24 fps，约 4.5 秒 |
| 首轮采样 | `er_sde`、`beta`、6 步 |
| 定稿画面 | 928 × 1632 |
| 二轮采样 | `er_sde`、`linear_quadratic`、2 步、降噪 0.35 |

宽高使用 32 的倍数。帧数使用 `17n + 5`，例如 107、124 或 141。H3 使用一段综合描述，可写进镜头、动作、台词和环境声。使用提示词预设时，把负向提示词留空。

## 在 ComfyUI 打开 AstrBot 画布

分别打开 `AstrBot/MiniMax_H3_Seed_Hunter_AstrBot.json` 和 `AstrBot/MiniMax_H3_Seed_Final_AstrBot.json`。画布上的 Base Seed 对应 QQ 的 `--seed`。手动接参考图时，将 `LoadImage` 的 IMAGE 输出连接到 H3 节点的首个参考图插槽。

AstrBot 版使用显式连线保留三个候选、音视频解码和潜空间放大。原画布提供的多媒体参考、视频续写、语音克隆、插帧和交互预览开关，可在原版 **FoxFurEssence H3 Seed Hunter v3** 中使用。
