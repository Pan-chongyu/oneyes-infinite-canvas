import { reportError } from "../diagnostics";
import axios from "axios";
import { MEDIA_POLL_INTERVAL_MS } from "./media-request-policy";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { dataUrlToFile, readFileAsDataUrl } from "@/lib/image-utils";
import { clampVideoSeconds, computeVideoSize, inferVideoRatio } from "@/lib/media-size";
import { isGrokVideoModel, isUnsupportedGrokVideoResolution, isUnsupportedMiniMaxVideoResolution, normalizeVideoResolutionForModel } from "@/lib/video-capabilities";
import { getVideoModelInfo, videoModelConfigError } from "@/lib/video-model-info";
import type { VideoModelInfo } from "@/lib/video-model-catalog";
import { videoErrorText, videoUserError } from "@/lib/video-display-text";
import { videoSiteRequestId } from '../../../../desktop/video-errors.mjs';
import { videoRetryAt } from '../../../../desktop/video-retry-after.mjs';
import { getMediaBlob, resolveMediaUrl, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { imageToDataUrl } from "@/services/image-storage";
import { boolConfig, buildApiUrl, GROK_VIDEO_CHANNEL_ID, modelOptionName, resolveModelChannel, resolveModelRequestConfig, resolveModelScript, withLocalProxy, type AiConfig } from "@/stores/use-config-store";
import { runModelPlugin } from "./model-plugin";
import { prepareReferenceFiles } from "./image-references";
import { buildVideoBridgeRequest, encodeVideoBridgeRequest, usesVideoBridgeRequest, videoBridgeMediaUrl } from "./video-bridge-request";
import { submitVideoBridge } from './video-bridge-submit';
import { fetchModelCatalogEntries } from './model-catalog';
import { isOneYes } from './image-stream';
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { adoptVideoTask, videoRecoveryInput, type VideoRecoveryJob } from '../video-recovery';

type VideoResponse = { id?: string; request_id?: string; status?: string; error?: { message?: string } | string; url?: string; result_url?: string; video_url?: string; content?: { video_url?: string; url?: string } | null; video?: { url?: string; respect_moderation?: boolean } | null };
type ApiVideoResponse = VideoResponse | { code?: number | string; data?: VideoResponse | null; msg?: string; message?: string; error?: { message?: string } };
type ApiEnvelope<T> = T | { code?: number | string; data?: T | null; msg?: string; message?: string; error?: { message?: string } };
type RequestOptions = { signal?: AbortSignal };
type VideoMediaOptions = RequestOptions & { videos?: ReferenceVideo[]; audios?: ReferenceAudio[]; target?: VideoRecoveryJob['target']; onPrepared?: (key: string) => Promise<void>; nativeJobKey?: string };
const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string; saved?: UploadedFile };
export type VideoGenerationTask = { id: string; provider: "openai" | "gemini" | "plugin"; model: string; nativeJobKey?: string };
type GeminiInlineData = { bytesBase64Encoded: string; mimeType: string };
type GeminiVideoOperation = {
    name?: string;
    done?: boolean;
    error?: { message?: string };
    response?: { generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }> } };
};
export type VideoGenerationTaskState = { status: "pending"; retryAt?: number } | { status: "completed"; result: VideoGenerationResult } | { status: "failed"; error: string };

/** Results for scripted (plugin) video models, which run their own create+poll in one shot at task creation. */
const pluginVideoResults = new Map<string, VideoGenerationResult>();

function aiApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig, contentType?: string) {
    return {
        Authorization: `Bearer ${config.apiKey}`,
        ...(contentType ? { "Content-Type": contentType } : {}),
    };
}

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: VideoMediaOptions): Promise<VideoGenerationResult> {
    return waitForVideoGenerationTask(config, await createVideoGenerationTask(config, prompt, references, options), options);
}

export async function waitForVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationResult> {
    try { return await waitForVideoTask(config, task, options); }
    catch (error) { throw videoUserError(error, { stage: 'poll' }); }
}

