import localforage from "localforage";

import i18n from "@/i18n";
import { getMediaBlob, resolveMediaUrl, setMediaBlob } from "@/services/file-storage";
import { getImageBlob, resolveImageUrl, setImageBlob } from "@/services/image-storage";
import { downloadWebdavFile, readWebdavFile, uploadWebdavFile, webdavFileExists, WEBDAV_MANIFEST_FILE_NAME } from "@/services/webdav-sync";
import { blobSha256, mergeById, mergeCanvasData, parseDomainManifest, storageKeyPattern, type AppSyncDomainKey, type AppSyncFile, type CanvasDomainData, type DomainManifest } from "./app-sync-data";
import type { Asset } from "@/stores/use-asset-store";
import { useAssetStore } from "@/stores/use-asset-store";
import type { WebdavSyncConfig } from "@/stores/use-config-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

type StoredLog = Record<string, unknown> & { id?: string };
export type { AppSyncDomainKey } from "./app-sync-data";
type DomainKey = AppSyncDomainKey;
type AssetDomainData = { assets: Asset[] };
type LogDomainData = { logs: StoredLog[] };

type SyncDomainOptions<T> = {
    key: DomainKey;
    label: string;
    remote: ReturnType<typeof readDomainManifest<T>>;
    localData: () => Promise<T>;
    mergeData: (local: T, remote: T) => T;
    applyData?: (data: T) => Promise<void>;
};

type SyncDomainResult<T> = {
    data: T;
    mergedRemote: boolean;
    files: number;
    manifestBytes: number;
    uploadedFiles: number;
    uploadedBytes: number;
};

export type AppSyncResult = {
    syncedAt: string;
    mergedRemote: boolean;
    projects: number;
    assets: number;
    imageLogs: number;
    videoLogs: number;
    files: number;
    manifestBytes: number;
    uploadedFiles: number;
    uploadedBytes: number;
};

export type AppSyncProgressEvent = {
    domain?: AppSyncDomainKey;
    label?: string;
    stage: string;
    current?: number;
    total?: number;
    status?: "active" | "success" | "exception";
};

export type AppSyncProgress = (event: AppSyncProgressEvent) => void;

const FILE_CONCURRENCY = 3;
const imageLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });
const videoLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });
type LogStore = typeof imageLogStore;
let syncing = false;

export async function syncAppDataToWebdav(config: WebdavSyncConfig, onProgress?: AppSyncProgress): Promise<AppSyncResult> {
    if (syncing) throw new Error(i18n.t("config.webdav.errors.busy"));
    syncing = true;
    try { return await syncAppData({ ...config }, onProgress); }
    catch (error) {
        emitProgress(onProgress, { stage: error instanceof Error ? error.message : i18n.t("config.webdav.errors.syncFailed"), status: "exception" });
        throw error;
    } finally { syncing = false; }
}

