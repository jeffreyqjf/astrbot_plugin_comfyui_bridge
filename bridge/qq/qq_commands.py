"""QQ command groups and compatibility aliases."""

import re

from ..workflows.workflow import WorkflowError
from ..workflows.workflow_store import WORKFLOW_ALIASES, WORKFLOW_SHORT_NAMES

HELP = """ComfyUI 指令
/comfy gen 描述         生成图片或视频
/comfy prompt           附图反推提示词，或管理个人预设
/comfy wf               查看、切换和检查工作流
/comfy lora             查看 LoRA 分类编号或预约
/comfy sweep            固定 LoRA 扫预设，或固定提示词扫人物 LoRA
/comfy set              查看和修改 Anima T2I 会话参数
/comfy job              查看队列、查询结果和取消任务
/comfy archive          图片与视频收藏
/comfy help             查看指令总览

在任意子指令后加 --help 查看详细用法。
/comfy lora wai --help
/comfy gen --wf wai --help"""

TOPICS = {
    "gen": """生成 · /comfy gen [--wf 工作流] 描述
工作流简称：t2i Anima 文生图，i2i Anima 重绘，wai WAI，sdxl SDXL。
视频简称：t2v 文生视频，i2v 图生视频，svi 分段视频，lightning 长视频。
t2v/i2v 优先使用当前同类工作流，再用插件默认值；wan-t2v/wan-i2v 直达内置工作流。
不写 --wf 时使用当前选择。默认 Anima 有图重绘，无图文生图。
通用：--image 2、--seed 42、--negative "text, watermark"、--raw、--preset 1。
Anima T2I：--hands、--face、--eyes、--feet（on/off）和 --denoise。
Anima I2I：--denoise。WAI：--face、--eyes、--controlnet-type。
分段视频：--segments 2 或 --stages 3,1、--frames 81、--fps 16。SVI 还支持 --samplers 2。
每个工作流的输入和示例见 /comfy gen --wf 简称 --help。
LoRA 用法见 /comfy lora --help。""",
    "prompt": """提示词
/comfy prompt [图片序号]  用 PixAI 反推，附图或回复图片
/comfy prompt wd14 [图片序号]  用 WD14 反推
/comfy prompt preset  私聊列出个人预设
/comfy prompt preset show 2
/comfy prompt preset add "名称" "正向词" "可选负向词"
/comfy prompt preset update 2 "正向词" "可选负向词"
/comfy prompt preset delete 2
生成时加 --preset 2 或 --preset "名称"，可追加画面描述。""",
    "wf": """工作流
/comfy wf  查看工作流与当前选择
/comfy wf use wai  为当前会话选择，可用简称、编号或完整名称
/comfy wf check [工作流]  检查连接与所需节点
/comfy wf reload  管理员重新读取工作流文件
查看某条工作流的用法，例如 /comfy wf wai --help。
只想切换一次，用 /comfy gen --wf 工作流 描述。""",
    "lora": """LoRA · /comfy lora [--wf 工作流简称] [操作]
省略目录时跟随当前工作流。每个模型目录按人物 C、风格 S、其他 O 独立编号。SVI / Lightning 用文件名。
/comfy lora wai list 水彩  查 WAI 编号，可省略 list
/comfy lora anima use C1:0.85 S1:0.6  预约下一次 Anima T2I
/comfy lora wai off  预约关闭，clear 取消预约
/comfy gen --wf wai 一只猫 --lora C1:0.85,S1:0.6  单次覆盖；off 单次关闭
/comfy lora video list 关键词  查 SVI / Lightning 的视频 LoRA
/comfy gen --wf svi 镜头推进 --stages 3,1 --lora "3=high:文件名:0.8"
视频用 high、low 或 both；同段逗号叠加，不同段可重复写 --lora。
3=off 清空本次第 3 段的附加项；--lora off 清空本次所有段的附加项。
Anima I2I AIO 的 LoRA 在工作台配置。批量扫图见 /comfy sweep --help。""",
    "sweep": '''批量扫图
/comfy sweep presets --wf wai --lora "C1:0.85,S1:0.6"  固定一组 LoRA 遍历个人预设
/comfy sweep lora --wf v40 --preset 2 雨夜街头  固定提示词遍历人物 LoRA
人物 LoRA 扫图使用对应工作流参数页选定的目录。支持具有可接入采样模型的文生图工作流。
两种模式均可加 --help。整批共用一个种子，并需要足够的队列位置。''',
    "set": """Anima T2I 会话参数
/comfy set  查看当前生效值
/comfy set show all  列出全部分支，也可把 all 换成分类名
/comfy set 修脚=on 降噪=0.55  保存到当前会话
/comfy set 修脚=default  单项沿用面板
/comfy set reset  恢复面板值并取消 Anima 待用 LoRA""",
    "archive": """图片归档
引用图片或视频，发送 /comfy archive fav 收藏。
引用多图时可加 --image 2。详情见 /comfy archive fav --help。""",
    "job": """任务
/comfy job  看自己的等待中和运行中任务
/comfy job all  管理员查看插件队列
/comfy job cancel 短ID  取消任务
/comfy job result [短ID]  查询结果，回传失败时重试；省略 ID 查最近一项""",
}

