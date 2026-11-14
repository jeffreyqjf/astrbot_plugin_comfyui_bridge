# QQ 指令集

发送 `/comfy help` 或 `/comfy --help` 查看总览。`/绘图` 可替代 `/comfy`。工作台的「任务队列 → 创建任务 → 命令添加」也可提交生成类指令和查看 `--help`。使用 `--preset` 时，在表单选择预设所属用户。

| 入口 | 用途 |
| --- | --- |
| `gen` | 生成图片或视频 |
| `prompt` | 图片反推和个人提示词预设 |
| `wf` | 查看、切换、检查和重载工作流 |
| `lora` | 查看模型目录内的 LoRA 分类编号，管理图片 LoRA 预约 |
| `sweep` | 固定 LoRA 扫预设，或固定提示词扫人物 LoRA |
| `set` | Anima T2I 会话参数 |
| `job` | 任务队列、取消、结果及补发 |
| `archive` | 图片归档和收藏 |
| `help` | 指令总览和分组帮助 |

## 查看详细帮助

| 用法 | 显示内容 |
| --- | --- |
| `/comfy gen --help` | 生成入口和通用参数 |
| `/comfy gen --wf wai --help` | WAI 的输入、修复、ControlNet 和独立 LoRA |
| `/comfy wf lightning --help` | Lightning 的参考图、段号、逐段 LoRA 和示例 |
| `/comfy wf 2 --help` | 工作流列表中第 2 项的用法 |
| `/comfy prompt preset add --help` | 添加个人预设的参数和示例 |
| `/comfy lora wai use --help` | 预约下次 WAI LoRA 的方法 |
| `/comfy job cancel --help` | 可取消的任务及权限 |
| `/comfy archive fav --help` | 收藏的位置、选图和权限 |

`/comfy help lora`、`/comfy help wf wai` 也可查看对应帮助。查看帮助时无需附图，也不会执行指令。

## 生成 · gen

`/comfy gen 一只窗边的猫` 使用当前工作流。以 Anima 为默认时，无图走 T2I，附图或引用图走 I2I AIO。

| 用法 | 目标 |
| --- | --- |
| `/comfy gen --wf t2i 一只猫` | 强制使用 Anima 文生图 |
| `/comfy gen --wf i2i 改成水彩 --denoise 0.55` | Anima 重绘，需要参考图 |
| `/comfy gen --wf v40 --feet on 1girl, full body --raw` | Advanced Gemma V40 文生图，临时开启修脚 |
| `/comfy gen --wf detailer --feet on detailed feet --raw` | Detailer V40 局部重绘并临时开启修脚，需要参考图 |
| `/comfy gen --wf wai 一只猫 --face on` | WAI-Illustrious 文生图 |
| `/comfy gen --wf sdxl 一只猫` | SDXL Turbo 文生图 |
| `/comfy gen --wf t2v 小熊猫慢慢走过树枝` | 文生视频 |
| `/comfy gen --wf i2v 镜头缓慢推进` | 图生视频，需要参考图 |
| `/comfy gen --wf wan-t2v 小熊猫慢慢走过树枝` | 直接使用内置普通 WAN 文生视频 |
| `/comfy gen --wf wan-i2v 镜头缓慢推进` | 直接使用内置普通 WAN 图生视频，需参考图 |
| `/comfy gen --wf svi 镜头推进 --stages 3,1,7` | SVI 图生视频，按指定顺序续写 |
| `/comfy gen --wf lightning 主体慢慢转头 --segments 2` | Lightning 图生视频，生成前两段 |

`--wf t2v` 和 `--wf i2v` 优先使用当前类型匹配的工作流，否则使用插件里相应的视频默认值。要指定随包的普通 WAN 工作流，用 `wan-t2v` 或 `wan-i2v`。也可用 `/comfy wf` 中的编号或完整名称。

QQ 优先取当前消息的附图，没有附图才取被回复消息的图片。默认取第一张，`--image 2` 取第二张。遮罩重绘使用透明 PNG，透明区域会被重绘。

