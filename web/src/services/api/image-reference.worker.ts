import { fileTypeFromBuffer } from "file-type/core";
import encode, { init } from "@jsquash/webp/encode";
import wasm from "@jsquash/webp/codec/enc/webp_enc.wasm?url";
import simdWasm from "@jsquash/webp/codec/enc/webp_enc_simd.wasm?url";

self.onmessage = async ({ data: source }: MessageEvent<Blob>) => {
    let bitmap: ImageBitmap | undefined;
    try {
        const type = await fileTypeFromBuffer(await source.arrayBuffer());
        bitmap = await createImageBitmap(new Blob([source], { type: type?.mime || source.type }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Image decoder unavailable");
        context.drawImage(bitmap, 0, 0);
        const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
        let blob: Blob;
        try {
            await init({ locateFile: (path: string) => path.includes("simd") ? simdWasm : wasm });
            // libwebp lossless: no resize, quantization, near-lossless or alpha loss.
            const bytes = await encode(pixels, { lossless: 1, exact: 1 });
            blob = new Blob([bytes], { type: "image/webp" });
        } catch {
            // PNG retains dimensions outside WebP's codec range as well. Never
            // shrink or switch to lossy compression to force a file to fit.
            blob = await canvas.convertToBlob({ type: "image/png" });
        }
        self.postMessage({ blob });
    } catch { self.postMessage({}); }
    finally { bitmap?.close(); }
};