ALIASES = {
    "commands": "help", "指令": "help", "生成": "gen", "文生图": "t2i",
    "图生图": "i2i", "重绘": "i2i", "redraw": "i2i", "video": "t2v",
    "反推": "reverse", "preset": "presets", "预设": "presets", "队列": "queue",
}
# Each help token keeps quoted values intact, including --name="multi word".
HELP_TOKEN = re.compile(r"""(?:[^\s"']+=)?(?:"[^"]*"|'[^']*')|\S+""")
GENERATION_HELP = """通用：--seed 42 固定种子（-1 随机），--negative "词" 覆盖负向（空引号清空）。
--preset 2 使用个人预设，--raw 保留描述原文。可用空格或 = 连接参数和值。"""
REFERENCE_HELP = "QQ 优先取本条附图，其次取引用图。--image 2 选择第 2 张，默认第 1 张。"

WORKFLOW_HELP = {
    "t2i": """Anima T2I · 文生图
输入画面描述。明确用 --wf t2i 时走文生图。若启用 ControlNet 参考分支，图像来源按工作台设置。
--hands / --face / --eyes / --feet 用 on 或 off 切换本次修复；--denoise 0–1。
--lora C1:0.85,S1:0.6 单次选 Anima LoRA，--lora off 本次关闭。用 /comfy lora anima 查编号。
例：/comfy gen --wf t2i 雨夜街景 --hands on --feet on --lora C1:0.85""",
    "i2i": """Anima I2I AIO · 重绘
附图或回复图片，并描述要改什么。工作台可选整图或遮罩重绘，遮罩方式用保留透明通道的 PNG。
--denoise 0–1 控制本次重绘幅度。LoRA、放大和控制分支在工作台配置。
例：/comfy gen --wf i2i 改成水彩 --denoise 0.55 --image 2""",
    "v40": """Advanced Gemma V40 · Illustrious 文生图
工作台可调整各生成、修复和后处理分支。Gemma 扩写默认关闭。
--hands、--face、--eyes、--feet 用 on 或 off 临时切换。
附图或回复图片，加 --img2img on 可重绘。
人物 LoRA 扫图用 /comfy sweep lora --wf v40。
例：/comfy gen --wf v40 --feet on 1girl, full body --raw""",
    "detailer": """Detailer V40 · 局部重绘和细节修复
附图或回复图片。--image 2 选择第 2 张。PNG 透明区域作为局部重绘遮罩。
在工作台的任务队列可选本地或收藏图片，再点击「编辑遮罩」。
--feet on / --feet off 单次开启或关闭修脚。省略时沿用工作台。
例：/comfy gen --wf detailer --feet on detailed feet --raw""",
    "wai": """WAI-Illustrious T2I · 文生图
输入画面描述。--face / --eyes 接 on 或 off；--controlnet-type depth 指定 Union ControlNet 类型，需开启工作台的「放大后重采样」和「重采样 ControlNet」。
--lora C1:0.85,S1:0.6 使用 WAI 编号，--lora off 本次关闭。用 /comfy lora wai 查编号。
例：/comfy gen --wf wai 一只窗边的猫 --face on --controlnet-type depth --lora C1:0.85""",
    "sdxl": """SDXL Turbo · 单步文生图
输入画面描述。尺寸和采样在工作台配置。
例：/comfy gen --wf sdxl 一只窗边的猫 --seed 42""",
    "wan-t2v": """WAN 2.2 T2V · 普通文生视频
输入主体动作和镜头描述。帧数、帧率、尺寸与高低噪声采样在工作台配置。
例：/comfy gen --wf wan-t2v 小熊猫慢慢走过树枝 --seed 42""",
    "wan-i2v": """WAN 2.2 I2V · 普通图生视频
附图或回复图片，描述主体动作或镜头变化。帧数、帧率和采样在工作台配置。
例：/comfy gen --wf wan-i2v 镜头缓慢推进 --image 2""",
    "svi": '''WAN 2.2 SVI · 分段图生视频
附图或回复图片，描述动作和镜头。最多 12 段，--segments 2 选前两段，--stages 3,1 按原段号重排，两项二选一。
--frames 81 设置每段帧数（4n+1），--fps 16 设置基础帧率，--samplers 2 或 3 切换采样阶段。
--lora "3=high:文件名:0.8" 覆盖第 3 段附加 LoRA。阶段可用 high、low、both、lightning-high，三阶段还可用 svi-high。
例：/comfy gen --wf svi 镜头推进 --stages 3,1 --lora "3=high:文件名:0.8" --lora "1=off"''',
    "lightning": '''WAN 2.2 Lightning · 长视频
附图或回复图片，描述动作和镜头。最多 4 段，--segments 2 选前两段，--stages 4,2 按原段号重排，两项二选一。
--frames 81 设置每段帧数（4n+1），--fps 16 设置基础帧率。采样固定两阶段。
--lora "4=both:文件名:0.7" 覆盖第 4 段附加 LoRA，可用 high、low 或 both。
例：/comfy gen --wf lightning 主体转头 --stages 4,2 --lora "4=both:文件名:0.7"''',
    "reverse": """Anima 反推流 · PixAI / TIPO
附图或回复图片，生成英文标签。工作台可启用 TIPO 扩写并调整置信度阈值。
/comfy prompt 默认第 1 张，/comfy prompt 2 反推第 2 张。""",
    "t2v": """文生视频 · 类型入口
优先使用当前选中的文生视频工作流，再用插件配置的默认文生视频工作流。
例：/comfy gen --wf t2v 小熊猫慢慢走过树枝
查看随包普通 WAN 参数用 /comfy gen --wf wan-t2v --help。""",
    "i2v": """图生视频 · 类型入口
附图或回复图片。优先使用当前选中的图生视频工作流，再用插件配置的默认图生视频工作流。
例：/comfy gen --wf i2v 镜头推进
查看具体参数用 /comfy gen --wf wan-i2v --help，也可换成 svi 或 lightning。""",
}
VIDEO_LORA_HELP = ('/comfy lora video 查文件。同段用逗号叠加，不同段可重复 --lora。'
                   '段号须在本次选中。--lora "3=off" 清空第 3 段，--lora off 清空所有段的附加项。全局 LoRA 沿用工作台。')