async function syncAppData(config: WebdavSyncConfig, onProgress?: AppSyncProgress): Promise<AppSyncResult> {
    emitProgress(onProgress, { stage: "等待本地数据加载" });
    await Promise.all([waitForHydration(useCanvasStore), waitForHydration(useAssetStore)]);
    emitProgress(onProgress, { stage: "同步中", status: "active" });
    const remotes = {
        canvas: readDomainManifest<CanvasDomainData>(config, "canvas"),
        assets: readDomainManifest<AssetDomainData>(config, "assets"),
        image: readDomainManifest<LogDomainData>(config, "image-workbench"),
        video: readDomainManifest<LogDomainData>(config, "video-workbench"),
    };
    const sharedFiles = Promise.allSettled(Object.values(remotes)).then(results => results.flatMap(result => result.status === "fulfilled" ? result.value?.manifest.files || [] : []));

    const [canvasResult, assetsResult, imageLogsResult, videoLogsResult] = await Promise.allSettled([
        syncDomain<CanvasDomainData>(config, onProgress, {
            key: "canvas",
            label: "画布",
            remote: remotes.canvas,
            localData: async () => {
                const { projects, deletedProjects } = useCanvasStore.getState();
                return { projects, deleted: deletedProjects };
            },
            mergeData: mergeCanvasData,
            applyData: async (data) => useCanvasStore.getState().replaceProjects(data.projects, data.deleted),
        }, sharedFiles),
        syncDomain<AssetDomainData>(config, onProgress, {
            key: "assets",
            label: "我的资产",
            remote: remotes.assets,
            localData: async () => ({ assets: useAssetStore.getState().assets }),
            mergeData: (local, remote) => ({ assets: mergeById(local.assets, remote.assets, "updatedAt") }),
            applyData: async (data) => useAssetStore.getState().replaceAssets(await Promise.all(data.assets.map(hydrateAsset))),
        }, sharedFiles),
        syncDomain<LogDomainData>(config, onProgress, {
            key: "image-workbench",
            label: "生图工作台",
            remote: remotes.image,
            localData: async () => ({ logs: await readStoredLogs(imageLogStore) }),
            mergeData: (local, remote) => ({ logs: mergeById(local.logs, remote.logs, "createdAt") }),
            applyData: async (data) => replaceStoredLogs(imageLogStore, data.logs),
        }, sharedFiles),
        syncDomain<LogDomainData>(config, onProgress, {
            key: "video-workbench",
            label: "视频创作台",
            remote: remotes.video,
            localData: async () => ({ logs: await readStoredLogs(videoLogStore) }),
            mergeData: (local, remote) => ({ logs: mergeById(local.logs, remote.logs, "createdAt") }),
            applyData: async (data) => replaceStoredLogs(videoLogStore, data.logs),
        }, sharedFiles),
    ]);

    // Wait until every domain settles before enabling another attempt.
    const canvas = fulfilled(canvasResult), assets = fulfilled(assetsResult), imageLogs = fulfilled(imageLogsResult), videoLogs = fulfilled(videoLogsResult);

    const result = {
        syncedAt: new Date().toISOString(),
        mergedRemote: [canvas, assets, imageLogs, videoLogs].some((item) => item.mergedRemote),
        projects: canvas.data.projects.length,
        assets: assets.data.assets.length,
        imageLogs: imageLogs.data.logs.length,
        videoLogs: videoLogs.data.logs.length,
        files: canvas.files + assets.files + imageLogs.files + videoLogs.files,
        manifestBytes: canvas.manifestBytes + assets.manifestBytes + imageLogs.manifestBytes + videoLogs.manifestBytes,
        uploadedFiles: canvas.uploadedFiles + assets.uploadedFiles + imageLogs.uploadedFiles + videoLogs.uploadedFiles,
        uploadedBytes: canvas.uploadedBytes + assets.uploadedBytes + imageLogs.uploadedBytes + videoLogs.uploadedBytes,
    };
    emitProgress(onProgress, { stage: "同步完成", status: "success" });
    return result;
}

