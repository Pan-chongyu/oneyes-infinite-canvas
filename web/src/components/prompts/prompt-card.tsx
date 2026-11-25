import { Copy, FileText, FolderPlus, Maximize2 } from "lucide-react";
import { useState } from "react";
import { Card } from "antd";
import { useTranslation } from "react-i18next";

import type { Prompt } from "@/services/api/prompts";
import { cn } from "@/lib/utils";

type PromptCardProps = {
    item: Prompt;
    onOpen: () => void;
} & ({ compact: true } | { compact?: false; onCopy: () => void; onSave: () => void });

export function PromptCard(props: PromptCardProps) {
    const { item, onOpen, compact } = props;
    const { t } = useTranslation();
    const [failedCover, setFailedCover] = useState("");
    const hasCover = item.coverUrl && item.coverUrl !== failedCover;
    const cover = (
        <span className={cn("relative block w-full overflow-hidden bg-muted/60", compact ? "aspect-square" : "aspect-[4/3]")}>
            {hasCover ? (
                <img src={item.coverUrl} alt="" className="h-full w-full object-cover motion-safe:transition-transform motion-safe:duration-300 motion-safe:group-hover:scale-[1.025]"
                    loading="lazy" decoding="async" onError={() => setFailedCover(item.coverUrl)} />
            ) : (
                <span className="grid h-full place-items-center text-muted-foreground">
                    <FileText className="size-7" strokeWidth={1.5} aria-hidden />
                </span>
            )}
            {!compact && <span className="absolute end-2 top-2 grid size-7 place-items-center rounded-md bg-background/85 text-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 motion-safe:transition-opacity">
                <Maximize2 className="size-3.5" aria-hidden />
            </span>}
        </span>
    );

    if (compact) return (
        <Card hoverable className="overflow-hidden" styles={{ body: { padding: 0 } }}>
            <button type="button" className="group block w-full cursor-pointer text-start focus-visible:outline-2 focus-visible:-outline-offset-2" onClick={onOpen}>
                {cover}
                <span className="block truncate px-3 py-2.5 text-sm font-semibold">{item.title}</span>
            </button>
        </Card>
    );

    const tags = Array.from(new Set(item.tags));
    const actionClass = "inline-flex min-h-9 min-w-0 cursor-pointer items-center justify-center gap-1.5 px-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 motion-safe:transition-colors";

    return (
        <article className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground">
            <button type="button" className="group relative flex w-full flex-1 cursor-pointer flex-col text-start focus-visible:outline-2 focus-visible:-outline-offset-2" onClick={onOpen} aria-label={t("prompts.openDetails", { title: item.title })}>
                {cover}
                <span className="flex w-full min-w-0 flex-1 flex-col px-3.5 pt-3 pb-3.5">
                    <span className="line-clamp-2 text-[15px] leading-5 font-semibold [overflow-wrap:anywhere]">{item.title}</span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground" title={item.category}>{item.category}</span>
                    <span className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">{item.description || item.prompt}</span>
                    {tags.length > 0 && <span className="mt-auto flex min-w-0 items-center gap-1.5 pt-2.5">
                        {tags.slice(0, 2).map((tag) => <span key={tag} title={tag} className="min-w-0 truncate rounded bg-muted/70 px-1.5 py-0.5 text-[11px] leading-4 text-muted-foreground">{tag}</span>)}
                        {tags.length > 2 && <span className="shrink-0 text-[11px] text-muted-foreground">+{tags.length - 2}</span>}
                    </span>}
                </span>
            </button>
            <div className="grid shrink-0 grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] divide-x divide-border border-t border-border">
                <button type="button" className={actionClass} aria-label={t("common.copyPrompt")} onClick={props.onCopy}>
                    <Copy className="size-3.5 shrink-0" aria-hidden />{t("common.copy")}
                </button>
                <button type="button" className={actionClass} aria-label={t("common.addToAssets")} onClick={props.onSave}>
                    <FolderPlus className="size-3.5 shrink-0" aria-hidden />{t("prompts.saveAsset")}
                </button>
            </div>
        </article>
    );
}
