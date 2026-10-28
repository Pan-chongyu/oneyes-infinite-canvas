import i18n from "@/i18n";
import { getImageBlob, imageToDataUrl } from "@/services/image-storage";
import { dataUrlToFile } from "@/lib/image-utils";
import type { ReferenceImage } from "@/types/image";

// Re-encode decoded pixels, not camera extensions or weakly compressed canvas
// PNGs. A disposable worker keeps encoding cancellable and off the UI thread.
function normalizeReference(source: Blob, signal?: AbortSignal): Promise<Blob> {
    signal?.throwIfAborted();
    const worker = new Worker(new URL("./image-reference.worker.ts", import.meta.url), { type: "module" });
    return new Promise((resolve, reject) => {
        const cleanup = () => { signal?.removeEventListener("abort", abort); worker.terminate(); };
        const abort = () => { cleanup(); reject(signal?.reason); };
        signal?.addEventListener("abort", abort, { once: true });
        worker.onerror = event => { event.preventDefault(); cleanup(); reject(new Error("Reference encoder failed")); };
        worker.onmessage = ({ data }: MessageEvent<{ blob?: Blob }>) => {
            cleanup();
            if (data.blob?.size) resolve(data.blob);
            else reject(new Error("Reference image could not be decoded or encoded"));
        };
        worker.postMessage(source);
    });
}

export async function prepareReferenceFiles(references: ReferenceImage[], signal?: AbortSignal) {
    const files: File[] = [];
    for (const [index, reference] of references.entries()) {
        signal?.throwIfAborted();
        try {
            const source = reference.storageKey
                ? await getImageBlob(reference.storageKey)
                : dataUrlToFile({ ...reference, dataUrl: await imageToDataUrl(reference, { signal }) });
            if (!source?.size) throw new Error("Empty reference");
            const output = await normalizeReference(source, signal);
            signal?.throwIfAborted();
            files.push(new File([output], `reference-${index + 1}.${output.type === "image/webp" ? "webp" : "png"}`, { type: output.type }));
        } catch (error) {
            signal?.throwIfAborted();
            throw new Error(i18n.t("apiErrors.invalidReferenceImage", { index: index + 1, name: reference.name || i18n.t("imageReferences.label", { index: index + 1 }) }), { cause: error });
        }
    }
    return files;
}