async function syncDomain<T>(config: WebdavSyncConfig, onProgress: AppSyncProgress | undefined, options: SyncDomainOptions<T>, sharedFiles: Promise<AppSyncFile[]>): Promise<SyncDomainResult<T>> {
    try {
        emitProgress(onProgress, { domain: options.key, label: options.label, stage: "读取远端清单", status: "active" });
        const remote = await options.remote;
        const remoteManifest = remote?.manifest;
        emitProgress(onProgress, { domain: options.key, label: options.label, stage: "读取本地数据", status: "active" });
        const localData = await options.localData();
        let mergedData = remoteManifest ? options.mergeData(localData, remoteManifest.data) : localData;

        emitProgress(onProgress, { domain: options.key, label: options.label, stage: "下载缺失媒体", status: "active" });
        await downloadMissingFiles(config, options.key, mergedData, remoteManifest?.files || [], sharedFiles, onProgress);
        if (remoteManifest) mergedData = options.mergeData(await options.localData(), remoteManifest.data);

        emitProgress(onProgress, { domain: options.key, label: options.label, stage: "上传新增媒体", status: "active" });
        const uploaded = await uploadChangedFiles(config, options.key, mergedData, remoteManifest?.files || [], onProgress);
        const manifest: DomainManifest<T> = { app: "infinite-canvas", version: 1, domain: options.key, exportedAt: new Date().toISOString(), data: mergedData, files: uploaded.files };
        const manifestFile = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
        emitProgress(onProgress, { domain: options.key, label: options.label, stage: `上传清单 ${formatBytes(manifestFile.size)}`, status: "active" });
        await uploadWebdavFile(config, domainPath(options.key, WEBDAV_MANIFEST_FILE_NAME), manifestFile, "application/json", remote ? { ifMatch: remote.etag?.startsWith('"') ? remote.etag : undefined } : { ifNoneMatch: "*" });
        if (remoteManifest) {
            emitProgress(onProgress, { domain: options.key, label: options.label, stage: "写入本地合并结果", status: "active" });
            // Edits and newly generated records made while uploading always win
            // their timestamp tie. Never replace them with the earlier snapshot.
            await options.applyData?.(options.mergeData(await options.localData(), mergedData));
        }
        emitProgress(onProgress, { domain: options.key, label: options.label, stage: "完成", current: 1, total: 1, status: "success" });

        return {
            data: mergedData,
            mergedRemote: Boolean(remoteManifest),
            files: uploaded.files.length,
            manifestBytes: manifestFile.size,
            uploadedFiles: uploaded.uploadedFiles,
            uploadedBytes: uploaded.uploadedBytes,
        };
    } catch (error) {
        emitProgress(onProgress, { domain: options.key, label: options.label, stage: error instanceof Error ? error.message : i18n.t("config.webdav.errors.syncFailed"), status: "exception" });
        throw error;
    }
}

async function readDomainManifest<T>(config: WebdavSyncConfig, domain: DomainKey) {
    const resource = await readWebdavFile(config, domainPath(domain, WEBDAV_MANIFEST_FILE_NAME));
    if (!resource) return null;
    try { return { manifest: parseDomainManifest<T>(await resource.blob.text(), domain), etag: resource.etag }; }
    catch { throw new Error(i18n.t("config.webdav.errors.invalidManifest", { domain })); }
}

async function localMediaBlob(storageKey: string) {
    const image = storageKey.startsWith("image:");
    const stored = await (image ? getImageBlob(storageKey) : getMediaBlob(storageKey));
    if (stored?.size) return stored;
    // These resolvers only return URLs cached from the original local Blob.
    // Never substitute previews or fetch a record's arbitrary remote URL.
    const url = await (image ? resolveImageUrl(storageKey) : resolveMediaUrl(storageKey));
    if (!url.startsWith("blob:")) return null;
    let blob: Blob;
    try {
        const response = await fetch(url, { credentials: "omit" });
        if (!response.ok) return null;
        blob = await response.blob();
    } catch { return null; }
    if (!blob.size) return null;
    await (image ? setImageBlob(storageKey, blob) : setMediaBlob(storageKey, blob));
    return blob;
}

