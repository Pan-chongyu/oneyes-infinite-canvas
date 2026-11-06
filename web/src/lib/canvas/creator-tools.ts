import type { CanvasNodeData, CanvasConnection } from "@/types/canvas";
import type { CreatorTool } from "@/types/creator-tools";

export const creatorTools = {
    board: { title: '拼图与分镜板', action: '生成分镜板', input: 'image', description: '按顺序排列原图，添加编号和说明，导出 PNG' },
    color: { title: '调色与色彩匹配', action: '输出调色图片', input: 'image', description: '调整曝光、对比度、色温，匹配参考图片色调' },
    mix: { title: '视频配乐与混音', action: '输出混音视频', input: 'video', description: '混入旁白与配乐，调整音量和淡入淡出，保留原尺寸' },
    analyze: { title: "视频拉片", action: "开始拉片", input: "video", description: "检测切镜，提取原尺寸关键帧、分镜和原音轨" },
    concat: { title: "视频拼接", action: "合并视频", input: "video", description: "按顺序拼接，可单独截取每段视频" },
    cutout: { title: "智能抠图", action: "开始抠图", input: "image", description: "U²-Netp 本地识别主体，输出原尺寸透明 PNG" },
    compose: { title: "图层合成", action: "合成图片", input: "image", description: "按图层叠放，调整位置、缩放、透明度和混合模式" },
    superResolution: { title: "AI 超分", action: "AI 超分 3×", input: "image", description: "ESPCN 本地 AI 增强，输出宽高均为原图 3 倍" },
    videoSuperResolution: { title: "视频 AI 超采样", action: "开始超采样", input: "video", description: "内置 ESPCN 逐帧增强，输出 2× 或 3× 视频，保留时间轴和全部音轨" },
} satisfies Record<CreatorTool, { title: string; action: string; input: "image" | "video"; description: string }>;
export function creatorTool(type: string): CreatorTool | undefined {
    const key = type.startsWith("creator-tools:") ? type.slice("creator-tools:".length) : "";
    return Object.hasOwn(creatorTools, key) ? key as CreatorTool : undefined;
}
export function creatorSources(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]): CanvasNodeData[] {
    const tool = creatorTool(node.type);
    if (!tool) throw new Error("未知的创作工具");
    const ids = node.metadata?.creatorSettings?.sourceIds ?? connections.filter(link => link.toNodeId === node.id).map(link => link.fromNodeId);
    if (!Array.isArray(ids) || !ids.length) throw new Error("请先选择素材，或将素材节点连入此节点");
    const selected = [...new Set(ids)].map(id => {
        const source = nodes.find(item => item.id === id);
        if (!source || source.type !== creatorTools[tool].input && !(tool === 'mix' && source.type === 'audio')) throw new Error("所选素材已删除或类型不匹配，请重新选择");
        return source;
    });
    if (!["compose", "concat", "board", "mix"].includes(tool) && selected.length !== 1) throw new Error("此工具每次处理一份素材，请选择一个节点");
    if(tool==='mix' && (selected[0]?.type!=='video'||selected.slice(1).some(node=>node.type!=='audio')))throw Error('请先选一个视频，再按顺序添加旁白或配乐');
    return selected;
}
