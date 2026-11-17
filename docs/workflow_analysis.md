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
| MiniMax H3 Seed Hunter | `minimax_h3.py`、随包的两份 MiniMax H3 API 图 | 基准种子映射、三路候选偏移、可选参考图、潜空间放大和带音频 MP4 |
| PixAI 和 WD14 | 反推工作流与 `templates/Anima_WD14_Caption_AstrBot.json` | 文本输出、参考图序号、可选扩写 |

正式更新依次修改 AstrBot 画布、导出 API、同步随包文件。记录画布、API 和随包路径，核对节点 ID、`class_type`、端口与连线、条件分支、模型和输出可达性。涉及参考图时核对入口、预处理与目标节点。涉及分段视频时核对单段及非顺序多段。必要的实际生成纳入当轮验证记录。

## v2.25.0 适配变化

- V40 OpenPose、Any 和 Anima T2I LLLite 有独立的工作台单次输入。V40 Any 先校验 Canny/Depth 与对应模型。Anima T2I 深度使用 `ModelPatchLoader` 枚举的深度模型。保存分支及普通重绘图可与 ControlNet 分开处理。
- Detailer V40 的修脚在修眼之后、全局后处理之前。脚分支关闭时沿用修眼后的图片。默认手动 API 裁剪关闭的分支，随包文件保留可启用的分支。兼容升级只重连匹配旧图特征的节点。
- 已核对并同步三个 AstrBot 画布、手动 API 和随包图。当前安装副本和其正式工作流运行配置未同步。

## v2.33.0 · MiniMax H3 Seed Hunter

- 原画布位于 `MiniMaxH3/FoxFurEssence H3 Seed Hunter v3.json`。首轮三套采样共享模型、提示词和音视频潜空间，使用基准种子及两个偏移值。首轮视频和音频分别解码并由 VHS 合流。原图另有可切换的定稿、参考视频续写、音频、插帧及参考引导分支。
- AstrBot 版将首轮搜种和放大定稿拆成两张显式连线画布。`h3` 在 15、35、55 输出候选，`h3-final` 以选中的实际种子重建首轮、放大去噪潜空间并运行二轮采样，节点 67 输出。两图映射 `5.prompt` 和 `16.value`，单张参考图由插件按需接到 `5.ref_images.ref_image_0`。
- 两张画布保存在 ComfyUI 的 `AstrBot/`，用已安装的转换器和本机节点定义导出到 `api/`，随后同步插件 `workflows/`。操作与权重清单见 [Seed Hunter 使用教程](../user%20docs/MINIMAX_H3_SEED_HUNTER.md)。
