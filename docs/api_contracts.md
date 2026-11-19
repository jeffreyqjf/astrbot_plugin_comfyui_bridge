# API 契约

## 任务预设预览与配置详情（v3.7.0）

- 预设列表沿用 `GET studio/presets?account=…` 返回的 `preview` 图片 ID。长按时按需调用 `GET studio/images/file?id=…`，不在加载预设时读取全库图片；无预览、失效图片或松开后的迟到响应不影响选择。
- 新增登录保护的 `GET studio/queue/details?id=…`，支持 8–32 位十六进制任务 ID／唯一前缀。未登录 401、非法 ID 400、找不到或前缀不唯一 404。远程入口沿用已有工作台鉴权。队列轮询响应保持原结构，详情按需读取。
- 返回 `{job, preset, configuration}`：`job` 沿用队列摘要，`preset` 不返回账号；`configuration` 包含 `positive/negative`（node、field、text）、`models`（node、field、name）、按输出节点分组的 `loras`（name、model、clip），以及 `nodes`（id、title、type、parameters）。无配置快照时为 null。仅展示执行图中可达节点，节点参数不重复展示上游连线；大于 JavaScript 安全整数范围的数值转为十进制字符串。
- 快照引用 `Workflow.prepare()` 已为单次任务复制的执行图，保留最终提示词、单次分支和 LoRA 覆盖，上传成功后同步实际输入文件名；后续保存工作流不会改写既有任务。记录随现有内存任务清理，不新增数据库或历史任务恢复机制。
- 返回前递归隐藏 API key、password、secret、token、authorization、credential、cookie 和 headers 字段（包括 JSON 字符串中的嵌套字段）。界面按纯文本渲染提示词和参数，不解释 HTML。

## v3 可选任务功能与 Regional Prompt

- `task_inputs.features` 为描述列表，稳定字段 `id/kind/title`，ControlNet 另带 `branch`。已注册 `controlnet.openpose`、`controlnet.any`、`controlnet.lllite`、`regional`。前端按 `kind` 分派面板，后端对应适配器校验；新增功能类型须实现两侧适配。
- 声明放在 `astrbot.task_features` 或输出节点 `_meta.task_features`，`task_feature_version:1`；画布在 `extra.astrbot_task_features` 保留同一份信息。旧图沿用已注册模型能力。
- 任务可传 `regional:{mask,regions:[{text,strength},...],base_strength}`，恰好三区。遮罩为 RGB PNG Base64，最多 419 万像素及插件图片上限；每项文字最多 8000 字符，强度 0–10。有遮罩且强度大于 0 的区域必须填写提示词。`regional:null` 关闭分支，省略保持旧 API 行为，其他工作流收到此字段返回 400。
- RGB 图绑定 V40 #1/#2/#3，#39/#40/#41 分别取通道；#4/#5/#6 使用固定文本，#7/#18/#26 和 #27 设置强度，启用分支 #24。任务使用独立图，相同遮罩在每项任务只上传一次。
- `GET studio/regional/presets` 返回 `{version:1,presets,revision}`。`POST` 接收 `{name,preset,revision}`，`preset` 为 `{regions,base_strength}`，`null` 删除。名称 1–64 字符，最多 64 套及 2 MB，登录验证和原子写入，旧版本返回 409。文件 `regional_prompt_presets.json` 不包含遮罩或本机路径。
- v3 网页只启用勾选功能，未勾选 ControlNet 传 `null`。Regional Prompt 支持普通生成和简易 LoRA 遍历，命令遍历入口暂只提供 ControlNet。

以 [main.py](../main.py) 的 AstrBot 路由注册、[studio_settings.py](../bridge/studio/studio_settings.py) 的服务端校验和 [remote_studio.py](../bridge/studio/remote_studio.py) 的远程路由白名单为准。以下路径为相对工作台路由。内嵌入口经 AstrBot 插件 Web API 注册在 `/astrbot_plugin_comfyui_bridge/<route>` 下。独立远程工作台为允许的路由提供 `/api/<route>`，使用会话令牌。

