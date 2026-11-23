import { imageUpscalePrompt, validateUpscaleSize } from "@/lib/image-upscale";
import { buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { resolveModelRequestConfig, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import { uploadImage } from "@/services/image-storage";
import type { CreatorSettings } from "@/types/creator-tools";

/** Prepare a single reference edit; no request or automatic fallback occurs here. */
export async function prepareModelUpscale(base: AiConfig, settings: CreatorSettings, blob: Blob, signal: AbortSignal) {
    const config = { ...buildGenerationConfig(base, undefined, "image"), count: "1", size: settings.upscaleSize || "", quality: "high" };
    if (settings.upscaleModel) config.model = settings.upscaleModel;
    if (!selectableModelsByCapability(base, "image").includes(config.model)) throw new Error("请选择当前 Key 下可用的生图模型，不会自动更换模型。");
    const request = resolveModelRequestConfig(config, config.model);
    if (!request.apiKey.trim()) throw new Error("该模型尚未配置 API Key，请先完成模型配置。");
    const bitmap = await createImageBitmap(blob);
    let dimensions: { width: number; height: number };
    try { dimensions = validateUpscaleSize(config.size, request.apiFormat, bitmap); } finally { bitmap.close(); }
    signal.throwIfAborted();
    // A durable snapshot prevents a source replacement/deletion changing this paid request's reference.
    const original = await uploadImage(blob, { signal });
    if (!original.storageKey) throw new Error("无法保存参考原图，已停止提交，请释放本机存储后重试。");
    return { config, prompt: imageUpscalePrompt(dimensions, settings.upscalePrompt), references: [{ id: "upscale-original", name: "超分参考原图.png", type: original.mimeType, dataUrl: original.url, storageKey: original.storageKey }] };
}