async function waitForVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationResult> {
    const api = window.oneYesDesktop?.videoTasks;
    if (api && task.provider !== 'plugin') {
        const key = task.nativeJobKey || await adoptVideoTask(config, task);
        for (;;) {
            options?.signal?.throwIfAborted();
            const job = (await api.call('list')).find(item => item.key === key);
            if (!job) throw Error('原视频恢复记录不存在，请检查本机数据目录；不会重新生成');
            if (job.state === 'saved' && job.result) return { saved: job.result };
            if (['failed', 'cancelled', 'expired', 'missing', 'unknown', 'not_submitted', 'confirmation', 'credentials', 'save_error'].includes(job.state)) throw Error(videoErrorText(job.reason, { state: job.state }));
            await delay(MEDIA_POLL_INTERVAL_MS, options?.signal);
        }
    }
    for (;;) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        let retryAt: number | undefined;
        try {
            const state = await pollVideoGenerationTask(config, task, options);
            if (state.status === "completed") return state.result;
            if (state.status === "failed") throw videoTaskFailed(state.error);
            if (state.status === 'pending') retryAt = state.retryAt;
        } catch (error) {
            // Retry only queries/downloads for this receipt, never the paid POST.
            const cause = error instanceof Error && error.cause ? error.cause : error;
            const retryable = axios.isAxiosError(cause) && (cause.response ? cause.response.status === 408 || cause.response.status === 429 || cause.response.status >= 500 : ["ERR_NETWORK", "ECONNABORTED", "ETIMEDOUT", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED"].includes(cause.code || ""));
            if (options?.signal?.aborted || !retryable) throw error;
            retryAt = videoRetryAt(cause.response?.headers['retry-after']);
        }
        await delay(Math.max(MEDIA_POLL_INTERVAL_MS, (retryAt ?? 0) - Date.now()), options?.signal);
    }
}

export function isVideoTaskFailed(error: unknown) {
    return error instanceof Error && error.name === "VideoTaskFailed";
}

function videoTaskFailed(message: string) {
    const error = new Error(message);
    error.name = "VideoTaskFailed";
    return error;
}

export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    try { return await prepareVideoGenerationTask(config, prompt, references, options); }
    catch (error) { throw videoUserError(error); }
}

async function prepareVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const selectedModel = config.model || config.videoModel;
    const channel = resolveModelChannel(config, selectedModel);
    const parameterError = videoModelConfigError(config, selectedModel);
    if (parameterError) throw Error(parameterError);
    if (channel.apiFormat !== 'gemini' && isOneYes(channel.baseUrl) && !resolveModelScript(config, selectedModel)) {
        const entries = await fetchModelCatalogEntries(channel, true);
        options?.signal?.throwIfAborted();
        const entry = entries.find(item => item.id === modelOptionName(selectedModel));
        if (!entry) throw Error('当前 API Key 的可用模型列表不包含所选模型。请刷新模型列表并检查官网分组权限；原模型与设置已保留，不会自动换 Key、分组或付费模型。');
        // Use this key's current limits without changing saved selections.
        config = { ...config, channels: config.channels.map(item => item.id === channel.id ? { ...item, models: [...item.models.filter(model => model.name !== entry.id), { ...item.models.find(model => model.name === entry.id), name: entry.id, capability: 'video', referenceFileMaxBytes: entry.referenceFileMaxBytes }] } : item) };
    }
    const api = window.oneYesDesktop?.videoTasks;
    if (!api || resolveModelScript(config, config.model || config.videoModel)) return createVideoTask(config, prompt, references, options);
    const selected = { ...config, model: config.model || config.videoModel };
    const key = await api.call('prepare', { ...videoRecoveryInput(selected, prompt, options?.target), retryLargeMaterial: Boolean(getVideoModelInfo(selected)), references: [...references, ...options?.videos || [], ...options?.audios || []].map(item => ({ id: item.id, storageKey: item.storageKey })) });
    try {
        await options?.onPrepared?.(key);
        const task = await createVideoTask(config, prompt, references, { ...options, nativeJobKey: key });
        return { ...task, nativeJobKey: key };
    } catch (error) {
        await api.call('submissionError', { key, reason: videoErrorText(error) });
        throw error;
    }
}

