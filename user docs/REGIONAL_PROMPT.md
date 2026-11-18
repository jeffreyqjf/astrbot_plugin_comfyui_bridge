# 可选功能与 RGB 区域提示词

选择工作流后，「本次可选功能」只列出已适配的功能。勾选后显示配置，取消勾选会关闭本次任务的对应分支并保留网页草稿。其他修复、放大和视频模式继续在工作流参数中配置。

| 工作流 | 本次可选功能 |
| --- | --- |
| Advanced Gemma V40 | OpenPose、Any ControlNet、Regional Prompting、Ultimate SD Upscale Pre/Post Detailer、Hires Pre/PostDetailer、2ndSampler |
| Anima T2I | Anima LLLite、Regional Prompting、Hires Pre/PostDetailer、2ndSampler、Ultimate SD Upscaler |
| Detailer V40 | HiresFix、Inpaint、Outpaint、Mask Detailer、Ultimate SD Upscale |
| 其他工作流 | 保留各自提示词、参考图和 H3 等专用输入；没有对应节点时不显示空开关 |

ControlNet 勾选后选择模型预设、控制类型、直用或预处理以及图片。未勾选的分支不会沿用工作流中已开启的同名分支。直接使用旧 API 且未传单次选项时，仍沿用已保存工作流。

## Regional Prompt

1. 选择 **Advanced Gemma V40** 或 **Anima T2I**，填写整体正向提示词，例如 `three girls standing in a garden`。
2. 勾选 **Regional Prompting**。初始是红、绿、蓝三列遮罩，可切换三行，或清空后自行画区域。
3. 点击红、绿、蓝区域按钮选择绘制颜色，用画笔、矩形或橡皮调整遮罩。支持触摸绘制、笔径调整和撤销。黑色表示不额外指定区域，整体提示词仍生效。
4. 分别填写三个区域的主体与细节，例如红区 `1girl, red hair, red dress`，绿区 `1girl, green hair, green dress`，蓝区 `1girl, blue hair, blue dress`。
5. 区域强度和全局提示词强度初始均为 1。遮罩按工作流生成尺寸缩放，可切换横向与纵向绘制比例。
6. 加入队列。简易添加支持多批次及 LoRA 叠加、遍历；普通生成命令也支持该面板。命令 `sweep` 暂不显示 Regional Prompt，可使用简易添加的遍历。

「本地参考底图」和「图集参考底图」仅辅助描画，不作为图生图输入。已有 RGB PNG 可以通过「导入 RGB 遮罩」载入。这里的遮罩限定区域提示词的作用范围，沿用 Attention Couple 的生成方式，并非对既有图片逐块执行降噪重绘。

## 整套提示词预设

输入名称并点击「保存预设」，同时保存三区提示词、三区强度和全局强度。同名保存更新预设，选择预设一次填入三个区域，不改变遮罩。「⋯」提供刷新和删除。

预设位于插件数据目录 `regional_prompt_presets.json`，电脑与手机共用。版本冲突提示刷新并保留草稿。遮罩、参考底图和任务设置不写回工作流默认值。

## 工作流文件

原始画布保留。Advanced Gemma V40 与 Anima T2I 的 AstrBot 画布、API 导出及随包工作流已更新功能声明，原有节点、连接及布局保留。正式开发顺序仍为 AstrBot 画布、API 导出、同步插件。安装包不会自动覆盖独立编辑过的运行图，运行实例需另行同步和重载。

## V40 前后放大

勾选「Ultimate SD Upscale Pre Detailer」或「Ultimate SD Upscale Post Detailer」，可独立或同时启用。模型、倍率、采样等沿用保存的工作流；仅影响本次任务。普通生成命令与简易添加支持这两个开关，单次遍历使用简易添加。

## Hires 与 2ndSampler

Advanced Gemma V40 与 Anima T2I 新建任务均可勾选 Hires PreDetailer、Hires PostDetailer、2ndSampler。V40 可与前后 Ultimate 放大组合；Anima T2I 提供原版单路 Ultimate SD Upscaler 开关。分辨率、模型、步数、降噪等参数沿用工作流已保存值；仅影响本次任务。普通生成命令、简易添加及简易 LoRA 遍历支持这些选项。

Anima T2I 的 Hires、2ndSampler、Ultimate SD Upscaler 直接使用原版对应分支。请在左侧 Anima T2I 工作流参数中调整各分支的倍率、模型、步数、降噪等并保存，然后回到新建任务勾选所需功能。未勾选显式关闭本次分支，不会修改保存的默认值。RGB 编辑、整套提示词预设、普通命令与简易 LoRA 叠加／遍历和 V40 共用操作方式。

可选功能标签沿用 ComfyUI 英文名称（不带 Enable 前缀），中文说明及内部功能 ID 保持原有含义。

## Detailer V40 新建任务

1. 选择 **Detailer V40**，从图集或本地文件选择参考图。
2. 在「本次可选功能」勾选 HiresFix、Inpaint、Outpaint、Mask Detailer、Ultimate SD Upscale。五项独立，可组合启用；未勾选显式关闭本次分支。其他修复分支仍沿用工作流设置。
3. 使用 Inpaint 或 Mask Detailer 时，在参考图预览中绘制遮罩，或提供已有透明通道的图片；只有遮罩区域参与对应局部处理。Outpaint 使用工作流节点 #50 保存的 left/top/right/bottom 扩展量，扩展遮罩由该节点产生。
4. 提示词／预设与采样、模型、倍率等按现有输入和工作流设置生效。即使保存的工作流关闭这些分支，新建任务仍提供所需提示词及遮罩输入。勾选只影响本次任务，不修改保存的参数。

简易添加和普通命令添加都支持这五个开关。命令 sweep 不提供这些选项。可选功能使用英文原名且不带 Enable。

本机核对发现原默认的 `noobaiInpainting_v10.safetensors` 未安装；使用 Inpaint／Outpaint 前，请在工作流参数的 ControlNetLoader #35／#36 选择本机已有且适配所用模型的文件并保存。提交时会核对所选模型是否可用，缺失会显示节点与参数提示；插件不会自动下载或替换模型。