SUBCOMMAND_HELP = {
    "archive fav": "收藏媒体 · /comfy archive fav [--image 2|--video 2]\n"
                   "回复图片或视频，默认第 1 张或第 1 条。也可用 /comfy archive fav --job 短ID。\n"
                   "收藏生成图时，同一用户在本会话中排在它前面的待评价图片会跳过。仅任务所有者或管理员可移动原件。",
    "sweep presets": '固定 LoRA 扫预设 · /comfy sweep presets --wf wai --lora "C1:0.85,S1:0.6" --seed 42\n'
                     '支持 wai 和 t2i。用逗号分隔多个 LoRA，强度留空时使用 LoRA 编号页的默认权重。\n'
                     '每个个人预设提交一个任务，整组 LoRA 和种子相同。省略种子时整批随机选一个。\n'
                     '整批需要足够的队列位置。用 /comfy job 查看进度。',
    "sweep lora": '固定提示词扫人物 LoRA · /comfy sweep lora --wf v40 --preset 2 雨夜街头 --seed 42\n'
                  '支持 v40、wai 和 t2i。可单写描述，也可使用预设并追加描述。加 --raw 保留补充描述原文。\n'
                  '在对应工作流的「人物 LoRA 扫图目录」选择 models/loras 下的文件夹。\n'
                  '人物组 C 的每个 LoRA 按各自默认权重生成一次，共用一个种子。省略种子时整批随机选一个。\n'
                  '整批需要足够的队列位置。用 /comfy job 查看进度。',
    "prompt wd14": "WD14 反推 · /comfy prompt wd14 [图片序号]\n"
                   "附图或回复图片，默认第 1 张。标签阈值来自 Anima I2I AIO 工作台。\n"
                   "例：/comfy prompt wd14 2",
    "prompt preset": "个人预设 · 私聊管理，生成时群聊也可使用。\n"
                     "直接发送 /comfy prompt preset 查看列表和账号标识。\n"
                     "子指令 list、show、add、update、delete 均可加 --help。\n"
                     "例：/comfy gen --preset 2 雨夜街头",
    "prompt preset list": "列出个人预设 · /comfy prompt preset list\n"
                          "私聊查看预设名称、编号和账号标识。可省略 list。",
    "prompt preset show": "查看预设 · /comfy prompt preset show 2\n"
                          "私聊使用，显示正向和负向词。可用编号或名称，名称含空格时加英文引号。",
    "prompt preset add": '新增预设 · /comfy prompt preset add "水彩 人像" "watercolor, portrait" "text"\n'
                         "私聊使用，名称在个人库中唯一。最后一项负向词可省略。",
    "prompt preset update": '修改预设 · /comfy prompt preset update 2 "watercolor, landscape" "text"\n'
                            "私聊使用，编号也可换成名称。最后一项负向词可省略。",
    "prompt preset delete": "删除预设 · /comfy prompt preset delete 2\n"
                            "私聊使用。可用编号或名称，删除后后续生成无法再引用该预设。",
    "wf list": "工作流列表 · /comfy wf list\n查看工作流简称、编号和当前选择。可省略 list。",
    "wf use": "切换工作流 · /comfy wf use wai\n"
              "可用简称、编号或完整名称，保存到当前用户的当前会话。单次切换用 gen --wf。",
    "wf check": "检查工作流 · /comfy wf check [工作流]\n"
                "检查 ComfyUI 连接、队列及所需节点。省略时检查当前工作流。例：/comfy wf check lightning",
    "wf reload": "重载工作流 · /comfy wf reload\n"
                 "管理员重新读取插件数据目录中的 API 工作流，并显示加载统计。插件代码从 AstrBot 面板重载。",
    "set show": "查看 Anima T2I 生效设置 · /comfy set show [all|分类]\n"
                "省略分类只看概况；all 展开全部。例：/comfy set show 局部修复",
    "set reset": "重置 Anima T2I 会话设置 · /comfy set reset\n"
                 "清除当前用户在当前会话保存的覆盖值和 Anima 待用 LoRA，恢复工作台默认值。",
    "set update": "修改 Anima T2I 会话参数 · /comfy set 修脚=on 降噪=0.55\n"
                  "on 开启，off 关闭，default 让单项沿用面板。用 /comfy set show all 查看开关名称。",
    "job list": "我的任务 · /comfy job list\n"
                "查看当前会话自己的排队和运行任务。可省略 list。查已完成任务用 job result。",
    "job all": "插件队列 · /comfy job all\n管理员查看所有等待和运行中的任务。",
    "job cancel": "取消任务 · /comfy job cancel 短ID\n"
                  "用户可取消自己的任务，管理员可取消他人的任务。运行中的任务是否能单独停止取决于 ComfyUI。",
    "job result": "查询或补发结果 · /comfy job result [短ID]\n"
                  "省略 ID 查询当前会话最近任务。若回传失败，可补发未确认发送的文件。",
}
LEGACY_HELP = {
    "caption": "prompt wd14", "presets": "prompt preset", "state": "set show",
    "queue": "job", "result": "job result", "check": "wf check", "reload": "wf reload",
}
LEGACY_GENERATION = {"t2i", "i2i", "t2v", "i2v", "illustrious", "svi", "lightning"}
LEGACY_SWEEP = {"sweep": "presets", "sweep-loras": "lora"}
LORA_FAMILY = {"anima": "anima", "wai": "wai", "illustrious": "wai",
               "video": "video", "svi": "video", "lightning": "video"}


