import { useEffect, useId, useMemo, useState } from "react";
import { Cpu, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { isModelUnavailable, modelOptionLabel, modelOptionName, selectableModelsByCapability, type AiConfig, type ModelCapability } from "@/stores/use-config-store";
import { useModelCatalogStore } from "@/stores/use-model-catalog-store";
import { modelPickerOptions } from "@/lib/video-model-info";
import { splitModelInformation } from '@/lib/model-information';
import { videoDisplayText } from '@/lib/video-display-text';
import { useVideoCatalogStore } from '@/stores/use-video-catalog-store';
import { VideoModelStatus } from './video-model-status';

type ModelPickerProps = {
    config: AiConfig;
    value?: string;
    onChange: (model: string) => void;
    capability?: ModelCapability;
    className?: string;
    fullWidth?: boolean;
    layout?: "compact" | "detailed";
    placeholder?: string;
    onMissingConfig?: () => void;
};

export function ModelPicker({ config, value, onChange, capability, className, fullWidth = false, layout = "compact", placeholder, onMissingConfig }: ModelPickerProps) {
    const { t } = useTranslation();
    const pickerId = useId();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const catalog = useVideoCatalogStore(state => state.catalog);
    const options = useMemo(() => modelPickerOptions(config, Array.from(new Set([...(config.channelMode === "local" && !capability ? [value] : []), ...(capability === 'video' ? config.channels.flatMap(channel => channel.models.filter(model => model.capability === 'video').map(model => channel.id + '::' + model.name)) : selectableModelsByCapability(config, capability))].filter((model): model is string => Boolean(model)))), value, catalog), [capability, config, value, catalog]);
    const current = value || "";
    const unavailable = isModelUnavailable(config, current);
    const detailed = layout === "detailed";
    const matched = options.find(option => option.value === current) || (capability === 'video' && options.find(option => option.value.split('::')[0] === current.split('::')[0] && option.name === splitModelInformation(modelOptionName(current)).name));
    const fallbackLabel = matched ? "" : modelOptionLabel(config, current);
    const displayLabel = videoDisplayText(fallbackLabel);
    const selected = matched || {
        value: current,
        ...(capability === "video"
            ? splitModelInformation(detailed ? displayLabel : videoDisplayText(modelOptionName(current)))
            : { name: fallbackLabel, information: "" }),
        label: displayLabel,
    };
    const currentLabel = current ? selected.label + (unavailable ? ' · 暂不可用，请重新选择' : '') : '';
    const pickerPlaceholder = placeholder || t("settingsPanels.model.select");
    const visibleOptions = options.filter(option => !query || option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    const hasDetails = Boolean(selected.information || (current && capability === "video"));

    useEffect(() => {
        const closeOtherPicker = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== pickerId) setOpen(false);
        };
        window.addEventListener("model-picker-open", closeOtherPicker);
        return () => window.removeEventListener("model-picker-open", closeOtherPicker);
    }, [pickerId]);

    return (
        <Select
            open={open}
            value={selected.value}
            onOpenChange={(nextOpen) => {
                if (!nextOpen) setQuery('');
                if (nextOpen && !options.length && config.channelMode === "local" && !config.channels.some(channel => channel.apiKey.trim())) onMissingConfig?.();
                if (nextOpen) { void useModelCatalogStore.getState().sync(); window.dispatchEvent(new CustomEvent("model-picker-open", { detail: pickerId })); }
                setOpen(nextOpen);
            }}
            onValueChange={value => { if (!isModelUnavailable(config, value)) onChange(value); }}
        >
            <SelectTrigger
                className={cn(
                    "canvas-composer-model-picker h-8 w-fit max-w-full gap-2 rounded-full border border-input bg-transparent px-3 text-sm font-normal shadow-sm transition-colors",
                    fullWidth ? "w-full min-w-0 justify-start" : "min-w-[9rem] justify-start",
                    "data-[state=open]:border-ring data-[state=open]:ring-2 data-[state=open]:ring-ring/20",
                    detailed && "h-auto! min-h-12 gap-2.5 rounded-xl border-border bg-background/45 py-2.5 shadow-none hover:bg-accent/60 motion-reduce:transition-none dark:bg-background/45 dark:hover:bg-accent/60",
                    className,
                )}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                title={currentLabel || pickerPlaceholder}
                aria-label={currentLabel || pickerPlaceholder}
                aria-invalid={unavailable || undefined}
                style={!detailed && hasDetails ? { height: 'auto', minHeight: 44, paddingBlock: 5 } : undefined}
            >
                <ModelIcon model={current} />
                <span className={cn("canvas-model-picker-text min-w-0 flex-1 text-left leading-snug", detailed && "whitespace-normal [overflow-wrap:anywhere]")}>
                    <span data-model-name className={cn("block min-w-0", detailed ? "font-semibold leading-5" : "truncate")}>{current ? selected.name : pickerPlaceholder}</span>
                    {hasDetails && <span className={cn("mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground", detailed && "mt-1 leading-[18px]")}>
                        {selected.information && <span data-model-information className={cn("min-w-0", !detailed && "truncate")}>{selected.information}</span>}
                        {current && capability === 'video' && <VideoModelStatus config={config} value={current} />}
                    </span>}
                    {unavailable && <span className="block text-xs text-destructive">暂不可用，请重新选择</span>}
                </span>
            </SelectTrigger>
            <SelectContent
                data-canvas-no-zoom
                className={cn(
                    "z-[1200] flex max-h-[min(var(--radix-select-content-available-height),24rem)] w-96 max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-xl border border-border/70 bg-popover p-1.5 shadow-xl motion-reduce:animate-none [&_[data-radix-select-viewport]]:!h-auto [&_[data-radix-select-viewport]]:min-h-0 [&_[data-radix-select-viewport]]:min-w-0 [&_[data-radix-select-viewport]]:flex-1 [&_[data-slot=select-scroll-up-button]]:shrink-0 [&_[data-slot=select-scroll-down-button]]:shrink-0",
                    detailed && "w-[clamp(22rem,var(--radix-select-trigger-width),34rem)] [&_[data-radix-select-viewport]]:min-w-0!",
                )}
                header={capability === 'video' && <div className="mb-1.5 flex shrink-0 items-center gap-2 border-b border-border/70 px-2 pb-2 pt-1" data-model-search>
                    <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                    <input type="search" aria-label="搜索视频模型" placeholder="搜索模型、分辨率或价格" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key !== 'Escape') event.stopPropagation(); if (event.key === 'ArrowDown') { event.preventDefault(); event.currentTarget.closest('[role=listbox]')?.querySelector<HTMLElement>('[role=option]:not([data-disabled])')?.focus(); } }} className="h-8 min-w-0 flex-1 bg-transparent text-sm text-popover-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50" />
                </div>}
                position="popper"
                align="start"
                side="bottom"
                sideOffset={6}
                collisionPadding={12}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                onWheel={event => {
                    const viewport = event.currentTarget.querySelector<HTMLElement>('[data-radix-select-viewport]');
                    if (viewport && !viewport.contains(event.target as Node)) viewport.scrollTop += event.deltaY;
                    event.stopPropagation();
                }}
            >
                {visibleOptions.length ? (
                    visibleOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value} disabled={isModelUnavailable(config, option.value)} data-model-id={option.value} textValue={option.label} className="my-0.5 cursor-pointer rounded-lg py-2.5 pl-2.5 pr-8 transition-colors data-[state=checked]:bg-accent/60 data-disabled:cursor-default data-disabled:opacity-75 motion-reduce:transition-none [&>span:last-child]:min-w-0 [&>span:last-child]:w-full" title={option.label}
                            onPointerUp={() => { if (!isModelUnavailable(config, option.value) && option.value === selected.value && current !== option.value) onChange(option.value); }}
                            onKeyDown={event => { if (!isModelUnavailable(config, option.value) && ['Enter', ' '].includes(event.key) && option.value === selected.value && current !== option.value) onChange(option.value); }}>
                            <ModelLabel option={option} config={config} video={capability === 'video'} />
                        </SelectItem>
                    ))
                ) : (
                    <SelectItem value="__empty__" disabled>
                        {query ? '没有匹配的模型' : emptyModelLabel(config, capability)}
                    </SelectItem>
                )}
            </SelectContent>
        </Select>
    );
}

