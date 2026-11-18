import type { ReferenceFileMaxBytes } from './video-material-policy';
export type VideoModelInfo = {
    id: string;
    provider: "88api" | "zhiying";
    summary: string;
    aliases: string[];
    promptMax?: number;
    resolutions: string[];
    duration: { min: number; max: number; values?: number[] };
    ratios: string[];
    defaultResolution: string;
    defaultSeconds: number;
    modes: ("frames" | "reference")[];
    referenceLimits: { images?: number; videos?: number; audios?: number; total?: number };
    referenceFileMaxBytes?: ReferenceFileMaxBytes;
    priceLines: string[];
    notes: string[];
    audio?: "optional" | "required" | "unsupported";
    watermark?: "optional" | "unsupported";
};

// Audited against official model docs, public pricing and the active bridge.
// https://88api.ai/zh/docs/api/video/video-api-standard/
// https://88api.ai/api/pricing
// https://zhiyingai.org/api/openapi
// Prices: CNY, upstream cost + 10%. Client defaults are valid selections;
// undocumented upstream defaults and exact 2K/4K pixels are not inferred.
// API request IDs stay separate from the client-visible summary.
export const videoModelCatalog: VideoModelInfo[] = [
    {
        "id": "wan3.0-video",
        "aliases": ["wan3.0-video [480-1080p 2-30s ¥0.385/秒起]"],
        "provider": "88api",
        "summary": "480p / 720p / 1080p · 2–30 秒 · ¥0.385/秒 起",
        "resolutions": [
            "480",
            "720",
            "1080"
        ],
        "duration": {
            "min": 2,
            "max": 30
        },
        "ratios": [
            "auto",
            "16:9",
            "9:16",
            "1:1",
            "4:3",
            "3:4",
            "21:9"
        ],
        "defaultResolution": "1080",
        "defaultSeconds": 5,
        "modes": [
            "frames",
            "reference"
        ],
        "referenceLimits": {
            "images": 10,
            "videos": 5,
            "audios": 5
        },
        "priceLines": [
            "480p：¥0.385/秒",
            "720p：¥0.66/秒",
            "1080p：¥0.99/秒"
        ],
        "notes": [
            "参考图片最多 10 张、视频 5 段、音频 5 段；首尾帧不能与普通参考素材混用，尾帧需要首帧。",
            "按输入参考视频时长 + 输出视频时长结算；使用参考视频或自动时长时可先按 30 秒预扣。",
            "上游支持 duration=-1 自动时长；此处滑块只展示明确秒数。",
            "自动比例使用上游 adaptive；不支持生成音频开关。"
        ],
        "watermark": "optional"
    },
    {
        "id": "doubao-seedance-2.0",
        "aliases": ["doubao-seedance-2.0 [480p-4k 4-15s ¥13.2/百万Token起]"],
        "provider": "88api",
        "summary": "480p / 720p / 1080p / 4K · 4–15 秒 · ¥13.2/百万 Token 起",
        "resolutions": [
            "480",
            "720",
            "1080",
            "4k"
        ],
        "duration": {
            "min": 4,
            "max": 15
        },
        "ratios": [
            "16:9",
            "4:3",
            "1:1",
            "3:4",
            "9:16",
            "21:9",
            "auto"
        ],
        "defaultResolution": "720",
        "defaultSeconds": 5,
        "modes": [
            "frames",
            "reference"
        ],
        "referenceLimits": {
            "images": 9,
            "videos": 3,
            "audios": 3
        },
        "priceLines": [
            "480p · 有参考视频：¥23.1/百万 Token",
            "480p · 无参考视频：¥37.95/百万 Token",
            "720p · 有参考视频：¥23.1/百万 Token",
            "720p · 无参考视频：¥37.95/百万 Token",
            "1080p · 有参考视频：¥25.575/百万 Token",
            "1080p · 无参考视频：¥42.075/百万 Token",
            "4K · 有参考视频：¥13.2/百万 Token",
            "4K · 无参考视频：¥21.45/百万 Token"
        ],
        "notes": [
            "按实际视频 Token 结算，不能用固定秒价估算；参考视频也会产生 Token。",
            "有参考视频与无参考视频采用不同单价；最低起价是 4K 参考视频档。",
            "首尾帧不能与普通参考素材混用，尾帧需要首帧；参考音频需要图片或视频。",
            "单段参考视频不超过 15 秒；图片最多 9 张、视频 3 段、音频 3 段。",
            "上游支持 duration=-1 自动时长；此处默认 5 秒是有效客户端选项。",
            "官方已下线旧 seedance-* 按秒模型，不自动替换成此 Token 模型。"
        ],
        "audio": "optional",
        "watermark": "optional"
    },
    {
        "id": "doubao-seedance-2.5",
        "aliases": ["doubao-seedance-2.5 [480-1080p 4-30s ¥34.65/百万Token起]"],
        "provider": "88api",
        "summary": "480p / 720p / 1080p · 4–30 秒 · ¥34.65/百万 Token 起",
        "resolutions": [
            "480",
            "720",
            "1080"
        ],
        "duration": {
            "min": 4,
            "max": 30
        },
        "ratios": [
            "16:9",
            "4:3",
            "1:1",
            "3:4",
            "9:16",
            "21:9",
            "auto"
        ],
        "defaultResolution": "720",
        "defaultSeconds": 5,
        "modes": [
            "frames",
            "reference"
        ],
        "referenceLimits": {
            "images": 30,
            "videos": 10,
            "audios": 10
        },
        "priceLines": [
            "480p · 有参考视频：¥34.65/百万 Token",
            "480p · 无参考视频：¥57.75/百万 Token",
            "720p · 有参考视频：¥34.65/百万 Token",
            "720p · 无参考视频：¥57.75/百万 Token",
            "1080p · 有参考视频：¥37.95/百万 Token",
            "1080p · 无参考视频：¥63.525/百万 Token"
        ],
        "notes": [
            "按实际视频 Token 结算；有无参考视频采用不同单价，最终以真实用量为准。",
            "首尾帧不能与普通参考素材混用，尾帧需要首帧；首尾帧须选择自动比例。",
            "参考图片最多 30 张、视频 10 段、音频 10 段；参考音频需要图片或视频。",
            "上游支持 duration=-1 自动时长；此处默认 5 秒是有效客户端选项。",
            "上游文档包含编辑/续写参数，不代表本画布已支持独立编辑/续写路由。"
        ],
        "audio": "optional",
        "watermark": "optional"
    },
    {
        "id": "minimax-h3",
        "aliases": ["minimax-h3 [768p/1080p/2k 4-15s ¥0.165/秒起]"],
        "provider": "88api",
        "summary": "768p / 1080p / 2K · 4–15 秒 · ¥0.165/秒 起",
        "resolutions": [
            "768",
            "1080",
            "2k"
        ],
        "duration": {
            "min": 4,
            "max": 15
        },
        "ratios": [
            "16:9",
            "9:16",
            "1:1",
            "4:3",
            "3:4",
            "21:9"
        ],
        "defaultResolution": "768",
        "defaultSeconds": 5,
        "modes": [
            "frames",
            "reference"
        ],
        "referenceLimits": {
            "images": 9,
            "videos": 0,
            "audios": 3
        },
        "priceLines": [
            "768p：¥0.165/秒",
            "1080p：¥0.22/秒",
            "2K：¥0.275/秒"
        ],
        "notes": [
            "768p 最多参考图片 9 张；1080p、2K 最多 6 张；音频最多 3 段且必须搭配图片。",
            "1080p、2K 仅支持 16:9 / 9:16；768p 支持所列全部比例。",
            "首尾帧仅限 768p，不能与普通参考素材混用；不支持参考视频。",
            "2K 为放大输出，官方未公布精确短边像素；480p、4K 已下线。",
            "始终生成音频，无音频开关；实际成片可能比请求时长长约 0.1–0.6 秒，按真实用量结算。",
            "支持首尾帧和参考图片、音频；仅提供上游允许的组合。"
        ],
        "audio": "required"
    },
    {
        "id": "grok-imagine-video-1.5",
        "aliases": ["grok-imagine-video-1.5 [480-1080p 1-15s ¥0.088/秒起]"],
        "provider": "88api",
        "summary": "480p / 720p / 1080p · 1–15 秒 · ¥0.088/秒 起",
        "resolutions": [
            "480",
            "720",
            "1080"
        ],
        "duration": {
            "min": 1,
            "max": 15
        },
        "ratios": [
            "16:9",
            "9:16",
            "1:1",
            "4:3",
            "3:4",
            "3:2",
            "2:3"
        ],
        "defaultResolution": "720",
        "defaultSeconds": 8,
        "modes": [
            "frames",
            "reference"
        ],
        "referenceLimits": {
            "images": 14,
            "videos": 0,
            "audios": 0
        },
        "priceLines": [
            "480p：¥0.088/秒",
            "720p：¥0.176/秒",
            "1080p：¥0.242/秒"
        ],
        "notes": [
            "1080p 仅限文生视频或单首帧；尾帧、关键帧、参考图片或预设音色最高 720p。",
            "参考图片最多 14 张、关键帧 4 个、预设音色 3 个；音色名称不是上传音频。",
            "可仅提供尾帧；关键帧时间须在时长内部，按 1/3 秒对齐且相隔至少 1/3 秒。",
            "图片必须是公开 HTTPS URL；不接受内联 Base64 或直接文件上传。",
            "本画布通用面板未提供关键帧时间轴或预设音色选择；不支持参考视频。"
        ]
    },
    {
        "id": "veo-3.1-fast",
        "aliases": ["veo-3.1-fast [720p-4k 4/6/8s ¥0.165/秒起]", "veo-3.1-fast [720p 8s ¥0.165/秒]"],
        "provider": "88api",
        "summary": "720p / 1080p / 4K · 4/6/8 秒 · ¥0.165/秒 起",
        "resolutions": [
            "720", "1080", "4k"
        ],
        "duration": {
            "min": 4,
            "max": 8,
            "values": [
                4, 6, 8
            ]
        },
        "ratios": [
            "16:9",
            "9:16"
        ],
        "defaultResolution": "720",
        "defaultSeconds": 8,
        "modes": [
            "frames",
            "reference"
        ],
        "referenceLimits": {
            "images": 3,
            "videos": 0,
            "audios": 0
        },
        "priceLines": [
            "720p：¥0.165/秒", "1080p：¥0.22/秒", "4K：¥0.33/秒"
        ],
        "notes": [
            "时长支持 4、6、8 秒；参考图片模式固定 8 秒，默认带音频。",
            "参考图片最多 3 张；首尾帧与普通参考图片互斥，尾帧需要首帧。",
            "当前面板不提供视频延长；不支持普通参考视频、参考音频、seed 或 negative_prompt。"
        ],
        "audio": "required"
    },
    {
        "id": "kling-3.0-omni",
        "aliases": ["kling-3.0-omni [720/1080p 3-15s ¥0.55/秒起]"],
        "provider": "88api",
        "summary": "720p / 1080p · 3–15 秒 · ¥0.55/秒 起",
        "resolutions": [
            "720",
            "1080"
        ],
        "duration": {
            "min": 3,
            "max": 15
        },
        "ratios": [
            "16:9",
            "1:1",
            "9:16"
        ],
        "defaultResolution": "720",
        "defaultSeconds": 5,
        "modes": [
            "frames",
            "reference"
        ],
        "referenceLimits": {
            "images": 8,
            "videos": 1,
            "audios": 0
        },
        "priceLines": [
            "720p · 参考视频：¥0.825/秒",
            "1080p · 参考视频：¥1.111/秒",
            "720p · 有声：¥0.869/秒",
            "1080p · 有声：¥1.089/秒",
            "720p · 无声：¥0.55/秒",
            "1080p · 无声：¥0.737/秒"
        ],
        "notes": [
            "默认无声；有声、无声、参考视频分别计价。",
            "最多 8 张参考图、1 段参考视频；使用参考视频只允许无声。",
            "首尾帧不能与普通参考图片或视频混用，首尾帧比例跟随首帧；不支持参考音频。",
            "能力依据官方实时价目描述/schema；独立 Kling 文档暂不可用。"
        ],
        "audio": "optional"
    },
    {
        "id": "gemini-omni-flash-1.2",
        "aliases": ["gemini-omni-flash-1.2 [720p-4k 3-15s ¥0.22/秒起]"],
        "provider": "88api",
        "summary": "720p / 1080p / 4K · 3–15 秒 · ¥0.22/秒 起",
        "resolutions": [
            "720",
            "1080",
            "4k"
        ],
        "duration": {
            "min": 3,
            "max": 15
        },
        "ratios": [
            "16:9",
            "9:16"
        ],
        "defaultResolution": "720",
        "defaultSeconds": 3,
        "modes": [
            "frames",
            "reference"
        ],
        "referenceLimits": {
            "images": 10,
            "videos": 3,
            "audios": 0
        },
        "priceLines": [
            "720p：¥0.22/秒",
            "1080p：¥0.275/秒",
            "4K：¥0.385/秒"
        ],
        "notes": [
            "参考图片最多 10 张、视频 3 段；不支持参考音频。",
            "一张图片默认作为首帧，多张默认参考模式；首尾帧与普通参考图片互斥。",
            "单个视频默认编辑；多个视频或视频加图片进入参考模式。",
            "参考视频需使用公开 HTTPS 链接，暂不直接上传本地视频。",
            "编辑任务画幅跟随原视频，忽略指定比例/size；不支持扩展或音频开关。"
        ]
    },
    {
        "id": "kling-3.0-motion-control",
        "aliases": ["kling-3.0-motion-control [720p 3-30s ¥0.979/秒]"],
        "provider": "88api",
        "summary": "720p · 3–30 秒 · ¥0.979/秒",
        "resolutions": [
            "720"
        ],
        "duration": {
            "min": 3,
            "max": 30
        },
        "ratios": [
            "auto"
        ],
        "defaultResolution": "720",
        "defaultSeconds": 3,
        "modes": [
            "reference"
        ],
        "referenceLimits": {
            "images": 1,
            "videos": 1,
            "audios": 0
        },
        "priceLines": [
            "720p：¥0.979/秒"
        ],
        "notes": [
            "必须提供 1 张人物图片和 1 段 3–30 秒动作参考视频，输出人物跟随动作。",
            "成片时长跟随动作视频；时长和比例选择不改变这一语义。",
            "保留动作视频原声；按实际成片秒数结算，创建时先按 30 秒预扣。",
            "固定 720p；独立 Kling 文档暂不可用，未确认文件大小等额外能力。"
        ]
    },
    {
        "id": "gemini-omni-flash-1.1",
        "aliases": ["gemini-omni-flash-1.1 [720p-4k 3-10s ¥0.22/秒起]"],
        "provider": "88api",
        "summary": "720p / 1080p / 4K · 3–10 秒 · ¥0.22/秒 起",
        "resolutions": [
            "720",
            "1080",
            "4k"
        ],
        "duration": {
            "min": 3,
            "max": 10
        },
        "ratios": [
            "16:9",
            "9:16"
        ],
        "defaultResolution": "720",
        "defaultSeconds": 3,
        "modes": [
            "frames",
            "reference"
        ],
        "referenceLimits": {
            "images": 10,
            "videos": 3,
            "audios": 0
        },
        "priceLines": [
            "720p：¥0.22/秒",
            "1080p：¥0.275/秒",
            "4K：¥0.385/秒"
        ],
        "notes": [
            "参考图片最多 10 张、视频 3 段；不支持参考音频。",
            "一张图片默认作为首帧，多张默认参考模式；首尾帧与普通参考图片互斥。",
            "单个视频默认编辑；多个视频或视频加图片进入参考模式。",
            "参考视频需使用公开 HTTPS 链接，暂不直接上传本地视频。",
            "编辑任务画幅跟随原视频，忽略指定比例/size；不支持扩展或音频开关。"
        ]
    },
    {
        "id": "veo-3.1",
        "aliases": ["veo-3.1 [720p-4k 4/6/8s ¥0.275/秒起]"],
        "provider": "88api",
        "summary": "720p / 1080p / 4K · 4/6/8 秒 · ¥0.275/秒 起",
        "resolutions": [
            "720",
            "1080",
            "4k"
        ],
        "duration": {
            "min": 4,
            "max": 8,
            "values": [
                4,
                6,
                8
            ]
        },
        "ratios": [
            "16:9",
            "9:16"
        ],
        "defaultResolution": "720",
        "defaultSeconds": 8,
        "modes": [
            "frames",
            "reference"
        ],
        "referenceLimits": {
            "images": 3,
            "videos": 0,
            "audios": 0
        },
        "priceLines": [
            "720p：¥0.275/秒",
            "1080p：¥0.33/秒",
            "4K：¥0.4125/秒"
        ],
        "notes": [
            "时长仅支持 4、6、8 秒；参考图片模式固定 8 秒，最多 3 张。",
            "首尾帧与普通参考图片互斥；尾帧需要首帧。",
            "支持开关生成音频，关闭音频不改变单价；不支持普通参考视频或参考音频。",
            "原生支持单个 MP4 的 7 秒扩展，但本画布通用生成面板不提供扩展任务。"
        ],
        "audio": "optional"
    },
    {
        "id": "wan3.0-video-prime",
        "aliases": ["wan3.0-video-prime [480-1080p 2-30s ¥0.66/秒起]"],
        "provider": "88api",
        "summary": "480p / 720p / 1080p · 2–30 秒 · ¥0.66/秒 起",
        "resolutions": [
            "480",
            "720",
            "1080"
        ],
        "duration": {
            "min": 2,
            "max": 30
        },
        "ratios": [
            "auto",
            "16:9",
            "9:16",
            "1:1",
            "4:3",
            "3:4",
            "21:9"
        ],
        "defaultResolution": "1080",
        "defaultSeconds": 5,
        "modes": [
            "frames",
            "reference"
        ],
        "referenceLimits": {
            "images": 10,
            "videos": 5,
            "audios": 5
        },
        "priceLines": [
            "480p：¥0.66/秒",
            "720p：¥0.88/秒",
            "1080p：¥1.76/秒"
        ],
        "notes": [
            "Prime 与普通 Wan 使用相同参数和素材能力，提供更快生成通道。",
            "参考图片最多 10 张、视频 5 段、音频 5 段；首尾帧不能与普通参考素材混用，尾帧需要首帧。",
            "按输入参考视频时长 + 输出视频时长结算；参考视频或自动时长可按 30 秒预扣。",
            "上游支持 duration=-1 自动时长；不支持生成音频开关。"
        ],
        "watermark": "optional"
    },
    {
        "id": "grok-imagine-video",
        "aliases": ["grok-imagine-video [480/720p 1-15s ¥0.11/秒]"],
        "provider": "88api",
        "summary": "480p / 720p · 1–15 秒 · ¥0.11/秒",
        "resolutions": [
            "480",
            "720"
        ],
        "duration": {
            "min": 1,
            "max": 15
        },
        "ratios": [
            "16:9",
            "9:16",
            "1:1",
            "4:3",
            "3:4",
            "3:2",
            "2:3"
        ],
        "defaultResolution": "720",
        "defaultSeconds": 8,
        "modes": [
            "frames",
            "reference"
        ],
        "referenceLimits": {
            "images": 14,
            "videos": 0,
            "audios": 0
        },
        "priceLines": [
            "480p / 720p：¥0.11/秒"
        ],
        "notes": [
            "首帧与普通参考图片模式互斥；参考图片最多 14 张。",
            "参考图片模式仅支持 1–10 秒；文生视频和首帧模式支持 1–15 秒。",
            "图片必须是公开 HTTPS URL；不接受内联 Base64 或直接文件上传。",
            "不支持尾帧、参考视频、上传参考音频、seed、negative_prompt 或音频开关。"
        ]
    },
    {
        "id": "kling-3.0",
        "aliases": ["kling-3.0 [720/1080p 3-15s ¥0.55/秒起]"],
        "provider": "88api",
        "summary": "720p / 1080p · 3–15 秒 · ¥0.55/秒 起",
        "resolutions": [
            "720",
            "1080"
        ],
        "duration": {
            "min": 3,
            "max": 15
        },
        "ratios": [
            "16:9",
            "1:1",
            "9:16"
        ],
        "defaultResolution": "720",
        "defaultSeconds": 5,
        "modes": [
            "frames",
            "reference"
        ],
        "referenceLimits": {
            "images": 6,
            "videos": 0,
            "audios": 0
        },
        "priceLines": [
            "720p · 有声：¥0.979/秒",
            "1080p · 有声：¥1.309/秒",
            "720p · 无声：¥0.55/秒",
            "1080p · 无声：¥0.737/秒"
        ],
        "notes": [
            "默认无声；开启音频使用有声单价。",
            "最多 6 张参考图；首尾帧与普通参考图片互斥，首尾帧比例跟随首帧。",
            "不支持参考视频或参考音频。",
            "能力依据官方实时价目描述/schema；独立 Kling 文档暂不可用，未确认文件大小等额外能力。"
        ],
        "audio": "optional"
    },
    {
        "id": "SD-特价",
        "aliases": ["SD-特价 [1080p 5-30s ¥2.178/条]"],
        "promptMax": 10000,
        "provider": "zhiying",
        "summary": "1080p · 5–30 秒 · ¥2.178/条",
        "resolutions": [
            "1080"
        ],
        "duration": {
            "min": 5,
            "max": 30
        },
        "ratios": [
            "16:9",
            "9:16",
            "1:1",
            "4:3",
            "3:4",
            "21:9"
        ],
        "defaultResolution": "1080",
        "defaultSeconds": 30,
        "modes": [
            "reference"
        ],
        "referenceLimits": {
            "images": 9,
            "videos": 0,
            "audios": 3
        },
        "priceLines": [
            "1080p：¥2.178/条"
        ],
        "notes": [
            "提示词最多 10000 字符。",
            "该模型仅支持参考素材模式，不支持固定首尾帧或带时间戳的关键帧。",
            "支持上传本地参考素材，不直接接收远程素材链接。",
            "费用按实际积分用量结算，所列为已含 10% 加价的基础售价。",
            "固定按条计价，所列支持时长内基础单价相同；实际附加用量以任务积分为准。",
            "不支持参考视频。"
        ]
    },
    {
        "id": "sd-2.5-fullblood",
        "aliases": ["sd-2.5-fullblood [720p 5-30s ¥6.028/条]"],
        "promptMax": 20000,
        "provider": "zhiying",
        "summary": "720p · 5–30 秒 · ¥6.028/条",
        "resolutions": [
            "720"
        ],
        "duration": {
            "min": 5,
            "max": 30
        },
        "ratios": [
            "16:9",
            "9:16",
            "1:1",
            "4:3",
            "3:4",
            "21:9"
        ],
        "defaultResolution": "720",
        "defaultSeconds": 30,
        "modes": [
            "reference"
        ],
        "referenceLimits": {
            "images": 30,
            "videos": 10,
            "audios": 10,
            "total": 50
        },
        "priceLines": [
            "720p：¥6.028/条"
        ],
        "notes": [
            "提示词最多 20000 字符。",
            "该模型仅支持参考素材模式，不支持固定首尾帧或带时间戳的关键帧。",
            "支持上传本地参考素材，不直接接收远程素材链接。",
            "费用按实际积分用量结算，所列为已含 10% 加价的基础售价。",
            "固定按条计价，所列支持时长内基础单价相同；实际附加用量以任务积分为准。",
            "有参考视频时需提供真实参考视频总秒数，不得以生成时长替代。"
        ]
    },
    {
        "id": "wan3.0",
        "aliases": ["wan3.0 [5-30s 720p/1080p ¥0.319/秒]"],
        "promptMax": 5000,
        "provider": "zhiying",
        "summary": "720p / 1080p · 5–30 秒 · ¥0.319/秒 起",
        "resolutions": [
            "720",
            "1080"
        ],
        "duration": {
            "min": 5,
            "max": 30
        },
        "ratios": [
            "16:9",
            "9:16",
            "1:1",
            "4:3",
            "3:4"
        ],
        "defaultResolution": "720",
        "defaultSeconds": 5,
        "modes": [
            "reference"
        ],
        "referenceLimits": {
            "images": 10,
            "videos": 5,
            "audios": 5
        },
        "priceLines": [
            "720p：¥0.319/秒",
            "1080p：¥0.319/秒"
        ],
        "notes": [
            "提示词最多 5000 字符。",
            "该模型仅支持参考素材模式，不支持固定首尾帧或带时间戳的关键帧。",
            "支持上传本地参考素材，不直接接收远程素材链接。",
            "费用按实际积分用量结算，所列为已含 10% 加价的基础售价。",
            "有参考视频时需提供真实参考视频总秒数，不得以生成时长替代。"
        ]
    },
    {
        "id": "sd-2.5-fullblood-line2",
        "aliases": ["sd-2.5-fullblood-line2 [720p 5-30s ¥4.378/条]"],
        "promptMax": 45000,
        "provider": "zhiying",
        "summary": "720p · 5–30 秒 · ¥4.378/条",
        "resolutions": [
            "720"
        ],
        "duration": {
            "min": 5,
            "max": 30
        },
        "ratios": [
            "16:9",
            "9:16",
            "1:1",
            "21:9"
        ],
        "defaultResolution": "720",
        "defaultSeconds": 30,
        "modes": [
            "reference"
        ],
        "referenceLimits": {
            "images": 30,
            "videos": 10,
            "audios": 10,
            "total": 50
        },
        "priceLines": [
            "720p：¥4.378/条"
        ],
        "notes": [
            "提示词最多 45000 字符。",
            "该模型仅支持参考素材模式，不支持固定首尾帧或带时间戳的关键帧。",
            "支持上传本地参考素材，不直接接收远程素材链接。",
            "费用按实际积分用量结算，所列为已含 10% 加价的基础售价。",
            "固定按条计价，所列支持时长内基础单价相同；实际附加用量以任务积分为准。",
            "有参考视频时需提供真实参考视频总秒数，不得以生成时长替代。"
        ]
    },
    {
        "id": "sd-2.5-fullblood-line3",
        "aliases": ["sd-2.5-fullblood-line3 [720p 1-30s ¥5.258/条]"],
        "promptMax": 20000,
        "provider": "zhiying",
        "summary": "720p · 1–30 秒 · ¥5.258/条",
        "resolutions": [
            "720"
        ],
        "duration": {
            "min": 1,
            "max": 30
        },
        "ratios": [
            "16:9",
            "9:16",
            "1:1",
            "4:3",
            "3:4",
            "21:9"
        ],
        "defaultResolution": "720",
        "defaultSeconds": 5,
        "modes": [
            "reference"
        ],
        "referenceLimits": {
            "images": 30,
            "videos": 30,
            "audios": 30,
            "total": 30
        },
        "priceLines": [
            "720p：¥5.258/条"
        ],
        "notes": [
            "提示词最多 20000 字符。",
            "该模型仅支持参考素材模式，不支持固定首尾帧或带时间戳的关键帧。",
            "支持上传本地参考素材，不直接接收远程素材链接。",
            "费用按实际积分用量结算，所列为已含 10% 加价的基础售价。",
            "固定按条计价，所列支持时长内基础单价相同；实际附加用量以任务积分为准。",
            "参考视频时长可由上游探测，仍须符合各素材数量上限。"
        ]
    },
    {
        "id": "seedance-2.0-official",
        "aliases": ["seedance-2.0-official [720p 5-15s ¥0.528/秒;参考视频x2]"],
        "promptMax": 4000,
        "provider": "zhiying",
        "summary": "720p · 5–15 秒 · ¥0.528/秒",
        "resolutions": [
            "720"
        ],
        "duration": {
            "min": 5,
            "max": 15
        },
        "ratios": [
            "16:9",
            "9:16",
            "1:1",
            "4:3",
            "3:4",
            "21:9"
        ],
        "defaultResolution": "720",
        "defaultSeconds": 5,
        "modes": [
            "reference"
        ],
        "referenceLimits": {
            "images": 9,
            "videos": 3,
            "audios": 3,
            "total": 12
        },
        "priceLines": [
            "720p：¥0.528/秒"
        ],
        "notes": [
            "提示词最多 4000 字符。",
            "该模型仅支持参考素材模式，不支持固定首尾帧或带时间戳的关键帧。",
            "支持上传本地参考素材，不直接接收远程素材链接。",
            "费用按实际积分用量结算，所列为已含 10% 加价的基础售价。",
            "带参考视频时费用×2。",
            "参考视频时长可由上游探测，仍须符合各素材数量上限。"
        ]
    },
    {
        "id": "seedance-2.0-fast-official",
        "aliases": ["seedance-2.0-fast-official [720p 5-15s ¥0.209/秒;参考视频x2]"],
        "promptMax": 4000,
        "provider": "zhiying",
        "summary": "720p · 5–15 秒 · ¥0.209/秒",
        "resolutions": [
            "720"
        ],
        "duration": {
            "min": 5,
            "max": 15
        },
        "ratios": [
            "16:9",
            "9:16",
            "1:1",
            "4:3",
            "3:4",
            "21:9"
        ],
        "defaultResolution": "720",
        "defaultSeconds": 5,
        "modes": [
            "reference"
        ],
        "referenceLimits": {
            "images": 9,
            "videos": 3,
            "audios": 3,
            "total": 12
        },
        "priceLines": [
            "720p：¥0.209/秒"
        ],
        "notes": [
            "提示词最多 4000 字符。",
            "该模型仅支持参考素材模式，不支持固定首尾帧或带时间戳的关键帧。",
            "支持上传本地参考素材，不直接接收远程素材链接。",
            "费用按实际积分用量结算，所列为已含 10% 加价的基础售价。",
            "带参考视频时费用×2。",
            "参考视频时长可由上游探测，仍须符合各素材数量上限。"
        ]
    },
    {
        "id": "seedance-2.5-official",
        "aliases": ["seedance-2.5-official [720p 5-30s ¥0.418/秒起]"],
        "promptMax": 15000,
        "provider": "zhiying",
        "summary": "720p · 5–30 秒 · ¥0.418/秒 起",
        "resolutions": [
            "720"
        ],
        "duration": {
            "min": 5,
            "max": 30
        },
        "ratios": [
            "16:9",
            "9:16",
            "1:1",
            "4:3",
            "3:4",
            "21:9"
        ],
        "defaultResolution": "720",
        "defaultSeconds": 30,
        "modes": [
            "reference"
        ],
        "referenceLimits": {
            "images": 30,
            "videos": 10,
            "audios": 10,
            "total": 50
        },
        "priceLines": [
            "720p：¥0.418/秒"
        ],
        "notes": [
            "提示词最多 15000 字符。",
            "该模型仅支持参考素材模式，不支持固定首尾帧或带时间戳的关键帧。",
            "支持上传本地参考素材，不直接接收远程素材链接。",
            "费用按实际积分用量结算，所列为已含 10% 加价的基础售价。",
            "参考视频倍率不确定，按实际结算；上游目录和文档有冲突，这里仅展示基础价。",
            "参考视频时长可由上游探测，仍须符合各素材数量上限。"
        ]
    },
    {
        "id": "seedance-2.5-dedicated-line1",
        "aliases": ["seedance-2.5-dedicated-line1 [5-30s 480p ¥0.429/秒;720p ¥0.539/秒]"],
        "promptMax": 12000,
        "provider": "zhiying",
        "summary": "480p / 720p · 5–30 秒 · ¥0.429/秒 起",
        "resolutions": [
            "480",
            "720"
        ],
        "duration": {
            "min": 5,
            "max": 30
        },
        "ratios": [
            "16:9",
            "9:16",
            "1:1",
            "4:3",
            "3:4",
            "21:9"
        ],
        "defaultResolution": "720",
        "defaultSeconds": 5,
        "modes": [
            "reference"
        ],
        "referenceLimits": {
            "images": 30,
            "videos": 10,
            "audios": 10
        },
        "priceLines": [
            "480p：¥0.429/秒",
            "720p：¥0.539/秒"
        ],
        "notes": [
            "提示词最多 12000 字符。",
            "该模型仅支持参考素材模式，不支持固定首尾帧或带时间戳的关键帧。",
            "支持上传本地参考素材，不直接接收远程素材链接。",
            "费用按实际积分用量结算，所列为已含 10% 加价的基础售价。",
            "有参考视频时需提供真实参考视频总秒数，不得以生成时长替代。"
        ]
    },
    ...[
        { id: "seedance-2.0-mini-discount", max: 15, price: "0.858" },
        { id: "seedance-2.0-fast-discount", max: 15, price: "1.078" },
        { id: "seedance-2.0-discount", max: 15, price: "1.738" },
        { id: "seedance-2.5-discount2", max: 30, price: "3.938" },
        { id: "seedance-2.5-discount", max: 30, price: "5.478" },
    ].map(({ id, max, price }): VideoModelInfo => ({
        id,
        aliases: [`${id} [720p 4-${max}s ¥${price}/条]`],
        provider: "zhiying",
        summary: `720p · 4–${max} 秒 · ¥${price}/条`,
        promptMax: 10000,
        resolutions: ["720"],
        duration: { min: 4, max },
        ratios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
        defaultResolution: "720",
        defaultSeconds: max,
        modes: ["reference"],
        referenceLimits: { images: 9, videos: 0, audios: 0, total: 9 },
        referenceFileMaxBytes: { image: 30 * 1024 * 1024, video: 0, audio: 0 },
        priceLines: [`720p：¥${price}/条`],
        notes: [
            "提示词最多 10000 字符；支持文生视频和最多 9 张参考图片。",
            "不支持固定首尾帧、参考视频或参考音频，请使用参考素材模式。",
            "参考图片按实际内容读取并无损处理后上传，单张上限 30 MiB；不会降低原图分辨率。",
            "费用按实际结算，所列为已含 10% 加价的售价。",
        ],
        audio: "unsupported",
        watermark: "unsupported",
    }))
];
