import type { AssetExportItem } from "@/lib/import-validation";
import { deleteStoredMedia, getMediaBlob, setMediaBlob } from "./file-storage";
import { deleteStoredImages, getImageBlob, setImageBlob } from "./image-storage";

/** Validation must finish before writes. Await every write before restoring any original data. */
export async function importPackageFiles(files: AssetExportItem[], zip: ReadonlyMap<string, Blob>) {
    const unique = [...new Map(files.map(item => [item.storageKey, item])).values()];
    const backups = await Promise.all(unique.map(async item => ({ item, blob: await (item.storageKey.startsWith("image:") ? getImageBlob(item.storageKey) : getMediaBlob(item.storageKey)) })));
    const write = (key: string, blob: Blob) => key.startsWith("image:") ? setImageBlob(key, blob) : setMediaBlob(key, blob);
    const results = await Promise.allSettled(unique.map(async item => {
        const blob = zip.get(item.path)!;
        await write(item.storageKey, blob.slice(0, blob.size, item.mimeType));
    }));
    const failed = results.find(result => result.status === "rejected");
    if (!failed || failed.status !== "rejected") return;
    const restored = await Promise.allSettled(backups.map(({ item, blob }) => blob
        ? write(item.storageKey, blob)
        : item.storageKey.startsWith("image:") ? deleteStoredImages([item.storageKey]) : deleteStoredMedia([item.storageKey])));
    const failures = restored.filter(result => result.status === "rejected");
    if (failures.length) throw new AggregateError([failed.reason, ...failures.map(result => result.reason)], "导入失败，部分媒体恢复失败，请检查本机存储空间后重试");
    throw failed.reason;
}