function emptyModelLabel(config: AiConfig, capability?: ModelCapability) {
    const label = capability ? i18n.t(`settingsPanels.model.capabilities.${capability}`) : "";
    if (capability && config.models.length) return i18n.t("settingsPanels.model.assign", { capability: label });
    return config.models.length ? i18n.t("settingsPanels.model.noMatch", { capability: label }) : i18n.t("settingsPanels.model.addFirst");
}

function ModelLabel({ option, config, video }: { option: ReturnType<typeof modelPickerOptions>[number]; config: AiConfig; video: boolean }) {
    return (
        <span className="grid w-full min-w-0 grid-cols-[20px_minmax(0,1fr)_auto] gap-x-2 whitespace-normal text-left">
            <span className="col-start-1 row-span-2 row-start-1 pt-0.5"><ModelIcon model={option.value} /></span>
            <span data-model-name className={cn("row-start-1 min-w-0 text-[13px] font-medium leading-5 [overflow-wrap:anywhere]", video ? "col-start-2" : "col-span-2 col-start-2")}>{option.name}</span>
            {option.information && <span data-model-information className="col-span-2 col-start-2 row-start-2 mt-0.5 text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">{option.information}</span>}
            {video && <VideoModelStatus config={config} value={option.value} menu />}
        </span>
    );
}

function ModelIcon({ model }: { model: string }) {
    const icon = resolveModelIcon(modelOptionName(model));
    return icon ? <img src={icon} alt="" className="size-4 shrink-0 dark:invert" /> : <Cpu className="size-4 shrink-0 opacity-70" />;
}

function resolveModelIcon(model: string) {
    const name = model.toLowerCase();
    if (name.includes("claude") || name.includes("anthropic")) return "/icons/claude.svg";
    if (name.includes("gemini") || name.includes("google")) return "/icons/gemini.svg";
    if (name.includes("gpt") || name.includes("openai")) return "/icons/openai.svg";
    if (name.includes("grok") || name.includes("grok")) return "/icons/grok.svg";
    if (name.includes("deepseek") || name.includes("deepseek")) return "/icons/deepseek.svg";
    if (name.includes("glm") || name.includes("glm")) return "/icons/glm.svg";
    return "";
}
