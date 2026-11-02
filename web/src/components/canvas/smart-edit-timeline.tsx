import { useRef, useState } from "react";
import { Select } from "antd";
import { Captions, Film, Music2 } from "lucide-react";
import type { EditAnalysis, EditClip } from "@/types/smart-edit";
import { editDuration, editTimeline, moveEditClip, trimEditClip } from "@/lib/canvas/smart-edit";

export const editTimecode = (seconds: number) => {
    const ms = Math.round(Math.max(0, seconds) * 1000);
    return `${Math.floor(ms / 60000)
        .toString()
        .padStart(2, "0")}:${Math.floor((ms / 1000) % 60)
        .toString()
        .padStart(2, "0")}.${(ms % 1000).toString().padStart(3, "0")}`;
};

export function SmartEditTimeline({
    clips,
    analysis,
    transition,
    selected,
    cursor,
    music,
    subtitles,
    disabled,
    onSelect,
    onSeek,
    onEdit,
}: {
    clips: EditClip[];
    analysis: EditAnalysis;
    transition: number;
    selected?: string;
    cursor: number;
    music: string[];
    subtitles: boolean;
    disabled: boolean;
    onSelect: (id: string) => void;
    onSeek: (time: number) => void;
    onEdit: (clips: EditClip[]) => void;
}) {
    const [zoom, setZoom] = useState(1),
        [drag, setDrag] = useState<EditClip | null>(null),
        [moving, setMoving] = useState("");
    const gesture = useRef<{ clip: EditClip; edge: "start" | "end"; x: number; scale: number } | null>(null);
    const track = useRef<HTMLDivElement>(null);
    const shown = drag ? clips.map((c) => (c.id === drag.id ? drag : c)) : clips;
    let timeline: ReturnType<typeof editTimeline> = [],
        total = 0;
    try {
        timeline = editTimeline(shown, transition);
        total = editDuration(shown, transition);
    } catch {
        /* Inspector remains available to repair invalid ranges. */
    }
    const percent = (time: number) => (total > 0 ? `${(time / total) * 100}%` : "0%");
    const begin = (event: React.PointerEvent<HTMLButtonElement>, c: EditClip, edge: "start" | "end") => {
        if (disabled || !track.current || !total) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        gesture.current = { clip: c, edge, x: event.clientX, scale: track.current.getBoundingClientRect().width / total };
        onSelect(c.id);
        setDrag(c);
    };
    const move = (event: React.PointerEvent<HTMLButtonElement>) => {
        const g = gesture.current,
            source = analysis.sources.find((s) => s.id === g?.clip.sourceId);
        if (!g || !source) return;
        const delta = Math.round(((event.clientX - g.x) / g.scale) * source.fps) / source.fps;
        const start = g.edge === "start" ? Math.max(0, Math.min(g.clip.end - 1 / source.fps, g.clip.start + delta)) : g.clip.start;
        const end = g.edge === "end" ? Math.min(source.duration, Math.max(g.clip.start + 1 / source.fps, g.clip.end + delta)) : g.clip.end;
        setDrag(trimEditClip(g.clip, start, end, source));
    };
    const finish = (event: React.PointerEvent<HTMLButtonElement>, commit: boolean) => {
        event.stopPropagation();
        if (commit && drag && gesture.current && JSON.stringify(drag) !== JSON.stringify(gesture.current.clip)) onEdit(clips.map((c) => (c.id === drag.id ? drag : c)));
        gesture.current = null;
        setDrag(null);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };
    return (
        <section className="border-t px-3 pb-2 pt-2" style={{ borderColor: "var(--edit-border)" }} data-edit-timeline aria-label="剪辑时间线">
            <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-3">
                    <span className="font-medium">时间线</span>
                    <span className="tabular-nums opacity-70">
                        {editTimecode(cursor)} / {editTimecode(total)}
                    </span>
                </div>
                <label className="flex items-center gap-2">
                    缩放
                    <Select size="small" aria-label="时间线缩放" value={zoom} options={[1, 2, 4].map((v) => ({ value: v, label: v === 1 ? "适应窗口" : `${v * 100}%` }))} onChange={setZoom} />
                </label>
            </div>
            <div className="thin-scrollbar overflow-x-auto pb-1">
                <div style={{ width: `${Math.max(1, zoom) * 100}%`, minWidth: 400 }}>
                    <div
                        className="ml-16 flex h-6 cursor-crosshair items-start justify-between border-b text-[10px] tabular-nums opacity-70"
                        style={{ borderColor: "var(--edit-border)" }}
                        aria-label="时间线标尺"
                        role="slider"
                        tabIndex={0}
                        aria-valuemin={0}
                        aria-valuemax={total}
                        aria-valuenow={Math.min(cursor, total)}
                        aria-valuetext={editTimecode(cursor)}
                        onPointerDown={(e) => {
                            if (!disabled && total) {
                                const r = e.currentTarget.getBoundingClientRect();
                                onSeek(Math.max(0, Math.min(total, ((e.clientX - r.left) / r.width) * total)));
                            }
                        }}
                        onKeyDown={(e) => {
                            if (disabled) return;
                            const step = 1 / (analysis.sources[0]?.fps || 30);
                            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
                                e.preventDefault();
                                e.stopPropagation();
                                onSeek(e.key === "Home" ? 0 : e.key === "End" ? total : Math.max(0, Math.min(total, cursor + (e.key === "ArrowLeft" ? -step : step))));
                            }
                        }}
                    >
                        {Array.from({ length: 9 }, (_, i) => (
                            <span key={i}>{editTimecode((total * i) / 8).slice(0, total < 60 ? 8 : 5)}</span>
                        ))}
                    </div>
                    <div className="flex items-center gap-2 py-1">
                        <span className="flex w-14 shrink-0 items-center gap-1 text-[11px]">
                            <Film size={12} />
                            画面
                        </span>
                        <div ref={track} className="relative h-14 min-w-0 flex-1" data-edit-sequence>
                            {!timeline.length && <span className="absolute inset-0 grid place-items-center text-xs opacity-60">读取素材或应用 AI 草稿，建立时间线</span>}
                            {timeline.map(({ clip: c, start, end }) => {
                                const index = clips.findIndex((item) => item.id === c.id),
                                    source = analysis.sources.find((s) => s.id === c.sourceId);
                                return (
                                    <div
                                        key={c.id}
                                        className="absolute inset-y-0 overflow-hidden rounded border transition-colors motion-reduce:transition-none"
                                        data-timeline-clip={c.id}
                                        style={{
                                            left: percent(start),
                                            width: percent(end - start),
                                            borderColor: selected === c.id ? "var(--edit-text)" : "var(--edit-border)",
                                            background: selected === c.id ? "var(--edit-selected)" : "var(--edit-surface)",
                                            opacity: moving === c.id ? 0.5 : 1,
                                        }}
                                        draggable={!disabled && !gesture.current}
                                        onDragStart={(e) => {
                                            setMoving(c.id);
                                            e.dataTransfer.setData("application/x-oneyes-edit-clip", c.id);
                                            e.dataTransfer.effectAllowed = "move";
                                        }}
                                        onDragEnd={() => setMoving("")}
                                        onDragOver={(e) => {
                                            if (!disabled && e.dataTransfer.types.includes("application/x-oneyes-edit-clip")) {
                                                e.preventDefault();
                                                e.dataTransfer.dropEffect = "move";
                                            }
                                        }}
                                        onDrop={(e) => {
                                            e.preventDefault();
                                            if (disabled) return;
                                            const id = e.dataTransfer.getData("application/x-oneyes-edit-clip"),
                                                r = e.currentTarget.getBoundingClientRect();
                                            onEdit(moveEditClip(clips, id, c.id, e.clientX > r.left + r.width / 2));
                                            setMoving("");
                                        }}
                                    >
                                        <button
                                            type="button"
                                            className="h-full w-full overflow-hidden px-3 py-1 text-left text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px]"
                                            aria-label={`预览片段${index + 1}`}
                                            aria-pressed={selected === c.id}
                                            disabled={disabled}
                                            onClick={() => {
                                                onSelect(c.id);
                                                onSeek(start);
                                            }}
                                            title={`${source?.title} · ${editTimecode(c.start)}–${editTimecode(c.end)}；拖动调整顺序`}
                                        >
                                            <span className="block truncate">
                                                {index + 1}. {source?.title}
                                            </span>
                                            <span className="block truncate text-[10px] opacity-65">
                                                {editTimecode(c.start)}–{editTimecode(c.end)}
                                            </span>
                                        </button>
                                        {(["start", "end"] as const).map((edge) => (
                                            <button
                                                key={edge}
                                                type="button"
                                                aria-label={`时间线片段${index + 1}${edge === "start" ? "入点" : "出点"}`}
                                                disabled={disabled}
                                                title="拖动修剪，按方向键逐帧调整"
                                                className="absolute inset-y-1 w-2 touch-none cursor-ew-resize rounded opacity-60 hover:opacity-100 focus-visible:outline focus-visible:outline-2"
                                                style={{ [edge === "start" ? "left" : "right"]: 0, background: "var(--edit-border)" }}
                                                onPointerDown={(e) => begin(e, c, edge)}
                                                onPointerMove={move}
                                                onPointerUp={(e) => finish(e, true)}
                                                onPointerCancel={(e) => finish(e, false)}
                                                onLostPointerCapture={() => {
                                                    gesture.current = null;
                                                    setDrag(null);
                                                }}
                                                onKeyDown={(e) => {
                                                    if (!disabled && ["ArrowLeft", "ArrowRight"].includes(e.key) && source) {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        const t = c[edge] + (e.key === "ArrowLeft" ? -1 : 1) / source.fps;
                                                        if (t >= 0 && t <= source.duration && (edge === "start" ? t < c.end : t > c.start))
                                                            onEdit(clips.map((item) => (item.id === c.id ? trimEditClip(c, edge === "start" ? t : c.start, edge === "end" ? t : c.end, source) : item)));
                                                    }
                                                }}
                                            />
                                        ))}
                                    </div>
                                );
                            })}
                            {total > 0 && (
                                <div className="pointer-events-none absolute inset-y-[-22px] z-10 w-px" style={{ left: percent(Math.min(cursor, total)), background: "var(--edit-text)" }} data-timeline-playhead>
                                    <span className="absolute -left-1 top-0 h-2 w-2 rotate-45" style={{ background: "var(--edit-text)" }} />
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-2 py-0.5 text-[11px]">
                        <span className="flex w-14 shrink-0 items-center gap-1">
                            <Captions size={12} />
                            字幕
                        </span>
                        <div className="relative h-6 min-w-0 flex-1 overflow-hidden">
                            {timeline.flatMap(({ clip, start }, index) =>
                                (analysis.sources.find((s) => s.id === clip.sourceId)?.cues || []).map((cue, i) => {
                                    const from = start + Math.max(index ? transition / 2 : 0, cue.start - clip.start),
                                        until = start + Math.min(clip.end - clip.start - (index < timeline.length - 1 ? transition / 2 : 0), cue.end - clip.start);
                                    if (until <= from) return null;
                                    return (
                                        <button
                                            type="button"
                                            key={`${clip.id}:${i}`}
                                            title={cue.text}
                                            disabled={disabled}
                                            className="absolute inset-y-0 truncate border-b px-1 text-left disabled:opacity-50"
                                            style={{ left: percent(from), width: percent(until - from), borderColor: "var(--edit-border)", opacity: subtitles ? 1 : 0.55 }}
                                            onClick={() => onSeek(from)}
                                        >
                                            {cue.text}
                                        </button>
                                    );
                                }),
                            )}
                            {!analysis.sources.some((s) => s.cues?.length) && <span className="opacity-50">未识别字幕</span>}
                        </div>
                    </div>
                    <div className="flex items-center gap-2 py-0.5 text-[11px]">
                        <span className="flex w-14 shrink-0 items-center gap-1">
                            <Music2 size={12} />
                            配乐
                        </span>
                        <span className="min-w-0 flex-1 truncate opacity-65">{music.length ? `${music.join("、")} · 随成片混音，音量在右侧调整` : "未连接配乐，保留原片音轨"}</span>
                    </div>
                </div>
            </div>
            <p className="m-0 mt-1 text-[10px] opacity-60">拖动片段排序、两端逐帧修剪；标尺定位。字幕与配乐行显示输出映射，非独立多轨编辑。转场效果请使用「预览成片」。</p>
        </section>
    );
}
