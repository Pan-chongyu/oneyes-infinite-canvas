import type { CanvasDeletedProject, CanvasProject } from "@/stores/canvas/use-canvas-store";

export type AppSyncDomainKey = "canvas" | "assets" | "image-workbench" | "video-workbench";
export type CanvasDomainData = { projects: CanvasProject[]; deleted: CanvasDeletedProject[] };
export type AppSyncFile = { storageKey: string; path: string; mimeType: string; bytes: number; sha256?: string };
export type DomainManifest<T> = { app: "infinite-canvas"; version: 1; domain: AppSyncDomainKey; exportedAt: string; data: T; files: AppSyncFile[] };
export const storageKeyPattern = /^(image|video|audio|file|video-reference|audio-reference):.+/;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const identified = (value: unknown) => record(value) && typeof value.id === "string" && Boolean(value.id);
const timestamp = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));

export function parseDomainManifest<T>(text: string, domain: AppSyncDomainKey): DomainManifest<T> {
    const value: unknown = JSON.parse(text);
    if (!record(value) || value.app !== "infinite-canvas" || value.version !== 1 || value.domain !== domain || !record(value.data) || !Array.isArray(value.files)) throw new Error("Invalid manifest");
    const data = value.data;
    const rows = domain === "canvas" ? data.projects : domain === "assets" ? data.assets : data.logs;
    if (!Array.isArray(rows) || rows.some(row => !identified(row)) || new Set(rows.map(row => row.id)).size !== rows.length) throw new Error("Invalid records");
    if (domain === "canvas" && (rows.some(row => !timestamp(row.updatedAt) || !Array.isArray(row.nodes) || !Array.isArray(row.connections)) || !Array.isArray(data.deleted) || data.deleted.some(row => !identified(row) || !timestamp(row.deletedAt)))) throw new Error("Invalid canvases");
    if (domain === "assets" && rows.some(row => !timestamp(row.updatedAt) || !["text", "image", "video"].includes(row.kind) || !record(row.data) || !Array.isArray(row.tags) || typeof row.coverUrl !== "string")) throw new Error("Invalid assets");
    const keys = new Set(), paths = new Set();
    for (const file of value.files) {
        if (!record(file) || typeof file.storageKey !== "string" || !storageKeyPattern.test(file.storageKey) || typeof file.path !== "string" || !file.path.startsWith(`${domain}/files/`) || file.path.split("/").some(part => !part || part === "." || part === "..") || /[\\\x00-\x1f]|%(?:2e|2f|5c)/i.test(file.path) || typeof file.mimeType !== "string" || !Number.isSafeInteger(file.bytes) || Number(file.bytes) <= 0 || (file.sha256 !== undefined && (typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256))) || keys.has(file.storageKey) || paths.has(file.path)) throw new Error("Invalid media entry");
        keys.add(file.storageKey); paths.add(file.path);
    }
    return value as DomainManifest<T>;
}

export function mergeCanvasData(local: CanvasDomainData, remote: CanvasDomainData): CanvasDomainData {
    const deletedAtById = new Map<string, string>();
    for (const item of [...remote.deleted, ...local.deleted]) {
        const current = deletedAtById.get(item.id);
        if (!current || Date.parse(item.deletedAt) >= Date.parse(current)) deletedAtById.set(item.id, item.deletedAt);
    }
    const projects = mergeById(local.projects, remote.projects, "updatedAt").filter(project => {
        const deletedAt = deletedAtById.get(project.id);
        if (!deletedAt) return true;
        if (getTime(project, "updatedAt") > Date.parse(deletedAt)) { deletedAtById.delete(project.id); return true; }
        return false;
    });
    return { projects, deleted: [...deletedAtById.entries()].map(([id, deletedAt]) => ({ id, deletedAt })) };
}

export function mergeById<T extends { id?: string }>(local: T[], remote: T[], timeKey: string) {
    const items = new Map<string, T>();
    for (const item of remote) if (item.id) items.set(item.id, item);
    for (const item of local) {
        if (!item.id) continue;
        const current = items.get(item.id);
        if (!current || getTime(item, timeKey) >= getTime(current, timeKey)) items.set(item.id, item);
    }
    return [...items.values()].sort((a, b) => getTime(b, timeKey) - getTime(a, timeKey));
}

function getTime(item: object, key: string) {
    const value = (item as Record<string, unknown>)[key];
    return typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" ? Date.parse(value) || 0 : 0;
}

export async function blobSha256(blob: Blob) {
    return [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