| 方法与相对路由 | 契约 |
| --- | --- |
| `GET studio/queue` | 查询队列及近期任务 |
| `POST studio/queue`、`POST studio/queue/command` | 结构化参数或命令创建任务。工作流和入口支持时，使用 `image`（Base64）或 `reference_id`（收藏图标识）二选一，可加 `mask`（Base64） |
| `POST studio/queue/command/workflow` | 发送 `command` 和布尔值 `has_reference`，返回生成或遍历命令选中的 `workflow`。无法解析或无需生成时返回 `workflow: null`，无需上传图像即可查询 |
| `GET studio/queue/loras` | 按 `workflow` 读取该工作流目录下可选 LoRA 的 ID、编号、名称、分类 `category`（C／S／O）和默认强度 |
| `GET/POST studio/controlnet/profiles` | GET 按 `workflow`、`branch` 读取预设、ComfyUI 模型和预处理器选项及文件修订号。POST 传 `workflow`、`branch`、`revision`、`profile`，编辑或删除时加 `id`，删除用 `profile: null`。修订不匹配返回 409 |
| `GET studio/input`、`GET studio/input/preview` | 用 `directory`、`page` 浏览受限的本机 ComfyUI input，`id` 指定要预览的图片 |
| `POST studio/input/pick` | AstrBot 内嵌工作台登录后发送空对象，在 Windows 主机的 ComfyUI input 中打开文件选择窗口。选图返回 `id`（input 相对路径），取消返回 `cancelled: true`。已有文件窗口返回 409，超时返回 408，窗口或目录不可用返回 503。远程工作台使用目录和预览查询 |
| `GET/POST studio/control-assets`、`GET studio/control-assets/preview` | 按控制图状态分页，查询可传 `type` 在分页前限定控制类型。按稳定 ID 预览或设置独立评价状态，预览返回 `src` 和 `asset` |
| `POST studio/queue/cancel`、`POST studio/queue/cancel-all` | 取消指定插件任务或插件任务队列，区分已提交和本地排队 |
| `GET studio/images` | `state` 默认 `unevaluate`，图库用 `favourite` 或 `pass`。可传 `rating`、JSON `filters`、`facets=1` 或 `lora_match=all`。页码 `page` 从 1 开始，待评按任务计数，图库按图片计数 |
| `POST studio/images`、`POST studio/images/delete` | JSON 提供 `id` 和 `state`。评价的可选 `source` 默认 `unevaluate` |
| `GET studio/images/file` | 通过 `id` 和可选 `state` 读取图片，`original=1` 取原图。响应数据含 `src` |
| `GET studio/images/export` | 登录后选择 `kind=images`（生成及手动归档图）或 `kind=controls`，并传 `state=favourite`、`pass` 或对应的待评价状态（`unevaluate`／`unevaluated`）。以附件返回该状态全部原图 ZIP，空图集返回 400 |
| `POST studio/images/thumbnails` | 补齐图库缩略图 |
| `GET/POST studio/workflow` | 查询和保存工作流参数 |
| `POST studio/workflow/layout` | 传工作流名、当前 `revision` 和版本化 `parameter_layout`，成功后返回更新的版本和布局 |

后端到 ComfyUI 的调用以 [client.py](../bridge/client.py) 为准。

待评省略 `page` 时仍返回 `jobs` 和 `limit`。传入页码后附加 `page`、`page_size`、筛选后的 `total` 和 `has_more`。图库一直返回分页信息。LoRA 默认任一命中，`lora_match=all` 要求同一张图片含所有已选 LoRA，其他筛选维度继续取交集。

工作台初始化返回各工作流的 `controlnets` 分支、类型和处理模式。提交任务时同名字段按分支填 `null` 以关闭，或指定 `type`、`mode`（`direct` 或 `preprocess`）以及 `id`、`asset_id`、Base64 `image`、`gallery: {id, state}` 中的一项。生成图的 `state` 可为 `favourite`、`pass` 或 `unevaluate`，提交时按指定图集读取原图。重绘参考图和遮罩独立传递。预处理输出按专用预览节点取回。它有独立归档和评价状态。

命令提交的 `controlnets` 可用于普通生成，以及 `sweep lora`、`sweep presets` 的整批任务。实际目标工作流在提交时重新解析，并校验该工作流支持请求中的分支。

