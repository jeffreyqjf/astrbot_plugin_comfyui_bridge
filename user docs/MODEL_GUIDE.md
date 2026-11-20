# 模型配置指南

在工作台 **管理 → 模型配置指南** 查看当前安装的每条工作流。清单根据实际加载节点、API 连线和保存图生成；Anima T2I 另外读取画布的旁路加载器。更改节点模型并刷新即可更新名称。

先准备基础模型，再按需配置分支模型；“当前分支依赖”表示输出连线引用，不保证运行时旁路一定执行。WAN 续写的 FP8 与 GGUF 为候选模式，选择对应高低噪声一套。未识别的第三方加载器及运行时自动下载的预处理权重，以节点作者说明为准。

## 发布页、存在检查与确认下载（v3.15.0）

主要入口是「打开发布页」，只打开浏览器网页，不会触发后台下载。清单按文件名检查对应模型目录的所有子目录，同时读取 extra_model_paths.yaml，兼容 diffusion_models/unet、text_encoders/clip 等别名。已存在时显示实际路径并禁用重复下载；这里只检查名称／非空文件，不证明哈希、版本或加载兼容性。改名文件无法仅凭名称自动识别。插件无法确认本机 ComfyUI 目录或扫描失败时显示未确认，不擅自判为缺失。

只有已核对精确直链的文件提供「下载模型」。点击后先显示文件名、来源和 ComfyUI 保存目录，用户点击「确认下载至 ComfyUI」才开始。文件下载到运行插件的电脑，不是手机本地。页面展示传输量、百分比及总量；服务器未返回总大小时显示不定进度。可取消，部分文件会清理，不作为可用模型出现；失败后可重试，不支持断点续传。

同一插件一次只运行一个下载；关闭网页不会取消，重新打开可继续查看或取消。任务历史仅本次插件进程保留，重载会取消进行中的下载并清理临时文件。已有模型不覆盖、不自动重命名、不自动应用到工作流。后台下载需要已确认本机 ComfyUI 目录，文件保存到清单所列模型目录；额外路径只用于重复检测。无直链、需要登录或访问受限时使用发布页自行下载。当前提供 Anima 主模型／文本编码器／VAE、SDXL Turbo、Canny Control-LoRA 和两个 RealESRGAN 文件的直链，其他文件保留发布页入口。

目录相对于 ComfyUI 根目录，保留名称中的子文件夹；使用 extra_model_paths.yaml 时可映射到外部磁盘。下载后刷新 ComfyUI 模型列表，在工作流参数页选择实际文件名并保存，再刷新指南。不能仅重命名文件把不同模型、精度或格式互相替代。

发布链接优先使用模型作者、官方组织或 Comfy 官方转换页。部分本机文件为旧版或别名，页面会标明转换／转载／待核实，绝不将镜像标作官方。页面提供发布页入口供核对版本，不承诺精确文件始终可下载；下载权限和许可证以发布页为准。

## 编辑链接及导入导出（v3.16.0）

每个模型的「编辑模型信息」提供类似 Windows 环境变量的链接列表，最多 10 项 HTTP／HTTPS 地址。选中后可新建、编辑、删除、上移或下移；双击或 F2 编辑，Enter 完成，Esc 撤销当前编辑。首项标为首选，作为「打开发布页」入口；可打开当前选中的备用链接。删除所有项可移除网页入口。新建的空白项需要填写或删除后才能保存。保存后会记忆，同工作流的模型名与目录共同确定记录，不影响其他工作流。自定义地址标为自定义链接，不会被当成已核对的后台下载直链。

AstrBot 内嵌页面禁止弹窗，因此内嵌页会在运行插件的 Windows 电脑默认浏览器打开链接；独立手机网页在手机浏览器开新标签。若不支持或打开失败，页面提供可复制地址。链接需要登录才可操作，远程工作台不提供启动插件电脑浏览器的接口。

「管理 → 导入导出 → 工作流模型链接」选择工作流后可导出 JSON，包含每个模型的链接列表和顺序。导入时选择同一工作流，合并同模型的链接设置，其余设置保留；先导入相应工作流，再导入链接。此文件不包含模型权重或已存在状态，直接填写的私有链接也会原样导出，请按实际需要分享。插件数据目录 model_links.json 用于长期保存，备份时一同保留。

