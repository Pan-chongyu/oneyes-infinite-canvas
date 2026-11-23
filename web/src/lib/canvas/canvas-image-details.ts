import { CanvasNodeType, type CanvasNodeData } from '@/types/canvas';

export function detailImages(node: CanvasNodeData) {
    if (node.type !== CanvasNodeType.Image) return [];
    const images = node.metadata?.images?.filter(image => image.content || image.storageKey) || [];
    if (images.length) return images;
    const data = node.metadata;
    return data?.content || data?.storageKey ? [{ id: node.id, content: data.content || '', storageKey: data.storageKey, naturalWidth: data.naturalWidth || 0, naturalHeight: data.naturalHeight || 0, bytes: data.bytes || 0, mimeType: data.mimeType || '', resolutionWarning: data.resolutionWarning }] : [];
}

export function detailImageIndex(node: CanvasNodeData, imageId?: string | null) {
    const images = detailImages(node), index = images.findIndex(image => image.id === (imageId || node.metadata?.primaryImageId));
    return Math.max(0, index);
}

export function imageAspectRatio(width: number, height: number) {
    if (!(width > 0 && height > 0)) return '';
    let a = width, b = height;
    while (b) [a, b] = [b, a % b];
    return `${width / a}:${height / a}`;
}
