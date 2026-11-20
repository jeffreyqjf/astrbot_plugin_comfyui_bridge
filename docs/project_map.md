# 项目地图

项目根目录位于 `D:\QQbot\插件\astrbot_plugin_comfyui_bridge`。ComfyUI 是独立工作区，位于 `G:\ComfyUI`。

| 路径 | 用途 |
| --- | --- |
| `main.py`、`bridge/qq/` | 插件生命周期、指令、工具、消息和参考图 |
| `bridge/client.py`、`bridge/service.py`、`bridge/video_library.py` | ComfyUI 请求、队列与媒体任务 |
| `bridge/studio/`、`_conf_schema.json` | 工作台服务端、远程入口、表单处理与宿主配置 |
| `views/workbench/` | HTML、CSS、JavaScript，含任务、遮罩、归档评价、视频与词库 |
| `views/workbench/task_inspect.js`、`bridge/studio/job_details.py` | 任务预设分页与长按预览、受理配置快照详情和凭据字段隐藏 |
| `bridge/workflows/`、`workflows/` | 图加载、字段映射、专用模型逻辑、随包 API 图 |
| `bridge/workflows/regional.py`、`bridge/studio/regional_presets.py`、`views/workbench/task_features.js` | 可扩展任务功能、RGB 区域提示词、三区预设及遮罩编辑 |
| `templates/` | Anima 同步与参考画布、WD14 辅助 API、默认绘图人格 |
| `bridge/image_archive.py`、`bridge/controlnet_archive.py`、`bridge/lora_settings.py` | 图像归档、评价、LoRA 排序和附带词 |
| `static workflows/` | 现有参考图资产，变更前核实用途和来源 |
| `README.md`、`user docs/` | 用户说明与参考资料 |
| `metadata.yaml`、`build_zip.py`、`pyproject.toml`、`requirements.txt` | 版本、安装打包、检查配置与依赖 |
| `AGENTS.md`、`.codex/`、`docs/` | 单 Agent 规则与项目知识 |

运行位置以实际实例为准。AstrBot Launcher 实例入口位于 `%USERPROFILE%\.astrbot_launcher\instances\`。通常在实例 `core\data\plugins\` 安装插件，在 `core\data\plugin_data\` 保存实际工作流和插件数据。ComfyUI 画布和手动导出在 `user\default\workflows\`。在本机写入前先核对运行实例、配置和适用维护说明。

初始化基线见 [开发状态](development_status.md)。当前检出里用户文档位于 `user docs/`，README 中已有的 `docs/` 用户文档链接待随获批文档变更修订。

## Anima Detailer

- `workflows/Anima_Detailer_AstrBot.json`：独立工作流、原版全部可用分支与参数，简称 `anima-detailer`。
- `templates/Anima_Detailer_AstrBot.json`：保留布局的配套 AstrBot 画布。
- `bridge/workflows/detailer.py`：任务功能及 Anima ModelOnly LoRA 注入；分支执行及参数面板复用 `v40.py` 和 `studio_settings.py`。
- `scripts/export_anima_detailer.py`：使用 ComfyUI 环境已有转换器进行受控导出；不加入运行安装包。
- `user docs/ANIMA_DETAILER.md`：新建任务、QQ、节点参数和本机模型条件。

## Detailer 主要修复对比

- `templates/Detailer_V40_AstrBot.json`、`templates/Anima_Detailer_AstrBot.json`：带主要修复滑动比较的 AstrBot 画布，与本机同名画布同步。
- `scripts/add_detailer_comparisons.py`：依据主要修复节点的实际输入／输出补齐比较，保留原位置、分组、处理连线及已有比较；处理原版需有用户明确授权。测试位于 `tests/test_detailer_comparisons.py`。

## 反推记录

- `bridge/studio/reverse_history.py`：提示词／原图副本持久保存、分页、删除与登录保护接口。
- `bridge/service.py`：run_caption 成功出口统一记录 PixAI／TIPO、WD14 和 AI 反推结果。
- `views/workbench/reverse_history.js`：管理侧边栏入口、缩略图、原图、复制、分页和删除确认。

## 工作流模型指南

`bridge/studio/model_catalog.py` 只读合并运行图、完整保存图和 Anima 旁路画布中的加载节点；`templates/model_sources.json` 维护人工核对的作者／官方／转换来源。`views/workbench/model_catalog.js` 渲染管理侧模型配置指南；`user docs/MODEL_GUIDE.md` 保存来源索引。新增模块、来源 JSON、前端脚本和用户说明均列入 build_zip.py 白名单。

模型指南的存在检查、目录别名／extra_model_paths.yaml 和经过确认的可取消下载由 bridge/studio/model_downloads.py 管理；生命周期在插件 terminate 中停止。该模块不复用 ComfyUI 的认证会话。源清单 downloads 仅登记经核对的精确文件直链。

bridge/studio/model_links.py 维护用户按工作流保存的有序模型网页链接、revision 与 JSON 导入导出，以及仅 AstrBot 面板使用的 Windows 浏览器打开入口。链接不参与后台自动下载 URL 解析。
