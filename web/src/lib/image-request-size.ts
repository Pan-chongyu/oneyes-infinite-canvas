import { computeMediaSize, imageSizePresets, parseAspectRatio, parseImageSizeSelection, parsePixelSize } from "./media-size";

const geminiRatios = ["1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9"];

/** Preserve exact pixels; these are the existing GPT Image protocol constraints. */
export function resolveImageRequestSize(size: string): string | undefined {
    const value = String(size || "").trim();
    const selection = parseImageSizeSelection(value);
    if (selection?.ratio === "auto" && selection.scale !== "auto") throw new Error("固定生图分辨率需要选择图片比例，请选择比例后生成；不会自动降低分辨率。");
    const selected = selection ? computeMediaSize(selection.scale, selection.ratio) : value;
    if (selection && selected === undefined) throw new Error("当前分辨率没有该比例的尺寸预设，请选择支持的比例或填写精确宽高。");
    if (!selected || selected.toLowerCase() === "auto") return undefined;
    let dimensions = parsePixelSize(selected);
    if (!dimensions) {
        const ratio = parseAspectRatio(selected);
        if (!ratio) throw new Error("图片尺寸格式不正确，请选择分辨率和比例，或填写宽×高。");
        const preset = imageSizePresets["1k"][selected];
        const longSide = Math.round(1024 * Math.max(ratio.width, ratio.height) / Math.min(ratio.width, ratio.height) / 16) * 16;
        dimensions = preset ? parsePixelSize(preset)! : ratio.width >= ratio.height ? { width: longSide, height: 1024 } : { width: 1024, height: longSide };
    }
    const { width, height } = dimensions;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) throw new Error("图片宽高必须是正整数。");
    if (width % 16 || height % 16) throw new Error("当前生图接口要求宽高为 16 的倍数，请手动调整尺寸后生成。");
    if (Math.max(width, height) > 3840 || Math.max(width, height) / Math.min(width, height) > 3 || width * height < 655360 || width * height > 8294400) throw new Error(`当前生图接口不支持 ${width}×${height}：单边最大 3840、比例不超过 3:1、总像素 655360–8294400。请主动选择支持的尺寸；不会自动缩小。`);
    return `${width}x${height}`;
}

/** Native Gemini accepts a tier and ratio, not arbitrary pixel dimensions. */
export function resolveGeminiImageConfig(config: { size: string }) {
    const value = String(config.size || "").trim();
    if (!value || value.toLowerCase() === "auto") return {};
    const selection = parseImageSizeSelection(value);
    const dimensions = parsePixelSize(value);
    const legacyScale = dimensions && Object.keys(imageSizePresets).find(scale => Object.values(imageSizePresets[scale]).includes(`${dimensions.width}x${dimensions.height}`));
    if (dimensions && !legacyScale) throw new Error("Gemini 生图使用分辨率档位和比例，不支持任意像素尺寸。请选择 1K、2K 或 4K 后生成；不会近似转换尺寸。");
    const ratio = selection?.ratio || (dimensions ? Object.entries(imageSizePresets[legacyScale as string]).find(([, pixels]) => pixels === `${dimensions.width}x${dimensions.height}`)?.[0] : value);
    const scale = selection?.scale || legacyScale;
    if (ratio !== "auto" && !geminiRatios.includes(ratio || "")) throw new Error(`当前 Gemini 生图接口不支持 ${ratio} 比例，请手动选择支持的比例；不会自动改为邻近比例。`);
    const image = { ...(ratio && ratio !== "auto" ? { aspectRatio: ratio } : {}), ...(scale && scale !== "auto" ? { imageSize: scale.toUpperCase() } : {}) };
    return Object.keys(image).length ? { imageConfig: image } : {};
}

export function imageSizeMismatch(expected: string | undefined, image: { width: number; height: number }) {
    const pixels = expected && parsePixelSize(expected);
    return pixels && image.width > 0 && image.height > 0 && (pixels.width !== image.width || pixels.height !== image.height)
        ? `请求 ${pixels.width}×${pixels.height}，上游返回 ${image.width}×${image.height}。已保留原图，未缩放或重新生成。` : undefined;
}
