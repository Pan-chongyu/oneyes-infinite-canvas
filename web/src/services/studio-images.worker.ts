import type { CreatorSettings } from "@/types/creator-tools";
self.onmessage = async ({ data }: MessageEvent<{ tool: "board" | "color"; blobs: Blob[]; settings: CreatorSettings; titles: string[] }>) => {
    const frames: ImageBitmap[] = [];
    try {
        for (const blob of data.blobs) frames.push(await createImageBitmap(blob));
        if (!frames.length) throw Error("请先选择原始图片");
        const settings = data.settings;
        let canvas: OffscreenCanvas;
        if (data.tool === "board") {
            const columns = settings.columns ?? Math.ceil(Math.sqrt(frames.length)),
                gap = settings.gap ?? 24;
            if (!Number.isSafeInteger(columns) || columns < 1 || !Number.isSafeInteger(gap) || gap < 0) throw Error("请填写有效的列数和间距");
            const w = Math.max(...frames.map((frame) => frame.width)),
                h = Math.max(...frames.map((frame) => frame.height)),
                caption = settings.labels === false ? 0 : 64;
            canvas = new OffscreenCanvas(columns * w + (columns + 1) * gap, Math.ceil(frames.length / columns) * (h + caption) + (Math.ceil(frames.length / columns) + 1) * gap);
            const ctx = canvas.getContext("2d");
            if (!ctx) throw Error("无法创建分镜板");
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.font = "24px sans-serif";
            ctx.textBaseline = "top";
            frames.forEach((frame, i) => {
                const x = gap + (i % columns) * (w + gap),
                    y = gap + Math.floor(i / columns) * (h + caption + gap);
                ctx.drawImage(frame, x + (w - frame.width) / 2, y + (h - frame.height) / 2);
                if (caption) {
                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(x, y + h, w, caption);
                    ctx.clip();
                    ctx.fillStyle = "#222222";
                    ctx.fillText(`${i + 1}. ${data.titles[i]}`, x, y + h + 16);
                    ctx.restore();
                }
            });
        } else {
            const frame = frames[0];
            canvas = new OffscreenCanvas(frame.width, frame.height);
            const ctx = canvas.getContext("2d");
            if (!ctx) throw Error("无法创建调色画布");
            ctx.drawImage(frame, 0, 0);
            const pixels = ctx.getImageData(0, 0, frame.width, frame.height),
                values = pixels.data;
            const exposure = settings.exposure ?? 0,
                contrast = settings.contrast ?? 1,
                temperature = settings.temperature ?? 0;
            if (![exposure, contrast, temperature].every(Number.isFinite) || contrast < 0) throw Error("调色参数无效");
            const mean = (pixels: Uint8ClampedArray) => {
                const total = [0, 0, 0];
                let count = 0;
                for (let i = 0; i < pixels.length; i += 4) {
                    const a = pixels[i + 3] / 255;
                    count += a;
                    for (let c = 0; c < 3; c++) total[c] += pixels[i + c] * a;
                }
                return total.map((n) => n / (count || 1));
            };
            let scale = [1, 1, 1];
            if (frames[1]) {
                const sample = new OffscreenCanvas(frames[1].width, frames[1].height),
                    ref = sample.getContext("2d")!;
                ref.drawImage(frames[1], 0, 0);
                const source = mean(values),
                    target = mean(ref.getImageData(0, 0, sample.width, sample.height).data);
                scale = target.map((v, c) => (source[c] > 0 ? v / source[c] : 1));
            }
            for (let i = 0; i < values.length; i += 4) for (let c = 0; c < 3; c++) values[i + c] = (values[i + c] * scale[c] * 2 ** exposure - 127.5) * contrast + 127.5 + (c === 0 ? temperature : c === 2 ? -temperature : 0);
            ctx.putImageData(pixels, 0, 0);
        }
        if (canvas.width < 1 || canvas.height < 1) throw Error("无法分配指定画布尺寸，不会自动降低分辨率");
        self.postMessage({ blob: await canvas.convertToBlob({ type: "image/png" }) });
    } catch (error) {
        self.postMessage({ error: error instanceof Error ? error.message : "无法处理原图，请释放内存后重试；不会降低分辨率" });
    } finally {
        frames.forEach((frame) => frame.close());
    }
};
