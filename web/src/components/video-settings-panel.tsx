import { type ReactNode } from "react";
import { Slider } from "antd";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { clampVideoSeconds, computeVideoSize, inferVideoRatio, parseAspectRatio, parseVideoResolution, readVideoDimensions, VIDEO_SECONDS_MAX, VIDEO_SECONDS_MIN, videoRatioOptions } from "@/lib/media-size";
import { getVideoModelInfo, videoModelConfigError } from "@/lib/video-model-info";
import { type AiConfig } from "@/stores/use-config-store";
import { emptyVideoReferences, isMiniMaxVideoModel, isSupportedMiniMaxVideoResolution, usesGrokVideoReferences, videoResolutionOptionsForModel, type VideoReferenceSummary } from "@/lib/video-capabilities";
const videoModeOptions = [
    { value: "frames", labelKey: "frames" },
    { value: "reference", labelKey: "reference" },
];

export const videoResolutionOptions = videoResolutionOptionsForModel("");
export const videoSizeOptions = videoRatioOptions.map((item) => ({ value: item.value, get label() { return item.value === "auto" ? i18n.t("settingsPanels.common.auto") : item.value; } }));
export const videoSecondsRange = { min: VIDEO_SECONDS_MIN, max: VIDEO_SECONDS_MAX };