function submissionHeaders(options?: VideoMediaOptions): Record<string, string> { return options?.nativeJobKey ? { 'x-oneyes-video-job': options.nativeJobKey, 'Idempotency-Key': options.nativeJobKey } : {}; }

async function createVideoTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const selectedModel = (config.model || config.videoModel).trim();
    const info = getVideoModelInfo(config, selectedModel);
    if (info) {
        references = uniqueVideoReferences(references, image => image.storageKey || image.dataUrl || image.url || image.id);
        options = { ...options, videos: uniqueVideoReferences(options?.videos || [], item => item.storageKey || item.url || item.id), audios: uniqueVideoReferences(options?.audios || [], item => item.storageKey || item.url || item.id) };
    }
    if (!info && isUnsupportedGrokVideoResolution({ ...config, model: selectedModel }, { imageCount: references.length, audioCount: options?.audios?.length || 0, videoCount: options?.videos?.length || 0 })) throw new Error(apiText("grokVideoReferenceResolution"));
    if (!info && isUnsupportedMiniMaxVideoResolution({ ...config, model: selectedModel })) throw new Error(apiText("miniMaxVideoResolution"));
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    const script = resolveModelScript(config, selectedModel);
    if (script) return createPluginVideoTask(requestConfig, selectedModel, script, prompt, references, options);
    assertVideoConfig(requestConfig, requestConfig.model);
    if (requestConfig.apiFormat === "gemini") return createGeminiVideoTask(requestConfig, selectedModel, prompt, references, options);
    // A canonical Grok ID may route to an existing native pool with edit/audio
    // capabilities beyond the 88API catalog. Keep that established path intact.
    const nativeGrok = info?.id.startsWith("grok-imagine-video") && modelOptionName(selectedModel) === info.id;
    const parameterError = nativeGrok ? undefined : videoModelConfigError(config, selectedModel, { imageCount: references.length, videoCount: options?.videos?.length || 0, audioCount: options?.audios?.length || 0 });
    if (parameterError) throw new Error(parameterError);
    if (info && usesVideoBridgeRequest(info)) return createBridgeVideoTask(requestConfig, selectedModel, prompt, references, info, options);
    const channel = resolveModelChannel(config, selectedModel);
    // Seedance served by OneYes' Grok group speaks Grok JSON too. Do not infer
    // the protocol from a display name or apply xAI-only model limits to it.
    if (isGrokVideoModel(selectedModel) || info?.id.startsWith("grok-imagine-video") || (/^(?:doubao-)?seedance(?:-|$)/i.test(modelOptionName(selectedModel)) && (channel.oneYes?.platform === "grok" || channel.id === GROK_VIDEO_CHANNEL_ID))) {
        return createGrokVideoTask(requestConfig, selectedModel, prompt, references, options);
    }
    return createOpenAIVideoTask(requestConfig, selectedModel, prompt, references, options);
}

function uniqueVideoReferences<T extends { id: string }>(items: T[], identity: (item: T) => string) {
    const seen = new Map<string, string>(), sources = new Set<string>();
    return items.filter(item => {
        const source = identity(item);
        if (seen.has(item.id) && seen.get(item.id) !== source) throw Error("同一参考素材 ID 指向不同文件，请重新选择素材；未提交生成。");
        seen.set(item.id, source);
        if (sources.has(source)) return false;
        sources.add(source); return true;
    });
}

export async function pollVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try { return await queryVideoGenerationTask(config, task, options); }
    catch (error) { throw videoUserError(error, { stage: 'poll' }); }
}

async function queryVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    if (task.provider === "plugin") {
        const result = pluginVideoResults.get(task.id);
        return result ? { status: "completed", result } : { status: "failed", error: apiText("pluginVideoExpired") };
    }
    const requestConfig = resolveModelRequestConfig(config, task.model);
    assertVideoConfig(requestConfig, requestConfig.model);
    if (task.provider === "gemini") return pollGeminiVideoTask(requestConfig, task, options);
    return pollOpenAIVideoTask(requestConfig, task, options);
}