配置了预设的分支在初始化数据附带 `profiles`，任务绑定可加 `profile` ID。省略 ID 时，后端使用匹配控制类型的第一条预设。文件保存在插件数据目录的 `controlnet_profiles.json`，由后端在受理时解析，模型参数由已保存的预设提供。

初始化还返回 `sweep_lora_family`（无目录时为 `null`）。结构化创建任务可传 `loras: [{id, strength}]`，按提供顺序叠加，省略强度时使用目录默认值。设置 `lora_sweep: true` 时，按完整目录的实际分类将所选 S／O 类作为固定叠加组，并为每个所选 C 类人物生成一个任务；未选择 C 类时遍历目录中全部人物。每个变体按固定组原顺序加载，再加载一个人物；保留各项强度和附带词。无人物时返回 400，不生成纯风格遍历任务。每批共享一个种子，人物数量 × 批次决定队列容量检查，任一校验失败时整批不入队。普通叠加及 QQ 命令自身的遍历协议不变。

命令添加的 `account` 独立于工作流参数能力显示，列表加载状态与输入是否适用分开管理；命令识别不能清空或禁用已选账号。账号由已有命令接口按原规则解析和校验。

- `GET /object_info/<class>` 获取节点字段和可选项。
- `POST /upload/image` 用 multipart 上传，使用 `type=input`、`subfolder=astrbot_bridge` 及 `overwrite=false`。回填服务返回的名字及子路径。
- `POST /prompt` 提交 `prompt` 和 `client_id`，可附 AstrBot 追溯信息，读取 `prompt_id`。提交本身不重试，以免重复生成。
- `GET /history/<prompt_id>` 轮询任务结果，`GET /view` 取媒体。使用各任务取消接口，队列删除按 prompt ID 定位。

改接口前由 Backend 和 Frontend 对齐字段、内容类型、错误、权限和旧调用方。工作流参数由 Workflow 提供映射，图片标识和状态由 Data 核对。接口变动应补记路径、请求和响应、失败行为及验证记录。

## H3 素材编辑

- `GET studio/h3/media` 返回当前完整版图 #416 的 `available` 与 `items`。
- `POST studio/h3/media/upload` 使用 multipart 的 `file` 字段，转发到原节点上传接口，返回原生媒体描述。图片采用图片上传上限，音视频采用视频上限。
- `POST studio/h3/media/rpc` 接收 `{path, method, body}`，仅支持媒体处理和预设白名单。节点服务令牌由后端取得并附带。Auto Mask 仅允许固定的 CheckpointLoaderSimple + MiniMaxH3FantasticObjectMask 两节点图，历史查询限于此入口受理的 mask 任务。
- `POST studio/h3/media/preview` 接收 `{file}`，校验 ComfyUI 素材路径及扩展名，缓存媒体并返回 `src`。桌面使用 AstrBot 文件令牌，远程工作台使用绑定登录会话的临时链接。预览缓存随插件终止清理。
- 简易任务与命令任务可附加 `h3_media: [...]`，完整保留原节点的文件描述、顺序、开关、裁剪、片段和遮罩字段。仅作用于本次工作流副本，空数组清空本次素材，省略时使用已保存默认值。
- `GET studio/h3/media` 额外返回当前正向提示词 `prompt` 和编辑器模式 `prompt_mode`。命令工作流识别额外返回解析出的 `positive`，用于首次导入命令里的提示词。
- 命令任务可附加 `h3_prompt`，仅用于 H3 工作流。该文本作为本次正向提示词，沿用 8000 字符上限，命令中的种子与选项仍由命令解析器处理。简易任务继续使用 `positive`。
- `GET studio/h3/prompt-templates` 登录后返回 `{revision, templates: {名称: {prompt, mode}}}`。模板存于插件数据目录 `h3_prompt_templates.json`，桌面与远程工作台共用。
- `POST studio/h3/prompt-templates` 接收 `{name, template: {prompt, mode}, revision}` 保存或更新同名模板；`template: null` 删除。名称为 1–64 字符，提示词非空且最多 8000 字符，保留原始换行及空白；模式为 `auto/t2va/i2va/fl2va/l2va/ref2va`。原子写入并校验文件版本，过期 `revision` 返回 409，刷新后再保存。总文件上限 4 MB。
- 同一 POST 还支持 `{version: 1, templates: {名称: {prompt, mode}}, replace: bool, revision}` 批量导入。`replace=false` 跳过同名项，`true` 更新同名项，未列出的模板保留；整批先校验再原子保存，响应额外包含 `imported/skipped`。导出格式为 `{version: 1, templates}`，文本与模式完整保留。

