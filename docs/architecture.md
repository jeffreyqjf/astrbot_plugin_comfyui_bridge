# 项目架构

v3 任务功能由 `task_inputs.features` 声明、`views/workbench/task_features.js` 渲染。Regional Prompt 的节点契约与验证位于 `bridge/workflows/regional.py`，持久预设位于 `bridge/studio/regional_presets.py`。工作流持有本次节点图片，任务服务统一上传并写入独立执行图；界面不向共享默认图写入草稿。

AstrBot ComfyUI Bridge 将 QQ 和网页创作工作台的请求转换成 ComfyUI 工作流任务，并处理结果回传、图片归档与评价。当前源码版本见 [metadata.yaml](../metadata.yaml)。

| 层 | 入口 | 职责 |
| --- | --- | --- |
| QQ 与 AstrBot 工具 | `main.py`、`bridge/qq/` | 指令、权限、会话选择、引用图和结果投递 |
| 工作台 | `views/workbench/`、`bridge/studio/` | 内嵌与远程工作台、任务表单、参数保存、媒体和预设 |
| 任务服务 | `bridge/service.py` | 准备工作流、并发、超时、状态、取消、输出与追溯 |
| 工作流适配 | `bridge/workflows/`、`workflows/` | 选择图、节点映射、分支、参数覆盖、API 图与配置 |
| ComfyUI 客户端 | `bridge/client.py` | 节点 schema、上传、提交、轮询、取消和下载 |
| 持久数据 | `bridge/image_archive.py`、`bridge/lora_settings.py` 等 | 档案、图片状态、模型偏好及旧记录兼容 |

生成入口先解析选项和工作流，任务服务通过映射准备图。带参考图的任务上传后将 ComfyUI 返回的名称填入图，再提交 prompt。插件任务 ID 与下游 prompt ID 分开记录。输出节点决定下载媒体，图像记录再进入评价流程。QQ 的生成完成和媒体投递分别确认。

工作台与 QQ 共用任务服务。前端依赖 Web API 返回的参数 schema、任务状态与图片标识。模型和可用节点以运行的 ComfyUI 为准。运行数据目录、随包资源和 ComfyUI 画布见 [项目地图](project_map.md)，边界见 [API 契约](api_contracts.md) 与 [持久数据结构](database_schema.md)。

任务配置详情沿用准备后的单次执行图，在内存 Job 中保留快照及输出／提示词映射；工作台按需请求经过凭据隐藏的描述，不从当前工作流重建历史参数，也不增加队列轮询的数据量。预设长按预览复用收藏图片读取接口，并取消滚动、松开或关闭后的预览响应。

绘图请求钩子将人格与动态状态作为临时 TextPart 追加到用户内容，使用 AstrBot 的临时标记排除历史持久化，保持宿主系统提示词不变。工具发现、直接绘图标记及权限门禁沿用原逻辑。任务服务所有日志共用 AstrBot logger。
