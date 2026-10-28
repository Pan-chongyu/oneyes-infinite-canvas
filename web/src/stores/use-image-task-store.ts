import localforage from "localforage";
import { create } from "zustand";
import { nanoid } from "nanoid";
import { buildApiUrl, useConfigStore, type AiConfig } from "./use-config-store";
import { ImageTaskManager, imageCredentialFingerprint, imageTaskRequest, type ImageTask, type ImageTaskTarget, type TaskImage } from "@/services/api/image-tasks";
import { resolveImageUrl, uploadImage, type UploadedImage } from "@/services/image-storage";
import type { ReferenceImage } from "@/types/image";

const storage = localforage.createInstance({ name: "infinite-canvas", storeName: "image_tasks" });
const logs = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });
export const useImageTaskStore = create<{ tasks: ImageTask[]; error?: string }>(() => ({ tasks: [] }));
let logWrites: Promise<unknown> = Promise.resolve();

export const imageTasks: ImageTaskManager = new ImageTaskManager({
    storage: {
        list: async () => { const tasks: ImageTask[] = []; await storage.iterate<ImageTask, void>(task => { tasks.push(task); }); return tasks; },
        put: task => storage.setItem(task.id, task),
        remove: id => storage.removeItem(id),
    },
    credentials: async task => {
        // Bind recovery to the original Key, even if the selected channel/account changes.
        for (const channel of useConfigStore.getState().config.channels) {
            if (channel.apiKey && await imageCredentialFingerprint(channel.apiKey) === task.credential) return channel.apiKey;
        }
    },
    submit: (path, body, key) => imageTaskRequest(buildApiUrl("https://oneyes.ai", path), key, body),
    poll: (id, key) => imageTaskRequest(buildApiUrl("https://oneyes.ai", `/images/tasks/${encodeURIComponent(id)}`), key),
    saveImage: async (source, id) => {
        const image = await uploadImage(source);
        // Remote-only fallbacks are not durable. Retry until the Blob is saved locally.
        if (!image.storageKey) throw new Error("图片尚未保存到本机");
        return { id, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType };
    },
    completed: task => {
        const write = logWrites.then(async () => {
            const group = [...imageTasks.tasks.values()].filter(item => item.logId === task.logId);
            const images = group.flatMap(item => item.images.map(image => ({ ...image, dataUrl: "", durationMs: Date.now() - item.createdAt })));
            await logs.setItem(task.logId, {
                id: task.logId, createdAt: Math.min(...group.map(item => item.createdAt)), title: task.prompt.slice(0, 32), prompt: task.prompt,
                time: new Date(task.createdAt).toLocaleString(), model: task.model, config: { ...task.config, count: String(group.reduce((count, item) => count + Number(item.config.count || 1), 0)) }, references: task.references || [],
                durationMs: Date.now() - task.createdAt, successCount: images.length, failCount: group.filter(item => item.status === "failed").length,
                imageCount: images.length, size: task.config.size, quality: task.config.quality, status: "success", images,
            });
        });
        logWrites = write.catch(() => undefined);
        return write;
    },
    changed: tasks => useImageTaskStore.setState({ tasks }),
    online: () => navigator.onLine,
});

export type AsyncImageOptions = { signal?: AbortSignal; onTask?: (id: string) => void | Promise<void>; taskTarget?: ImageTaskTarget; taskLogId?: string };
export type GeneratedImageResult = { id: string; dataUrl: string; taskId?: string; stored?: UploadedImage };

export async function requestDurableImage(config: AiConfig, prompt: string, path: string, body: Record<string, unknown> | FormData, options?: AsyncImageOptions, references?: ReferenceImage[]): Promise<GeneratedImageResult[]> {
    const id = nanoid();
    const savedReferences = await Promise.all((references || []).map(async reference => {
        const storageKey = reference.storageKey || (await uploadImage(reference.dataUrl)).storageKey;
        if (!storageKey) throw new Error("参考图尚未保存到本机，请检查网络后重试");
        return { ...reference, storageKey, dataUrl: "", url: undefined };
    }));
    const saved = await imageTasks.submit({
        id, credential: await imageCredentialFingerprint(config.apiKey), model: config.model, prompt,
        config: { model: config.model, imageModel: config.imageModel, quality: config.quality, size: config.size, count: config.count },
        ...(options?.taskTarget ? { target: options.taskTarget } : {}), logId: options?.taskLogId || `async-${id}`, createdAt: Date.now(),
        ...(savedReferences.length ? { references: savedReferences } : {}),
    }, path, body, config.apiKey, options);
    return Promise.all(saved.map(async image => ({ id: image.id, taskId: id, dataUrl: await resolveImageUrl(image.storageKey, ""), stored: await storedTaskImage(image) })));
}

export async function storedTaskImage(image: TaskImage): Promise<UploadedImage> {
    return { ...image, url: await resolveImageUrl(image.storageKey, "") };
}

export function storeGeneratedImage(image: GeneratedImageResult, options?: { signal?: AbortSignal }) {
    return image.stored ? Promise.resolve(image.stored) : uploadImage(image.dataUrl, options);
}

let started = false;
export function initializeImageTasks() {
    if (started) return;
    started = true;
    const recover = () => { void imageTasks.resumeAll().then(() => useImageTaskStore.setState({ error: undefined })).catch(() => useImageTaskStore.setState({ error: "生图任务缓存暂不可读，请重启后再试。" })); };
    recover();
    window.addEventListener("online", recover);
    window.addEventListener("focus", recover);
    useConfigStore.subscribe((state, previous) => { if (state.config.channels !== previous.config.channels) recover(); });
}
