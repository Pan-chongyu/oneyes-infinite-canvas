import type { CanvasExportFile } from "@/types/canvas-export";
import type { Asset } from "@/stores/use-asset-store";
import { storageKeyPattern } from "@/services/app-sync-data";
import { validateZipEntryName } from "./zip";

type RecordValue = Record<string, unknown>;

export type AssetExportItem = { storageKey: string; path: string; mimeType: string; bytes: number };
export type AssetExportFile = { app: "infinite-canvas"; version: 1; exportedAt: string; assets: Asset[]; files: AssetExportItem[] };

export function validateCanvasExport(value: unknown, zip: ReadonlyMap<string, Blob>): CanvasExportFile {
    if (!record(value) || value.app !== "infinite-canvas" || value.version !== 3 || !isoDate(value.exportedAt) || !Array.isArray(value.projects) || !value.projects.length) throw new Error("画布导出文件格式无效");
    const projects = value.projects as unknown[];
    const projectIds = new Set<string>();
    const storageKeys = new Set<string>();
    const filePaths = new Set<string>();
    for (const item of projects) {
        if (!record(item) || !record(item.project) || !nonEmptyString(item.project.id) || projectIds.has(item.project.id) || !nonEmptyString(item.project.title) || !isoDate(item.project.createdAt) || !isoDate(item.project.updatedAt) || !Array.isArray(item.project.nodes) || !Array.isArray(item.project.connections) || !Array.isArray(item.project.chatSessions) || !Array.isArray(item.files)) throw new Error("画布项目数据无效");
        projectIds.add(item.project.id);
        for (const node of item.project.nodes) if (!record(node) || !nonEmptyString(node.id) || !nonEmptyString(node.type) || !nonEmptyString(node.title) || !record(node.position)) throw new Error("画布节点数据无效");
        validatePackageFiles(item.files, zip, "画布", storageKeys, filePaths);
    }
    rejectUnexpectedEntries(zip, "projects.json", projects.flatMap((item) => (item as RecordValue).files as RecordValue[]).map((item) => String(item.path)));
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

function validatePackageFiles(value: unknown, zip: ReadonlyMap<string, Blob>, label: string, sharedKeys = new Set<string>(), sharedPaths = new Set<string>()) {
    if (!Array.isArray(value)) throw new Error(`${label}文件清单无效`);
    const keys = new Set<string>();
    const paths = new Set<string>();
    for (const item of value) {
        if (!record(item) || !nonEmptyString(item.storageKey) || !storageKeyPattern.test(item.storageKey) || !nonEmptyString(item.path) || paths.has(item.path) || keys.has(item.storageKey) || sharedPaths.has(item.path) || sharedKeys.has(item.storageKey) || !nonEmptyString(item.mimeType) || typeof item.bytes !== "number" || !Number.isSafeInteger(item.bytes) || item.bytes < 0) throw new Error(`${label}媒体清单无效`);
        validateZipEntryName(item.path);
        if (!zip.has(item.path) || item.path === "projects.json" || item.path === "assets.json") throw new Error(`${label}媒体文件缺失或路径冲突`);
        if (zip.get(item.path)!.size !== item.bytes) throw new Error(`${label}媒体大小校验失败`);
        keys.add(item.storageKey);
        paths.add(item.path);
        sharedKeys.add(item.storageKey);
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
