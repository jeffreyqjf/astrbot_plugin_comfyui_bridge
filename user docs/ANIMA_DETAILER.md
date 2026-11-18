# Anima Detailer 使用说明

Anima Detailer 使用 Anima 扩散模型对参考图做遮罩重绘、局部细化和放大。简称 `anima-detailer`，兼容 `animadetailer`、`adetailer`。它是独立工作流，保留原来的 Detailer V40。

## 新建任务

1. 选择 **Anima Detailer**，从图集或本地文件选择参考图。
2. 填写希望保留或加强的主体、发色、衣服等提示词；支持普通提示词预设、负向词和批次。
3. 需要局部处理时，在参考图预览点击「编辑遮罩」，或使用已有透明区域的 PNG。Mask Detailer 读取参考图遮罩。
4. 在「本次可选功能」勾选 Hires PreDetailer、Hires PostDetailer、In/Outpaint、Mask Detailer、Ultimate SD Upscaler。未勾选的对应分支仅在本次任务关闭，其他修复分支沿用保存设置。
5. LoRA 区域使用 Anima 目录，支持叠加、强度调整和人物 LoRA 遍历。单次 LoRA 替换画布的 LoRA 选择，通过原版 #5 模型入口供各个细化分支共用；附带词和图片多 LoRA 记录继续有效。

## 参数位置

| 设置 | 原版节点 |
| --- | --- |
| 扩散模型、文本编码器、VAE | #1 UNETLoader、#27 CLIPLoader、#38 VAELoader |
| 正向词、负向词 | #3、#41 easy wildcards，保留原版文本处理连线 |
| 种子及共享采样设置 | #49 Input Parameters，随机／固定种子沿用工作台规则 |
| LoRA | #5 Lora Loader，#57 原版附带词开关 |
| 手、NSFW、脸、眼细化 | #43、#44、#45、#46，各自采样与检测器参数可编辑 |
| Mask Detailer | #31 MaskToSEGS、#36 DetailerForEach |
| Hires 前／后 | #79、#80 easy hiresFix |
| In/Outpaint | #95 四边扩展量与羽化、#91 遮罩合并、#103 模型、#89 LLLite、#87 采样 |
| Ultimate 放大 | #47 模型、#48 放大与采样、#75／#76 图块尺寸计算 |

In/Outpaint 是原版共用分支。#95 四边扩展量均为 0 时结合参考图遮罩做 Inpaint；设置 left/top/right/bottom 后用于扩图，扩展遮罩与参考图遮罩由 #91 合并。扩展量、处理强度和采样参数在工作流参数页设置并保存。这里的数值不是新建任务复选框的一部分。

工作流参数页按原版分组提供旁路参数、模型下拉项和布局调整。界面隐藏或显示旁路字段不会改动画布布局。原版没有独立修脚、Regional Prompting 或独立 2ndSampler 分支，插件不添加虚构选项。

## QQ 命令

附图或回复图片：

```text
/comfy gen --wf anima-detailer detailed face --raw
/comfy gen --wf anima-detailer --hands on --face on --eyes off detailed face --raw
/comfy gen --wf anima-detailer --lora C1:0.8,S1:0.5 detailed face --raw
/comfy sweep lora --wf anima-detailer --preset 1,2 --raw
/comfy gen --wf anima-detailer --help
```

QQ 支持 `--image N` 选择消息中的图片。网页命令添加复用新建任务的参考图、遮罩和本次功能选择。命令 sweep 使用保存的功能设置；需要单次调整功能并遍历时使用简易添加。

## 本机模型条件

默认处理路径已通过本机节点和模型下拉项检查。原版 In/Outpaint 的 #103 选择 `anima-lllite-inpainting-v2.safetensors`，本机当前模型列表没有此文件。启用该分支前，先准备所需模型，或在 #103 选择确认兼容且已安装的模型并保存。插件不会自动下载或替换版本；缺失时任务不会入队。

SAM 3.1、去背景及其他旁路分支仍受各自模型和节点条件约束；启用时以工作流参数页的本机下拉项和校验为准。本轮验证了构图与接口，尚未验证实际 GPU 生成质量或 QQ 实际投递。

## 文件与后续维护

- 原版：ComfyUI `user/default/workflows/main/AnimaDetailer.json`。v3.6.0 按用户要求补充主要修复比较节点，原模型和处理连线保留。
- AstrBot 画布：ComfyUI `user/default/workflows/AstrBot/Anima_Detailer_AstrBot.json`，插件随包模板同名。
- API：ComfyUI `user/default/workflows/api/Anima_Detailer_AstrBot_API.json`；插件 `workflows/Anima_Detailer_AstrBot.json` 保留全部分支和旁路描述，按本次设置裁剪。

AstrBot 版仅将 #2 改为任务参考图占位、#15 改为插件可归档的 SaveImage，并移除旧输出的 metadata 连线；保留节点 ID、布局、分组、其他模型与参数。Image Saver 的专属文件名／元数据控件由插件输出和图片记录替代。

首次导出工具为 `scripts/export_anima_detailer.py`，使用 ComfyUI 环境已有的 comfy-cli 转换器及本机 object_info 快照，生成 AstrBot 画布、API 和随包配置。后续正式修改以 AstrBot 画布为准再导出；不要重新用原版覆盖已经手动调整的 AstrBot 画布或插件参数布局。安装包不自动重载生产插件，也不覆盖已保存的运行图。

## 在 ComfyUI 查看主要修复前后

原版和 AstrBot 版现在在遮罩、整图 Detailer、SAM 3.1、手、NSFW、脸、眼的主要修复列下方提供 `Image … #节点号` 比较框，保留原有 Ultimate 放大和全局比较。与 Advanced Gemma V40 一样，新增节点使用 Slide 模式：A 为处理后，B 为处理前，在图像上移动鼠标比较效果。

保存中的画布需要重新打开并运行一次才显示新预览。旁路的修复没有应用时，对应前后画面可能相同。原处理节点与分组位置保留，未给零散的预处理、尺寸或滤镜步骤增加比较框。插件生成 API 和新建任务功能保持原有行为。