def _lora_help(words):
    family = LORA_FAMILY.get(words[0], "") if words else ""
    if family:
        words = words[1:]
    action = words[0] if words else ""
    if not family and action not in {"list", "use", "off", "clear"}:
        return TOPICS["lora"]
    scope = f" {family}" if family else ""
    prefix = "/comfy lora" + scope
    if family == "video":
        return ("视频 LoRA · " + prefix + " [list] [关键词]\n"
                "供 SVI 和 Lightning 使用。唯一文件可用短名，同名时用完整相对路径。\n" + VIDEO_LORA_HELP)
    catalog = {
        "anima": "Anima T2I · models/loras/anima/。I2I AIO 的 LoRA 在工作台设置。",
        "wai": "WAI-Illustrious T2I · models/loras/illustrious/。使用独立编号。",
        "": "省略目录时跟随当前工作流。可指定 anima 或 wai 来区分图片 LoRA。",
    }[family]
    if action == "use":
        detail = f"{prefix} use C1:0.85 S1:0.6\n预约下一次对应工作流，空格分隔，可用编号或 ID，省略强度时使用 LoRA 编号页的默认权重。"
    elif action == "off":
        detail = f"{prefix} off\n预约下一次对应工作流关闭 LoRA。单次关闭也可在生成时用 --lora off。"
    elif action == "clear":
        detail = f"{prefix} clear\n清除对应目录的预约，恢复工作流或会话默认值。"
    elif action == "list":
        detail = f"{prefix} list 关键词\n按关键词筛选，保留原编号。省略关键词列出全部可查项。"
    else:
        detail = (f"{prefix} [list] [关键词]\n"
                  f"用 {prefix} use C1:0.85 预约，off 预约关闭，clear 取消预约。")
    return catalog + "\n" + detail


