# 项目地图

项目根目录位于 `D:\QQbot\插件\astrbot_plugin_comfyui_bridge`。ComfyUI 是独立工作区，位于 `G:\ComfyUI`。

| 路径 | 用途 | 默认责任 |
| --- | --- | --- |
| `main.py`、`bridge/qq/` | 插件生命周期、指令、工具、消息和参考图 | Backend |
| `bridge/client.py`、`bridge/service.py`、`bridge/video_library.py` | ComfyUI 请求、队列与媒体任务 | Backend |
| `bridge/studio/`、`_conf_schema.json` | 工作台服务端、远程入口、表单处理与宿主配置 | Backend |
| `views/anima/` | HTML、CSS、JavaScript，含任务、遮罩、归档评价、视频与词库 | Frontend |
| `bridge/workflows/`、`workflows/` | 图加载、字段映射、专用模型逻辑、随包 API 图 | Workflow |
| `templates/` | Anima 同步与参考画布、WD14 辅助 API、默认绘图人格 | Workflow 负责工作流类文件，Backend 负责绘图人格 |
| `bridge/image_archive.py`、`bridge/lora_settings.py` | 归档、评价、LoRA 排序和附带词持久规则 | Data |
| `static workflows/` | 现有参考图资产，变更前核实用途和来源 | Architect 协调 Workflow |
| `README.md`、`user docs/` | 用户说明与参考资料 | Architect 安排相应角色核对 |
| `metadata.yaml`、`build_zip.py`、`pyproject.toml`、`requirements.txt` | 版本、安装打包、检查配置与依赖 | Architect |
| `AGENTS.md`、`.codex/`、`docs/` | Agent 规则与项目知识 | Architect |

运行位置以实际实例为准。AstrBot Launcher 实例入口位于 `%USERPROFILE%\.astrbot_launcher\instances\`。通常在实例 `core\data\plugins\` 安装插件，在 `core\data\plugin_data\` 保存实际工作流和插件数据。ComfyUI 画布和手动导出在 `user\default\workflows\`。在本机写入前先核对运行实例、配置和适用维护说明。

初始化基线见 [开发状态](development_status.md)。当前检出里用户文档位于 `user docs/`，README 中已有的 `docs/` 用户文档链接待随获批文档变更修订。