| 参数 | 作用 |
| --- | --- |
| `--image 2` | 选择参考图序号 |
| `--seed 42` | 固定种子，`-1` 强制随机 |
| `--negative "text, watermark"` | 覆盖本次负向词，空引号清空 |
| `--raw` | 保留描述原文，适合标签、权重写法和已写好的英文 Prompt |
| `--preset 2` | 使用个人预设，可追加描述或用英文引号指定名称 |
| `--denoise 0.55` | Anima T2I / I2I 的单次降噪，范围 0–1 |
| `--hands on --face on --eyes off --feet on` | Anima T2I 和两条 V40 工作流的单次修复开关。WAI 支持 `--face` 与 `--eyes` |
| `--nsfw-repair on` | Anima T2I 和两条 V40 的 NSFW 局部修复开关。QQ 中仅管理员私聊可用，已登录工作台可用 |
| `--controlnet-type depth` | WAI 的 Union ControlNet 类型，需在工作台开启相应重采样分支 |
| `--segments 2` 或 `--stages 3,1` | 分段视频选前 N 段或按指定段号顺序生成，两项二选一 |
| `--frames 81 --fps 16` | 分段视频的每段帧数（4n+1）与基础帧率 |
| `--samplers 2` | SVI 采样阶段数，支持 2 或 3。Lightning 固定两阶段 |
| `--lora` | 按当前任务的目标工作流配置 LoRA，见下节 |

参数支持 `--seed 42` 和 `--seed=42`。含空格的值使用英文引号。省略单次参数时沿用相应会话或工作台值。归档标签可写在图片描述里，例如 `/comfy gen 雨夜街道 [风景]`。

## LoRA · lora

`/comfy lora` 根据当前选择打开目录。默认、Anima 及其他普通工作流查看 Anima 目录，WAI 查看 WAI 目录，SVI 和 Lightning 查看视频目录。用显式目录名可独立查询或预约。

| 目录 | 权重来源 | 指令适用范围 |
| --- | --- | --- |
| `anima` | `models/loras/anima/` | Anima T2I 支持编号或 ID。Anima I2I AIO 的 LoRA 槽位在工作台保存 |
| `wai` | `models/loras/illustrious/` | WAI 支持独立编号或 ID |
| `video` | ComfyUI 注册的视频 LoRA 文件，例如 `WAN-N/`、`wan/` | SVI 和 Lightning 按段指定，使用列表显示的短文件名或完整相对路径 |

Anima 和 WAI 各自在模型目录内为人物（C）、风格（S）、其他（O）编号。工作台「LoRA 编号」可调整分类及组内顺序。

- `/comfy lora wai list 水彩` 按关键词查 WAI 编号。也可写 `/comfy lora wai 水彩`。筛选保留原编号。
- `/comfy lora anima use C1:0.85 S1:0.6` 预约下次 Anima T2I 叠加两项。省略强度时使用工作台「LoRA 编号」里设置的默认权重。WAI 同样可用 `use`。
- `/comfy lora wai off` 预约关闭，`/comfy lora wai clear` 取消预约。
- `/comfy gen --wf wai 一只猫 --lora "C1: 0.85,S1:,O1:"` 单次指定，逗号分隔。冒号后留空或省略冒号时使用默认权重，初始值为 1。图片的 `--lora off` 本次关闭。单次指定时保留原预约，预约只在适用且成功受理的任务中消耗。
- `/comfy lora video list 镜头` 查视频 LoRA。唯一的文件名可省略 `.safetensors`，同名文件请用列表显示的相对路径。

先附图或回复图片，再发送下面的视频指令。

```text
/comfy gen --wf svi 镜头缓慢推进 --stages 3,1 --lora "3=high:动作模型:0.8,low:镜头模型:0.6" --lora "1=off"
```

- `high`、`low`、`both` 分别指定高噪声、低噪声或两者。SVI 还可用 `svi-high`（仅三阶段）或 `lightning-high`。
- 同段用逗号叠加，不同段重复 `--lora`。段号对应画布原编号，只能指定本次选中的段。
- `--lora "1=off"` 清空本次第 1 段的附加项，`--lora off` 清空本次所有段的附加项。全局 SVI / Lightning LoRA 仍按工作台生效。
- 视频逐段设置保存在工作台，每次指令只覆盖写出的段。SVI 最多 12 段，Lightning 最多 4 段。

## 提示词 · prompt

| 用法 | 作用 |
| --- | --- |
| `/comfy prompt` 或 `/comfy prompt 2` | 用 PixAI 反推，附图或回复图片。可在工作台启用 TIPO 扩写 |
| `/comfy prompt wd14 2` | 用 WD14 反推第二张图 |
| `/comfy prompt preset` | 私聊查看个人预设编号和账号标识 |
| `/comfy prompt preset show 2` | 查看正向和负向词，可用编号或名称 |
| `/comfy prompt preset add "水彩 人像" "watercolor, portrait" "text"` | 添加，最后一项负向词可省略 |
| `/comfy prompt preset update 2 "watercolor, landscape" "text"` | 更新指定项 |
| `/comfy prompt preset delete 2` | 删除指定项 |

