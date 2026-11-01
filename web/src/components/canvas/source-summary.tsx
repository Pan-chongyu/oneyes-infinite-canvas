import { useEffect, useSyncExternalStore } from "react";
import { FileText, Image, Music2, Video } from "lucide-react";
import { ensureImagePreview, getImagePreviewRevision, previewUrlFor, subscribeImagePreviews } from "@/services/image-storage";
import type { CanvasNodeData } from "@/types/canvas";

export function SourceSummary({ node }: { node: CanvasNodeData }) {
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const image = node.type === "image" ? node.metadata?.images?.find((item) => item.id === node.metadata?.primaryImageId) : undefined;
    const key = image?.storageKey || node.metadata?.storageKey;
    useEffect(() => {
        if (node.type === "image") void ensureImagePreview(key);
    }, [node.type, key]);
    const url = node.type === "image" ? previewUrlFor(key) : undefined;
    const Icon = node.type === "image" ? Image : node.type === "video" ? Video : node.type === "audio" ? Music2 : FileText;
    const width = image?.naturalWidth || node.metadata?.naturalWidth,
        height = image?.naturalHeight || node.metadata?.naturalHeight;
    return (
        <span className="flex min-w-0 flex-1 items-center gap-2" data-source-summary={node.id}>
            {url ? <img src={url} alt="" loading="lazy" className="size-8 shrink-0 rounded object-contain" /> : <Icon size={17} className="mx-1.5 shrink-0" />}
            <span className="min-w-0">
                <span className="block truncate text-xs" title={node.title}>
                    {node.title}
                </span>
                <span className="block text-[11px] opacity-70">
                    {width && height ? `${width} × ${height}` : node.type === "text" ? "文本" : node.type === "studio:reference" ? "角色与风格" : node.type === "audio" ? "音频" : node.type === "video" ? "视频" : "图片"}
                </span>
            </span>
        </span>
    );
}
