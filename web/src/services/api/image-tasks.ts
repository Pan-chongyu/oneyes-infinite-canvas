import { MEDIA_POLL_INTERVAL_MS, IMAGE_REQUEST_TIMEOUT_MS } from "./media-request-policy";
import type { ReferenceImage } from "../../types/image";

export type ImageTaskTarget = { projectId: string; nodeId: string; imageId?: string };
export type TaskImage = { id: string; storageKey: string; width: number; height: number; bytes: number; mimeType: string };
export type ImageTask = {
    id: string;
    remoteId?: string;
    credential: string;
    model: string;
    prompt: string;
    config: { model: string; imageModel: string; size: string; quality: string; count: string };
    target?: ImageTaskTarget;
    references?: ReferenceImage[];
    logId: string;
    createdAt: number;
    expiresAt?: number;
    pollMs: number;
    status: "submitting" | "processing" | "waiting" | "credentials" | "saving" | "completed" | "failed" | "uncertain" | "paused";
    error?: string;
    expectedImages?: number;
    images: TaskImage[];
};
export type ImageTaskReceipt = { id?: string; task_id?: string; status?: string; expires_at?: number; result?: { data?: Array<{ url?: string; b64_json?: string }> }; image_url?: string; error?: { message?: string } | string };
export type ImageTaskReply = { value: ImageTaskReceipt; pollMs?: number };
export type ImageTaskDependencies = {
    storage: { list(): Promise<ImageTask[]>; put(task: ImageTask): Promise<unknown>; remove(id: string): Promise<unknown> };
    credentials(task: ImageTask): Promise<string | undefined>;
    submit(path: string, body: Record<string, unknown> | FormData, key: string): Promise<ImageTaskReply>;
    poll(id: string, key: string): Promise<ImageTaskReply>;
    saveImage(source: string, id: string): Promise<TaskImage>;
    completed(task: ImageTask): Promise<void>;
    changed(tasks: ImageTask[]): void;
    online?(): boolean;
    automatic?: boolean;
};

export class ImageTaskHttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
}

export function taskImageSources(value: ImageTaskReceipt) {
    const data = value.result?.data;
    const sources = Array.isArray(data) && data.length ? data.map(item => item.b64_json ? `data:image/png;base64,${item.b64_json}` : item.url || "") : value.image_url ? [value.image_url] : [];
    if (!sources.length || sources.some(source => !/^https:\/\//i.test(source) && !/^data:image\/[a-z0-9.+-]+;base64,/i.test(source))) throw new Error("异步任务未返回有效图片，请保留任务并重试取图。");
    return sources;
}

export async function imageCredentialFingerprint(key: string) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
    return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, "0")).join("");
}

/** Server tasks are durable, but submission is NOT idempotent. Never replay POST. */
export class ImageTaskManager {
    tasks = new Map<string, ImageTask>();
    private busy = new Set<string>();
    private timers = new Map<string, ReturnType<typeof setTimeout>>();
    private listeners = new Set<() => void>();
    private loading?: Promise<void>;
    private paused = new Set<string>();
    private removed = new Set<string>();
    constructor(private deps: ImageTaskDependencies) {}

    initialize() {
        return this.loading ||= (async () => {
            for (let task of await this.deps.storage.list()) {
                // A crash before the receipt was saved cannot be recovered by resubmitting.
                if (task.status === "submitting") {
                    task = { ...task, status: "uncertain", error: "提交响应未保存，无法确认是否受理。请先检查官网用量，勿直接重复生成。" };
                    await this.deps.storage.put(task);
                }
                this.tasks.set(task.id, task);
                if (task.status === "paused") this.paused.add(task.id);
            }
            this.emit();
            for (const task of this.tasks.values()) if (this.recoverable(task)) this.schedule(task.id, 0);
        })();
    }

