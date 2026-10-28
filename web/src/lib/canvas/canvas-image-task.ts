import type { ImageTask, ImageTaskTarget } from "@/services/api/image-tasks";
import type { UploadedImage } from "@/services/image-storage";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeImage } from "@/types/canvas";
import { fitNodeSize } from "./canvas-node-size";

export function markCanvasImageTask(nodes: CanvasNodeData[], target: ImageTaskTarget, id: string) {
    return nodes.map(node => node.id !== target.nodeId ? node : {
        ...node, metadata: { ...node.metadata, ...(target.imageId ? { images: node.metadata?.images?.map(image => image.id === target.imageId ? { ...image, imageTaskId: id } : image) } : { imageTaskId: id }) },
    });
}

export function failMissingCanvasImageTasks(node: CanvasNodeData, tasks: ReadonlyMap<string, ImageTask>, projectId: string): CanvasNodeData {
    if (node.type !== CanvasNodeType.Image || !node.metadata) return node;
    const images = node.metadata.images;
    const matches = (id?: string, imageId?: string) => {
        const task = id ? tasks.get(id) : undefined;
        return Boolean(task?.target?.projectId === projectId && task.target.nodeId === node.id && (task.target.imageId ? task.target.imageId === imageId : !imageId || images?.length === 1));
    };
    const missingNodeTask = Boolean(node.metadata.imageTaskId && !matches(node.metadata.imageTaskId));
    const missingImages = images?.some(image => image.imageTaskId ? !matches(image.imageTaskId, image.id) : image.status === "loading" && !matches(node.metadata?.imageTaskId, image.id));
    const orphanedNode = node.metadata.status === "loading" && !matches(node.metadata.imageTaskId) && !images?.some(image => matches(image.imageTaskId, image.id));
    if (!missingNodeTask && !missingImages && !orphanedNode) return node;
    const errorDetails = "本机缺少此生图任务记录，无法确认原任务结果。请先检查官网用量，勿直接重复生成。";
    const updatedImages = images?.map(image => {
        const linked = image.imageTaskId ? matches(image.imageTaskId, image.id) : matches(node.metadata?.imageTaskId, image.id);
        const missing = image.status === "loading" && !linked || Boolean(image.imageTaskId && !matches(image.imageTaskId, image.id));
        return missing ? { ...image, status: "error" as const, errorDetails } : image;
    });
    const status = updatedImages?.some(image => image.status === "loading") ? "loading" : node.metadata.content || updatedImages?.some(image => image.status === "success") ? "success" : "error";
    return { ...node, metadata: { ...node.metadata, images: updatedImages, status, errorDetails: status === "error" ? errorDetails : undefined } };
}

export function applyCanvasImageTask(node: CanvasNodeData, task: ImageTask, image?: UploadedImage): CanvasNodeData {
    if (node.id !== task.target?.nodeId) return node;
    const slot = task.target.imageId && node.metadata?.images?.find(item => item.id === task.target?.imageId);
    if ((task.target.imageId ? slot && slot.imageTaskId : node.metadata?.imageTaskId) !== task.id) return node;
    if (task.status === "submitting") return node;
    const terminal = ["failed", "uncertain", "paused", "credentials"].includes(task.status);
    const status = task.status === "completed" && image ? "success" : terminal ? "error" : "loading";
    const loadingMessage = status === "loading" ? task.expectedImages ? "图片已生成，正在取回…" : task.status === "waiting" ? "连接中断，正在重连…" : undefined : undefined;
    const fields = image && status === "success" ? { content: image.url, storageKey: image.storageKey, naturalWidth: image.width, naturalHeight: image.height, bytes: image.bytes, mimeType: image.mimeType } : {};
    const images = node.metadata?.images?.map(item => item.id === task.target?.imageId ? { ...item, ...fields, status, loadingMessage, errorDetails: task.error, ...(status === "success" ? { imageTaskId: undefined } : {}) } as CanvasNodeImage : item);
    const primary = !task.target.imageId || !node.metadata?.content || node.metadata?.primaryImageId === task.target.imageId;
    const aggregateStatus = images?.length ? images.some(item => item.status === "loading") ? "loading" : images.some(item => item.status === "success") ? "success" : "error" : status;
    const dimensions = image && primary && !node.metadata?.freeResize ? fitNodeSize(image.width, image.height, node.width, node.height) : {};
    return { ...node, ...dimensions, metadata: { ...node.metadata, ...(primary ? fields : {}), status: aggregateStatus, loadingMessage, errorDetails: aggregateStatus === "error" ? task.error : undefined, ...(task.target.imageId ? { images, ...(primary && status === "success" ? { primaryImageId: task.target.imageId } : {}) } : status === "success" ? { imageTaskId: undefined } : {}) } };
}
