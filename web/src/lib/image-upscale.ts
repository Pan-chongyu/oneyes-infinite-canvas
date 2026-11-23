import { resolveGeminiImageConfig, resolveImageRequestSize } from "./image-request-size";
import { computeMediaSize, parseImageSizeSelection, parsePixelSize } from "./media-size";

export function validateUpscaleSize(size: string, format: string, source: { width: number; height: number }) {
    const selection = parseImageSizeSelection(size);
    const pixels = selection ? computeMediaSize(selection.scale, selection.ratio) : size;
    const dimensions = pixels && parsePixelSize(pixels);
    if (!dimensions) throw new Error("请先选择明确的输出分辨率与比例，或填写目标宽高；超分不使用自动尺寸。");
    if (format === "gemini") resolveGeminiImageConfig({ size });
    else resolveImageRequestSize(size);
    if (dimensions.width < source.width || dimensions.height < source.height) throw new Error(`目标尺寸小于原图 ${source.width}×${source.height}，请选择更大的分辨率；不会自动缩小原图。`);
    return dimensions;
}

export function imageUpscalePrompt(size: { width: number; height: number }, extra = "") {
    return `请对唯一的参考原图进行高保真超分辨率修复，输出 ${size.width}×${size.height} 像素。保持原图的构图、取景、人物身份、五官、文字内容、物体数量、材质和色彩一致；不裁剪、不拉伸、不增加或删除元素。清理压缩噪点与锯齿，恢复自然清晰的边缘和纹理，避免过度锐化、光晕、塑料皮肤和虚构细节。${extra.trim() ? `\n用户的细节要求：${extra.trim()}` : ""}`;
}

/** Reflection excludes a duplicate boundary pixel (reflect-101), including 1px images. */
export function reflectPixel(index: number, length: number) {
    if (length <= 1) return 0;
    const period = 2 * (length - 1), value = ((index % period) + period) % period;
    return value < length ? value : period - value;
}

/** Fit chroma to the predicted Y gamut without independently clipping RGB hues. */
export function restoreLuminance(y: number, r: number, g: number, b: number, pixels: Uint8ClampedArray, index: number) {
    if (!Number.isFinite(y)) throw new Error("超分模型返回无效像素，已停止处理");
    const luminance = Math.max(0, Math.min(255, y));
    const baseline = 0.299 * r + 0.587 * g + 0.114 * b;
    const cr = r - baseline, cg = g - baseline, cb = b - baseline;
    let saturation = 1;
    if (cr > 0) saturation = Math.min(saturation, (255 - luminance) / cr);
    if (cg > 0) saturation = Math.min(saturation, (255 - luminance) / cg);
    if (cb > 0) saturation = Math.min(saturation, (255 - luminance) / cb);
    if (cr < 0) saturation = Math.min(saturation, -luminance / cr);
    if (cg < 0) saturation = Math.min(saturation, -luminance / cg);
    if (cb < 0) saturation = Math.min(saturation, -luminance / cb);
    pixels[index] = Math.round(luminance + cr * saturation);
    pixels[index + 1] = Math.round(luminance + cg * saturation);
    pixels[index + 2] = Math.round(luminance + cb * saturation);
}