    private emit() {
        this.deps.changed([...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt));
        this.listeners.forEach(listener => listener());
    }
    private async put(task: ImageTask) {
        if (this.removed.has(task.id)) return;
        if (this.paused.has(task.id)) task = { ...task, status: "paused", error: "已暂停取图，可继续获取原任务结果" };
        await this.deps.storage.put(task);
        if (this.removed.has(task.id)) return;
        this.tasks.set(task.id, task);
        this.emit();
    }
    private recoverable(task: ImageTask) { return !!task.remoteId && !["completed", "failed", "uncertain", "paused"].includes(task.status); }
    private schedule(id: string, ms: number) {
        if (this.deps.automatic === false) return;
        clearTimeout(this.timers.get(id));
        this.timers.set(id, setTimeout(() => { this.timers.delete(id); void this.refresh(id); }, ms));
    }

    async submit(seed: Omit<ImageTask, "status" | "images" | "pollMs">, path: string, body: Record<string, unknown> | FormData, key: string, options?: { signal?: AbortSignal; onTask?: (id: string) => void | Promise<void> }) {
        await this.initialize();
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        let task: ImageTask = { ...seed, status: "submitting", images: [], pollMs: MEDIA_POLL_INTERVAL_MS };
        await this.put(task); // A failed local write must prevent the paid request.
        try {
            await options?.onTask?.(task.id);
            if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        } catch (error) {
            await this.remove(task.id);
            throw error;
        }
        try {
            // Do not abort submission on a UI cancellation: retain its receipt first.
            const { value, pollMs } = await this.deps.submit(path, body, key);
            const remoteId = value.task_id || value.id;
            if (!remoteId || !/^[a-zA-Z0-9_-]+$/.test(remoteId)) throw new Error("服务端未返回有效任务编号");
            task = { ...task, remoteId, status: "processing", pollMs: pollMs || task.pollMs, ...(value.expires_at ? { expiresAt: value.expires_at * 1000 } : {}) };
            await this.put(task); // Receipt must be durable before the first poll.
        } catch (error) {
            const rejected = error instanceof ImageTaskHttpError && error.status >= 400 && error.status < 500 && error.status !== 408;
            await this.put({ ...task, status: rejected ? "failed" : "uncertain", error: rejected ? error.message : "提交响应中断，暂时无法确认是否受理。请先检查官网用量，避免重复扣费；不会自动重发。" });
            throw new Error(this.tasks.get(task.id)!.error);
        }
        this.schedule(task.id, task.pollMs);
        return this.waitFor(task.id, options?.signal);
    }

    waitFor(id: string, signal?: AbortSignal): Promise<TaskImage[]> {
        return new Promise((resolve, reject) => {
            const done = () => { this.listeners.delete(check); signal?.removeEventListener("abort", abort); };
            const check = () => {
                const task = this.tasks.get(id);
                if (task?.status === "completed") { done(); resolve(task.images); }
                else if (!task || ["failed", "uncertain", "paused"].includes(task.status)) { done(); reject(new Error(task?.error || "任务已暂停，可在生图工作台继续取图")); }
            };
            const abort = () => {
                done();
                void this.pause(id);
                reject(new DOMException("已停止等待，服务端任务可稍后继续取图", "AbortError"));
            };
            this.listeners.add(check);
            signal?.addEventListener("abort", abort, { once: true });
            if (signal?.aborted) abort(); else check();
        });
    }