## 按工作流构建任务

`GET studio` 的每条工作流及 `POST studio/queue/command/workflow` 的解析结果附带 `task_inputs`：`simple/positive/negative/presets/reference/mask/h3_prompt/h3_media`。能力来自实际正负提示词映射、参考图字段、遮罩输出连线及专用工作流适配。命令解析返回的能力优先，以当前已保存分支的图为依据。

客户端隐藏不适用的控件，并从提交中省略对应字段，切换工作流后保留的草稿不会泄漏进其他类型任务。服务端拒绝没有映射的显式负向词、单图参考、遮罩和完整版 H3 普通预设；无负向映射的普通工作流使用预设时只采用正向部分。简易添加可为 Anima AIO 和单参考图视频工作流读取图集或本地图片，实际图中上传字段、AIO 图生图转换和 Anima 分支均使用该参考图。详见 [任务输入核对](task_inputs.md)。

## 控制图文件与参考图选择（v2.40.0）

`POST studio/control-assets` 保留 `{id,state}` 评价，新增 `{id,name}` 重命名实际原图文件、`{id,delete:true}` 删除原文件。操作需登录；名称限 128 字符并校验路径、扩展名、保留名及同名冲突。ID 不变，重命名和评价状态迁移保持关联；删除保留带 `deleted:true` 的记录，原生成结果保留，旧引用会提示控制图不可用。

新建任务的参考图复用图集筛选、分页和预览，可选择收藏、Pass、待评价以及控制图集。受理前读取原图填入当前参考图字段，沿用图片及遮罩校验。

`GET studio/queue/loras` 改用文件头目录列表，保留分类编号、排序和默认强度，不在列出选项时计算完整权重哈希。正式提交、附带词和管理功能仍用完整校验目录。

## V40 放大任务选项（v3.1.0）

功能描述新增 `upscale.pre/upscale.post`，`kind:branch`，`branch:pre/post`。普通命令与简易任务传 `upscale:{pre:bool,post:bool}`，仅 Advanced Gemma V40 接受，分别映射 43 和 upscale_post。省略沿用工作流；网页明确传两个状态，简易 LoRA 遍历共用本次构图。

## V40 Hires 与二次采样（v3.2.0）

新增 `sampling.hires_pre/sampling.hires_post/sampling.second_sampler`，kind 为 branch。任务传 `sampling:{hires_pre:bool,hires_post:bool,second_sampler:bool}`，V40 对应 18、40、second_sampler；从 v3.3.0 起 Anima T2I 也接受，分别对应 13、14、15。省略保留默认，网页显式提交勾选状态，三个值均须为布尔类型。

## Anima T2I 可选功能（v3.3.0）

- `task_inputs.features` 补充 `regional`、`sampling.hires_pre/hires_post/second_sampler` 与 `anima.ultimate`。已保存的旧功能声明仅有 LLLite 时，注册表补齐这些已适配能力，不覆盖现有参数布局。
- `POST studio/queue` 和普通 `POST studio/queue/command` 支持既有 `regional`、`sampling` 结构及新的 `anima_upscale:bool`。Anima 不接受 V40 的 `upscale:{pre,post}`，其他工作流不接受 `anima_upscale`。字段省略沿用默认；网页显式提交全部状态；命令 sweep 仍只提供 ControlNet，简易遍历支持全部新增功能。
- `regional:null` 关闭 119；有效 RGB 载荷启用 119，并绑定 `0/1/2.image`、`3/4/5` 文本、`6/7/8` 强度和 `9` 全局强度。图片在构图校验时声明待上传，在任务执行时共用一次上传结果；不进入普通参考图映射。`anima_upscale` 映射分支 19，sampling 映射 13/14/15。
- 仅重新构建本次任务的图，沿用保存的字段覆盖和布局；LoRA 叠加／遍历保留 `input_images`。开关必须能映射到输出可达节点，否则明确报错。

