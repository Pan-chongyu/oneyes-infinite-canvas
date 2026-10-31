import type { CanvasExportFile } from "@/types/canvas-export";
import type { Asset } from "@/stores/use-asset-store";
import { blobSha256, storageKeyPattern } from "@/services/app-sync-data";
import { validateZipEntryName } from "./zip";

type RecordValue = Record<string, unknown>;

export type AssetExportItem = { storageKey: string; path: string; mimeType: string; bytes: number };
export type AssetExportFile = { app: "infinite-canvas"; version: 1; exportedAt: string; assets: Asset[]; files: AssetExportItem[] };

export async function validateCanvasExport(value: unknown, zip: ReadonlyMap<string, Blob>): Promise<CanvasExportFile> {
    if (!record(value) || value.app !== "infinite-canvas" || value.version !== 3 || !isoDate(value.exportedAt) || !Array.isArray(value.projects) || !value.projects.length) throw new Error("画布导出文件格式无效");
    const projects = value.projects as unknown[];
    const projectIds = new Set<string>();
    const filePaths = new Set<string>();
    for (const item of projects) {
        if (!record(item) || !record(item.project) || !nonEmptyString(item.project.id) || projectIds.has(item.project.id) || !nonEmptyString(item.project.title) || !isoDate(item.project.createdAt) || !isoDate(item.project.updatedAt) || !Array.isArray(item.project.nodes) || !Array.isArray(item.project.connections) || !Array.isArray(item.project.chatSessions) || !Array.isArray(item.files)) throw new Error("画布项目数据无效");
        projectIds.add(item.project.id);
        const nodeIds = new Set<string>();
        for (const node of item.project.nodes) {
            if (!record(node) || !nonEmptyString(node.id) || nodeIds.has(node.id) || !nonEmptyString(node.type) || typeof node.title !== "string" || !record(node.position) || !finite(node.position.x) || !finite(node.position.y) || !finite(node.width) || node.width <= 0 || !finite(node.height) || node.height <= 0 || (node.metadata !== undefined && !record(node.metadata))) throw new Error("画布节点数据无效");
            nodeIds.add(node.id);
        }
        const connectionIds = new Set<string>();
        for (const connection of item.project.connections) {
            if (!record(connection) || !nonEmptyString(connection.id) || connectionIds.has(connection.id) || typeof connection.fromNodeId !== "string" || typeof connection.toNodeId !== "string" || !nodeIds.has(connection.fromNodeId) || !nodeIds.has(connection.toNodeId)) throw new Error("画布连线数据无效");
            connectionIds.add(connection.id);
        }
        for (const session of item.project.chatSessions) if (!record(session) || !nonEmptyString(session.id) || typeof session.title !== "string" || !Array.isArray(session.messages) || !isoDate(session.createdAt) || !isoDate(session.updatedAt)) throw new Error("画布对话数据无效");
        validatePackageFiles(item.files, zip, "画布", filePaths);
    }
    const files = projects.flatMap((item) => (item as RecordValue).files as AssetExportItem[]);
    rejectUnexpectedEntries(zip, "projects.json", files.map((item) => item.path));
    const shared = new Map<string, AssetExportItem>();
    const hashes = new Map<string, string>();
    for (const item of files) {
        const existing = shared.get(item.storageKey);
        if (existing) {
            if (existing.bytes !== item.bytes || existing.mimeType !== item.mimeType) throw new Error("共用媒体内容冲突");
            const hash = hashes.get(existing.path) || await blobSha256(zip.get(existing.path)!);
            hashes.set(existing.path, hash);
            if (hash !== await blobSha256(zip.get(item.path)!)) throw new Error("共用媒体内容冲突");
        } else shared.set(item.storageKey, item);
    }
    return value as CanvasExportFile;
}

export function validateAssetExport(value: unknown, zip: ReadonlyMap<string, Blob>): AssetExportFile {
    if (!record(value) || value.app !== "infinite-canvas" || value.version !== 1 || !isoDate(value.exportedAt) || !Array.isArray(value.assets) || !Array.isArray(value.files)) throw new Error("素材导出文件格式无效");
    const assets = value.assets as unknown[];
    const assetIds = new Set<string>();
    for (const asset of assets) {
        if (!record(asset) || !nonEmptyString(asset.id) || assetIds.has(asset.id) || !["text", "image", "video"].includes(String(asset.kind)) || !nonEmptyString(asset.title) || !Array.isArray(asset.tags) || !record(asset.data)) throw new Error("素材数据无效");
        assetIds.add(asset.id);
    }
    validatePackageFiles(value.files, zip, "素材");
    rejectUnexpectedEntries(zip, "assets.json", (value.files as RecordValue[]).map((item) => String(item.path)));
    return value as AssetExportFile;
}

function validatePackageFiles(value: unknown, zip: ReadonlyMap<string, Blob>, label: string, sharedPaths = new Set<string>()) {
    if (!Array.isArray(value)) throw new Error(`${label}文件清单无效`);
    const keys = new Set<string>();
    const paths = new Set<string>();
    for (const item of value) {
        if (!record(item) || !nonEmptyString(item.storageKey) || !storageKeyPattern.test(item.storageKey) || !nonEmptyString(item.path) || paths.has(item.path) || keys.has(item.storageKey) || sharedPaths.has(item.path) || !nonEmptyString(item.mimeType) || typeof item.bytes !== "number" || !Number.isSafeInteger(item.bytes) || item.bytes < 0) throw new Error(`${label}媒体清单无效`);
        validateZipEntryName(item.path);
        if (!zip.has(item.path) || item.path === "projects.json" || item.path === "assets.json") throw new Error(`${label}媒体文件缺失或路径冲突`);
        if (zip.get(item.path)!.size !== item.bytes) throw new Error(`${label}媒体大小校验失败`);
        keys.add(item.storageKey);
        paths.add(item.path);
        sharedPaths.add(item.path);
    }
}

function rejectUnexpectedEntries(zip: ReadonlyMap<string, Blob>, manifest: string, paths: string[]) {
    const allowed = new Set([manifest, ...paths]);
    for (const name of zip.keys()) if (!allowed.has(name)) throw new Error("ZIP 包含未声明文件");
}

function record(value: unknown): value is RecordValue {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function isoDate(value: unknown) {
    return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function finite(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}
