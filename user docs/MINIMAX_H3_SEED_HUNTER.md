# MiniMax H3 Seed Hunter 使用教程

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