## Detailer V40 可选任务分支（v3.4.0）

- `task_inputs.features` 注册 `detailer.hires/inpaint/outpaint/mask/upscale`，`kind:branch`，对应英文 HiresFix、Inpaint、Outpaint、Mask Detailer、Ultimate SD Upscale。旧功能声明可补齐，不覆盖参数布局。
- 简易 `POST studio/queue` 和普通 `POST studio/queue/command` 接受 `detailer:{hires:bool,inpaint:bool,outpaint:bool,mask:bool,upscale:bool}`，必须包含五项且不带额外字段；分别映射 V40 分支 `15/27/28/mask/30`。仅 Detailer V40 接受，省略沿用已有默认。网页显式提交五项，普通命令添加有可选功能时通过 JSON 提交，避免文件上传捷径丢失开关。
- Detailer 输入能力按包含可选分支的图计算提示词／负向词／遮罩支持；不受保存分支关闭状态影响。图片和遮罩复用 `image/reference_id/mask`、`apply_mask` 和 `2.image`，Outpaint 遮罩来自 #50。任务仅重构执行图，不写入保存设置；模型等节点参数仍由工作流参数管理。
- 提交新 Detailer 功能时，仅在 Inpaint／Outpaint 对应加载器实际可达时读取 ControlNetLoader schema，验证 #35／#36 的模型下拉项。缺失返回 400，任务不入队；不自动更换或下载模型。其他已保存的修复分支保持原逻辑。

## Anima Detailer（v3.5.0）

- 新增独立 `Anima_Detailer_AstrBot`，简称 `anima-detailer`，别名 `animadetailer/adetailer`。复用图片任务、参考图遮罩、归档、评价和参数布局，内部使用现有 V40 分支协议，避免新增并行的持久格式。
- `task_inputs.features` 为 `anima_detailer.hires_pre/hires_post/inoutpaint/mask/upscale`。任务和普通命令接受 `anima_detailer:{hires_pre:bool,hires_post:bool,inoutpaint:bool,mask:bool,upscale:bool}`，严格五项且仅该工作流接受，映射 `13/14/126/mask/19`。省略沿用保存值，网页显式提交选择；不接受 Detailer V40 的 `detailer` 参数。
- 输入 `image/reference_id/mask` 复用既有结构。始终需要参考图，支持普通提示词预设、负向词、批次、Anima LoRA 叠加及遍历。命令支持手脸眼和 NSFW 单次开关；原版没有 feet，传入会拒绝。#103 仅在实际可达时按 ModelPatchLoader schema 校验模型；缺失返回 400 且不入队。
- 参数页暴露所有分支的字面输入和本机下拉项，关闭的分支仍可编辑；手动参数布局保留。原 Image Saver 文件名／元数据专用节点不进入插件执行参数。API 图和配套模板加入打包白名单，生产实例同步与重载另行授权。

## 预设效果图来源（v3.8.0）

预设 `preview` 字符串格式保持兼容，允许 `manual:favourite/ pass/ unevaluate` 对应状态（实际标识使用冒号分隔），仍校验 ID 长度与格式。生成记录 ID 不变。列表、效果图、大图与长按预览读取时省略 state，由归档层按记录或手动文件标识定位；不向远程请求发送字符串 undefined。选图窗口复用现有图集分页、筛选和预览，不开放控制图或任意文件路径。

## LoRA 效果图（v3.9.0）

`GET studio/lora-order` 与 `GET studio/queue/loras` 的每个 entry 增加 `preview` 图片 ID 字符串，无图为空。`POST studio/lora-order` 可与 tag/category/default_strength 一起或单独提交 `preview`，空字符串／null 清除，沿用 family、id、revision 校验。允许生成记录及 favourite/pass/unevaluate 手动图集标识，不接受外部 URL 或任意路径。列表只返回标识，图片复用登录保护的 `studio/images/file` 接口按需读取。旧设置默认无预览，写入其他设置时必须保留 `previews`；其变动参与修订计算。图片与模型文件均不被修改。