async function createPluginVideoTask(config: AiConfig, model: string, script: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    if (!config.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
    const refs = await Promise.all(references.map((image) => imageToDataUrl(image)));
    const videos = await Promise.all((options?.videos || []).map((video) => referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options)));
    const audios = await Promise.all((options?.audios || []).map((audio) => referenceMediaToFile(audio, "ref.mp3", "invalidReferenceAudio", options)));
    const result = videoPluginResult(
        await runModelPlugin({
            capability: "video",
            script,
            config,
            prompt,
            images: refs,
            videos,
            audios,
            params: {
                seconds: normalizeVideoSeconds(config.videoSeconds),
                size: normalizeVideoSize(config.size, config.vquality),
                resolution: normalizeVideoResolution(config.vquality, model),
                ratio: videoAspectRatio(config.size),
                generateAudio: boolConfig(config.videoGenerateAudio, true),
                watermark: boolConfig(config.videoWatermark, false),
                mode: resolveVideoMode(config.videoMode, refs.length),
            },
            signal: options?.signal,
        }),
    );
    const id = nanoid();
    pluginVideoResults.set(id, result);
    return { id, provider: "plugin", model };
}

function videoPluginResult(result: unknown): VideoGenerationResult {
    if (result instanceof Blob) return { blob: result };
    if (typeof result === "string") return { url: result, mimeType: "video/mp4" };
    if (result && typeof result === "object") {
        const record = result as Record<string, unknown>;
        if (record.blob instanceof Blob) return { blob: record.blob };
        const url = [record.url, record.video_url, record.result_url].find((value) => typeof value === "string" && value) as string | undefined;
        if (url) return { url, mimeType: "video/mp4" };
    }
    throw new Error(apiText("scriptNoVideo"));
}

export async function storeGeneratedVideo(result: VideoGenerationResult): Promise<UploadedFile> {
    if (result.saved) return result.saved;
    if (result.blob) return uploadMediaFile(result.blob, "video");
    if (result.url) {
        return uploadMediaFile(result.url, "video");
    }
    throw new Error(apiText("noPlayableVideo"));
}

async function createOpenAIVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const images = await Promise.all(references.map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) })));
    const videos = await Promise.all((options?.videos || []).map((video) => referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options)));
    const audios = await Promise.all((options?.audios || []).map((audio) => referenceMediaToFile(audio, "ref.mp3", "invalidReferenceAudio", options)));
    const mode = resolveVideoMode(config.videoMode, images.length);
    const ratio = inferVideoRatio(config.size || "16:9");
    const body = new FormData();
    body.append("model", modelOptionName(model));
    body.append("prompt", prompt);
    body.append("seconds", getVideoModelInfo(config, model) ? config.videoSeconds : normalizeVideoSeconds(config.videoSeconds));
    body.append("size", normalizeVideoSize(config.size, config.vquality) || "1280x720");
    if (ratio && ratio !== "auto") {
        body.append("ratio", ratio);
    }
    body.append("resolution_name", normalizeVideoResolution(config.vquality, model));
    body.append("generate_audio", String(boolConfig(config.videoGenerateAudio, true)));
    body.append("watermark", String(boolConfig(config.videoWatermark, false)));
    body.append("mode", mode);
    if (mode === "frames") {
        if (images[0]) {
            body.append("first_frame", images[0], "first.png");
        }
        if (images[1]) {
            body.append("last_frame", images[1], "last.png");
        }
    } else {
        images.forEach((file, idx) => {
            body.append("image[]", file, `ref_${idx + 1}.png`);
        });
    }
    videos.forEach((file) => body.append("video[]", file));
    audios.forEach((file) => body.append("audio[]", file));
    try {
        const created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(aiApiUrl(config, "/videos"), body, { headers: { ...aiHeaders(config), ...submissionHeaders(options) }, signal: options?.signal, timeout: 0 })).data);
        const id = created.request_id || created.id;
        if (!id) throw new Error(apiText("noVideoTaskId"));
        return { id, provider: "openai", model };
    } catch (error) {

        reportError("video", "submit", error, "video-openai");
        throw await readAxiosError(error, apiText("videoTaskCreateFailed"));
    }
}

