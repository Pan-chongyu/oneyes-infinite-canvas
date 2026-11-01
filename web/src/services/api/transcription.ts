import { buildApiUrl, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { validateCues } from "@/lib/canvas/studio";
import type { SubtitleCue } from "@/types/studio";

export async function transcribeAudio(config: AiConfig, blob: Blob, model: string, signal?: AbortSignal): Promise<SubtitleCue[]> {
    if (!model.trim()) throw Error("请先选择或填写支持时间戳的语音识别模型");
    const target = resolveModelRequestConfig(config, model);
    if (!target.apiKey || target.apiFormat === "gemini") throw Error("请配置 OpenAI 兼容的语音识别接口和 Key");
    const body = new FormData();
    body.append("file", blob, "speech.wav");
    body.append("model", target.model);
    body.append("response_format", "verbose_json");
    body.append("timestamp_granularities[]", "segment");
    const response = await fetch(buildApiUrl(target.baseUrl, "/audio/transcriptions"), { method: "POST", headers: { Authorization: `Bearer ${target.apiKey}` }, body, signal });
    if (!response.ok)
        throw Error(
            response.status === 404
                ? "当前接口不支持语音识别，请选择已开通的识别模型"
                : response.status === 401 || response.status === 403
                  ? "语音识别未获授权，请检查 Key 和分组权限"
                  : `语音识别失败（HTTP ${response.status}），请检查模型、额度或网络后手动重试`,
        );
    const value = await response.json().catch(() => null);
    if (!Array.isArray(value?.segments) || value.segments.some((item: unknown) => !item || typeof item !== "object")) throw Error("模型未返回字幕时间戳，请选择支持 verbose_json 和 segment 时间戳的识别模型");
    return validateCues(value.segments.map((item: { start: number; end: number; text: string; speaker?: unknown }) => ({ start: item.start, end: item.end, text: item.text, ...(typeof item.speaker === "string" ? { speaker: item.speaker } : {}) })));
}
