import { buildGenerationConfig, generationModePatch } from "@/lib/canvas/node-generation-config";
import type { CSSProperties } from "react";
import { Image as ImageIcon, LoaderCircle, MessageSquare, Music2, Play, Settings2, Square, Video } from "lucide-react";
import { Button, Segmented } from "antd";
import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/components/model-picker";
import { isModelUnavailable, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { useVideoCatalogStore } from '@/stores/use-video-catalog-store';
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasAudioSettingsPopover, type CanvasAudioSettingKey } from "./canvas-audio-settings-popover";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasTextSettingsPopover } from "./canvas-text-settings-popover";
import type { CanvasGenerationMode, CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import type { VideoReferenceSummary } from "@/lib/video-capabilities";
import { DEFAULT_VIDEO_FRAME_COUNT } from "@/services/director-video";
import { videoModelNodePatch } from '@/lib/video-model-defaults';
import { getVideoModelInfo } from '@/lib/video-model-info';

type CanvasConfigNodePanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    inputSummary: { textCount: number; imageCount: number; videoCount: number; audioCount: number };
    videoInputs: VideoReferenceSummary;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
    onGenerate: (nodeId: string) => void;
    onStop: (nodeId: string) => void;
    onComposerToggle: () => void;
};

export function CanvasConfigNodePanel({ node, isRunning, inputSummary, videoInputs, onConfigChange, onGenerate, onStop, onComposerToggle }: CanvasConfigNodePanelProps) {
    useVideoCatalogStore(state => state.catalog);
    const { t } = useTranslation();
    const globalConfig = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const mode = node.metadata?.generationMode || "image";
    const config = buildGenerationConfig(globalConfig, node, mode);
    const videoInfo = mode === 'video' ? getVideoModelInfo(config) : undefined;
    const settingsButtonClassName = "canvas-compact-control !h-7 !w-full !justify-start !rounded-md !bg-transparent !px-1 !text-xs hover:!bg-black/5 dark:hover:!bg-white/10";
    const chipStyle = { background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text };
    const hasAnyInput = Boolean(inputSummary.textCount || inputSummary.imageCount || inputSummary.videoCount || inputSummary.audioCount);
    const hasComposerContent = Boolean((node.metadata?.composerContent ?? node.metadata?.prompt ?? "").trim());
    const canGenerate = (hasComposerContent || (mode === "audio" ? inputSummary.textCount > 0 : hasAnyInput)) && (mode !== 'video' || !isModelUnavailable(config, config.model));

    return (
        <div className="flex h-full w-full cursor-move flex-col px-3 pb-3 pt-5 text-sm" style={{ color: theme.node.text }} onWheel={(event) => event.stopPropagation()}>
            <div className="mb-1.5 flex shrink-0 items-center justify-between gap-3">
                <div className="shrink-0 text-sm font-semibold">{t("canvas.configNode.title")}</div>
                <div className="cursor-default" onMouseDown={(event) => event.stopPropagation()}>
                    <Segmented
                        size="small"
                        className="canvas-config-mode !rounded-md !p-0.5"
                        value={mode}
                        onChange={(value) => onConfigChange(node.id, generationModePatch(globalConfig, node, value as CanvasGenerationMode))}
                        options={[
                            {
                                value: "image",
                                label: (
                                    <span className="inline-flex items-center gap-1">
                                        <ImageIcon className="size-3.5" />
                                        {t("canvas.configNode.image")}
                                    </span>
                                ),
                            },
                            {
                                value: "text",
                                label: (
                                    <span className="inline-flex items-center gap-1">
                                        <MessageSquare className="size-3.5" />
                                        {t("canvas.configNode.text")}
                                    </span>
                                ),
                            },
                            {
                                value: "video",
                                label: (
                                    <span className="inline-flex items-center gap-1">
                                        <Video className="size-3.5" />
                                        {t("canvas.configNode.video")}
                                    </span>
                                ),
                            },
                            {
                                value: "audio",
                                label: (
                                    <span className="inline-flex items-center gap-1">
                                        <Music2 className="size-3.5" />
                                        {t("canvas.configNode.audio")}
                                    </span>
                                ),
                            },
                        ]}
                    />
                </div>
            </div>

            <div className="mb-2 min-h-0 flex-1 overflow-y-auto" data-config-node-controls>
                <div className="mb-1.5 flex flex-wrap gap-1.5">
                    <InputChip label={t("canvas.configNode.prompt")} value={t("canvas.configNode.items", { count: inputSummary.textCount })} style={chipStyle} />
                    <InputChip label={t("canvas.configNode.references")} value={t("canvas.configNode.images", { count: inputSummary.imageCount })} style={chipStyle} />
                    {videoInfo?.referenceLimits.videos !== 0 || inputSummary.videoCount > 0 ? <InputChip label={t("canvas.configNode.videoReferences")} value={t("canvas.configNode.items", { count: inputSummary.videoCount })} style={chipStyle} /> : null}
                    {videoInfo?.referenceLimits.audios !== 0 || inputSummary.audioCount > 0 ? <InputChip label={t("canvas.configNode.audioReferences")} value={t("canvas.configNode.items", { count: inputSummary.audioCount })} style={chipStyle} /> : null}
                    <button type="button" className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-md border px-2 text-[11px]" style={chipStyle} onMouseDown={(event) => event.stopPropagation()} onClick={onComposerToggle}>
                        <Settings2 className="size-3.5" />
                        {t("canvas.configNode.compose")}
                    </button>
                </div>

                <div className="flex min-w-0 cursor-default flex-col gap-1" onMouseDown={(event) => event.stopPropagation()}>
                    <ModelPicker className="canvas-compact-control !h-auto min-h-10 !rounded-lg !py-1.5 shadow-none [&_[data-model-name]]:whitespace-normal [&_[data-model-name]]:break-all [&_[data-model-information]]:whitespace-normal [&_[data-model-information]]:break-words" config={config} value={config.model} onChange={(model) => onConfigChange(node.id, mode === 'video' && model !== config.model ? videoModelNodePatch(globalConfig, model) : { model })} capability={mode} onMissingConfig={() => openConfigDialog(true)} fullWidth />
                    <div className="min-w-0 [&>span]:w-full" data-config-node-settings>
                        {mode === "video" ? (
                            <CanvasVideoSettingsPopover config={config} inputs={videoInputs} placement="topRight" buttonClassName={settingsButtonClassName} onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))} />
                        ) : mode === "image" ? (
                            <CanvasImageSettingsPopover config={config} placement="topRight" autoAdjustOverflow={false} buttonClassName={settingsButtonClassName} onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })} />
                        ) : mode === "audio" ? (
                            <CanvasAudioSettingsPopover config={config} placement="topRight" buttonClassName={settingsButtonClassName} onConfigChange={(key, value) => onConfigChange(node.id, audioConfigPatch(key, value))} />
                        ) : (
                            <CanvasTextSettingsPopover config={config} count={node.metadata?.textCount || 1} placement="topRight" buttonClassName={settingsButtonClassName} onConfigChange={(_, value) => onConfigChange(node.id, { reasoningEffort: value })} onCountChange={(textCount) => onConfigChange(node.id, { textCount })} videoFrameCount={node.metadata?.videoFrameCount ?? DEFAULT_VIDEO_FRAME_COUNT} onVideoFrameCountChange={inputSummary.videoCount ? videoFrameCount => onConfigChange(node.id, { videoFrameCount }) : undefined} />
                        )}
                    </div>
                </div>
            </div>

            <Button
                type="primary"
                className="mt-auto shrink-0 !h-9 !w-full !cursor-pointer !rounded-lg"
                danger={isRunning}
                disabled={!isRunning && !canGenerate}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => (isRunning ? onStop(node.id) : onGenerate(node.id))}
            >
                <span className="inline-flex items-center gap-1.5">
                    {isRunning ? (
                        <>
                            <LoaderCircle className="size-4 animate-spin" />
                            <Square className="size-3.5 fill-current" />
                            <span className="truncate" title={node.metadata?.loadingMessage}>{node.metadata?.loadingMessage || t("canvas.configNode.stop")}</span>
                        </>
                    ) : (
                        <>
                            <Play className="size-4" />
                            <span>{t("canvas.configNode.generate")}</span>
                        </>
                    )}
                </span>
            </Button>
        </div>
    );
}

function InputChip({ label, value, style }: { label: string; value: string; style: CSSProperties }) {
    return (
        <div className="inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[11px]" style={style}>
            <span>{label}</span>
            <span className="font-medium">{value}</span>
        </div>
    );
}


function videoConfigPatch(key: keyof AiConfig, value: string) {
    if (key === "videoSeconds") return { seconds: value };
    if (key === "videoGenerateAudio") return { generateAudio: value };
    if (key === "videoWatermark") return { watermark: value };
    if (key === "videoMode") return { videoMode: value };
    return { [key]: value };
}

function audioConfigPatch(key: CanvasAudioSettingKey, value: string) {
    if (key === "audioVoice") return { audioVoice: value };
    if (key === "audioFormat") return { audioFormat: value };
    if (key === "audioSpeed") return { audioSpeed: value };
    return { audioInstructions: value };
}