async function createBridgeVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], info: VideoModelInfo, options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const videos = options?.videos || [], audios = options?.audios || [];
    // Keep public-only inputs as URLs. In particular, do not download a video
    // and disguise it as inline media when the upstream requires a prior upload.
    const videoInputs = info.provider === "zhiying"
        ? await Promise.all(videos.map(video => referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options)))
        : videos.map(video => videoBridgeMediaUrl(video.url, "视频"));
    const audioFiles = info.id.startsWith('wan3.0-video') ? undefined : await Promise.all(audios.map(audio => referenceMediaToFile(audio, "ref.mp3", "invalidReferenceAudio", options)));
    const audioInputs = info.provider === "zhiying"
        ? audioFiles!
        : info.id.startsWith("wan3.0-video")
            ? audios.map(audio => videoBridgeMediaUrl(audio.url, "音频"))
            : await Promise.all(audioFiles!.map(readFileAsDataUrl));
    const grok = info.id.startsWith("grok-");
    const images = grok ? [] : await prepareReferenceFiles(references, options?.signal, info.id === "veo-3.1" ? "png" : undefined);
    const referenceVideoDurationTotal = videos.every(video => Number.isFinite(video.durationMs) && video.durationMs! > 0)
        ? videos.reduce((total, video) => total + video.durationMs! / 1000, 0)
        : undefined;
    const request = await encodeVideoBridgeRequest(buildVideoBridgeRequest(info, config, modelOptionName(model), prompt, {
        images,
        imageDataUrls: grok ? references.map(image => videoBridgeMediaUrl(image.url || image.dataUrl, "图片")) : info.provider === "zhiying" || info.id.startsWith('wan3.0-video') || /^(veo-|gemini-omni-)/.test(info.id) ? [] : await Promise.all(images.map(readFileAsDataUrl)),
        videos: videoInputs,
        audios: audioInputs,
        audioFiles,
        referenceVideoDurationTotal,
    }), info);
    options?.signal?.throwIfAborted();
    try {
        const created = unwrapVideoResponse((await submitVideoBridge<ApiVideoResponse>(aiApiUrl(config, '/videos'), request.body, { ...aiHeaders(config, request.contentType), 'Idempotency-Key': options?.nativeJobKey || crypto.randomUUID(), ...submissionHeaders(options) }, options?.signal)).data);
        const id = created.request_id || created.id;
        if (!id) throw new Error(apiText("noVideoTaskId"));
        return { id, provider: "openai", model };
    } catch (error) {
        reportError("video", "submit", error, "video-bridge");
        throw await readAxiosError(error, apiText("videoTaskCreateFailed"));
    }
}

// Grok's native API accepts JSON, not the generic OpenAI multipart fields.
async function createGrokVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const videos = options?.videos || [], audios = options?.audios || [];
    const info = getVideoModelInfo(config, model);
    const grokModel = isGrokVideoModel(model) || Boolean(info?.id.startsWith("grok-imagine-video"));
    if (videos.length && (videos.length !== 1 || references.length || audios.length)) throw new Error(apiText("grokVideoEditReferences"));
    if ((info?.id || modelOptionName(model)) === "grok-imagine-video-1.5" && !references.length && !videos.length) throw new Error(apiText("grokVideoImageRequired"));
    const body: Record<string, unknown> = { model: modelOptionName(model), prompt };
    if (videos.length) {
        body.video = { url: await readFileAsDataUrl(await referenceMediaToFile(videos[0], "ref.mp4", "invalidReferenceVideo", options)) };
    } else {
        body.duration = Number(info ? config.videoSeconds : normalizeVideoSeconds(config.videoSeconds));
        body.aspect_ratio = videoAspectRatio(config.size);
        body.resolution = normalizeVideoResolution(config.vquality, model);
        if (!grokModel) {
            body.watermark = boolConfig(config.videoWatermark, false);
            body.generate_audio = boolConfig(config.videoGenerateAudio, true);
        }
        const images = await Promise.all((await prepareReferenceFiles(references, options?.signal)).map(readFileAsDataUrl));
        if (resolveVideoMode(config.videoMode, images.length) === "reference" || audios.length) {
            if (images.length) body.reference_images = images.map(url => ({ url }));
        } else {
            if (images[0]) body.image = { url: images[0] };
            if (images[1]) body.last_frame = { url: images[1] };
        }
        if (audios.length) body.reference_audios = await Promise.all(audios.map(async audio => ({ url: await readFileAsDataUrl(await referenceMediaToFile(audio, "ref.mp3", "invalidReferenceAudio", options)) })));
    }
    options?.signal?.throwIfAborted();
    try {
        const created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(aiApiUrl(config, videos.length ? "/videos/edits" : "/videos/generations"), body, { headers: { ...aiHeaders(config, "application/json"), ...submissionHeaders(options) }, signal: options?.signal, timeout: 0 })).data);
        const id = created.request_id || created.id;
        if (!id) throw new Error(apiText("noVideoTaskId"));
        return { id, provider: "openai", model };
    } catch (error) {

        reportError("video", "submit", error, "video-grok");
        throw await readAxiosError(error, apiText("videoTaskCreateFailed"));
    }
}

