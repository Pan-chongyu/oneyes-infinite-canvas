import { BookOpen, Layers3, Search, Tags } from "lucide-react";
import { type UIEvent, useRef, useState } from "react";
import { App, Button, Input, Select, Spin } from "antd";
import { useTranslation } from "react-i18next";

import { PromptCard } from "@/components/prompts/prompt-card";
import { usePromptList } from "@/components/prompts/use-prompt-list";
import { PromptDetailDialog } from "./components/prompt-detail-dialog";
import { useCopyText } from "@/hooks/use-copy-text";
import { useAssetStore } from "@/stores/use-asset-store";
import { usePromptSourceStore } from "@/stores/use-prompt-source-store";
import { ALL_PROMPTS_OPTION, type Prompt } from "@/services/api/prompts";

export default function PromptsPage() {
    const { message } = App.useApp();
    const { i18n, t } = useTranslation();
    const [keyword, setKeyword] = useState("");
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [selectedCategory, setSelectedCategory] = useState(ALL_PROMPTS_OPTION);
    const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
    const list = useRef<HTMLDivElement>(null);
    const addAsset = useAssetStore((state) => state.addAsset);
    const sources = usePromptSourceStore((state) => state.sources);
    const copyText = useCopyText();
    const { query, items, tags, total } = usePromptList({ keyword, tags: selectedTags, category: selectedCategory });
    const filtered = Boolean(keyword.trim() || selectedTags.length || selectedCategory !== ALL_PROMPTS_OPTION);
    const sourceOptions = Array.from(new Set(sources.filter((source) => source.enabled).map((source) => source.name)));
    if (selectedCategory !== ALL_PROMPTS_OPTION && !sourceOptions.includes(selectedCategory)) sourceOptions.push(selectedCategory);

    const scrollToStart = () => { if (list.current) list.current.scrollTop = 0; };

    const clearFilters = () => {
        setKeyword("");
        setSelectedCategory(ALL_PROMPTS_OPTION);
        setSelectedTags([]);
        scrollToStart();
    };

    const copyPrompt = (prompt: string) => copyText(prompt, t("common.promptCopied"));

    const savePromptAsset = (item: Prompt) => {
        addAsset({ kind: "text", title: item.title, coverUrl: item.coverUrl, tags: item.tags, source: item.category, data: { content: item.prompt }, metadata: { source: "prompt-library", promptId: item.id, githubUrl: item.githubUrl } });
        message.success(t("common.addedToAssets"));
    };

    const handleListScroll = (event: UIEvent<HTMLDivElement>) => {
        const target = event.currentTarget;
        if (query.hasNextPage && !query.isFetching && !query.isFetchNextPageError && target.scrollTop + target.clientHeight >= target.scrollHeight - 160) void query.fetchNextPage();
    };

    return (
        <main className="@container flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background text-foreground">
            <header className="shrink-0 border-b border-border">
                <div className="mx-auto w-full max-w-[1440px] px-4 @min-[720px]:px-7">
                    <div className="flex flex-col gap-3 py-4 @min-[620px]:flex-row @min-[620px]:items-center @min-[620px]:justify-between @min-[620px]:gap-5">
                        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 @min-[620px]:justify-start">
                            <h1 className="m-0! text-[25px] leading-8 font-semibold! tracking-tight">{t("prompts.title")}</h1>
                            <span role="status" className="text-xs text-muted-foreground tabular-nums">
                                {query.data ? t("prompts.resultCount", { number: total.toLocaleString(i18n.resolvedLanguage) }) : null}
                            </span>
                        </div>
                        <Input
                            size="large"
                            allowClear
                            aria-label={t("prompts.search")}
                            prefix={<Search className="size-4 text-muted-foreground" aria-hidden />}
                            className="w-full @min-[620px]:max-w-[min(52%,480px)]"
                            classNames={{ input: "placeholder:text-muted-foreground!" }}
                            value={keyword}
                            placeholder={t("prompts.search")}
                            onChange={(event) => { setKeyword(event.target.value); scrollToStart(); }}
                        />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pb-3">
                        <div className="grid w-full min-w-0 grid-cols-2 gap-2 @min-[660px]:w-auto @min-[660px]:grid-cols-[210px_224px]">
                            <Select<string>
                                aria-label={t("prompts.source")}
                                prefix={<Layers3 className="size-4 text-muted-foreground" aria-hidden />}
                                className="min-w-0"
                                showSearch={{ optionFilterProp: "label" }}
                                value={selectedCategory}
                                options={[{ value: ALL_PROMPTS_OPTION, label: t("prompts.allSources") }, ...sourceOptions.map((source) => ({ value: source, label: source }))]}
                                onChange={(category) => { setSelectedCategory(category); scrollToStart(); }}
                            />
                            <Select<string[]>
                                aria-label={t("prompts.tags")}
                                prefix={<Tags className="size-4 text-muted-foreground" aria-hidden />}
                                className="min-w-0"
                                mode="multiple"
                                classNames={{ placeholder: "text-muted-foreground!" }}
                                showSearch={{ optionFilterProp: "label" }}
                                placeholder={t("prompts.allTags")}
                                maxTagCount="responsive"
                                value={selectedTags}
                                options={Array.from(new Set([...selectedTags, ...tags.slice(1)])).map((label) => ({ label, value: label }))}
                                onChange={(next) => { setSelectedTags(next); scrollToStart(); }}
                            />
                        </div>
                        {filtered && <Button type="text" size="small" className="ms-auto" onClick={clearFilters}>{t("prompts.clearFilters")}</Button>}
                    </div>
                </div>
            </header>

            <div ref={list} role="region" aria-label={t("prompts.results")} aria-busy={query.isFetching} tabIndex={0} onScroll={handleListScroll}
                className="thin-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain focus-visible:outline-2 focus-visible:-outline-offset-2">
                <div className="mx-auto w-full max-w-[1440px] px-4 pt-4 pb-6 @min-[720px]:px-7 @min-[720px]:pt-5">
                    {query.isLoading ? (
                        <div className="grid min-h-44 place-items-center"><Spin /></div>
                    ) : items.length > 0 ? (
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-4 @min-[720px]:gap-5">
                            {items.map((item) => (
                                <PromptCard key={`${item.sourceId}:${item.id}`} item={item} onOpen={() => setSelectedPrompt(item)} onCopy={() => copyPrompt(item.prompt)} onSave={() => savePromptAsset(item)} />
                            ))}
                        </div>
                    ) : (
                        <div className="flex min-h-52 flex-col items-center justify-center gap-3 py-8 text-center">
                            <BookOpen className="size-7 text-muted-foreground" aria-hidden />
                            <span className="text-sm font-medium">{t(query.isError ? "prompts.loadFailed" : filtered ? "prompts.empty" : "prompts.noPrompts")}</span>
                            {query.isError ? <Button onClick={() => void query.refetch()}>{t("prompts.retry")}</Button>
                                : filtered && <Button type="text" onClick={clearFilters}>{t("prompts.clearFilters")}</Button>}
                        </div>
                    )}
                    {query.hasNextPage && (
                        <div className="flex justify-center pt-5">
                            <Button loading={query.isFetchingNextPage} disabled={query.isFetching && !query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                                {t(query.isFetchNextPageError ? "prompts.retry" : "prompts.more")}
                            </Button>
                        </div>
                    )}
                </div>
            </div>

            <PromptDetailDialog prompt={selectedPrompt} onClose={() => setSelectedPrompt(null)} onCopy={copyPrompt} onSaveAsset={savePromptAsset} />
        </main>
    );
}
