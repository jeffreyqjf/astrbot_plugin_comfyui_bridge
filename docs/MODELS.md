# 本机 ComfyUI 模型清单

盘点日期为 2026-11-09。本机 ComfyUI 0.44.0。共记录 **95 个权重或节点随附模型数据文件**，包括 `G:/ComfyUI/models/` 下 70 个、A1111 注册共享目录 8 个、WD14 直接引用 1 个和自定义节点包内部 16 个。下表路径以 `G:/ComfyUI` 为基准，E 盘文件使用完整路径。标签表、配置和缓存元数据单独说明。空占位目录与示例 YAML 不计入。

**下载来源怎么看。** 文件页优先引用发布者或为 ComfyUI 制作对应版本的维护者。标记「SHA‑256 对应」的项目已经核对；同名文件或相关模型页只提供线索。对本机自训、改名、下架或来源不明的权重，保留识别信息，具体下载版本待确认。来源页可能要求登录或同意模型许可。

- Anima Aesthetic v1.1 的本机缓存校验记录为 `3c1868387a3a1ff504bbb87c33678321965ead381fcf87afbd0264daa600c082`，与发布页一致。WAI v17、WAI Union ControlNet、Eyeful 配对检测器已另行读取本机文件并比对。[Anima 发布文件](https://huggingface.co/circlestone-labs/Anima/blob/main/split_files/diffusion_models/anima-aesthetic-v1.1.safetensors)
- WAI v17 的 SHA‑256 为 `f116b0c78ff441467b0cdc8f1936e1ed18ea31e9997c7b132b1b8db533f0bd04`。Union ControlNet 为 `a9e13fd61f3193887791c8a0dd07a07202174dc47d5ddaea94ea1344f07c7467`。Eyeful 为 `0d574fd6b4f5d5f1310294ae375059369f850e80ea7a628e98e6e2dae2963152`。[WAI v17 发布页](https://civitai.red/models/827184/wai-illustrious-sdxl?modelVersionId=2883731) · [Union 标准版](https://huggingface.co/xinsir/controlnet-union-sdxl-1.0/blob/main/diffusion_pytorch_model.safetensors) · [Eyeful 同哈希文件](https://huggingface.co/vladmandic/yolo-detailers/blob/main/eyeful-paired-v2.pt)
- 在依赖配置的 `workflows.astrbot_runtime` 查当前执行节点，`workflows.comfyui_saved` 查其余本机画布和 API 图。 [ComfyUI 节点依赖配置](COMFYUI_DEPENDENCIES.json)
- 参数与指令用法分别见 [模型与参数说明](CONFIGURATION.md) 和 [QQ 指令集](COMMANDS.md)。

## 本机 AstrBot 当前模型组合

| QQ 工作流 | 当前保存路径 |
| --- | --- |
| `t2i` | Anima Aesthetic v1.1、Qwen3 0.6B、Qwen Image VAE。已启用手、脸、眼、脚修复，并引用相应 YOLO 与 SAM ViT‑B |
| `i2i` | 同一套 Anima 主模型、编码器、VAE。LLLite、LoRA、放大等按面板分支选用 |
| `wai` | WAI v17，使用 checkpoint 内置 VAE。当前接入 Union ControlNet、RealESRGAN x4plus、脸/眼检测和 SAM |
| `sdxl` | SDXL Turbo FP16 checkpoint |
| `wan-t2v` / `wan-i2v` | 各自的 Kijai FP8 高低噪声模型，配 Comfy Org UMT5 和 Wan 2.1 VAE |
| `svi` | GGUF 高低噪声，修改版 UMT5、Wan 2.1 VAE、SVI Pro 高低噪声 LoRA 及 Lightning 蒸馏 LoRA。当前为首段、三阶段 |
| `lightning` | 同一对 GGUF 高低噪声，Comfy Org UMT5 和 Wan 2.1 VAE。当前为首段，面板可切到 FP8 |
| `reverse` / `prompt wd14` | PixAI v1.0 与已启用的 TIPO 扩写。WD14 是单独的本机 MOAT v2 辅助流程 |

下表的「本机引用于」表示读取运行配置后，从输出可达的节点引用，补充了 TIPO、PixAI 和 WD14 的模型别名。它不代表所有可选分支都在执行。

## 图像生成模型与 Anima 编解码

| 本机文件 | 大小 | 作用或身份 | 来源 |
| --- | ---: | --- | --- |
| `models/checkpoints/sd_xl_turbo_1.0_fp16.safetensors` | 6.46 GiB | SDXL Turbo FP16 一步文生图 checkpoint，供 sdxl。 本机引用于 `sdxl`。 | [Stability AI 文件](https://huggingface.co/stabilityai/sdxl-turbo/blob/main/sd_xl_turbo_1.0_fp16.safetensors) |
| `models/checkpoints/WAI-Nsfw-Illustrious-17.safetensors` | 6.46 GiB | Illustrious 系 SDXL 动漫 checkpoint，供 wai。发布文件名为 `waiIllustriousSDXL_v170.safetensors`。 本机引用于 `wai`。 | [WAI0731 v17.0，SHA‑256 对应](https://civitai.red/models/827184/wai-illustrious-sdxl?modelVersionId=2883731) |
| `models/diffusion_models/anima-aesthetic-v1.1.safetensors` | 3.90 GiB | Anima 动漫插画 DiT，供 t2i、i2i，配合 Qwen3 编码器与 Qwen Image VAE。 本机引用于 `i2i`、`t2i`。 | [CircleStone Labs 文件，SHA‑256 对应](https://huggingface.co/circlestone-labs/Anima/blob/main/split_files/diffusion_models/anima-aesthetic-v1.1.safetensors) |
| `models/text_encoders/clip_l.safetensors` | 234.74 MiB | 独立 CLIP‑L 文本编码器。本机 AstrBot 保存路径未直接引用。 | [ComfyUI 同名文件](https://huggingface.co/comfyanonymous/flux_text_encoders/blob/main/clip_l.safetensors) |
| `models/text_encoders/qwen_3_06b_base.safetensors` | 1.11 GiB | Anima 的 Qwen3‑0.6B 文本编码器，供 t2i、i2i。 本机引用于 `i2i`、`t2i`。 | [CircleStone Labs 文件](https://huggingface.co/circlestone-labs/Anima/blob/main/split_files/text_encoders/qwen_3_06b_base.safetensors) |
| `models/vae/qwen_image_vae.safetensors` | 242.05 MiB | Anima 的 Qwen‑Image VAE，负责图像与 latent 编解码。 本机引用于 `i2i`、`t2i`。 | [Comfy Org 文件](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/blob/main/split_files/vae/qwen_image_vae.safetensors) |

## WAN 视频模型与编解码

WAN 高噪声和低噪声模型分别对应采样前段和后段。I2V、T2V、FP8 和 GGUF 按工作流选择配套组合。VACE 文件是控制模块，使用对应工作流加载。

| 本机文件 | 大小 | 作用或身份 | 来源 |
| --- | ---: | --- | --- |
| `models/diffusion_models/vace/Wan2_1-VACE_module_14B_bf16.safetensors` | 5.68 GiB | Wan 2.1 VACE 14B 控制模块 BF16，用于参考视频、掩膜等条件。 | [Kijai 文件](https://huggingface.co/Kijai/WanVideo_comfy/blob/1b0ca315d0526d056575004928757d1ae7b879c0/Wan2_1-VACE_module_14B_bf16.safetensors) |
| `models/diffusion_models/vace/Wan2_1-VACE_module_14B_fp8_e4m3fn.safetensors` | 2.84 GiB | 同系列 VACE 模块 FP8 版本，用于较低的显存占用。 | [Kijai 文件](https://huggingface.co/Kijai/WanVideo_comfy/blob/main/Wan2_1-VACE_module_14B_fp8_e4m3fn.safetensors) |
| `models/diffusion_models/wan2.2/Wan2_2-I2V-A14B-HIGH_fp8_e4m3fn_scaled_KJ.safetensors` | 13.97 GiB | Kijai FP8 scaled WAN 2.2 图生视频 高噪声权重。 本机引用于 `wan-i2v`。 | [Kijai 文件](https://huggingface.co/Kijai/WanVideo_comfy_fp8_scaled/blob/main/I2V/Wan2_2-I2V-A14B-HIGH_fp8_e4m3fn_scaled_KJ.safetensors) |
| `models/diffusion_models/wan2.2/Wan2_2-I2V-A14B-LOW_fp8_e4m3fn_scaled_KJ.safetensors` | 13.97 GiB | Kijai FP8 scaled WAN 2.2 图生视频 低噪声权重。 本机引用于 `wan-i2v`。 | [Kijai 文件](https://huggingface.co/Kijai/WanVideo_comfy_fp8_scaled/blob/main/I2V/Wan2_2-I2V-A14B-LOW_fp8_e4m3fn_scaled_KJ.safetensors) |
| `models/diffusion_models/wan2.2/Wan2_2-I2V-A14B-NSFW_fast_move-HIGH_Q8(lightning_edition)V2.gguf` | 14.35 GiB | WAN 2.2 I2V 高噪声 GGUF，Lightning Edition V2 的本机文件，供 svi 和 lightning。 本机引用于 `lightning`、`svi`。 | [画布标注的项目页，具体文件未复核](https://civitai.com/models/2053259) |
| `models/diffusion_models/wan2.2/Wan2_2-I2V-A14B-NSFW_fast_move-LOW_Q8lightning_edition)V2.gguf` | 14.35 GiB | WAN 2.2 I2V 低噪声 GGUF，Lightning Edition V2 的本机文件，供 svi 和 lightning。 本机引用于 `lightning`、`svi`。 | [画布标注的项目页，具体文件未复核](https://civitai.com/models/2053259) |
| `models/diffusion_models/wan2.2/Wan2_2-T2V-A14B-LOW_fp8_e4m3fn_scaled_KJ.safetensors` | 13.97 GiB | Kijai FP8 scaled WAN 2.2 文生视频 低噪声权重。 本机引用于 `wan-t2v`。 | [Kijai 文件](https://huggingface.co/Kijai/WanVideo_comfy_fp8_scaled/blob/main/T2V/Wan2_2-T2V-A14B-LOW_fp8_e4m3fn_scaled_KJ.safetensors) |
| `models/diffusion_models/wan2.2/Wan2_2-T2V-A14B_HIGH_fp8_e4m3fn_scaled_KJ.safetensors` | 13.97 GiB | Kijai FP8 scaled WAN 2.2 文生视频 高噪声权重。 本机引用于 `wan-t2v`。 | [Kijai 文件](https://huggingface.co/Kijai/WanVideo_comfy_fp8_scaled/blob/main/T2V/Wan2_2-T2V-A14B_HIGH_fp8_e4m3fn_scaled_KJ.safetensors) |
| `models/text_encoders/nsfw_wan_umt5-xxl_fp8_scaled.safetensors` | 6.00 GiB | 修改版 UMT5‑XXL FP8 编码器，本机 svi 保存路径选用。 本机引用于 `svi`。 | [NSFW-API 文件](https://huggingface.co/NSFW-API/NSFW-Wan-UMT5-XXL/blob/main/nsfw_wan_umt5-xxl_fp8_scaled.safetensors) |
| `models/text_encoders/umt5-xxl-enc-fp8_e4m3fn.safetensors` | 6.27 GiB | WanVideoWrapper 可用的另一套 UMT5‑XXL FP8 编码器格式。 | [Kijai 文件](https://huggingface.co/Kijai/WanVideo_comfy/blob/5f8b2498d311d6a6cd219949040c1589dfbe948e/umt5-xxl-enc-fp8_e4m3fn.safetensors) |
| `models/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors` | 6.27 GiB | WAN 文本编码器，本机普通 T2V、I2V 和 Lightning 使用。 本机引用于 `wan-i2v`、`lightning`、`wan-t2v`。 | [Comfy Org 文件](https://huggingface.co/Comfy-Org/Wan-2.1/blob/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors) |
| `models/vae/wan_2.1_vae.safetensors` | 242.06 MiB | WAN 视频 latent 编解码，供本机四条 WAN 生成工作流共用。 本机引用于 `wan-i2v`、`lightning`、`svi`、`wan-t2v`。 | [Comfy Org 文件](https://huggingface.co/Comfy-Org/Wan-2.1/blob/main/split_files/vae/wan_2.1_vae.safetensors) |

## ControlNet、检测、修复与放大

| 本机文件 | 大小 | 作用或身份 | 来源 |
| --- | ---: | --- | --- |
| `models/controlnet/anima-lllite-any-test-like-v2.safetensors` | 15.64 MiB | 线稿、涂鸦或灰度图约束的 Anima LLLite 补丁，供 Anima 参考控制分支。 | [kohya-ss 文件](https://huggingface.co/kohya-ss/Anima-LLLite/blob/main/anima-lllite-any-test-like-v2.safetensors) |
| `models/controlnet/anima-lllite-inpainting-v1.safetensors` | 62.73 MiB | Anima LLLite 局部重绘补丁，供 I2I AIO 遮罩路径。 | [kohya-ss 文件](https://huggingface.co/kohya-ss/Anima-LLLite/blob/main/anima-lllite-inpainting-v1.safetensors) |
| `models/controlnet/diffusion_pytorch_model.safetensors` | 2.34 GiB | SDXL Union ControlNet 标准版，供 WAI 放大重采样。文件名通用，复原时核对哈希以避免换成 ProMax。 本机引用于 `wai`。 | [xinsir Union 标准版，SHA‑256 对应](https://huggingface.co/xinsir/controlnet-union-sdxl-1.0/blob/main/diffusion_pytorch_model.safetensors) |
| `models/sams/sam_vit_b_01ec64.pth` | 357.67 MiB | SAM ViT‑B 分割模型，为局部细化生成掩膜。 本机引用于 `t2i`、`wai`。 | [Meta 官方权重](https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth) |
| `models/ultralytics/bbox/Eyeful_v2-Paired.pt` | 21.51 MiB | 配对眼部检测器，供 Anima T2I 与 WAI 修眼。 本机引用于 `t2i`、`wai`。 | [同 SHA‑256 镜像，下载后按本机名保存](https://huggingface.co/vladmandic/yolo-detailers/blob/main/eyeful-paired-v2.pt) |
| `models/ultralytics/bbox/face_yolov9c.pt` | 49.26 MiB | 人脸框检测，供 Anima T2I 和 WAI 修脸。 本机引用于 `t2i`、`wai`。 | [Bingsu ADetailer 文件](https://huggingface.co/Bingsu/adetailer/blob/main/face_yolov9c.pt) |
| `models/ultralytics/bbox/foot_anime_yolo11m_v3.pt` | 38.64 MiB | 动漫脚部框检测，供 Anima T2I 分支 123 修脚。 本机引用于 `t2i`。 | [Claquasse 文件](https://huggingface.co/Claquasse/foot_anime_yolo/blob/main/foot_anime_yolo11m_v3.pt) |
| `models/ultralytics/bbox/hand_yolov9c.pt` | 49.24 MiB | 手部框检测，供 Anima T2I 修手。 本机引用于 `t2i`。 | [Bingsu ADetailer 文件](https://huggingface.co/Bingsu/adetailer/blob/main/hand_yolov9c.pt) |
| `models/ultralytics/segm/ntd11_anime_nsfw_segm_v5-variant1.pt` | 19.63 MiB | 动漫 NSFW 区域实例分割，供 Anima 可选局部修复。 | [Nudimmud 文件](https://huggingface.co/Nudimmud/adetailers/blob/main/ntd11_anime_nsfw_segm_v5-variant1.pt) |
| `models/upscale_models/RealESRGAN_x4plus.pth` | 63.94 MiB | 通用 4× 超分，供 WAI 模型放大。 本机引用于 `wai`。 | [Real‑ESRGAN 官方权重](https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth) |
| `models/upscale_models/RealESRGAN_x4plus_anime_6B.pth` | 17.11 MiB | 动漫 4× 超分，供 Anima AIO 与 SVI/Lightning 的可选放大路径。 | [Real‑ESRGAN 官方权重](https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth) |

## 图像标签反推与扩写

PixAI 和 TIPO 的开关、阈值在工作台配置。WD14 的实际位置由本机 `AstrBotLocalTagger` 指定，复现时应核对该节点的 `MODEL_DIR`。

| 本机文件 | 大小 | 作用或身份 | 来源 |
| --- | ---: | --- | --- |
| `models/kgen/TIPO-v2.1-1B-A200M_TIPO-v2.1-1B-A200M-f16.gguf` | 1.88 GiB | TIPO v2.1 1B A200M F16，扩写 PixAI 反推标签。本机反推已启用。 本机引用于 `reverse`。 | [KBlueLeaf 文件，注意本机加载名](https://huggingface.co/KBlueLeaf/TIPO-v2.1-1B-A200M/blob/main/gguf/TIPO-v2.1-1B-A200M-f16.gguf) |
| `models/pixai_tagger/pixai-tagger-v1.0/model.safetensors` | 1.81 GiB | PixAI Tagger v1.0 动漫图像标签反推。加载需同目录的 `config.json`。 本机引用于 `reverse`。 | [PixAI 官方模型和配置](https://huggingface.co/pixai-labs/pixai-tagger-v1.0/tree/main) |
| `E:/stable-diffusion-webui/models/interrogators/models--SmilingWolf--wd-v1-4-moat-tagger-v2/snapshots/8452cddf280b952281b6e102411c50e981cb2908/model.onnx` | 311.09 MiB | WD14 MOAT Tagger v2，AstrBotLocalTagger 当前读取的 ONNX 权重。同目录的 `selected_tags.csv` 为必需标签表。 本机引用于 `prompt wd14`。 | [SmilingWolf 对应版本的权重与 CSV](https://huggingface.co/SmilingWolf/wd-v1-4-moat-tagger-v2/tree/8452cddf280b952281b6e102411c50e981cb2908) |

## Anima LoRA（15 个）

QQ 用 `/comfy lora anima` 查看排序和编号。来源待确认的文件以本机名称、训练元数据和 SHA‑256 前缀作为检索线索。

| 本机文件 | 大小 | 作用或身份 | 来源 |
| --- | ---: | --- | --- |
| `models/loras/anima/2.5D-style-ANI.safetensors` | 87.62 MiB | 2.5D 风格 LoRA。训练名 `zi_lora`。SHA‑256 前缀 `b470d3cea367`。 | 待确认公开下载来源 |
| `models/loras/anima/Alisa.safetensors` | 87.61 MiB | 艾莉莎角色 LoRA。训练名 `alisa_mikhailovna_kujou-roshidere_s1-ana-anime-soralz`。SHA‑256 前缀 `1b34ddba8641`。 | [对应角色的发布页候选，Anima 权重未比对](https://pixai.art/model/2037283162292384618) |
| `models/loras/anima/ashima_style.safetensors` | 87.60 MiB | Ashima 风格 LoRA。SHA‑256 前缀 `6d12abc379f5`。 | 待确认公开下载来源 |
| `models/loras/anima/Maria.safetensors` | 87.61 MiB | 玛丽亚角色 LoRA。训练名 `maria_mikhailovna_kujou-roshidere_s1-ana-anime-soralz`。SHA‑256 前缀 `e8415feabaab`。 | 待确认公开下载来源 |
| `models/loras/anima/odette.safetensors` | 87.62 MiB | Odette 训练项 LoRA。SHA‑256 前缀 `60a49099fca5`。 | 待确认公开下载来源 |
| `models/loras/anima/rucarachiv_style.safetensors` | 132.24 MiB | rucarachiv 风格 LoRA。SHA‑256 前缀 `9b761917db71`。 | 待确认公开下载来源 |
| `models/loras/anima/vodyanitsa.safetensors` | 87.60 MiB | Vodyanitsa 角色 LoRA。训练名 `vodyanitsa_gi_anima_v1`。SHA‑256 前缀 `455fdee366dd`。 | 待确认公开下载来源 |
| `models/loras/anima/Yuki.safetensors` | 87.61 MiB | 周防有希角色 LoRA。训练名 `yuki_suou-roshidere_s1-ana-anime-soralz`。SHA‑256 前缀 `d202a2e97f2e`。 | [对应模型系列发布页，Anima 版本未比对](https://civitai.red/models/519399) |
| `models/loras/anima/哥伦比亚_anima.safetensors` | 132.24 MiB | 哥伦比亚角色 LoRA。训练名 `columbina_anima_v1`。SHA‑256 前缀 `b0138ed4104d`。 | 待确认公开下载来源 |
| `models/loras/anima/梦见月瑞希_anima.safetensors` | 87.63 MiB | 梦见月瑞希角色 LoRA。训练名 `mizuki_anima_v1`。SHA‑256 前缀 `241fc16d019c`。 | 待确认公开下载来源 |
| `models/loras/anima/椎名真昼.safetensors` | 87.61 MiB | 椎名真昼角色 LoRA。训练名 `mahiru_shiina-otonari_no_tenshi_sama_s2-v3-ana-anime-soralz`。SHA‑256 前缀 `c05a2adbdc34`。 | 待确认公开下载来源 |
| `models/loras/anima/洛希琪.safetensors` | 87.61 MiB | 洛琪希角色，本机文件名保留 LoRA。训练名 `roxy_migurdia-mushoku_tensei_s3-v3-ana-anime-soralz`。SHA‑256 前缀 `76430cdb2aa3`。 | 待确认公开下载来源 |
| `models/loras/anima/胡桃_anima.safetensors` | 87.63 MiB | 胡桃角色 LoRA。训练名 `hutao_anima_v2`。SHA‑256 前缀 `1766c19cf70d`。 | 待确认公开下载来源 |
| `models/loras/anima/茜特菈莉_anima.safetensors` | 87.63 MiB | 茜特菈莉角色 LoRA。训练名 `citlali_anima_v2`。SHA‑256 前缀 `62a270fdf845`。 | 待确认公开下载来源 |
| `models/loras/anima/莱依拉.safetensors` | 132.24 MiB | 莱依拉角色 LoRA。训练名 `Layla`。SHA‑256 前缀 `7b7ab259b33b`。 | 待确认公开下载来源 |

## Illustrious LoRA（12 个）

QQ 用 `/comfy lora wai` 查看独立编号。角色名相同的文件可能来自不同训练项。

| 本机文件 | 大小 | 作用或身份 | 来源 |
| --- | ---: | --- | --- |
| `models/loras/illustrious/blue_archive-style-IL.safetensors` | 109.16 MiB | 蔚蓝档案画风 LoRA。训练名 `blue_archive-ixl-style-soralz`。SHA‑256 前缀 `04fad2ba6e02`。 | [同名 Illustrious 风格发布页，权重未比对](https://tensor.art/models/844969510780844511) |
| `models/loras/illustrious/pixel-Illustrious.safetensors` | 54.76 MiB | 像素画风，训练元数据指向 NoobAI‑XL 0.75 LoRA。训练名 `pixel`。SHA‑256 前缀 `b568a22e427b`。 | 待确认公开下载来源 |
| `models/loras/illustrious/八奈见杏菜-IL.safetensors` | 109.14 MiB | 八奈见杏菜角色 LoRA。训练名 `anna_yanami-makeine_s1-ixl-anime-soralz`。SHA‑256 前缀 `684e6e1903af`。 | 待确认公开下载来源 |
| `models/loras/illustrious/凯伊-IL.safetensors` | 109.13 MiB | 凯伊角色 LoRA。训练名 `h_madoka`。SHA‑256 前缀 `95c5f1c65be6`。 | 待确认公开下载来源 |
| `models/loras/illustrious/北条糸青-IL.safetensors` | 109.14 MiB | 北条糸青角色 LoRA。训练名 `shisei_houjou-kurakon_s1-v3-ixl-anime-soralz`。SHA‑256 前缀 `16929ba30e51`。 | 待确认公开下载来源 |
| `models/loras/illustrious/君岛绫乃-IL.safetensors` | 109.14 MiB | 君岛绫乃角色 LoRA。训练名 `ayano_kimishima_kujou-roshidere_s1-ixl-anime-soralz`。SHA‑256 前缀 `ad5088ee3429`。 | 待确认公开下载来源 |
| `models/loras/illustrious/四宫-IL.safetensors` | 109.14 MiB | 四宫辉夜角色 LoRA。训练名 `kaguya_shinomiya-kaguya_sama_wa_kokurasetai_tvs-ixl-anime-soralz`。SHA‑256 前缀 `8f79d4f10985`。 | 待确认公开下载来源 |
| `models/loras/illustrious/圣园未花-IL.safetensors` | 109.13 MiB | 圣园未花角色 LoRA。训练名 `h_madoka`。SHA‑256 前缀 `36067415a451`。 | 待确认公开下载来源 |
| `models/loras/illustrious/椎名真昼-IL.safetensors` | 109.13 MiB | 椎名真昼角色 LoRA。训练名 `h_madoka`。SHA‑256 前缀 `06e5d1142889`。 | 待确认公开下载来源 |
| `models/loras/illustrious/筱泽广-IL.safetensors` | 109.14 MiB | 筱泽广角色 LoRA。训练名 `hiro_shinosawa-idolmaster_gakuen-v2-ixl-game-soralz`。SHA‑256 前缀 `0d240cd4e0c3`。 | 待确认公开下载来源 |
| `models/loras/illustrious/结城明日奈-IL.safetensors` | 109.14 MiB | 结城明日奈角色，soralz 训练项 LoRA。训练名 `asuna_yuuki-sao_s2-ixl-anime-soralz`。SHA‑256 前缀 `e2cdd5a983ad`。 | 待确认公开下载来源 |
| `models/loras/illustrious/结城明日奈-Illustrious.safetensors` | 109.13 MiB | 结城明日奈角色，h_madoka 训练项 LoRA。训练名 `h_madoka`。SHA‑256 前缀 `2978d2e97e5e`。 | 待确认公开下载来源 |

## 视频及其他位置的 LoRA

`WAN-N/` 用于 WAN 2.2 配置中的 SVI、Lightning 和高低噪声 LoRA。`wan/` 中的 Wan 2.1 权重按基模和任务类型使用。

| 本机文件 | 大小 | 作用或身份 | 来源 |
| --- | ---: | --- | --- |
| `models/loras/Smooth_Booster_v4.safetensors` | 243.18 MiB | SDXL 系细节增强 LoRA。文件位于 LoRA 根目录，未归入 Anima 或 WAI 专用子目录。SHA‑256 前缀 `f2d92363839d`。 | [Smooth Booster v4 发布版本页](https://civitai.red/models/1145743?modelVersionId=2196453) |
| `models/loras/wan/lightx2v_I2V_14B_480p_cfg_step_distill_rank128_bf16.safetensors` | 1.37 GiB | Wan 2.1 14B 图生视频 LightX2V 蒸馏 LoRA，rank 128。 | [Kijai 文件](https://huggingface.co/Kijai/WanVideo_comfy/blob/709844db75d2e15582cf204e9a0b5e12b23a35dd/Lightx2v/lightx2v_I2V_14B_480p_cfg_step_distill_rank128_bf16.safetensors) |
| `models/loras/wan/lightx2v_T2V_14B_cfg_step_distill_v2_lora_rank128_bf16.safetensors` | 1.17 GiB | Wan 2.1 14B 文生视频 LightX2V 蒸馏 LoRA，rank 128。 | [Kijai 文件](https://huggingface.co/Kijai/WanVideo_comfy/blob/ada5d03a206e4b4a5a54317ac47da3715330fd45/Lightx2v/lightx2v_T2V_14B_cfg_step_distill_v2_lora_rank128_bf16.safetensors) |
| `models/loras/wan/Wan21_I2V_14B_lightx2v_cfg_step_distill_lora_rank64.safetensors` | 707.58 MiB | Wan 2.1 14B 图生视频 LightX2V 蒸馏 LoRA，rank 64。 | [LightX2V 文件](https://huggingface.co/lightx2v/Wan2.1-I2V-14B-480P-StepDistill-CfgDistill-Lightx2v/blob/main/loras/Wan21_I2V_14B_lightx2v_cfg_step_distill_lora_rank64.safetensors) |
| `models/loras/wan/Wan21_T2V_14B_lightx2v_cfg_step_distill_lora_rank32.safetensors` | 302.15 MiB | Wan 2.1 14B 文生视频 LightX2V 蒸馏 LoRA，rank 32。 | [Kijai 文件](https://huggingface.co/Kijai/WanVideo_comfy/blob/main/Wan21_T2V_14B_lightx2v_cfg_step_distill_lora_rank32.safetensors) |
| `models/loras/wan/Wan21_T2V_14B_lightx2v_cfg_step_distill_lora_rank64.safetensors` | 603.84 MiB | Wan 2.1 14B 文生视频 LightX2V 蒸馏 LoRA，rank 64。 | [Kijai WAN 文件库，具体文件未复核](https://huggingface.co/Kijai/WanVideo_comfy/tree/main) |
| `models/loras/WAN-N/SVI_v2_PRO_Wan2.2-I2V-A14B_HIGH_lora_rank_128_fp16.safetensors` | 1.14 GiB | SVI v2 Pro WAN 2.2 I2V 高噪声续写 LoRA。 本机引用于 `svi`。 | [Kijai SVI Pro 文件](https://huggingface.co/Kijai/WanVideo_comfy/blob/main/LoRAs/Stable-Video-Infinity/v2.0/SVI_v2_PRO_Wan2.2-I2V-A14B_HIGH_lora_rank_128_fp16.safetensors) |
| `models/loras/WAN-N/SVI_v2_PRO_Wan2.2-I2V-A14B_LOW_lora_rank_128_fp16.safetensors` | 1.14 GiB | SVI v2 Pro WAN 2.2 I2V 低噪声续写 LoRA。 本机引用于 `svi`。 | [Kijai SVI Pro 文件](https://huggingface.co/Kijai/WanVideo_comfy/blob/main/LoRAs/Stable-Video-Infinity/v2.0/SVI_v2_PRO_Wan2.2-I2V-A14B_LOW_lora_rank_128_fp16.safetensors) |
| `models/loras/WAN-N/Wan2.2-Lightning_I2V-A14B-4steps-lora_LOW_fp16.safetensors` | 585.14 MiB | WAN 2.2 I2V 低噪声 4 步蒸馏 LoRA，供 SVI 及 Lightning FP8 路径。 本机引用于 `svi`。 | [同名文件镜像，哈希未比对](https://huggingface.co/kalmi7223/LORAs/blob/main/Wan2.2-Lightning_I2V-A14B-4steps-lora_LOW_fp16.safetensors) |
| `models/loras/WAN-N/wan2.2_i2v_A14b_high_noise_lora_rank64_lightx2v_4step_1022.safetensors` | 605.25 MiB | WAN 2.2 I2V 高噪声 4 步蒸馏 LoRA，供 SVI 及 Lightning FP8 路径。 本机引用于 `svi`。 | [LightX2V 文件](https://huggingface.co/lightx2v/Wan2.2-Distill-Loras/blob/main/wan2.2_i2v_A14b_high_noise_lora_rank64_lightx2v_4step_1022.safetensors) |
| `models/loras/wan2.2-live 2d new-low.safetensors` | 292.59 MiB | WAN 2.2 低噪声 Live2D 风格 LoRA，Klee Live2D 画布用途。SHA‑256 前缀 `20a7f5a46ebc`。 | [相关发布页，new-low 版本未核实](https://tensor.art/models/909497636304762413/wan2.2-live-2d-v1-low) |
| `models/SmoothMix_Illustrious_v2.safetensors` | 243.18 MiB | 文件头标记为 SDXL LoRA。当前放在 `models/` 根目录，通常需要放到 `models/loras/illustrious/` 才会进入 WAI 目录。SHA‑256 前缀 `c9f19c74b806`。 | [相关 LoRA 项目，v2 文件未核实](https://tensor.art/models/839051840416070583) |

## A1111 共享模型

这些目录由 `G:/ComfyUI/extra_model_paths.yaml` 注册。WD14 另外由本机节点直接访问 E 盘，见上节。

| 本机文件 | 大小 | 作用或身份 | 来源 |
| --- | ---: | --- | --- |
| `E:/stable-diffusion-webui/models/Stable-diffusion/mymodel.ckpt` | 7.17 GiB | 本地 SD1 系 checkpoint。E 盘部分 LoRA 的训练元数据引用它，原始来源未确认。 | 待确认公开下载来源 |
| `E:/stable-diffusion-webui/models/Stable-diffusion/novelaifinal-pruned.ckpt` | 3.97 GiB | 旧 SD 系 checkpoint，按本机文件名记录，公开发布版本未确认。 | 待确认公开下载来源 |
| `E:/stable-diffusion-webui/models/Stable-diffusion/v1-5-pruned-emaonly.safetensors` | 3.97 GiB | Stable Diffusion 1.5 旧 checkpoint，来自 A1111 共享目录。 | [Comfy Org 归档文件](https://huggingface.co/Comfy-Org/stable-diffusion-1.5/blob/main/v1-5-pruned-emaonly.safetensors) |
| `E:/stable-diffusion-webui/models/Lora/flat_color.pt` | 72.33 MiB | A1111 共享 LoRA 文件，文件名标记为平涂风格，模型族与来源待核实。 | 待确认公开下载来源 |
| `E:/stable-diffusion-webui/models/Lora/last.safetensors` | 0.20 MiB | A1111 共享的本地 SD1 系 LoRA/LyCORIS，训练基底记录为 `mymodel.ckpt`。 | 待确认公开下载来源 |
| `E:/stable-diffusion-webui/models/Lora/robot.safetensors` | 0.20 MiB | A1111 共享的本地 SD1 系 LoRA/LyCORIS，训练基底记录为 `mymodel.ckpt`。 | 待确认公开下载来源 |
| `E:/stable-diffusion-webui/models/Lora/robot_2.safetensors` | 0.38 MiB | A1111 共享的本地 SD1 系 LoRA/LyCORIS，训练基底记录为 `mymodel.ckpt`。 | 待确认公开下载来源 |
| `E:/stable-diffusion-webui/models/SwinIR/SwinIR_4x.pth` | 135.87 MiB | A1111 共享的 SwinIR 4× 超分，具体权重仍可按发布文件复核。 | [本机 A1111 指向的作者权重](https://github.com/JingyunLiang/SwinIR/releases/download/v0.0/003_realSR_BSRGAN_DFOWMFC_s64w8_SwinIR-L_x4_GAN.pth) |

## 节点包随附权重和辅助数据

这些文件随包分发，或供节点内部代码使用。按表中包路径保留。

| 本机文件 | 大小 | 作用或身份 | 来源 |
| --- | ---: | --- | --- |
| `custom_nodes/ComfyUI-WanVideoWrapper/fantasyportrait/models/face_det.onnx` | 0.35 MiB | FantasyPortrait 人脸检测组件。 | [随节点包获取](https://github.com/kijai/ComfyUI-WanVideoWrapper) |
| `custom_nodes/ComfyUI-WanVideoWrapper/fantasyportrait/models/face_landmark.onnx` | 2.73 MiB | FantasyPortrait 人脸关键点组件。 | [随节点包获取](https://github.com/kijai/ComfyUI-WanVideoWrapper) |
| `custom_nodes/ComfyUI-WanVideoWrapper/multitalk/encoded_silence.safetensors` | 1.58 MiB | MultiTalk 的静音条件张量。 | [随节点包获取](https://github.com/kijai/ComfyUI-WanVideoWrapper) |
| `custom_nodes/comfyui_controlnet_aux/src/custom_controlnet_aux/diffusion_edge/taming/modules/autoencoder/lpips/vgg.pth` | 0.01 MiB | Diffusion Edge 中供 LPIPS 使用的 VGG 权重。 | [随节点包获取](https://github.com/Fannovel16/comfyui_controlnet_aux) |
| `custom_nodes/comfyui_controlnet_aux/src/custom_mesh_graphormer/modeling/data/mano_195_adjmat_indices.pt` | 0.02 MiB | MeshGraphormer 的网格、手部模型或采样辅助数据。 | [随节点包获取](https://github.com/Fannovel16/comfyui_controlnet_aux) |
| `custom_nodes/comfyui_controlnet_aux/src/custom_mesh_graphormer/modeling/data/mano_195_adjmat_size.pt` | 0.00 MiB | MeshGraphormer 的网格、手部模型或采样辅助数据。 | [随节点包获取](https://github.com/Fannovel16/comfyui_controlnet_aux) |
| `custom_nodes/comfyui_controlnet_aux/src/custom_mesh_graphormer/modeling/data/mano_195_adjmat_values.pt` | 0.01 MiB | MeshGraphormer 的网格、手部模型或采样辅助数据。 | [随节点包获取](https://github.com/Fannovel16/comfyui_controlnet_aux) |
| `custom_nodes/comfyui_controlnet_aux/src/custom_mesh_graphormer/modeling/data/mano_downsampling.npz` | 0.17 MiB | MeshGraphormer 的网格、手部模型或采样辅助数据。 | [随节点包获取](https://github.com/Fannovel16/comfyui_controlnet_aux) |
| `custom_nodes/comfyui_controlnet_aux/src/custom_mesh_graphormer/modeling/data/MANO_LEFT.pkl` | 3.29 MiB | MeshGraphormer 的网格、手部模型或采样辅助数据。 | [随节点包获取](https://github.com/Fannovel16/comfyui_controlnet_aux) |
| `custom_nodes/comfyui_controlnet_aux/src/custom_mesh_graphormer/modeling/data/MANO_RIGHT.pkl` | 3.29 MiB | MeshGraphormer 的网格、手部模型或采样辅助数据。 | [随节点包获取](https://github.com/Fannovel16/comfyui_controlnet_aux) |
| `custom_nodes/comfyui_controlnet_aux/src/custom_mesh_graphormer/modeling/data/mesh_downsampling.npz` | 1.64 MiB | MeshGraphormer 的网格、手部模型或采样辅助数据。 | [随节点包获取](https://github.com/Fannovel16/comfyui_controlnet_aux) |
| `custom_nodes/comfyui_controlnet_aux/src/custom_mesh_graphormer/modeling/data/smpl_431_adjmat_indices.pt` | 0.05 MiB | MeshGraphormer 的网格、手部模型或采样辅助数据。 | [随节点包获取](https://github.com/Fannovel16/comfyui_controlnet_aux) |
| `custom_nodes/comfyui_controlnet_aux/src/custom_mesh_graphormer/modeling/data/smpl_431_adjmat_size.pt` | 0.00 MiB | MeshGraphormer 的网格、手部模型或采样辅助数据。 | [随节点包获取](https://github.com/Fannovel16/comfyui_controlnet_aux) |
| `custom_nodes/comfyui_controlnet_aux/src/custom_mesh_graphormer/modeling/data/smpl_431_adjmat_values.pt` | 0.01 MiB | MeshGraphormer 的网格、手部模型或采样辅助数据。 | [随节点包获取](https://github.com/Fannovel16/comfyui_controlnet_aux) |
| `custom_nodes/efficiency-nodes-comfyui/py/sd15_resizer.pt` | 12.04 MiB | Efficiency Nodes 的 SD 1.5 latent 尺寸转换权重。 | [随节点包获取](https://github.com/jags111/efficiency-nodes-comfyui) |
| `custom_nodes/efficiency-nodes-comfyui/py/sdxl_resizer.pt` | 12.04 MiB | Efficiency Nodes 的 SDXL latent 尺寸转换权重。 | [随节点包获取](https://github.com/jags111/efficiency-nodes-comfyui) |

## 可选分支的待补资源

| 功能 | 本机盘点结果 | 下载或说明 |
| --- | --- | --- |
| SVI / Lightning 的 RIFE 插帧 | 当前关闭。`custom_nodes/comfyui_fill-nodes/nodes/cache/rife_models/` 未找到 `rife47.pth` / `rife49.pth` | [RIFE 作者项目](https://github.com/hzwer/Practical-RIFE) · [节点内 4.7 下载地址](https://huggingface.co/lividtm/RIFE/resolve/main/rife47.pth) · [节点内 4.9 下载地址](https://huggingface.co/lividtm/RIFE/resolve/main/rife49.pth)。节点下载地址的外网可用性未确认 |
| Anima I2I AIO 深度 LLLite | `depth_anything_v2_vitl.pth` 未在本次扫描路径中找到 | [Depth Anything V2 Large 作者仓库](https://huggingface.co/depth-anything/Depth-Anything-V2-Large)。放置目录以本机 ControlNet Aux 配置为准 |
| Anima I2I AIO 的 VOSR2 放大 | `models/vosr2/` 下当前没有模型包 | [VOSR2 官方模型目录](https://huggingface.co/CSWRY/VOSR/tree/main/VOSR2) · [节点包安装与文件布局](https://github.com/ylchen333/ComfyUI-VOSR2) |
| WAI 可选外部 `taesdxl` | 当前使用 checkpoint 内 VAE。盘点未见 TAESDXL 的编码器、解码器权重 | [TAESD 作者仓库与模型](https://github.com/madebyollin/taesd)。按 ComfyUI 的 `vae_approx/` 规则放置 |
| Anima AIO LoRA 预填项 | API 图中还有 `anima/alisa_mikhailovna_kujou-roshidere_s1-ana-anime-soralz.safetensors`，本机目录只看到 `anima/Alisa.safetensors` 对应的短名文件，旧字段当前不在执行路径 | 启用该槽时在工作台重新选中本机实际文件 |

`models/configs/` 的 YAML 是旧 Stable Diffusion 加载配置，`models/pixai_tagger/pixai-tagger-v1.0/config.json`、WD14 的 `selected_tags.csv` 与对应模型配套。恢复时按节点下拉项匹配文件名和相对目录，尤其是本机已重命名的 WAI、TIPO、Eyeful 和角色 LoRA。