async function pollOpenAIVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    let stage: "poll" | "download" = "poll";
    try {
        const taskPath = `/videos/${encodeURIComponent(task.id)}`;
        const response = await axios.get<ApiVideoResponse>(aiApiUrl(config, taskPath), { headers: aiHeaders(config), signal: options?.signal, timeout: 0 });
        const retryAt = videoRetryAt(response.headers['retry-after']);
        if (response.status === 202 && !response.data) return { status: "pending", retryAt };
        const video = unwrapVideoResponse(response.data);
        if (["failed", "cancelled", "canceled", "expired"].includes(video.status || "")) {
            return { status: "failed", error: videoErrorText(video, { state: video.status, requestId: videoSiteRequestId(aiApiUrl(config, taskPath), response.headers) }) };
        }
        if (video.video?.respect_moderation === false) return { status: "failed", error: videoErrorText(video.error ? video : { code: 'content_policy' }, { requestId: videoSiteRequestId(aiApiUrl(config, taskPath), response.headers) }) };
        const url = videoResultUrl(video);
        // Sub2API returns an authenticated relay URL. Rebuild it from the fixed
        // account endpoint; never attach the API key to an upstream media URL.
        const contentPath = `${taskPath}/content`;
        if (url && !isVideoContentRelay(url, config.baseUrl, contentPath)) { stage = 'download'; return { status: "completed", result: await videoResultFromUrl(url, options) }; }
        if (url || video.status === "completed") {
            stage = "download";
            const content = await axios.get<Blob>(aiApiUrl(config, contentPath), { headers: aiHeaders(config), responseType: "blob", signal: options?.signal, timeout: 0 });
            await assertVideoBlob(content.data);
            return { status: "completed", result: { blob: content.data } };
        }
        if (video.status === "done") return { status: "failed", error: apiText("noPlayableVideo") };
        return { status: "pending", retryAt };
    } catch (error) {

        reportError("video", stage, error, stage === "download" ? "video-content" : "video-openai");
        throw await readAxiosError(error, apiText("videoTaskQueryFailed"), stage);
    }
}

async function videoResultFromUrl(url: string, options?: RequestOptions): Promise<VideoGenerationResult> {
    try {
        const response = await axios.get<Blob>(withLocalProxy(url), { responseType: "blob", signal: options?.signal, timeout: 0 });
        await assertVideoBlob(response.data);
        return { blob: response.data };
    } catch (error) {

        reportError("video", "download", error, "video-content");
        if (axios.isCancel(error) || options?.signal?.aborted) throw error;
        throw error;
    }
}

