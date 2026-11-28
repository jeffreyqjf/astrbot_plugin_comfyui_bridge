# 持久数据结构

v3.24.0：task_memory/{sha256(username)}.json 保存 global 的 workflow/mode 和各 workflow:名称 的扁平任务草稿；config 名称、field:控件、lora:模型ID 对应强度、feature:功能ID 对应布尔、control:分支:参数对应字符串、open:区域对应折叠状态。文件名与登录账号绑定，不接受用户路径；state_lock 内按 scope 合并及原子写入，最多 200 个 scope／5 MiB。无原图、文件内容或临时遮罩。旧本地配置名称仅作缺省读取，成功应用后写入账号记忆，不自动迁移其他浏览器草稿。

v3.23.0：generation.refinement 兼容增加 source_info，保存来源图片的安全展示元数据快照（id、rating、generation 的工作流／配置预设／提示词预设／LoRA／种子等）。明确选择时即捕获，图集自动匹配时捕获，在结果 remember 时深拷贝保存；没有来源信息不推断。旧数据读取时回退对应生成记录，不自动迁移。正向 source 关系仍是唯一事实来源，溯源按需扫描记录推导双向连接，支持多结果共享来源和任意深度连续修复，无反向列表写入一致性问题。detached 按结果索引标记失效边，历史边保留但不恢复移动联动。手动文件按来源摘要与相对位置形成内部稳定键以兼容移动后的 manual ID。

v3.20.0：运行图 astrbot.workflow_config 保存最后应用的配置名称。任务受理时快照到 Job.configuration.workflow_config，生成 metadata 和归档 generation 同步保存；图片列表的 generation.workflow_config 是可选字符串，缺省为无记录。名称作为当时使用的配置来源保留，单次参数覆盖不改变该来源，不根据现有配置反推旧图片，无数据迁移。

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

## Detailer 原图关联（v3.12.0）

新 Detailer 记录增加可选 `generation.refinement:{input_id,suffix,source}`。input_id 使用结果任务 UUID；输入字节独立保存在 `image_reviews/detailer_inputs/{UUID}{suffix}`，缩略图为 `{UUID}.thumb.webp`。source 为 null 或 `{id,state,digest,relative}`，记录核验过的源图 ID、当时状态、SHA-256 及相对于状态根目录的路径；网页只返回 input_id/linked。

移入 hd 时保持源图原相对路径，因此生成记录 ID／LoRA／预设继续有效。联动移动在图集锁内先校验、复制两张图，再移除旧路径，失败回滚。HD 隐藏来源卡片依赖仍有高清结果及相同摘要的来源文件；快照用于预览和导出，不依赖来源仍存在。旧记录缺省无关联，不迁移或猜测历史来源。图集 ZIP 同时包含对应输入副本。

v3.19.0 兼容增加 refinement.detached 整数数组，记录已解除的图片索引（从 1 开始），缺省为空。不删除共享快照／来源元数据，其他结果仍可对照；列表、联动移动、来源隐藏与 ZIP 按有效索引判断。解除前验证当前结果及输入快照，必要时完整保留原图，之后原子写入索引；写失败清理本次新建原图。没有来源的上传输入在移入高清时保存至 hd/{rating}/detailer_inputs/{job_id}{suffix}，主列表隐藏，选图窗口可独立读取；旧的仅有快照记录在主动解除时保留该副本，无自动数据迁移。所有结果解除／移走／删除后来源恢复独立卡片，删除单图不级联。

## 模型下载状态（v3.15.0）

模型存在检查只读目录与 extra_model_paths.yaml，无索引落盘。下载历史为 ModelDownloads.jobs 的当前进程内记录（最多约 20 项），各用户仅能列出和取消自己的任务。临时模型位于目标目录 `.{文件名}.{UUID}.part`，完整后排他发布为目标名称；取消、失败、插件退出时清理。既有模型不覆盖，下载完成不自动修改工作流。断电等进程外强制终止可能留下 part 文件，不会被作为正式模型识别；本轮未迁移现有数据。

## 模型自定义链接（v3.16.0）

plugin_data/model_links.json 为 `{工作流名:{SHA256([name,folder]):{name,folder,links:[URL…]}}}`，UTF-8 JSON 原子写入，读写限制 8 MiB、revision 为文件字节摘要。无配置时沿用随包来源链接；显式空数组移除入口；配置与权重／工作流图独立，不变更随包来源清单或已核对下载 URL。按工作流导出使用带 format/version 的模型行列表，导入同模型合并。未命中的旧模型条目保存在配置文件中但不影响新图。

v3.17.0：model_links.json 中的模型项可附加 note（简介，最多 4000 字）。缺失为沿用既有说明，空字符串为显式清空；保存／导入缺失字段时保留当前自定义值。导出附带有效简介，仍兼容 version:1 链接配置，无需旧数据迁移。

## 图集页码记忆（v3.18.0）

gallery_pages/{SHA256(username)}.json 保存上下文键到页码的字典。上下文包含视图用途、图集状态、评级／筛选或 input 目录；同名图片图集的选图与管理视图分别记忆。每个账号最多最近 1000 条及 5 MiB，超限移除最旧上下文。新增文件按需创建，无既有数据迁移或图片修改。浏览器同时保存对应 localStorage 项；内嵌页禁用本地存储时以插件记录为准。

同一文件中的 `comfy-gallery-selection:` 键保存各入口的图集选项字符串。图集选择随账号恢复，和页码一起原子保存。既有仅含页码的文件可直接读取。
