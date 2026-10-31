import type { CreatorLayer } from "@/types/creator-tools";

self.onmessage = async ({ data }: MessageEvent<{ blobs: Blob[]; layers: CreatorLayer[] }>) => {
    const frames: ImageBitmap[] = [];
    try {
        if (!data.blobs.length) throw new Error("请先选择图片图层");
        for (const blob of data.blobs) frames.push(await createImageBitmap(blob));
        const canvas = new OffscreenCanvas(frames[0].width, frames[0].height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("当前设备无法创建图层画布");
        for (const [index, frame] of frames.entries()) {
            const layer = data.layers[index] || {};
            const values = [layer.x ?? 0, layer.y ?? 0, layer.scale ?? 1, layer.opacity ?? 1];
            if (values.some(value => !Number.isFinite(value)) || values[2] <= 0 || values[3] < 0 || values[3] > 1) throw new Error("请填写有效的图层位置、缩放和透明度");
            if (layer.blend && !["source-over", "multiply", "screen"].includes(layer.blend)) throw new Error("不支持的图层混合模式");
            context.globalAlpha = values[3];
            context.globalCompositeOperation = layer.blend || "source-over";
            context.drawImage(frame, values[0], values[1], frame.width * values[2], frame.height * values[2]);
        }
        self.postMessage({ blob: await canvas.convertToBlob({ type: "image/png" }) });
    } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : "图层合成失败，请释放内存后重试" }); }
    finally { frames.forEach(frame => frame.close()); }
};