async function createGeminiVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const images = await Promise.all(references.map((image) => imageToDataUrl(image)));
    const videos = await Promise.all((options?.videos || []).map((video) => referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options)));
    const audios = await Promise.all((options?.audios || []).map((audio) => referenceMediaToFile(audio, "ref.mp3", "invalidReferenceAudio", options)));
    const mode = resolveVideoMode(config.videoMode, images.length);
    const instance: Record<string, unknown> = { prompt };
    if (mode === "frames") {
        if (images[0]) instance.image = parseDataUrlInline(images[0]);
        if (images[1]) instance.lastFrame = parseDataUrlInline(images[1]);
    } else {
        instance.referenceImages = images.map((dataUrl) => ({ image: parseDataUrlInline(dataUrl), referenceType: "asset" }));
    }
    if (videos[0]) instance.video = await fileToGeminiInline(videos[0]);
    if (audios[0]) instance.audio = await fileToGeminiInline(audios[0]);
    try {
        const created = unwrapEnvelope((await axios.post<ApiEnvelope<GeminiVideoOperation>>(geminiVideoUrl(config, model, "predictLongRunning"), {
            instances: [instance],
            parameters: {
                aspectRatio: videoAspectRatio(config.size),
                durationSeconds: Number(normalizeVideoSeconds(config.videoSeconds)) || 8,
                resolution: normalizeVideoResolution(config.vquality, model),
                generateAudio: boolConfig(config.videoGenerateAudio, true),
                addWatermark: boolConfig(config.videoWatermark, false),
            },
        }, { headers: { ...geminiVideoHeaders(config), ...submissionHeaders(options) }, signal: options?.signal, timeout: 0 })).data, apiText("noVideoTask"));
        if (!created.name) throw new Error(apiText("noVideoTaskId"));
        return { id: created.name, provider: "gemini", model };
    } catch (error) {

        reportError("video", "submit", error, "video-gemini");
        throw await readAxiosError(error, apiText("videoTaskCreateFailed"));
    }
}

async function pollGeminiVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const url = geminiOperationUrl(config, task.id);
        const response = await axios.get<ApiEnvelope<GeminiVideoOperation>>(url, { headers: geminiVideoHeaders(config), signal: options?.signal, timeout: 0 });
        const state = unwrapEnvelope(response.data, apiText("videoTaskQueryFailed"));
        if (state.error) return { status: "failed", error: videoErrorText(state, { requestId: videoSiteRequestId(url, response.headers) }) };
        if (!state.done) return { status: "pending", retryAt: videoRetryAt(response.headers['retry-after']) };
        const uri = state.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
        if (!uri) return { status: "failed", error: apiText("noPlayableVideo") };
        const mediaUrl = uri.includes("key=") ? uri : `${uri}${uri.includes("?") ? "&" : "?"}key=${config.apiKey}`;
        return { status: "completed", result: await videoResultFromUrl(mediaUrl, options) };
    } catch (error) {

        reportError("video", "poll", error, "video-gemini");
        throw await readAxiosError(error, apiText("videoTaskQueryFailed"), 'poll');
    }
}

