import { nanoid } from "nanoid";
import type { CanvasNodeDefinition } from "@/types/canvas-plugin";
import type { CanvasAgentOp } from "./canvas-agent-ops";
import type { Position } from "@/types/canvas";

// UI guidance for bundled nodes; third-party nodes remain available under 扩展.
export const nodeCategories = ["全部", "基础", "策划", "图片", "音视频", "交付", "扩展"] as const;
type Category = (typeof nodeCategories)[number];
const entries: Record<string, [Category, string, string?]> = {
    text: ["基础", "文字 → 提示词"],
    image: ["基础", "提示词／参考图 → 图片"],
    video: ["基础", "提示词／参考图 → 视频"],
    audio: ["基础", "提示词 → 音频"],
    config: ["基础", "统一生成参数"],
    group: ["基础", "整理画布素材"],
    "studio:storyboard": ["策划", "故事文本 → 分镜脚本", "故事 脚本 镜头 storyboard"],
    "studio:decision": ["策划", "文本／标准 → 选择、评分与判断", "jev typesafe 决策 分类 概率 判断 score choice noul"],
    "studio:reference": ["策划", "图片／角色说明 → 生成参考", "角色 一致性 风格 reference"],
    "studio:batch": ["策划", "多条提示词／参考图 → 图片", "批处理 队列 batch"],
    "studio:compare": ["图片", "多张原图 → 精选图片", "对照 滑动 compare"],
    "studio:ocr": ["图片", "图片 → 文字", "识字 ocr"],
    "studio:subtitles": ["音视频", "视频／音频 → SRT／字幕视频", "字幕 转写 captions srt"],
    "smart-edit:editor": ["音视频", "素材／字幕／脚本 → 智能剪辑成片", "自动剪辑 口播 去静音 选片 集锦 混剪 smart edit"],
    "studio:export": ["交付", "原始素材／参数 → ZIP", "打包 下载 export"],
    "creator-tools:board": ["图片", "多张原图 → 拼图 PNG", "分镜 排版 contact sheet"],
    "creator-tools:color": ["图片", "图片／参考色调 → 原尺寸图片", "曝光 对比度 色温 color"],
    "creator-tools:cutout": ["图片", "图片 → 透明 PNG", "移除背景 cutout"],
    "creator-tools:compose": ["图片", "多张图片 → 图层合成", "叠加 混合 compose"],
    "creator-tools:superResolution": ["图片", "图片 → 3 倍 AI 超分", "放大 增强 upscale"],
    "creator-tools:analyze": ["音视频", "视频 → 镜头表／关键帧／音轨", "拆镜 分析 analyze"],
    "creator-tools:concat": ["音视频", "多段视频 → 拼接视频", "剪辑 合并 concat"],
    "creator-tools:mix": ["音视频", "视频／配乐 → 混音视频", "旁白 音量 mix"],
    "director:stage": ["策划", "3D 场景 → 取景／深度／蒙版", "导演 构图 director 3d"],
};
export const nodeLibraryInfo = (type: string) => {
    const [category, flow, keywords] = entries[type] || ["扩展", "自定义扩展节点"];
    return { category, flow, keywords: keywords || "" };
};
export function filterLibraryNodes(defs: CanvasNodeDefinition[], query: string, category: Category) {
    const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return defs.filter((def) => {
        const info = nodeLibraryInfo(def.type);
        const text = `${def.title} ${def.type} ${def.description || ""} ${info.flow} ${info.keywords}`.toLocaleLowerCase();
        return (category === "全部" || category === info.category) && terms.every((term) => text.includes(term));
    });
}

export const workflowTemplates = [
    {
        id: "smart-edit", title: "智能剪辑", description: "连接视频、脚本与配乐，分析后编辑片段并输出成片",
        types: ["video", "text", "audio", "smart-edit:editor"],
        positions: [[0, 0], [0, 300], [0, 500], [430, 0]],
        links: [[0, 3], [1, 3], [2, 3]],
    },
    {
        id: "reference",
        title: "角色参考生图",
        description: "填写角色与风格，生成图片后对比精选",
        types: ["studio:reference", "image", "studio:compare"],
        positions: [
            [0, 0],
            [430, 0],
            [860, 0],
        ],
        links: [
            [0, 1],
            [1, 2],
        ],
    },
    {
        id: "story",
        title: "故事分镜",
        description: "从故事拆分镜头，再转成串行批量任务",
        types: ["text", "studio:storyboard"],
        positions: [
            [0, 0],
            [430, 0],
        ],
        links: [[0, 1]],
    },
    {
        id: "image",
        title: "图片后期",
        description: "放入原图，分别抠图、调色与排版",
        types: ["image", "creator-tools:cutout", "creator-tools:color", "creator-tools:board"],
        positions: [
            [0, 240],
            [430, 0],
            [430, 270],
            [430, 540],
        ],
        links: [
            [0, 1],
            [0, 2],
            [0, 3],
        ],
    },
    {
        id: "video",
        title: "视频字幕配乐",
        description: "放入视频与配乐，分别识别字幕和混音",
        types: ["video", "audio", "studio:subtitles", "creator-tools:mix"],
        positions: [
            [0, 0],
            [0, 360],
            [430, 0],
            [430, 340],
        ],
        links: [
            [0, 2],
            [0, 3],
            [1, 3],
        ],
    },
] as const;
export function createWorkflowOps(id: string, position: Position): CanvasAgentOp[] {
    const template = workflowTemplates.find((item) => item.id === id);
    if (!template) throw Error("未找到创作模板");
    const ids = template.types.map(() => nanoid());
    return [
        ...template.types.map((nodeType, index): CanvasAgentOp => ({ type: "add_node", id: ids[index], nodeType, position: { x: position.x + template.positions[index][0], y: position.y + template.positions[index][1] } })),
        ...template.links.map(([from, to]): CanvasAgentOp => ({ type: "connect_nodes", fromNodeId: ids[from], toNodeId: ids[to] })),
        { type: "select_nodes", ids },
    ];
}