已存在状态统一用禁用「已存在」按钮表示，保留实际路径；不区分该模型有没有后台下载直链。

### 编辑模型简介（v3.17.0）

卡片按钮已升级为「编辑模型信息」，可同时编辑模型简介和多个网页链接。简介支持换行、留空，最多 4000 字；保存后卡片更新，仍按工作流分别记忆。管理 → 导入导出 → 工作流模型信息可一起迁移简介与链接；旧版链接 JSON 不含简介时不会清空当前简介。模型文件名、目录与模型本身不被修改。

## 来源索引

人工核对日期：2026-11-20。维护清单见 templates/model_sources.json，网页运行时不联网搜索。

| 对应文件 | 来源 | 下载／发布页 | 简要用途与兼容说明 |
| --- | --- | --- | --- |
| `minimax_h3_ref2v_turbo_silver*` | 合并作者 | [发布页](https://huggingface.co/silveroxides/MiniMax-H3_tests/tree/main/silver_official_releases) | H3 Silver DARE-TIES 加速 LoRA；选择 pruned v2 Ref2V 文件。 |
| `minimax_h3_video_vae_int8_convrot*` | 转换作者 | [发布页](https://huggingface.co/Kijai/MiniMax-H3-experimental) | H3 INT8 视频 VAE，和音频 VAE 不可互换。 |
| `SVI_v2_PRO*` | 节点维护者配套转换 | [发布页](https://huggingface.co/Kijai/WanVideo_comfy/tree/main/LoRAs/Stable-Video-Infinity/v2.0) | SVI v2 PRO 续写 LoRA，使用匹配的 HIGH／LOW。 |
| `*lightx2v*` | 作者 | [发布页](https://huggingface.co/lightx2v/Wan2.2-Lightning) | WAN 加速 LoRA；高低噪声及步数要配套。 |
| `Wan2.2-Lightning*` | 作者 | [发布页](https://huggingface.co/lightx2v/Wan2.2-Lightning) | WAN Lightning 加速 LoRA。 |
| `noobIPAMARK1*` | 配套转载（非原作者） | [发布页](https://huggingface.co/r3gm/noob-ipa) | IP-Adapter；该分发由 Krita AI 官方模型清单引用。 |
| `CLIP-ViT-bigG*` | 作者配套 | [发布页](https://huggingface.co/h94/IP-Adapter) | SDXL IP-Adapter 的 bigG 图像编码器；节点文件名可能是本机别名。 |
| `clip_vision_g*` | 作者配套 | [发布页](https://huggingface.co/h94/IP-Adapter) | IP-Adapter 图像编码器；核对模型架构及本机命名。 |
| `openpose_noob*` | 作者候选（别名未核实） | [发布页](https://huggingface.co/Laxhar/noob_openpose) | Noob OpenPose；本机文件名是别名，下载前核对原文件及工作流模型设置。 |
| `noobaiInpainting*` | 原作者发布页 | [发布页](https://civitai.com/models/1376234) | NoobAI／Illustrious 补绘控制模型；本机别名需在节点选择实际文件。 |
| `anima-lllite-*` | 作者 | [发布页](https://huggingface.co/kohya-ss/Anima-LLLite) | LLLite 控制／遮罩补绘；v1 和 v2 不自动互换。 |
| `qwen_3_06b_base.safetensors` | 官方配套 | [发布页](https://huggingface.co/circlestone-labs/Anima) | Anima 文本编码器。 |
| `qwen_image_vae.safetensors` | 官方配套 | [发布页](https://huggingface.co/circlestone-labs/Anima) | Anima 图像编解码。 |
| `sd_xl_turbo*` | 官方 | [发布页](https://huggingface.co/stabilityai/sdxl-turbo) | SDXL Turbo 快速文生图主模型。 |
| `sdxl_vae*` | 官方 | [发布页](https://huggingface.co/stabilityai/sdxl-vae) | SDXL 图像编解码。 |
| `*Illustrious-17*` | 作者发布页 | [发布页](https://civitai.com/models/827184/wai-illustrious-sdxl?modelVersionId=2883731) | WAI v17；本机文件名可能改过，请在节点选择实际下载的文件名。 |
| `gemma4_e4b*` | Comfy 官方转换 | [发布页](https://huggingface.co/Comfy-Org/gemma-4) | 提示词增强；并非基础绘图模型。 |
| `*Singularity*` | 微调作者 | [发布页](https://huggingface.co/WarmBloodAban/Minimax-h3_Singularity) | H3 Singularity 微调版；本机旧 v1.3 文件名可能不同，请核对 Ref2VA 与量化格式。 |
| `qwen3vl_32b_minimax*` | Comfy 官方转换 | [发布页](https://huggingface.co/Comfy-Org/MiniMax-H3) | H3 文本／视觉编码器，量化格式需节点与硬件支持。 |
| `minimax_h3_*vae*` | Comfy 官方转换 | [发布页](https://huggingface.co/Comfy-Org/MiniMax-H3) | H3 视频或音频编解码，二者不可混用。 |
| `minimax_h3_latent*` | Comfy 官方转换 | [发布页](https://huggingface.co/Comfy-Org/MiniMax-H3) | H3 潜空间视频放大。 |
| `Wan2_2-*_fp8*` | 转换作者 | [发布页](https://huggingface.co/Kijai/WanVideo_comfy_fp8_scaled) | WAN 高低噪声配对模型；区分 I2V/T2V。 |
| `umt5_xxl*` | Comfy 官方转换 | [发布页](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged) | WAN 文本编码器。 |
| `wan_2.1_vae*` | Comfy 官方转换 | [发布页](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged) | WAN 视频编解码。 |
| `sam3.1*` | Comfy 官方转换 | [发布页](https://huggingface.co/Comfy-Org/sam3.1) | SAM 3.1 分割；此加载器使用 checkpoints 目录。 |
| `sam_vit_b*` | 官方 | [发布页](https://github.com/facebookresearch/segment-anything) | SAM ViT-B 分割，按作者说明下载 checkpoint。 |
| `control-lora-canny*` | 官方 | [发布页](https://huggingface.co/stabilityai/control-lora) | SDXL 边缘控制；不是 Anima LLLite。 |
| `RealESRGAN*` | 官方 | [发布页](https://github.com/xinntao/Real-ESRGAN/releases) | 像素空间超分；anime_6B 为动漫优化版。 |
| `foot_anime_yolo*` | 作者 | [发布页](https://huggingface.co/Claquasse/foot_anime_yolo) | 脚部区域检测，供修脚分支使用。 |
| `face_yolov9c*` | 作者 | [发布页](https://huggingface.co/Bingsu/adetailer) | 脸部区域检测。 |
| `hand_yolov9c*` | 作者 | [发布页](https://huggingface.co/Bingsu/adetailer) | 手部区域检测。 |
| `4x_foolhardy_Remacri*` | 模型索引／原始来源入口 | [发布页](https://openmodeldb.info/models/4x-Remacri) | 4 倍超分。工作流使用 pth，不要把其他格式只改后缀冒充。 |
| `TIPO*` | 作者 | [发布页](https://huggingface.co/KBlueLeaf/TIPO-v2.1-1B-A200M) | 提示词补全／扩写；按节点选择 GGUF 版本。 |
| `pixai-tagger-v1.0` | 官方 | [发布页](https://huggingface.co/pixai-labs/pixai-tagger-v1.0) | 图片标签反推；需同时下载 model.safetensors 和 config.json。 |
| `VOSR2` | 作者 | [发布页](https://huggingface.co/CSWRY/VOSR) | 视觉超分模型包，包含 checkpoint、DINOv2 与 Qwen VAE，按节点说明保持子目录。 |
| `taesdxl` | 作者 | [发布页](https://github.com/madebyollin/taesd) | 快速 VAE 预览；需 taesdxl_encoder 和 decoder 配套文件，按 ComfyUI 安装说明放置。 |
| `anima-aesthetic-v1.1.safetensors` | 官方 | [发布页](https://huggingface.co/circlestone-labs/Anima) | Anima 扩散模型；选择与工作流匹配的版本。 |
| `rife49` | 加载节点作者说明 | [发布页](https://github.com/filliptm/ComfyUI_Fill-Nodes) | FL_RIFE 首次运行下载 rife49.pth 到自身缓存；不要误放 checkpoints。 |

未找到权威来源的精确文件保留在各工作流页面，标为来源待核实，例如部分 Eyeful／NSFW 检测器、本机改名的 WAN GGUF 和人物 LoRA；不会凭文件名猜一个官方链接。
