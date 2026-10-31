import * as ort from "onnxruntime-web/wasm";
import wasm from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import mjs from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";

// All inference assets are packaged locally. Terminating this worker cancels inference too.
ort.env.wasm.wasmPaths = { wasm, mjs };
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
const models = {
    cutout: { file: "u2netp.onnx", sha256: "309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8" },
    superResolution: { file: "espcn-3x.onnx", sha256: "85f36ff88cc504a24af5e0602148bc56a8aa09a58eca8c0da2756f3e8186035e" },
};
const progress = (stage: string, value?: number) => self.postMessage({ stage, progress: value });
function surface(width: number, height: number) {
    const canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("当前设备无法创建原尺寸图像，请关闭部分应用释放内存后重试");
    return { canvas, ctx };
}
const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

async function cutout(bitmap: ImageBitmap, session: ort.InferenceSession) {
    const side = 320, area = side * side;
    const sample = surface(side, side);
    sample.ctx.drawImage(bitmap, 0, 0, side, side);
    const rgb = sample.ctx.getImageData(0, 0, side, side).data;
    let maximum = 0;
    for (let i = 0; i < rgb.length; i += 4) maximum = Math.max(maximum, rgb[i], rgb[i + 1], rgb[i + 2]);
    const tensor = new Float32Array(3 * area), means = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
    for (let i = 0; i < area; i++) for (let c = 0; c < 3; c++) tensor[c * area + i] = (rgb[i * 4 + c] / (maximum || 255) - means[c]) / std[c];
    progress("U²-Netp 正在识别主体");
    const prediction = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", tensor, [1, 3, side, side]) });
    const output = prediction[session.outputNames[0]].data as Float32Array;
    if (output.length !== area) throw new Error("抠图模型输出尺寸异常");
    let low = Infinity, high = -Infinity;
    for (const value of output) { low = Math.min(low, value); high = Math.max(high, value); }
    if (!Number.isFinite(low) || !Number.isFinite(high)) throw new Error("抠图模型返回无效蒙版");
    const mask = sample.ctx.createImageData(side, side);
    for (let i = 0; i < area; i++) {
        const value = clamp((high > low ? (output[i] - low) / (high - low) : output[i]) * 255);
        mask.data.set([value, value, value, 255], i * 4);
    }
    sample.ctx.putImageData(mask, 0, 0);
    const result = surface(bitmap.width, bitmap.height);
    result.ctx.drawImage(sample.canvas, 0, 0, bitmap.width, bitmap.height);
    const alpha = result.ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    result.ctx.clearRect(0, 0, bitmap.width, bitmap.height);
    result.ctx.drawImage(bitmap, 0, 0);
    const pixels = result.ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    for (let i = 0; i < pixels.data.length; i += 4) pixels.data[i + 3] = clamp(pixels.data[i + 3] * alpha[i] / 255);
    result.ctx.putImageData(pixels, 0, 0);
    return result.canvas.convertToBlob({ type: "image/png" });
}

async function superResolution(bitmap: ImageBitmap, session: ort.InferenceSession) {
    const scale = 3;
    const source = surface(bitmap.width, bitmap.height);
    source.ctx.drawImage(bitmap, 0, 0);
    const result = surface(bitmap.width * scale, bitmap.height * scale);
    // ESPCN predicts luminance. Chroma and alpha retain the source content with smooth sampling.
    result.ctx.drawImage(bitmap, 0, 0, result.canvas.width, result.canvas.height);
    const rgb = source.ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    // Overlapping tiles bound inference working memory, never the user's input dimensions.
    // ESPCN's 5/3/3 kernels have a four-pixel receptive-field radius.
    // The published ESPCN model has a fixed 224 × 224 input. Pad edge tiles;
    // do not resize the source to the model input or cap the source dimensions.
    const side = 224, overlap = 4, tile = side - 2 * overlap;
    const total = Math.ceil(bitmap.width / tile) * Math.ceil(bitmap.height / tile);
    let completed = 0;
    for (let y = 0; y < bitmap.height; y += tile) for (let x = 0; x < bitmap.width; x += tile) {
        const input = new Float32Array(side * side);
        for (let dy = 0; dy < side; dy++) for (let dx = 0; dx < side; dx++) {
            const sx = Math.max(0, Math.min(bitmap.width - 1, x - overlap + dx));
            const sy = Math.max(0, Math.min(bitmap.height - 1, y - overlap + dy));
            const i = (sy * bitmap.width + sx) * 4;
            input[dy * side + dx] = (0.299 * rgb[i] + 0.587 * rgb[i + 1] + 0.114 * rgb[i + 2]) / 255;
        }
        progress(`ESPCN 3× 正在增强细节 · ${completed + 1} / ${total}`, completed / total * 100);
        const prediction = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", input, [1, 1, side, side]) });
        const output = prediction[session.outputNames[0]];
        if (output.dims[2] !== side * scale || output.dims[3] !== side * scale) throw new Error("超分模型输出倍率不一致，已停止处理");
        const w = Math.min(tile, bitmap.width - x) * scale, h = Math.min(tile, bitmap.height - y) * scale;
        const pixels = result.ctx.getImageData(x * scale, y * scale, w, h);
        const values = output.data as Float32Array;
        for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
            const index = (dy * w + dx) * 4;
            const luminance = values[(overlap * scale + dy) * side * scale + overlap * scale + dx] * 255;
            const r = pixels.data[index], g = pixels.data[index + 1], b = pixels.data[index + 2];
            const cb = -0.168736 * r - 0.331264 * g + 0.5 * b;
            const cr = 0.5 * r - 0.418688 * g - 0.081312 * b;
            pixels.data[index] = clamp(luminance + 1.402 * cr);
            pixels.data[index + 1] = clamp(luminance - 0.344136 * cb - 0.714136 * cr);
            pixels.data[index + 2] = clamp(luminance + 1.772 * cb);
        }
        result.ctx.putImageData(pixels, x * scale, y * scale);
        completed++;
    }
    return result.canvas.convertToBlob({ type: "image/png" });
}

self.onmessage = async ({ data }: MessageEvent<{ operation: keyof typeof models; blob: Blob }>) => {
    let bitmap: ImageBitmap | undefined, session: ort.InferenceSession | undefined;
    try {
        const model = models[data.operation];
        if (!model) throw new Error("未知的本地图像处理方式");
        progress("正在加载本地 AI 模型");
        const response = await fetch(new URL(`${import.meta.env.BASE_URL}models/${model.file}`, self.location.origin));
        if (!response.ok) throw new Error("本地 AI 模型缺失，请重新安装最新版");
        const bytes = await response.arrayBuffer();
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), value => value.toString(16).padStart(2, "0")).join("");
        if (digest !== model.sha256) throw new Error("本地 AI 模型校验失败，请重新安装最新版");
        session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
        bitmap = await createImageBitmap(data.blob);
        const blob = data.operation === "cutout" ? await cutout(bitmap, session) : await superResolution(bitmap, session);
        self.postMessage({ blob });
    } catch (error) {
        self.postMessage({ error: error instanceof Error ? error.message : "本地 AI 处理失败，请释放内存后重试" });
    } finally { bitmap?.close(); await session?.release(); }
};
