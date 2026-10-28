import { fileTypeFromBuffer } from "file-type/core";
import i18n from "@/i18n";
import { getImageBlob, imageToDataUrl } from "@/services/image-storage";
import { dataUrlToFile } from "@/lib/image-utils";
import type { ReferenceImage } from "@/types/image";

// Storage headers and canvas titles are not authoritative image formats. Validate
// each original before submitting the whole edit; never send an empty file.
export async function prepareReferenceFiles(references: ReferenceImage[], signal?: AbortSignal) {
    const files: File[] = [];
    for (const [index, reference] of references.entries()) {
        signal?.throwIfAborted();
        try {
            const source = reference.storageKey
                ? await getImageBlob(reference.storageKey)
                : dataUrlToFile({ ...reference, dataUrl: await imageToDataUrl(reference, { signal }) });
            if (!source?.size) throw new Error("Empty reference");
            const type = await fileTypeFromBuffer(await source.arrayBuffer());
            const blob = new Blob([source], { type: type?.mime || source.type });
            const bitmap = await createImageBitmap(blob);
            let output = blob, ext = type?.ext;
            try {
                if (!type || !["image/png", "image/jpeg", "image/webp"].includes(type.mime)) {
                    // Other decodable formats become a still PNG at the original
                    // dimensions. Already supported images retain their bytes.
                    const canvas = document.createElement("canvas");
                    canvas.width = bitmap.width; canvas.height = bitmap.height;
                    const context = canvas.getContext("2d");
                    if (!context) throw new Error("Image encoder unavailable");
                    context.drawImage(bitmap, 0, 0);
                    output = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Image encoding failed")), "image/png"));
                    ext = "png";
                }
            } finally { bitmap.close(); }
            signal?.throwIfAborted();
            files.push(new File([output], `reference-${index + 1}.${ext}`, { type: output.type }));
        } catch (error) {
            signal?.throwIfAborted();
            throw new Error(i18n.t("apiErrors.invalidReferenceImage", { index: index + 1, name: reference.name || i18n.t("imageReferences.label", { index: index + 1 }) }), { cause: error });
        }
    }
    return files;
}
