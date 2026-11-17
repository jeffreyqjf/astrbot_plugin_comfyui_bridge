# API 契约

以 [main.py](../main.py) 的 AstrBot 路由注册、[studio_settings.py](../bridge/studio/studio_settings.py) 的服务端校验和 [remote_studio.py](../bridge/studio/remote_studio.py) 的远程路由白名单为准。以下路径为相对工作台路由。内嵌入口经 AstrBot 插件 Web API 注册在 `/astrbot_plugin_comfyui_bridge/<route>` 下。独立远程工作台为允许的路由提供 `/api/<route>`，使用会话令牌。

| 方法与相对路由 | 契约 |
| --- | --- |
| `GET studio/queue` | 查询队列及近期任务 |
| `POST studio/queue`、`POST studio/queue/command` | 结构化参数或命令创建任务。工作流和入口支持时，使用 `image`（Base64）或 `reference_id`（收藏图标识）二选一，可加 `mask`（Base64） |
| `GET studio/input`、`GET studio/input/preview` | 用 `directory`、`page` 浏览受限的本机 ComfyUI input，`id` 指定要预览的图片 |
| `POST studio/input/pick` | 登录后发送空对象，在 Windows 主机的 ComfyUI input 中打开文件选择窗口。选图返回 `id`（input 相对路径），取消返回 `cancelled: true`。已有文件窗口返回 409，超时返回 408，窗口或目录不可用返回 503 |
| `GET/POST studio/control-assets`、`GET studio/control-assets/preview` | 按控制图状态分页，按稳定 ID 预览或设置独立评价状态，预览返回 `src` 和 `asset` |
| `POST studio/queue/cancel`、`POST studio/queue/cancel-all` | 取消指定插件任务或插件任务队列，区分已提交和本地排队 |
| `GET studio/images` | `state` 默认 `unevaluate`，图库用 `favourite` 或 `pass`。可传 `rating`、JSON `filters`、`facets=1` 或 `lora_match=all`。页码 `page` 从 1 开始，待评按任务计数，图库按图片计数 |
| `POST studio/images`、`POST studio/images/delete` | JSON 提供 `id` 和 `state`。评价的可选 `source` 默认 `unevaluate` |
| `GET studio/images/file` | 通过 `id` 和可选 `state` 读取图片，`original=1` 取原图。响应数据含 `src` |
| `POST studio/images/thumbnails` | 补齐图库缩略图 |
| `GET/POST studio/workflow` | 查询和保存工作流参数 |
| `POST studio/workflow/layout` | 传工作流名、当前 `revision` 和版本化 `parameter_layout`，成功后返回更新的版本和布局 |

后端到 ComfyUI 的调用以 [client.py](../bridge/client.py) 为准。

待评省略 `page` 时仍返回 `jobs` 和 `limit`。传入页码后附加 `page`、`page_size`、筛选后的 `total` 和 `has_more`。图库一直返回分页信息。LoRA 默认任一命中，`lora_match=all` 要求同一张图片含所有已选 LoRA，其他筛选维度继续取交集。

工作台初始化返回各工作流的 `controlnets` 分支、类型和处理模式。提交任务时同名字段按分支填 `null` 以关闭，或指定 `type`、`mode`（`direct` 或 `preprocess`）以及 `id`、`asset_id`、Base64 `image` 中的一项。重绘参考图和遮罩独立传递。预处理输出按专用预览节点取回。它有独立归档和评价状态。

- `GET /object_info/<class>` 获取节点字段和可选项。
- `POST /upload/image` 用 multipart 上传，使用 `type=input`、`subfolder=astrbot_bridge` 及 `overwrite=false`。回填服务返回的名字及子路径。
- `POST /prompt` 提交 `prompt` 和 `client_id`，可附 AstrBot 追溯信息，读取 `prompt_id`。提交本身不重试，以免重复生成。
- `GET /history/<prompt_id>` 轮询任务结果，`GET /view` 取媒体。使用各任务取消接口，队列删除按 prompt ID 定位。

改接口前由 Backend 和 Frontend 对齐字段、内容类型、错误、权限和旧调用方。工作流参数由 Workflow 提供映射，图片标识和状态由 Data 核对。接口变动应补记路径、请求和响应、失败行为及验证记录。