def _workflow_help(name, resolve_workflow, allow_nsfw):
    folded = name.casefold()
    workflow = None
    if resolve_workflow is not None:
        try:
            workflow = resolve_workflow(name)
        except WorkflowError:
            pass
    if workflow is not None:
        key = WORKFLOW_SHORT_NAMES.get(workflow.name)
        if key is None:
            reference = f"附图或回复图片。{REFERENCE_HELP}" if workflow.image_required else "输入画面描述。"
            example = f'/comfy gen --wf "{name}" 描述'
            return f"{workflow.name} · 自定义工作流\n{reference}\n例：{example}\n{GENERATION_HELP}"
    else:
        key = WORKFLOW_SHORT_NAMES.get(WORKFLOW_ALIASES.get(folded)) or next(
            (short for full, short in WORKFLOW_SHORT_NAMES.items() if full.casefold() == folded), folded
        )
    if key not in WORKFLOW_HELP:
        return f"未找到工作流「{name}」。用 /comfy wf 查看简称或编号。"
    text = WORKFLOW_HELP[key]
    if key == "t2i" and allow_nsfw:
        text += "\n" + NSFW_HELP
    if key == "reverse":
        return text
    if key in {"svi", "lightning"}:
        text += "\n" + VIDEO_LORA_HELP
    if key in {"t2i", "i2i", "wan-i2v", "i2v", "svi", "lightning"}:
        text += "\n" + REFERENCE_HELP
    return text + "\n" + GENERATION_HELP


def _requested_workflow(tokens):
    for index, token in enumerate(tokens):
        if token.startswith("--wf="):
            return token[5:].strip("\"'")
        if token == "--wf" and index + 1 < len(tokens) and not tokens[index + 1].startswith("--"):
            return tokens[index + 1].strip("\"'")
    return ""


NSFW_HELP = "管理员私聊可用 --nsfw-repair on/off，或用 /comfy set 7=on 保存会话设置。归档可用 [NSFW]。"


