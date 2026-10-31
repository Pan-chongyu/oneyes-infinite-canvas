import { saveAs } from "file-saver";

import { createZip, readZip } from "@/lib/zip";
import { validateAssetExport, type AssetExportFile, type AssetExportItem } from "@/lib/import-validation";
import { deleteStoredMedia, getMediaBlob, setMediaBlob } from "@/services/file-storage";
import { deleteStoredImages, getImageBlob, setImageBlob } from "@/services/image-storage";
import type { Asset } from "@/stores/use-asset-store";

export async function exportAssets(assets: Asset[], filename: string) {
    const files: AssetExportItem[] = [];
    const zipFiles: { name: string; data: BlobPart }[] = [];

    await Promise.all(
        assets.map(async (asset) => {
            if (asset.kind !== "image" && asset.kind !== "video") return;
            const storageKey = asset.data.storageKey;
            if (!storageKey) return;
            const blob = asset.kind === "image" ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
            if (!blob) return;
            const path = `files/${safeFileName(storageKey)}.${fileExtension(blob.type, asset.kind)}`;
            files.push({ storageKey, path, mimeType: blob.type || asset.data.mimeType, bytes: blob.size });
            zipFiles.push({ name: path, data: blob });
        }),
    );

    const data: AssetExportFile = { app: "infinite-canvas", version: 1, exportedAt: new Date().toISOString(), assets, files };
    const zip = await createZip([{ name: "assets.json", data: JSON.stringify(data, null, 2) }, ...zipFiles]);
    saveAs(zip, filename);
}

export async function readAssetPackage(file: File) {
    const zip = await readZip(file);
    const assetFile = zip.get("assets.json");
    if (!assetFile) throw new Error("missing assets.json");
    const data = validateAssetExport(JSON.parse(await assetFile.text()) as unknown, zip);
    const backups = await Promise.all(data.files.map(async (item) => ({ item, blob: item.storageKey.startsWith("image:") ? await getImageBlob(item.storageKey) : await getMediaBlob(item.storageKey) })));
    try {
        await Promise.all(data.files.map(async (item) => {
            const blob = zip.get(item.path)!;
            const typedBlob = blob.type ? blob : blob.slice(0, blob.size, item.mimeType);
            await (item.storageKey.startsWith("image:") ? setImageBlob(item.storageKey, typedBlob) : setMediaBlob(item.storageKey, typedBlob));
        }));
    } catch (error) {
        await Promise.all(backups.map(({ item, blob }) => {
            if (blob) return item.storageKey.startsWith("image:") ? setImageBlob(item.storageKey, blob) : setMediaBlob(item.storageKey, blob);
            return item.storageKey.startsWith("image:") ? deleteStoredImages([item.storageKey]) : deleteStoredMedia([item.storageKey]);
        }));
        throw error;
    }
    return data.assets;
}

function safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, "_");
}

function fileExtension(mimeType: string, kind: Asset["kind"]) {
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("webm")) return "webm";
    return kind === "image" ? "png" : "bin";
}