async function downloadMissingFiles<T>(config: WebdavSyncConfig, domain: DomainKey, data: T, remoteFiles: AppSyncFile[], sharedFiles: Promise<AppSyncFile[]>, onProgress?: AppSyncProgress) {
    const remoteFileMap = new Map(remoteFiles.map((item) => [item.storageKey, item]));
    const tasks: string[] = [];
    const storageKeys = collectStorageKeys(data);
    let scanned = 0;
    for (const storageKey of storageKeys) {
        const localBlob = await localMediaBlob(storageKey);
        scanned += 1;
        if (localBlob) {
            emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "检查缺失媒体", current: scanned, total: storageKeys.length, status: "active" });
            continue;
        }
        tasks.push(storageKey);
        emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "检查缺失媒体", current: scanned, total: storageKeys.length, status: "active" });
    }
    if (!tasks.length) {
        emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "媒体已齐全", current: 1, total: 1, status: "active" });
        return;
    }
    let downloaded = 0;
    await runWithConcurrency(tasks, FILE_CONCURRENCY, async (storageKey) => {
        const primary = remoteFileMap.get(storageKey);
        let source = primary, blob = primary ? await downloadWebdavFile(config, primary.path) : null;
        if (!blob) {
            const candidates = (await sharedFiles).filter(file => file.storageKey === storageKey && file.sha256 && file.path !== primary?.path && (!primary || file.sha256 === primary.sha256 && file.bytes === primary.bytes));
            if (!primary && new Set(candidates.map(file => `${file.sha256}:${file.bytes}`)).size > 1) throw new Error(i18n.t("config.webdav.errors.mediaCorrupt", { key: mediaLocation(data, storageKey) }));
            for (const file of candidates) {
                blob = await downloadWebdavFile(config, file.path);
                if (blob) { source = file; break; }
            }
        }
        if (!blob || !source) throw new Error(i18n.t("config.webdav.errors.mediaMissing", { key: mediaLocation(data, storageKey) }));
        if (blob.size !== source.bytes || (source.sha256 && await blobSha256(blob) !== source.sha256)) throw new Error(i18n.t("config.webdav.errors.mediaCorrupt", { key: mediaLocation(data, storageKey) }));
        const typedBlob = blob.slice(0, blob.size, source.mimeType);
        await (storageKey.startsWith("image:") ? setImageBlob(storageKey, typedBlob) : setMediaBlob(storageKey, typedBlob));
        downloaded += 1;
        emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "下载媒体", current: downloaded, total: tasks.length, status: "active" });
    });
}

async function uploadChangedFiles<T>(config: WebdavSyncConfig, domain: DomainKey, data: T, remoteFiles: AppSyncFile[], onProgress?: AppSyncProgress) {
    const remoteFileMap = new Map(remoteFiles.map((item) => [item.storageKey, item]));
    const files: AppSyncFile[] = [];
    const tasks: Array<{ item: AppSyncFile; blob: Blob }> = [];
    let uploadedFiles = 0;
    let uploadedBytes = 0;

    const storageKeys = collectStorageKeys(data);
    let scanned = 0;
    for (const storageKey of storageKeys) {
        const blob = await localMediaBlob(storageKey);
        const remoteFile = remoteFileMap.get(storageKey);
        if (!blob) {
            if (remoteFile) files.push(remoteFile);
            else throw new Error(i18n.t("config.webdav.errors.mediaMissing", { key: mediaLocation(data, storageKey) }));
            scanned += 1;
            emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "检查本地媒体", current: scanned, total: storageKeys.length, status: "active" });
            continue;
        }
        const sha256 = await blobSha256(blob);
        const unchanged = remoteFile?.sha256 === sha256 && await webdavFileExists(config, remoteFile.path);
        const item: AppSyncFile = {
            storageKey,
            path: unchanged ? remoteFile.path : domainPath(domain, `files/${Array.from(new TextEncoder().encode(storageKey), byte => byte.toString(16).padStart(2, "0")).join("")}-${sha256}.${fileExtension(blob.type, storageKey)}`),
            mimeType: blob.type || remoteFile?.mimeType || "application/octet-stream",
            bytes: blob.size,
            sha256,
        };
        files.push(item);
        if (!unchanged) tasks.push({ item, blob });
        scanned += 1;
        emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "检查本地媒体", current: scanned, total: storageKeys.length, status: "active" });
    }

    if (!tasks.length) {
        emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "媒体无需上传", current: 1, total: 1, status: "active" });
        return { files, uploadedFiles, uploadedBytes };
    }

    await runWithConcurrency(tasks, FILE_CONCURRENCY, async ({ item, blob }) => {
        await uploadWebdavFile(config, item.path, blob, item.mimeType);
        uploadedFiles += 1;
        uploadedBytes += blob.size;
        emitProgress(onProgress, { domain, label: domainLabel(domain), stage: `上传媒体 ${formatBytes(blob.size)}`, current: uploadedFiles, total: tasks.length, status: "active" });
    });

    return { files, uploadedFiles, uploadedBytes };
}