预设按平台实例和用户隔离。私聊管理，生成时群聊也可用 `/comfy gen --preset 2 雨夜街头`。

工作台的提示词预设可从收藏选择效果图。预览随预设导出为收藏图引用，导入到另一实例时需要对应的收藏图。

## 工作流 · wf

- `/comfy wf` 列出简称、编号和当前选择。
- `/comfy wf use wai` 在当前会话选 WAI。单次指定用 `gen --wf`。
- `/comfy wf check lightning` 检查 ComfyUI 连接、队列和该工作流的节点。省略名称检查当前工作流。
- `/comfy wf reload` 管理员重新读取 API 文件。升级插件代码从 AstrBot 插件管理重载。

## 会话参数 · set

只作用于当前用户在当前会话的 Anima T2I。

- `/comfy set` 查看当前生效值及 LoRA。
- `/comfy set show all` 列出全部分支。也可用 `show 局部修复`。
- `/comfy set 修脚=on 修脸=off 降噪=0.55` 保存会话覆盖。
- `/comfy set 修脚=default` 让指定项目沿用工作台。
- `/comfy set reset` 清除会话覆盖和 Anima 待用 LoRA。
- `/comfy set 7=on` 和 `[NSFW]` 图片归档标签仅管理员私聊可用。

## 任务 · job

- `/comfy job` 查看当前会话自己的等待和运行任务。
- `/comfy job all` 管理员查看插件队列。
- `/comfy job cancel 短ID` 取消自己的任务，管理员也可取消他人任务。
- `/comfy job result [短ID]` 查询任务，失败回传可重试。省略 ID 查最近一项。生成成功后插件自动回传。

## 批量扫图 · sweep

```text
/comfy sweep presets --wf wai --lora "C1: 0.85,S1:0.6" --seed 42
/comfy sweep lora --wf t2i --preset "水彩 人像" 雨夜街头 --seed 42
/comfy sweep lora --wf wai 雨夜街头
/comfy sweep lora --wf v40 --preset 2 雨夜街头 --seed 42
```

- `sweep presets` 给每个个人预设提交一个任务。每个任务都用指定的同一组 LoRA。
- `sweep lora` 为所选模型目录中的每个人物 LoRA（C）按各自的默认权重提交一次。可直接写描述，也可用编号或名称选预设后追加描述。追加词只参与本次生成，可加 `--raw` 保留原文。
- 预设扫图和人物 LoRA 扫图可使用具备可接入采样模型、已选 LoRA 目录的自定义文生图工作流。用 `/comfy lora --wf 简称 list` 查询目录、`/comfy lora --wf 简称 use C1` 预约。默认 `t2i` 使用 `anima`，`wai` 和 `v40` 使用 `illustrious`。
- Advanced Gemma V40 开启参考图分支时，扫图整批使用同一张参考图。QQ 可附图或回复图片，并用 `--image 2` 选择第二张。工作台的「命令添加」可上传一张参考图。
- 省略 `--wf` 时用当前工作流，省略 `--seed` 或填写 `-1` 时整批随机选一个种子。整批需要足够的队列位置，可用 `/comfy job` 查看。

## 图片与视频收藏 · archive

回复要收藏的图片或视频后，发送 `/comfy archive fav`。用 `--image 2` 或 `--video 2` 选第二个结果。也可直接用 `/comfy archive fav --job 短ID` 收藏任务的结果。

- 生成图收藏后移入 `output/favourite/SFW/` 或 `output/favourite/NSFW/`。同一用户在本会话中排在该图前面的待评价图片移入 `pass`，回传缓存仍可用于补发。普通 QQ 引用图保存在 `favourite/SFW`。
- 可移动自己在本会话生成的原图，管理员也可移动其他人的原图。新版 NSFW 图片收藏仅在管理员私聊中可用。
- 视频和升级前已有原图索引的记录使用旧版收藏路径 `output/Favorites/`，可在插件设置中配置。连接远程 ComfyUI 时，归档目录位于插件数据目录的 `outputs/`。
- 文件同名时保留已有文件。重复收藏同一张引用图或同一个已移动的原图时会提示已收藏。

## 旧指令兼容

原有的 `t2i`、`i2i`、`t2v`、`i2v`、`illustrious`、`svi`、`lightning`、`reverse`、`caption`、`presets`、`state`、`queue`、`result`、`check`、`reload` 及原有中文别名仍可用。原 `--stage-lora` 等同于分段视频的 `--lora "段号=…"`，`lora illustrious` 对应 `lora wai`，`lora svi` 和 `lora lightning` 对应 `lora video`。

[快速上手](../README.md) · [模型与参数说明](CONFIGURATION.md)