def command_help(argument, resolve_workflow=None, *, allow_nsfw=False):
    parts = argument.split(maxsplit=1)
    if not parts:
        return HELP
    action = parts[0].casefold()
    action = ALIASES.get(action, action)
    tail = parts[1] if len(parts) == 2 else ""
    tokens = HELP_TOKEN.findall(tail)
    words = [token.casefold() for token in tokens]
    if action == "help":
        return HELP
    if action == "gen" or action in LEGACY_GENERATION:
        name = _requested_workflow(tokens)
        if name or action != "gen":
            return _workflow_help(name or action, resolve_workflow, allow_nsfw)
    if action == "reverse" or (action == "prompt" and words and (words[0] == "pixai" or words[0].isdecimal())):
        return WORKFLOW_HELP["reverse"]
    if action == "wf" and words and words[0] not in {"list", "use", "check", "reload"}:
        return _workflow_help(tail.strip("\"'"), resolve_workflow, allow_nsfw)
    if action == "lora":
        if words and words[0] in LEGACY_SWEEP:
            return SUBCOMMAND_HELP[f"sweep {LEGACY_SWEEP[words[0]]}"]
        name = _requested_workflow(tokens)
        if name and resolve_workflow:
            try:
                workflow = resolve_workflow(name)
            except WorkflowError as exc:
                return str(exc)
            if workflow.sweep_lora_family:
                return (
                    f'{workflow.name} · {workflow.sweep_lora_family}\n/comfy lora --wf "{name}" list\n'
                    f'/comfy lora --wf "{name}" use C1:0.85\n/comfy sweep lora --wf "{name}" 描述'
                )
        return _lora_help(words)
    if action in WORKFLOW_HELP or action in WORKFLOW_ALIASES:
        return _workflow_help(parts[0], resolve_workflow, allow_nsfw)
    if action == "sweep" and words[:1] == ["preset"]:
        words[0] = "presets"
    if action == "state" and words == ["reset"]:
        return SUBCOMMAND_HELP["set reset"]
    if action == "set" and words and "=" in words[0]:
        return SUBCOMMAND_HELP["set update"]
    base = LEGACY_HELP.get(action, action)
    if base == "archive" and words and words[0] == "收藏":
        words[0] = "fav"
    if base == "job" and words and words[0] in {"delete", "取消", "删除"}:
        words[0] = "cancel"
    for count in range(min(len(words), 2), -1, -1):
        topic = " ".join((base, *words[:count]))
        if topic in SUBCOMMAND_HELP:
            return SUBCOMMAND_HELP[topic]
    if base == "gen" and allow_nsfw:
        return TOPICS["gen"] + "\n" + NSFW_HELP
    if resolve_workflow is not None and base not in TOPICS and not words:
        try:
            resolve_workflow(parts[0])
        except WorkflowError:
            pass
        else:
            return _workflow_help(parts[0], resolve_workflow, allow_nsfw)
    return TOPICS.get(base) or "可查看 gen、prompt、wf、lora、sweep、set、job 或 archive。"


def route_command(text):
    text = re.sub(r"^/?(?:comfy|绘图)(?:\s+|$)", "", text.strip(), count=1, flags=re.I)
    if "--help" in text:
        topic = HELP_TOKEN.sub(lambda token: "" if token[0] == "--help" else token[0], text)
        if topic != text:
            return "help", topic.strip()
    parts = text.split(maxsplit=1)
    action = parts[0].casefold() if parts else "help"
    action = ALIASES.get(action, action)
    argument = parts[1] if len(parts) == 2 else ""
    subparts = argument.split(maxsplit=1)
    verb = subparts[0].casefold() if subparts else ""
    rest = subparts[1] if len(subparts) == 2 else ""

    if action == "lora" and verb in LEGACY_SWEEP:
        return "sweep", f"{LEGACY_SWEEP[verb]} {rest}".strip()
    if action == "sweep" and not verb:
        return "help", "sweep"
    if action == "prompt":
        if verb == "preset":
            return "presets", rest
        if verb in {"wd14", "pixai"}:
            return ("caption" if verb == "wd14" else "reverse"), rest
        if not verb or verb.isdecimal() and not rest:
            return "reverse", argument
        raise WorkflowError("提示词用法见 /comfy help prompt。")
    if action == "wf":
        if verb == "use":
            if not rest:
                raise WorkflowError("用法：/comfy wf use 简称或编号。")
            return "wf", rest
        if verb == "check":
            return "check", rest
        if verb == "reload" and not rest:
            return "reload", ""
        if verb == "list" and not rest:
            return "wf", ""
    if action == "set":
        if verb == "show":
            return "state", rest
        if argument.casefold() in {"", "all", "reset"}:
            return "state", argument
    if action == "job":
        return ("result", rest) if verb == "result" else ("queue", argument)
    return action, argument