    async refresh(id: string) {
        const original = this.tasks.get(id);
        if (!original?.remoteId || this.busy.has(id) || ["completed", "failed", "uncertain", "paused"].includes(original.status)) return;
        this.busy.add(id);
        let task = original;
        try {
            if (this.deps.online?.() === false) {
                await this.put({ ...task, status: "waiting", error: "网络已断开，联网后自动继续取图" });
                return;
            }
            if (task.expiresAt && Date.now() >= task.expiresAt && !task.expectedImages) {
                await this.put({ ...task, status: "failed", error: "服务端任务已超过保留期，无法继续取图。已取回的图片仍保存在本机。" });
                return;
            }
            if (!task.expectedImages || task.images.length < task.expectedImages) {
                const key = await this.deps.credentials(task);
                if (!key) { await this.put({ ...task, status: "credentials", error: "请恢复提交此任务时使用的 API Key，再继续取图。" }); return; }
                const { value, pollMs } = await this.deps.poll(task.remoteId!, key);
                if (this.removed.has(id)) return;
                if ((value.task_id || value.id) && (value.task_id || value.id) !== task.remoteId) throw new Error("任务编号不一致");
                task = { ...task, pollMs: pollMs || task.pollMs, ...(value.expires_at ? { expiresAt: value.expires_at * 1000 } : {}) };
                if (value.status === "failed") {
                    await this.put({ ...task, status: "failed", error: typeof value.error === "string" ? value.error : value.error?.message || "服务端生图失败，请查看用量后再决定是否重新生成。" });
                    return;
                }
                if (value.status !== "completed") { await this.put({ ...task, status: "processing", error: undefined }); return; }
                const sources = taskImageSources(value);
                task = { ...task, status: "saving", expectedImages: sources.length, error: undefined };
                await this.put(task);
                for (let index = task.images.length; index < sources.length; index++) {
                    const image = await this.deps.saveImage(sources[index], `${task.id}-${index}`);
                    if (this.removed.has(id)) return;
                    task = { ...task, images: [...task.images, image] };
                    await this.put(task); // Multi-image recovery never repeats cached downloads.
                }
            }
            if (this.removed.has(id)) return;
            await this.deps.completed(task);
            await this.put({ ...task, status: "completed", error: undefined });
        } catch (error) {
            const terminal = error instanceof ImageTaskHttpError && [404, 410].includes(error.status);
            const auth = error instanceof ImageTaskHttpError && [401, 403].includes(error.status);
            await this.put({ ...task, status: terminal ? "failed" : auth ? "credentials" : "waiting", error: terminal ? "任务不存在或已过期，请检查是否仍使用原 API Key。不会自动重新生成。" : auth ? "原 API Key 无效或无权限，请在配置中修复后继续取图。" : "连接或图片保存暂未完成，将自动重试取图，不会重复生成。" });
        } finally {
            this.busy.delete(id);
            const latest = this.tasks.get(id);
            if (latest && this.recoverable(latest) && latest.status !== "credentials" && this.deps.online?.() !== false) this.schedule(id, latest.pollMs);
        }
    }

    async resume(id: string) {
        const task = this.tasks.get(id);
        if (!task?.remoteId || this.busy.has(id) || ["completed", "failed", "uncertain"].includes(task.status)) return;
        this.paused.delete(id);
        await this.put({ ...task, status: task.expectedImages ? "saving" : "processing", error: undefined });
        await this.refresh(id);
    }
    async resumeAll() {
        await this.initialize();
        await Promise.all([...this.tasks.values()].filter(task => this.recoverable(task)).map(task => this.resume(task.id)));
    }
    async pause(id: string) {
        clearTimeout(this.timers.get(id));
        const task = this.tasks.get(id);
        if (task && this.recoverable(task)) { this.paused.add(id); await this.put({ ...task, status: "paused", error: "已暂停取图，可继续获取原任务结果" }); }
    }
    async remove(id: string) {
        this.removed.add(id);
        clearTimeout(this.timers.get(id));
        await this.deps.storage.remove(id);
        this.tasks.delete(id);
        this.emit();
    }
    close() { this.timers.forEach(clearTimeout); this.timers.clear(); }
}

/** Only fixed OneYes paths are used; never follow a poll_url to another host with the Key. */
export async function imageTaskRequest(url: string, key: string, body?: Record<string, unknown> | FormData): Promise<ImageTaskReply> {
    const multipart = body instanceof FormData;
    const response = await fetch(url, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${key}`, Accept: "application/json", ...(body && !multipart ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}), redirect: "error", cache: "no-store", signal: AbortSignal.timeout(IMAGE_REQUEST_TIMEOUT_MS) });
    let value;
    try { value = await response.json(); } catch { throw new ImageTaskHttpError(response.status, `OneYes 异步生图响应无效（HTTP ${response.status}）`); }
    if (!response.ok) throw new ImageTaskHttpError(response.status, value.error?.message || `OneYes 异步生图失败（HTTP ${response.status}）`);
    const after = response.headers.get("retry-after");
    const delay = after && /^\d+$/.test(after) ? Number(after) * 1000 : after ? Date.parse(after) - Date.now() : 0;
    return { value, ...(Number.isFinite(delay) && delay > 0 ? { pollMs: delay } : {}) };
}