function assertVideoConfig(config: AiConfig, model: string) {
    if (!model) throw new Error(apiText("videoModelRequired"));
    if (!config.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
}

function geminiVideoBaseUrl(config: Pick<AiConfig, "baseUrl">) {
    const normalizedBaseUrl = config.baseUrl.trim().replace(/\/+$/, "");
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    return lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/v1beta") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1beta`;
}

function geminiVideoUrl(config: Pick<AiConfig, "baseUrl">, model: string, action: string) {
    return withLocalProxy(`${geminiVideoBaseUrl(config)}/models/${encodeURIComponent(modelOptionName(model).replace(/^models\//, ""))}:${action}`);
}

function geminiOperationUrl(config: Pick<AiConfig, "baseUrl">, name: string) {
    return withLocalProxy(`${geminiVideoBaseUrl(config)}/${name.replace(/^\//, "")}`);
}

function geminiVideoHeaders(config: Pick<AiConfig, "apiKey">) {
    return { "x-goog-api-key": config.apiKey, "Content-Type": "application/json" };
}

function videoAspectRatio(size: string) {
    const ratio = inferVideoRatio(size);
    return ratio === "auto" ? "16:9" : ratio;
}

function parseDataUrlInline(dataUrl: string, fallbackType = "image/png"): GeminiInlineData {
    const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
    return { bytesBase64Encoded: match?.[2] || "", mimeType: match?.[1] || fallbackType };
}

async function fileToGeminiInline(file: File): Promise<GeminiInlineData> {
    return parseDataUrlInline(await readFileAsDataUrl(file), file.type || "application/octet-stream");
}

async function referenceMediaToFile(item: { name: string; type?: string; url?: string; storageKey?: string }, fallbackName: string, errorKey: "invalidReferenceVideo" | "invalidReferenceAudio", options?: RequestOptions) {
    let blob = item.storageKey ? await getMediaBlob(item.storageKey) : null;
    if (!blob) {
        const url = item.storageKey ? await resolveMediaUrl(item.storageKey, item.url || "") : item.url || "";
        if (!url) throw new Error(apiText(errorKey));
        try {
            blob = await (await fetch(url, { signal: options?.signal })).blob();
        } catch (error) {

            reportError("video", "load", error, "video-reference");
            if (error instanceof DOMException && error.name === "AbortError") throw error;
            throw new Error(apiText(errorKey));
        }
    }
    if (!blob.size) throw new Error(apiText(errorKey));
    return new File([blob], item.name || fallbackName, { type: item.type || blob.type || "application/octet-stream" });
}

function normalizeVideoSeconds(value: string) {
    return clampVideoSeconds(value);
}

function resolveVideoMode(mode: string | undefined, imageCount: number) {
    if (mode === "reference" || imageCount > 2) return "reference";
    return "frames";
}

function normalizeVideoSize(value: string, resolution?: string) {
    if (value === "auto") return null;
    if (/^\d+x\d+$/.test(value || "")) return value;
    const ratio = inferVideoRatio(value || "16:9");
    if (ratio === "auto") return null;
    return computeVideoSize(resolution || "720", ratio);
}

function normalizeVideoResolution(value: string, model?: string) {
    return normalizeVideoResolutionForModel(value, model);
}

function unwrapVideoResponse(payload: ApiVideoResponse) {
    return unwrapEnvelope(payload, apiText("noVideoTask"));
}

function unwrapEnvelope<T>(payload: ApiEnvelope<T>, emptyMessage: string): T {
    if (!payload) throw new Error(emptyMessage);
    if (typeof payload === "object" && "code" in payload && payload.code !== undefined) {
        if (payload.code !== 0 && payload.code !== "0") throw new Error(readApiErrorMessage(payload) || apiText("requestFailed"));
        if (!payload.data) throw new Error(emptyMessage);
        return payload.data;
    }
    return payload as T;
}

function videoResultUrl(payload: VideoResponse) {
    return [payload.video?.url, payload.video_url, payload.result_url, payload.url, payload.content?.video_url, payload.content?.url].find((url) => typeof url === "string" && (isPublicMediaUrl(url) || url.startsWith("/v1/videos/")));
}

function isVideoContentRelay(value: string, baseUrl: string, path: string) {
    try {
        const url = new URL(value, baseUrl);
        return ["https://oneyes.ai", "https://api.oneyes.ai", new URL(baseUrl).origin].includes(url.origin) && url.pathname === `/v1${path}`;
    } catch { return false; }
}

function readApiErrorMessage(value: unknown): string {
    return videoErrorText(value);
}

async function readAxiosError(error: unknown, _fallback: string, stage?: string) {
    if (axios.isCancel(error) || error instanceof Error && ['AbortError', 'CanceledError'].includes(error.name)) return videoUserError(error);
    const response = axios.isAxiosError(error) ? error.response : undefined;
    let data = response?.data;
    if (data instanceof Blob && /json|text\/|html/i.test(data.type)) data = await data.text();
    const safe = new Error(videoErrorText(response ? { response: { ...response, data } } : error, { stage, requestId: response ? videoSiteRequestId(response.config.url || '', response.headers) : undefined }), { cause: error });
    if (error instanceof Error) safe.name = error.name;
    return safe;
}

async function assertVideoBlob(blob: Blob) {
    if (!/json|text\/|html/i.test(blob.type)) return;
    let payload: unknown;
    try {
        payload = JSON.parse(await blob.text());
    } catch {
        throw Error(videoErrorText(undefined, { stage: 'download' }));
    }
    throw Error(videoErrorText(payload, { stage: 'download' }));
}

function isPublicMediaUrl(value: string) {
    return /^https?:\/\//i.test(value || "");
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
        const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
        signal?.addEventListener("abort", abort, { once: true });
    });
}
