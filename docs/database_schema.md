# 持久数据结构

v3 新增 `regional_prompt_presets.json`：`{version:1,presets:{名称:{regions:[{text,strength},...],base_strength}}}`。最多 64 套、2 MB，按文件摘要处理并发冲突。遮罩不存入预设，由任务上传到 ComfyUI input，已提交图中记录各 LoadImage 文件名及三区文本。旧持久数据无需迁移。

当前插件使用 JSON、媒体文件和内存任务状态。源码中未发现用于插件记录的关系数据库或 SQL schema。以下路径以 AstrBot 插件数据目录为根，媒体根目录另行说明。

| 存储 | 标识与内容 | 证据 |
| --- | --- | --- |
| `generation_metadata/<job_id>.json` | 插件任务 ID、工作流、种子、状态、参考图 SHA-256、已提交 prompt、下游 prompt ID 和可用输出信息 | [service.py](../bridge/service.py) |
| `image_reviews/<任务 ID 前两位>/<job_id>.json` | 所有者、工作流、创建时间、相对目录、图片槽位、内容摘要及可选生成信息 | [image_archive.py](../bridge/image_archive.py) |
| `controlnet_assets/<asset_id>.json` | 按任务、分支和产物槽标识控制图，记录媒体摘要、来源摘要、预处理类型与评价状态 | [controlnet_archive.py](../bridge/controlnet_archive.py) |
| 图片媒体目录 | `unevaluate` 待评价、`favourite` 收藏、`pass` 通过，各有 `SFW` 和 `NSFW` 分类。可用本机 ComfyUI 输出目录，否则用插件输出目录 | [image_archive.py](../bridge/image_archive.py) |
| `workflows/` 和其他设置 JSON | API 图与工作流设置、会话选择、命令简称、QQ 超时、预设和各族 LoRA 设置 | [workflow_store.py](../bridge/workflows/workflow_store.py)、[studio_settings.py](../bridge/studio/studio_settings.py)、[lora_settings.py](../bridge/lora_settings.py) |

生成图标识为 `<job_id>:<序号>`，序号从 1 开始。手动放入的图片有独立的 `manual:...` 标识。评价通过移动原图表达状态，关联记录仍以任务 ID 找回。多 LoRA 按输出节点从生成图追溯，评价记录的 `generation.loras` 按图片槽位保存。旧评价记录在需要时读取生成追溯文件补足信息。

ControlNet 产物的媒体保存在 ComfyUI `input/my_input/{unevaluated,favourite,pass}/<asset_id>.<格式>`。生成档案可在每个输出图槽记录 `controlnets`，每个关系保留 ID、分支、类型和本次是否新建。文件状态迁移时保持 ID，保存目标媒体并校验后更新索引。旧评价记录可省略控制图关系。

参数布局保存在工作流 `astrbot.parameter_layout`，以版本、分类顺序和 `节点.字段` 顺序表示。布局保存与参数值修改分开，同名导入及命名配置保留已有布局。`workflow_layout_admissions.json` 记录已接纳的工作流名，首次升级保留既有排序，之后停机期间新放入的自定义图也能在首次读取时生成初始布局。

## LoRA 预览关联

各族 `lora_order*.json` 新增可选 `previews: {LoRA_ID: image_ID}`，与排序／分类／强度保存在同一个原子替换文件内。缺省为空；该关联按目录内稳定 ID 保存，不使用预览 URL 或图片二进制。旧版列表设置仍可读取，无需迁移。

## 高清成品状态（v3.10.0）

图片归档增加 `hd`，属于 REVIEW_STATES 和 GALLERY_STATES，目录 `hd/{SFW|NSFW}/…`。已有任务图片保持 `{job_id}:{index}` 标识，手动文件支持 `manual:hd:…`。状态仍由原图所在目录表示，不更改旧记录 schema；原图按原有摘要验证移动，任务与 LoRA 元数据不变。预设／LoRA 预览标识校验接受 manual:hd，图片查找枚举新状态。

## 永久反推记录

插件数据目录 `reverse_history/{UUID}.json` 保存 `id/prompt/source/created_at/suffix`；`{UUID}{suffix}` 保存输入原图独立副本，`{UUID}.thumb.jpg` 保存 480px 内缩略图。JSON 原子写入作为成功记录提交点；所有写入和删除使用同一锁，不设条数清理。列表按记录文件时间倒序分页。只删除请求 ID 对应的托管文件，其他目录／原图不受影响。新建目录按需生成，旧数据无需迁移。
