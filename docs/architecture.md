# 项目架构

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
