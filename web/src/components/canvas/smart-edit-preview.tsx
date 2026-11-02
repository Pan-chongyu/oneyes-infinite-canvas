import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Button, InputNumber, Slider } from "antd";
import { Scissors, Play, Pause } from "lucide-react";
import type { CanvasNodeData } from "@/types/canvas";
import type { EditClip, EditSource } from "@/types/smart-edit";
import { creatorSourceBlob } from "@/services/creator-media";
import { trimEditClip } from "@/lib/canvas/smart-edit";

export type EditPreviewHandle = { play: () => void; markIn: () => void; markOut: () => void; split: () => void; step: (direction: number) => void };
export function SmartEditPreview({
    source,
    detail,
    clip,
    disabled,
    onChange,
    onSplit,
    controls,
    seekTarget,
    onCursor,
    readOnly = false,
}: {
    source?: CanvasNodeData;
    detail?: EditSource;
    clip?: EditClip;
    disabled: boolean;
    onChange: (clip: EditClip) => void;
    onSplit: (time: number) => void;
    controls?: Ref<EditPreviewHandle>;
    seekTarget?: { id: string; time: number; serial: number };
    onCursor?: (time: number) => void;
    readOnly?: boolean;
}) {
    const [url, setUrl] = useState(""),
        [error, setError] = useState(""),
        [loaded, setLoaded] = useState(false),
        [playing, setPlaying] = useState(false),
        [cursor, setCursor] = useState(0),
        [range, setRange] = useState<number[]>([0, 0]);
    const video = useRef<HTMLVideoElement>(null);
    useEffect(() => {
        const controller = new AbortController();
        let objectUrl = "";
        setUrl("");
        setError("");
        setLoaded(false);
        setPlaying(false);
        if (source)
            void creatorSourceBlob(source, controller.signal)
                .then((blob) => {
                    controller.signal.throwIfAborted();
                    objectUrl = URL.createObjectURL(blob);
                    setUrl(objectUrl);
                })
                .catch((error) => {
                    if (!controller.signal.aborted) setError(error.message);
                });
        return () => {
            controller.abort();
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [source?.id, source?.type, source?.metadata?.storageKey, source?.metadata?.content, source?.metadata?.primaryImageId, source?.metadata?.images]);
    useEffect(() => {
        setError("");
        setCursor(clip?.start || 0);
        if (video.current && clip) {
            video.current.pause();
            if (video.current.readyState) video.current.currentTime = clip.start;
        }
    }, [clip?.id, source?.id]);
    useEffect(() => {
        setRange([clip?.start || 0, clip?.end || 0]);
    }, [clip?.id, clip?.start, clip?.end]);
    useEffect(() => {
        if (disabled) video.current?.pause();
    }, [disabled]);
    const unavailable = disabled || !loaded,
        step = 1 / (detail?.fps || 30);
    const seek = (time: number) => {
        if (!detail || !Number.isFinite(time) || time < 0 || time > detail.duration) return;
        video.current?.pause();
        if (video.current?.readyState) video.current.currentTime = time;
        setCursor(time);
        onCursor?.(time);
    };
    const trim = (start: number, end: number) => {
        if (!clip || !detail || readOnly) return;
        try {
            const next = trimEditClip(clip, start, end, detail);
            setError("");
            video.current?.pause();
            onChange(next);
        } catch (error) {
            setError((error as Error).message);
            setRange([clip.start, clip.end]);
        }
    };
    const play = async () => {
        try {
            if (video.current?.paused) await video.current.play();
            else video.current?.pause();
        } catch {
            setError("暂时无法播放，可继续编辑时间并输出；请使用系统播放器确认原文件编码");
        }
    };
    useEffect(() => {
        if (loaded && seekTarget && clip && seekTarget.id === clip.id) seek(seekTarget.time);
    }, [seekTarget, clip?.id, loaded]);
    useImperativeHandle(controls, () => ({
        play: () => {
            if (!unavailable) void play();
        },
        markIn: () => {
            if (!unavailable && clip && cursor < clip.end) trim(cursor, clip.end);
        },
        markOut: () => {
            if (!unavailable && clip && cursor > clip.start) trim(clip.start, cursor);
        },
        split: () => {
            if (!unavailable && !readOnly && clip && cursor > clip.start && cursor < clip.end) {
                video.current?.pause();
                onSplit(cursor);
            }
        },
        step: (direction) => {
            if (!unavailable && detail) seek(Math.max(0, Math.min(detail.duration, cursor + direction * step)));
        },
    }));
    if (!source || !detail || !clip)
        return (
            <div className="grid min-h-48 place-items-center text-xs opacity-65" role="status">
                读取素材后，在时间线上选择片段开始剪辑
            </div>
        );
    return (
        <div className="space-y-2" data-edit-preview>
            <div className="flex h-32 items-center justify-center overflow-hidden rounded" aria-label="原素材片段预览">
                {!url ? (
                    <span className="text-xs" role="status">
                        {error || "正在读取原素材…"}
                    </span>
                ) : source.type === "image" ? (
                    <img className="h-full w-full object-contain" src={url} alt={source.title} onLoad={() => setLoaded(true)} onError={() => setError("图片无法预览，请检查原文件")} />
                ) : (
                    <video
                        ref={video}
                        className="h-full w-full object-contain"
                        src={url}
                        playsInline
                        preload="auto"
                        onLoadedMetadata={(e) => {
                            e.currentTarget.currentTime = clip.start;
                            setCursor(clip.start);
                            setLoaded(true);
                            onCursor?.(clip.start);
                        }}
                        onTimeUpdate={(e) => {
                            setCursor(e.currentTarget.currentTime);
                            onCursor?.(e.currentTarget.currentTime);
                            if (e.currentTarget.currentTime >= clip.end) e.currentTarget.pause();
                        }}
                        onPlay={(e) => {
                            if (disabled) e.currentTarget.pause();
                            else {
                                setPlaying(true);
                                if (e.currentTarget.currentTime < clip.start || e.currentTarget.currentTime >= clip.end) e.currentTarget.currentTime = clip.start;
                            }
                        }}
                        onPause={() => setPlaying(false)}
                        onEnded={() => setPlaying(false)}
                        onError={() => setError("原视频暂时无法预览，可继续编辑时间并输出；请检查文件或使用系统播放器确认编码")}
                    />
                )}
            </div>
            <div className="flex items-center justify-between gap-2 text-xs">
                {source.type === "video" && <Button type="text" size="small" aria-label={playing ? "暂停预览" : "播放片段"} icon={playing ? <Pause size={13} /> : <Play size={13} />} disabled={unavailable} onClick={() => void play()} />}
                <span className="min-w-0 truncate">{source.title}</span>
                <label className="flex shrink-0 items-center gap-1">
                    播放头
                    <InputNumber size="small" className="!w-24" aria-label="播放头秒数" min={0} max={detail.duration} step={step} value={cursor} precision={3} disabled={disabled || !loaded} onChange={(value) => value !== null && seek(value)} />
                    <span>秒</span>
                </label>
            </div>
            <Slider aria-label="素材播放头" ariaLabelForHandle="素材播放头" className="!my-2" min={0} max={detail.duration} step={step} value={cursor} disabled={disabled || !loaded} onChange={seek} tooltip={{ formatter: (v) => `${v?.toFixed(3)} 秒` }} />
            <div className="flex items-center justify-between text-[11px] opacity-70">
                <span>
                    {readOnly ? "选段" : "保留"} {clip.start.toFixed(2)}–{clip.end.toFixed(2)} 秒
                </span>
                <span>原片 {detail.duration.toFixed(2)} 秒</span>
            </div>
            <Slider
                range
                aria-label="片段保留范围"
                ariaLabelForHandle={["片段入点", "片段出点"]}
                className="!my-2"
                min={0}
                max={detail.duration}
                step={step}
                value={range}
                disabled={disabled || readOnly}
                onChange={(value) => {
                    setRange(value);
                    seek(value[0] !== range[0] ? value[0] : value[1]);
                }}
                onChangeComplete={(value) => trim(value[0], value[1])}
                tooltip={{ formatter: (v) => `${v?.toFixed(3)} 秒` }}
            />
            {!readOnly && (
                <div className="flex flex-wrap items-center gap-1">
                    <Button type="text" size="small" disabled={unavailable || cursor >= clip.end} onClick={() => trim(cursor, clip.end)}>
                        设为入点
                    </Button>
                    <Button type="text" size="small" disabled={unavailable || cursor <= clip.start} onClick={() => trim(clip.start, cursor)}>
                        设为出点
                    </Button>
                    <Button
                        type="text"
                        size="small"
                        icon={<Scissors size={12} />}
                        disabled={unavailable || cursor <= clip.start || cursor >= clip.end}
                        onClick={() => {
                            video.current?.pause();
                            onSplit(cursor);
                        }}
                    >
                        在此切分
                    </Button>
                    <Button type="text" size="small" disabled={disabled || (clip.start === 0 && clip.end === detail.duration)} onClick={() => trim(0, detail.duration)}>
                        恢复整段
                    </Button>
                </div>
            )}
            {error && (
                <p className="m-0 text-xs" role="alert">
                    {error}
                </p>
            )}
            <p className="m-0 text-[11px] leading-5 opacity-70">{readOnly ? "这里只预览选段，不修改时间线；点击播放试听，返回时间线后继续精修。" : "拖动上方播放头定位，下方两端控制保留范围。预览为原素材，转场、字幕与配乐在输出时合成。"}</p>
        </div>
    );
}
