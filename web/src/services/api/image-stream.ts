import { createParser } from "eventsource-parser";

export type ImagePayload = { data: Array<Record<string, unknown>> };
type Options = { signal?: AbortSignal; timeoutMs: number; onPartial?: (image: string) => void };
export function isOneYes(baseUrl: string) {
    try { return new URL(baseUrl).origin === "https://api.oneyes.ai"; } catch { return false; }
}
function failure(status: number) {
    if (status === 524) return "OneYes 上游响应超时（524）。请先在用量记录中确认结果，再手动重试，避免重复扣费。";
    if (status === 401 || status === 403) return "OneYes API Key 无效或当前分组无权使用此模型，请打开「配置 → 连接诊断」检查 Key 是否被删除，并修复连接。";
    if (status === 429) return "OneYes 请求过于频繁，请稍后再试。";
    return `OneYes 生图请求失败（HTTP ${status}），请检查渠道和模型。`;
}
// Image generation must never be replayed automatically: a disconnected request
// may already have been billed. Only completed events become persisted results.
export async function requestImageStream(url: string, body: Record<string, unknown> | FormData, headers: Record<string, string>, options: Options): Promise<ImagePayload> {
    const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(options.timeoutMs)]);
    const multipart = body instanceof FormData;
    if (multipart) { body.set("stream", "true"); body.set("partial_images", "2"); }
    const response = await fetch(url, {
        method: "POST", headers: { ...headers, Accept: "text/event-stream", ...(!multipart ? { "Content-Type": "application/json" } : {}) },
        body: multipart ? body : JSON.stringify({ ...body, stream: true, partial_images: 2 }), signal, redirect: "error",
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error(failure(response.status)); }
    const contentType = response.headers.get("content-type") || "";
    // Some OneYes channels return a final JSON response despite stream=true.
    // Accept that single response, but never issue a second request as fallback.
    if (contentType.includes("application/json")) {
        const value = await response.json();
        if (value.error) throw new Error(typeof value.error === "string" ? value.error : value.error.message || "OneYes 生图失败");
        return value;
    }
    if (!contentType.includes("text/event-stream") || !response.body) { await response.body?.cancel(); throw new Error("OneYes 未返回生图事件流，请检查模型是否支持流式生图。"); }
    const images = new Map<string, Record<string, unknown>>();
    let streamError = "";
    const parser = createParser({
        onEvent(event) {
            if (event.data === "[DONE]") return;
            let value;
            try { value = JSON.parse(event.data); } catch { throw new Error("OneYes 生图事件格式无效，请确认用量记录后再重试。"); }
            const type = value.type || event.event || "";
            if (value.error || type === "error" || type.endsWith(".failed")) {
                streamError = typeof value.error === "string" ? value.error : value.error?.message || value.message || "OneYes 生图失败";
                throw new Error(streamError);
            }
            if (type.endsWith(".partial_image")) {
                if (typeof value.b64_json === "string") options.onPartial?.(`data:image/png;base64,${value.b64_json}`);
                return;
            }
            const final = type.endsWith(".completed") || Array.isArray(value.data);
            if (!final) return; // Keepalives and progress events are not image results.
            const items = Array.isArray(value.data) ? value.data : [value];
            for (const item of items) {
                if (typeof item.b64_json !== "string" && typeof item.url !== "string") continue;
                const key = String(item.output_index ?? value.output_index ?? item.b64_json ?? item.url);
                images.set(key, item);
            }
        },
        onError() { throw new Error("OneYes 生图事件流解析失败，请确认用量记录后再重试。"); },
    });
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let finished = false;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) { parser.feed(decoder.decode()); parser.reset({ consume: true }); finished = true; break; }
            parser.feed(decoder.decode(value, { stream: true }));
        }
    } finally {
        if (!finished) await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
    if (streamError) throw new Error(streamError);
    if (!images.size) throw new Error("生图连接已结束，未收到完整图片。请先查看用量记录，再决定是否重试。");
    return { data: [...images.values()] };
}
