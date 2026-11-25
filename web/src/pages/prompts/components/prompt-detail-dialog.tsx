import { Copy, FolderPlus, ImageOff } from "lucide-react";
import { Button, Modal } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { formatPromptDate, type Prompt } from "@/services/api/prompts";

export function PromptDetailDialog({ prompt, onClose, onCopy, onSaveAsset }: { prompt: Prompt | null; onClose: () => void; onCopy: (prompt: string) => void; onSaveAsset?: (prompt: Prompt) => void }) {
    const { i18n, t } = useTranslation();
    const images = prompt ? Array.from(new Set([prompt.coverUrl, ...prompt.referenceImageUrls].filter(Boolean))) : [];
    const created = prompt && formatPromptDate(prompt.createdAt, i18n.resolvedLanguage);
    const updated = prompt && formatPromptDate(prompt.updatedAt, i18n.resolvedLanguage);

    return (
        <Modal
            title={<span className="line-clamp-2 text-lg leading-6 [overflow-wrap:anywhere]" title={prompt?.title}>{prompt?.title}</span>}
            open={Boolean(prompt)}
            onCancel={onClose}
            width={960}
            centered
            destroyOnHidden
            classNames={{ body: "thin-scrollbar @container" }}
            styles={{
                container: { display: "flex", flexDirection: "column", padding: 0, maxHeight: "calc(100dvh - 32px)", overflow: "hidden", borderRadius: 16 },
                header: { flexShrink: 0, margin: 0, padding: "17px 52px 16px 20px" },
                body: { minHeight: 0, overflowY: "auto", overscrollBehavior: "contain" },
                footer: { flexShrink: 0, margin: 0 },
            }}
            footer={prompt && <div className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3 sm:px-5">
                {onSaveAsset && <Button icon={<FolderPlus className="size-4" />} onClick={() => onSaveAsset(prompt)}>{t("common.addToAssets")}</Button>}
                <Button type="primary" icon={<Copy className="size-4" />} onClick={() => onCopy(prompt.prompt)}>{t("common.copyPrompt")}</Button>
            </div>}
        >
            {prompt && (
                <div className={cn("grid gap-4 border-t border-border px-4 py-4 sm:px-5", images.length > 0 && "@min-[650px]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @min-[650px]:gap-6")}>
                    {images.length > 0 && <PromptPreview key={`${prompt.sourceId}:${prompt.id}`} images={images} />}
                    <div className="min-w-0 space-y-3">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted-foreground">
                            <span className="[overflow-wrap:anywhere]">{prompt.category}</span>
                            {[...new Set(prompt.tags)].map((tag) => <span key={tag} className="rounded bg-muted px-1.5 py-0.5 [overflow-wrap:anywhere]">{tag}</span>)}
                        </div>
                        {prompt.description && prompt.description !== prompt.prompt && <p className="m-0! text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">{prompt.description}</p>}
                        {prompt.preview && prompt.preview !== prompt.prompt && prompt.preview !== prompt.description && <div className="rounded-md bg-muted/50 px-3 py-2 text-xs leading-5 whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">{prompt.preview}</div>}
                        <div className="rounded-lg border border-border bg-muted/25 p-3.5 text-sm leading-7 whitespace-pre-wrap text-foreground select-text [overflow-wrap:anywhere]">{prompt.prompt}</div>
                        {(created || updated) && <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            {created && <span>{t("common.created", { date: created })}</span>}
                            {updated && <span>{t("common.updated", { date: updated })}</span>}
                        </div>}
                    </div>
                </div>
            )}
        </Modal>
    );
}

function PromptPreview({ images }: { images: string[] }) {
    const { t } = useTranslation();
    const [selected, setSelected] = useState(0);
    const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());
    const index = images[selected] ? selected : 0;
    const image = images[index];
    const markFailed = (url: string) => setFailedImages((current) => current.has(url) ? current : new Set([...current, url]));

    return <div className="min-w-0 self-start @min-[650px]:sticky @min-[650px]:top-4">
        <div className="grid h-[clamp(130px,40dvh,360px)] place-items-center overflow-hidden rounded-lg border border-border bg-muted/55">
            {failedImages.has(image) ? <span className="flex items-center gap-2 text-xs text-muted-foreground"><ImageOff className="size-4" aria-hidden />{t("prompts.previewUnavailable")}</span>
                : <img key={image} src={image} alt={t("prompts.previewImage", { index: index + 1 })} className="h-full min-h-0 w-full object-contain" onError={() => markFailed(image)} />}
        </div>
        {images.length > 1 && <div className="thin-scrollbar mt-2 flex gap-2 overflow-x-auto px-0.5 py-1">
            {images.map((url, index) => <button
                key={url}
                type="button"
                aria-label={t("prompts.previewImage", { index: index + 1 })}
                aria-pressed={url === image}
                className="size-12 shrink-0 cursor-pointer overflow-hidden rounded-md border border-border bg-muted/55 focus-visible:outline-2 focus-visible:-outline-offset-2 aria-pressed:border-foreground"
                onClick={() => setSelected(index)}
            >
                {failedImages.has(url) ? <ImageOff className="mx-auto size-4 text-muted-foreground" aria-hidden />
                    : <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" onError={() => markFailed(url)} />}
            </button>)}
        </div>}
    </div>;
}
