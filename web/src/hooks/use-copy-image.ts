import { useState } from "react";
import { App } from "antd";
import { useTranslation } from "react-i18next";
import { getImageBlob, fetchImageBlob } from "@/services/image-storage";
import { writeImageToClipboard } from "@/lib/canvas/system-clipboard";

export function useCopyImage() {
    const [copying, setCopying] = useState(false), { message } = App.useApp(), { t } = useTranslation();
    const copyImage = async (image: { storageKey?: string; content?: string }) => {
        if (copying) return;
        setCopying(true);
        try {
            await writeImageToClipboard((async () => {
                const local = image.storageKey ? await getImageBlob(image.storageKey) : null;
                if (local) return local;
                if (image.content) return fetchImageBlob(image.content);
                throw new Error("Missing original");
            })());
            message.success(t("canvas.imageTools.imageCopied"));
        } catch { message.error(t("canvas.imageTools.copyImageFailed")); }
        finally { setCopying(false); }
    };
    return { copyImage, copying };
}