type VideoSettingsPanelProps = {
    config: AiConfig;
    model?: string;
    inputs?: VideoReferenceSummary;
    onConfigChange: (key: "vquality" | "size" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoMode", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
};

export function VideoSettingsPanel({ config, model, inputs = emptyVideoReferences, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5" }: VideoSettingsPanelProps) {
    const { t } = useTranslation();
    const selectedModel = model || config.model || config.videoModel;
    const info = getVideoModelInfo(config, selectedModel);
    const nativeGrok = info?.id.startsWith("grok-imagine-video") && selectedModel.split("::").pop() === info.id;
    const controlsInfo = nativeGrok ? undefined : info;
    const configError = nativeGrok ? undefined : videoModelConfigError(config, selectedModel, inputs);
    const referenceLimited = usesGrokVideoReferences({ ...config, model: selectedModel }, inputs);
    const miniMaxModel = isMiniMaxVideoModel(selectedModel);
    const resolutionOptions = controlsInfo ? controlsInfo.resolutions.map((value) => ({ value, label: videoResolutionLabel(value) })) : videoResolutionOptionsForModel(selectedModel);
    const seconds = info ? Number(config.videoSeconds) : Number(clampVideoSeconds(config.videoSeconds || "6"));
    const videoMode = info ? config.videoMode : normalizeVideoModeValue(config.videoMode);
    const resolution = controlsInfo ? String(config.vquality || "").replace(/p$/i, "").toLowerCase() : parseVideoResolution(config.vquality);
    const selectedRatio = info?.ratios.find((ratio) => ratio === config.size) || inferVideoRatio(config.size || "auto");
    const dimensions = readVideoDimensions(config.size || "auto", resolution, selectedRatio);
    const ratios = controlsInfo ? controlsInfo.ratios.map((value) => ({ value, ...(parseAspectRatio(value) || { width: 0, height: 0 }) })) : videoRatioOptions;
    const modes = controlsInfo ? videoModeOptions.filter((item) => controlsInfo.modes.includes(item.value as "frames" | "reference")) : videoModeOptions;
    const duration = nativeGrok ? { min: 1, max: 15 } : info?.duration || videoSecondsRange;
    const discreteSeconds = controlsInfo?.duration.values;
    const secondsValid = Number.isInteger(seconds) && seconds >= duration.min && seconds <= duration.max && (!discreteSeconds || discreteSeconds.includes(seconds));
    const applySize = (nextResolution: string, ratio: string) => {
        if (referenceLimited && parseVideoResolution(nextResolution) === "1080") return;
        onConfigChange("vquality", nextResolution);
        onConfigChange("size", controlsInfo ? ratio : computeVideoSize(nextResolution, ratio));
    };
    const selectResolution = (nextResolution: string) => {
        if (referenceLimited && parseVideoResolution(nextResolution) === "1080") return;
        if (selectedRatio === "auto") onConfigChange("vquality", nextResolution);
        else applySize(nextResolution, selectedRatio);
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">{t("settingsPanels.video.title")}</div> : null}
                {info ? (
                    <div className="space-y-1 text-xs leading-relaxed" aria-label="当前视频模型">
                        <div className="font-medium break-words">{info.id}</div>
                        <div style={{ color: theme.node.muted }}>{info.summary}</div>
                    </div>
                ) : null}
                {info && configError ? <p role="alert" className="border-l-2 pl-3 text-xs font-medium leading-5" style={{ color: theme.node.text, borderColor: theme.node.text }}>{configError} 当前设置已保留，请主动选择支持的参数。</p> : null}
                <SettingGroup title={t("settingsPanels.video.quality")} color={theme.node.muted}>
                    <div className="grid grid-cols-4 gap-2.5">
                        {resolutionOptions.map((item) => (
                            <OptionPill key={item.value} selected={resolution.toLowerCase() === item.value.toLowerCase()} disabled={referenceLimited && item.value === "1080"} theme={theme} onClick={() => selectResolution(item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                        {!controlsInfo ? <ResolutionInput value={resolution} allowNamedTier={miniMaxModel} theme={theme} onChange={selectResolution} /> : null}
                    </div>
                    {info ? <div className="text-xs" style={{ color: theme.node.muted }}>当前分辨率：{config.vquality || "未设置"}</div> : null}
                    {!controlsInfo && miniMaxModel && !isSupportedMiniMaxVideoResolution(config.vquality) ? <p role="alert" className="text-xs leading-5" style={{ color: theme.node.muted }}>该模型仅支持 768P、1080P、2K，请先选择支持的分辨率。</p> : null}
                    {referenceLimited ? <p role="status" className="text-xs leading-5" style={{ color: theme.node.muted }}>{t("apiErrors.grokVideoReferenceResolutionHint")}</p> : null}
                </SettingGroup>
                {!controlsInfo ? <SettingGroup title={t("settingsPanels.video.size")} color={theme.node.muted}>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                        <DimensionInput prefix="W" value={dimensions.width} disabled={selectedRatio === "auto"} theme={theme} onChange={(value) => updateDimension("width", value, dimensions, onConfigChange)} />
                        <span className="text-lg opacity-45">↔</span>
                        <DimensionInput prefix="H" value={dimensions.height} disabled={selectedRatio === "auto"} theme={theme} onChange={(value) => updateDimension("height", value, dimensions, onConfigChange)} />
                    </div>
                </SettingGroup> : null}
                <SettingGroup title={t("settingsPanels.video.ratio")} color={theme.node.muted}>
                    <div className="grid grid-cols-4 gap-2.5">
                        {ratios.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                aria-pressed={selectedRatio === item.value}
                                className="flex h-[72px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border bg-transparent text-sm transition hover:opacity-80"
                                style={{ borderColor: selectedRatio === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => applySize(resolution, item.value)}
                            >
                                <SizePreview width={item.width} height={item.height} color={theme.node.text} />
                                <span>{item.value === "auto" ? t("settingsPanels.common.auto") : item.value}</span>
                            </button>
                        ))}
                    </div>
                    {info ? <div className="text-xs" style={{ color: theme.node.muted }}>当前输出尺寸：{config.size || "未设置"}</div> : null}
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.video.seconds")} color={theme.node.muted}>
                    {discreteSeconds || duration.min === duration.max ? (
                        <div className="grid grid-cols-4 gap-2.5">
                            {(discreteSeconds || [duration.min]).map((value) => (
                                <OptionPill key={value} selected={seconds === value} theme={theme} onClick={() => onConfigChange("videoSeconds", String(value))}>{value}s</OptionPill>
                            ))}
                        </div>
                    ) : (
                        <div className="flex items-center gap-3" onMouseDown={(event) => event.stopPropagation()}>
                            {secondsValid ? <Slider className="min-w-0 flex-1" min={duration.min} max={duration.max} step={1} value={seconds} onChange={(value) => onConfigChange("videoSeconds", String(Array.isArray(value) ? value[0] : value))} /> : <span className="min-w-0 flex-1 text-xs" style={{ color: theme.node.muted }}>请调整为支持的时长</span>}
                            <SecondsInput value={info ? config.videoSeconds : seconds} min={duration.min} max={duration.max} preserveInvalid={Boolean(info)} theme={theme} onCommit={(value) => onConfigChange("videoSeconds", value)} />
                            <span className="shrink-0 text-sm" style={{ color: theme.node.muted }}>s</span>
                        </div>
                    )}
                    {info ? <div className="text-xs" style={{ color: theme.node.muted }}>当前 {config.videoSeconds || "未设置"} 秒 · {discreteSeconds ? `支持 ${discreteSeconds.join(" / ")} 秒` : duration.min === duration.max ? `固定 ${duration.min} 秒` : `支持 ${duration.min}–${duration.max} 秒`}</div> : null}
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.video.mode")} color={theme.node.muted}>
                    <div className="grid grid-cols-2 gap-2.5">
                        {modes.map((item) => (
                            <OptionPill key={item.value} selected={videoMode === item.value} theme={theme} onClick={() => onConfigChange("videoMode", item.value)}>
                                {t(`settingsPanels.video.modes.${item.labelKey}`)}
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup>
                {info?.audio === "optional" ? (
                    <SettingGroup title="生成音频" color={theme.node.muted}>
                        <div className="grid grid-cols-2 gap-2.5">
                            <OptionPill selected={config.videoGenerateAudio !== "false"} theme={theme} onClick={() => onConfigChange("videoGenerateAudio", "true")}>开启</OptionPill>
                            <OptionPill selected={config.videoGenerateAudio === "false"} theme={theme} onClick={() => onConfigChange("videoGenerateAudio", "false")}>关闭</OptionPill>
                        </div>
                    </SettingGroup>
                ) : info?.audio === "required" ? <SettingGroup title="生成音频" color={theme.node.muted}>
                    <OptionPill selected={config.videoGenerateAudio !== "false"} theme={theme} onClick={() => onConfigChange("videoGenerateAudio", "true")}>固定开启</OptionPill>
                </SettingGroup> : info?.audio ? <div className="text-xs" style={{ color: theme.node.muted }}>不支持生成音频开关</div> : null}
                {info?.watermark === "optional" ? (
                    <SettingGroup title="视频水印" color={theme.node.muted}>
                        <div className="grid grid-cols-2 gap-2.5">
                            <OptionPill selected={config.videoWatermark === "true"} theme={theme} onClick={() => onConfigChange("videoWatermark", "true")}>开启</OptionPill>
                            <OptionPill selected={config.videoWatermark !== "true"} theme={theme} onClick={() => onConfigChange("videoWatermark", "false")}>关闭</OptionPill>
                        </div>
                    </SettingGroup>
                ) : null}
                {info ? (
                    <div className="space-y-3 border-t pt-3 text-xs leading-relaxed" style={{ borderColor: theme.node.stroke }}>
                        <SettingGroup title="价格与计费" color={theme.node.muted}>
                            <ul className="space-y-1">{info.priceLines.map((line) => <li key={line} className="break-words">{line}</li>)}</ul>
                            <p style={{ color: theme.node.muted }}>参考售价，最终按任务实际用量结算。</p>
                        </SettingGroup>
                        <SettingGroup title={nativeGrok ? "88API 通道参考限制" : "参考素材与限制"} color={theme.node.muted}>
                            <div style={{ color: theme.node.muted }}>
                                {([
                                    ["images", "图片"], ["videos", "视频"], ["audios", "音频"], ["total", "素材总数"],
                                ] as const).filter(([key]) => info.referenceLimits[key] !== undefined).map(([key, label]) => `${label}：${info.referenceLimits[key] === 0 ? "不支持" : `最多 ${info.referenceLimits[key]} 个`}`).join(" · ")}
                            </div>
                            <ul className="space-y-1" style={{ color: theme.node.muted }}>{info.notes.map((line) => <li key={line} className="break-words">{line}</li>)}</ul>
                        </SettingGroup>
                    </div>
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

export function videoResolutionLabel(value: string) {
    if (/^[24]k$/i.test(value)) return value.toUpperCase();
    const normalized = parseVideoResolution(value);
    return normalized === "2K" ? "2K" : `${normalized}p`;
}

export function videoSizeLabel(value: string) {
    const ratio = inferVideoRatio(value);
    return ratio === "auto" ? i18n.t("settingsPanels.video.adaptive") : ratio;
}

export function videoSecondsLabel(value: string) {
    if (String(value).trim() === "-1") return i18n.t("settingsPanels.video.smart");
    return `${value || "6"}s`;
}

export function videoModeLabel(value: string) {
    return i18n.t(`settingsPanels.video.modes.${normalizeVideoModeValue(value)}`);
}

export function normalizeVideoModeValue(value: string | undefined) {
    return value === "reference" ? "reference" : "frames";
}

export function normalizeVideoSizeValue(value: string, resolution = "720") {
    if (value === "auto") return "auto";
    if (/^\d+x\d+$/.test(value || "")) return value;
    const ratio = inferVideoRatio(value);
    return ratio === "auto" ? "auto" : computeVideoSize(resolution, ratio);
}

export function normalizeVideoResolutionValue(value: string) {
    return parseVideoResolution(value);
}

function updateDimension(key: "width" | "height", value: number | null, dimensions: { width: number; height: number }, onConfigChange: VideoSettingsPanelProps["onConfigChange"]) {
    const next = Math.max(1, Math.floor(value || dimensions[key] || 720));
    onConfigChange("size", `${key === "width" ? next : dimensions.width}x${key === "height" ? next : dimensions.height}`);
}

function OptionPill({ selected, disabled = false, theme, onClick, children }: { selected: boolean; disabled?: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" disabled={disabled} aria-pressed={selected} className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-35" style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onClick={onClick}>
            {children}
        </button>
    );
}

function SettingGroup({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return (
        <div className="space-y-2.5">
            <div className="text-xs font-medium" style={{ color }}>
                {title}
            </div>
            {children}
        </div>
    );
}

function ResolutionInput({ value, allowNamedTier = false, theme, onChange }: { value: string; allowNamedTier?: boolean; theme: CanvasTheme; onChange: (value: string) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-full border text-sm" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
            <input type={allowNamedTier ? "text" : "number"} min={1} className="min-w-0 flex-1 bg-transparent px-3 text-center uppercase outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={value} onChange={(event) => onChange(event.target.value)} onMouseDown={(event) => event.stopPropagation()} />
            <span className="grid w-7 place-items-center pr-1" style={{ color: theme.node.muted }}>
                {allowNamedTier && value === "2K" ? "" : "p"}
            </span>
        </label>
    );
}

function SecondsInput({ value, min, max, preserveInvalid, theme, onCommit }: { value: string | number; min: number; max: number; preserveInvalid: boolean; theme: CanvasTheme; onCommit: (value: string) => void }) {
    const commit = (input: HTMLInputElement) => {
        const next = preserveInvalid ? input.value : clampVideoSeconds(input.value);
        input.value = next;
        onCommit(next);
    };

    return (
        <label className="flex h-9 w-[68px] shrink-0 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text }}>
            <input
                type="number"
                min={min}
                max={max}
                className="min-w-0 flex-1 bg-transparent px-2 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                defaultValue={value}
                key={value}
                onBlur={(event) => commit(event.currentTarget)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function DimensionInput({ prefix, value, disabled, theme, onChange }: { prefix: string; value: number; disabled: boolean; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text, opacity: disabled ? 0.55 : 1 }}>
            <span className="grid w-9 place-items-center" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <input type="number" min={1} disabled={disabled} className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={value || ""} onChange={(event) => onChange(Number(event.target.value) || null)} onMouseDown={(event) => event.stopPropagation()} />
        </label>
    );
}

function SizePreview({ width, height, color }: { width: number; height: number; color: string }) {
    if (!width || !height) return null;
    const longSide = Math.max(width, height);
    const previewWidth = Math.max(10, Math.round((width / longSide) * 26));
    const previewHeight = Math.max(10, Math.round((height / longSide) * 26));
    return <span className="rounded-[3px] border-2" style={{ width: previewWidth, height: previewHeight, borderColor: color }} />;
}