async function hydrateAsset(asset: Asset): Promise<Asset> {
    if (asset.kind === "image" && asset.data.storageKey) {
        const dataUrl = await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl);
        return { ...asset, coverUrl: asset.coverUrl.startsWith("blob:") ? dataUrl : asset.coverUrl, data: { ...asset.data, dataUrl } };
    }
    if (asset.kind === "video" && asset.data.storageKey) {
        const url = await resolveMediaUrl(asset.data.storageKey, asset.data.url);
        return { ...asset, coverUrl: asset.coverUrl.startsWith("blob:") ? url : asset.coverUrl, data: { ...asset.data, url } };
    }
    return asset;
}

async function readStoredLogs(store: LogStore) {
    const logs: StoredLog[] = [];
    await store.iterate<StoredLog, void>((value) => {
        if (value && typeof value === "object" && getStringField(value, "id")) logs.push(value);
    });
    return logs;
}

async function replaceStoredLogs(store: LogStore, logs: StoredLog[]) {
    await store.clear();
    await runWithConcurrency(logs, FILE_CONCURRENCY, async (log) => {
        const id = getStringField(log, "id");
        if (id) await store.setItem(id, log);
    });
}

function collectStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return [...keys];
    if ("storageKey" in value && typeof value.storageKey === "string" && storageKeyPattern.test(value.storageKey)) keys.add(value.storageKey);
    if ("references" in value && Array.isArray(value.references)) for (const key of value.references) if (typeof key === "string" && storageKeyPattern.test(key)) keys.add(key);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectStorageKeys(child, keys)) : collectStorageKeys(item, keys)));
    return [...keys];
}

function mediaLocation(data: unknown, key: string) {
    if (data && typeof data === "object") for (const rows of Object.values(data)) {
        if (!Array.isArray(rows)) continue;
        const row = rows.find(item => collectStorageKeys(item).includes(key));
        if (row && typeof row.title === "string" && row.title) return `${row.title} · ${key}`;
    }
    return key;
}

function domainPath(domain: DomainKey, path: string) {
    return `${domain}/${path}`;
}

function domainLabel(domain: DomainKey) {
    if (domain === "canvas") return "画布";
    if (domain === "assets") return "我的资产";
    if (domain === "image-workbench") return "生图工作台";
    return "视频创作台";
}

function emitProgress(onProgress: AppSyncProgress | undefined, event: AppSyncProgressEvent) {
    onProgress?.(event);
}

function getStringField(item: Record<string, unknown>, key: string) {
    const value = item[key];
    return typeof value === "string" ? value : "";
}

function fileExtension(mimeType: string, storageKey: string) {
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("webm")) return "webm";
    if (mimeType.includes("wav")) return "wav";
    if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
    return storageKey.startsWith("image:") ? "png" : "bin";
}

function waitForHydration<T extends { hydrated: boolean }>(store: { getState: () => T; subscribe: (listener: (state: T) => void) => () => void }) {
    if (store.getState().hydrated) return Promise.resolve();
    return new Promise<void>((resolve) => {
        const unsubscribe = store.subscribe((state) => {
            if (!state.hydrated) return;
            unsubscribe();
            resolve();
        });
    });
}

async function runWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>) {
    const results = new Array<R>(items.length);
    let nextIndex = 0;
    const workers = await Promise.allSettled(
        Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (nextIndex < items.length) {
                const index = nextIndex++;
                results[index] = await worker(items[index], index);
            }
        }),
    );
    workers.forEach(fulfilled);
    return results;
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function fulfilled<T>(result: PromiseSettledResult<T>): T {
    if (result.status === "rejected") throw result.reason;
    return result.value;
}
