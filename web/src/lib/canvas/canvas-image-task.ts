import type { ImageTask, ImageTaskTarget } from "@/services/api/image-tasks";
import type { UploadedImage } from "@/services/image-storage";
import type { CanvasNodeData, CanvasNodeImage } from "@/types/canvas";
import { fitNodeSize } from "./canvas-node-size";

export function markCanvasImageTask(nodes: CanvasNodeData[], target: ImageTaskTarget, id: string) {
    return nodes.map(node => node.id !== target.nodeId ? node : {
        ...node, metadata: { ...node.metadata, ...(target.imageId ? { images: node.metadata?.images?.map(image => image.id === target.imageId ? { ...image, imageTaskId: id } : image) } : { imageTaskId: id }) },
    });
}

export function applyCanvasImageTask(node: CanvasNodeData, task: ImageTask, image?: UploadedImage): CanvasNodeData {
    if (node.id !== task.target?.nodeId) return node;
    const slot = task.target.imageId && node.metadata?.images?.find(item => item.id === task.target?.imageId);
    if ((task.target.imageId ? slot && slot.imageTaskId : node.metadata?.imageTaskId) !== task.id) return node;
    if (task.status === "submitting") return node;
    const terminal = ["failed", "uncertain", "paused", "credentials"].includes(task.status);
    const status = task.status === "completed" && image ? "success" : terminal ? "error" : "loading";
    const fields = image && status === "success" ? { content: image.url, storageKey: image.storageKey, naturalWidth: image.width, naturalHeight: image.height, bytes: image.bytes, mimeType: image.mimeType } : {};
    const images = node.metadata?.images?.map(item => item.id === task.target?.imageId ? { ...item, ...fields, status, errorDetails: task.error, ...(status === "success" ? { imageTaskId: undefined } : {}) } as CanvasNodeImage : item);
    const primary = !task.target.imageId || !node.metadata?.content || node.metadata?.primaryImageId === task.target.imageId;
    const aggregateStatus = images?.length ? images.some(item => item.status === "loading") ? "loading" : images.some(item => item.status === "success") ? "success" : "error" : status;
    const dimensions = image && primary && !node.metadata?.freeResize ? fitNodeSize(image.width, image.height, node.width, node.height) : {};
    return { ...node, ...dimensions, metadata: { ...node.metadata, ...(primary ? fields : {}), status: aggregateStatus, errorDetails: aggregateStatus === "error" ? task.error : undefined, ...(task.target.imageId ? { images, ...(primary && status === "success" ? { primaryImageId: task.target.imageId } : {}) } : status === "success" ? { imageTaskId: undefined } : {}) } };
}
