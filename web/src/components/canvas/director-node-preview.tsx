import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Slider } from "antd";
import { Pause, Play } from "lucide-react";
import { createDirectorRuntime, type DirectorRuntime } from "./director-runtime";
import { useDirectorPlayback } from "./use-director-playback";
import { readDirectorScene } from "@/lib/canvas/director-scene";
import { sequenceAt, sequenceDuration } from "@/lib/canvas/director-sequence";
import type { DirectorScene } from "@/types/director";

export default function DirectorNodePreview({ scene, autoPlayFrom }: { scene: DirectorScene; autoPlayFrom?: string }) {
    const container = useRef<HTMLDivElement>(null), runtime = useRef<DirectorRuntime | null>(null);
    const [error, setError] = useState("");
    const sequence = useMemo(() => {
        const index = scene.shots?.findIndex(shot => shot.id === autoPlayFrom) ?? -1;
        return index >= 0 ? { ...scene, shots: scene.shots!.slice(index) } : scene;
    }, [scene, autoPlayFrom]);
    const playback = useDirectorPlayback(sequence), started = useRef<string | undefined>(undefined), shots = sequence.shots || [], total = sequenceDuration(shots);
    const index = shots.findIndex(shot => shot.id === playback.preview?.shotId), cursor = index >= 0 && playback.preview ? sequenceDuration(shots.slice(0, index)) + playback.preview.time : 0;
    useEffect(() => {
        try {
            runtime.current = createDirectorRuntime(container.current!, readDirectorScene(scene), { camera: () => {}, object: () => {}, select: () => {}, error: setError });
            runtime.current.interactive(false);
        } catch { setError("场景已保存；当前无法显示三维预览，请打开导演台查看硬件加速提示。"); }
        return () => { runtime.current?.dispose(); runtime.current = null; };
    }, []);
    useEffect(() => {
        try { runtime.current?.update(readDirectorScene(playback.display), null); }
        catch { setError("预览暂不可用，场景数据已保留。"); }
    }, [playback.display]);
    useEffect(() => {
        if (error) { playback.stop(); return; }
        if (autoPlayFrom && started.current !== autoPlayFrom) { started.current = autoPlayFrom; playback.play(); }
    }, [autoPlayFrom, sequence, error]);
    return <div className="flex min-h-0 flex-1 flex-col gap-1">
        <div ref={container} role="img" aria-label={shots.length ? "节点动画预演" : "已搭建布景预览"} data-director-node-preview data-playing={playback.playing} className="pointer-events-none relative min-h-0 w-full flex-1 overflow-hidden rounded-lg">{error && <p role="status" className="absolute inset-0 z-10 flex items-center justify-center p-3 text-xs">{error}</p>}</div>
        {!!shots.length && <div aria-label="节点预演控制" className="flex shrink-0 items-center gap-2 text-[11px]" onMouseDown={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onWheel={event => event.stopPropagation()} data-canvas-shortcuts-ignore data-canvas-no-zoom>
            <Button type="text" size="small" className="!px-1 !text-xs" disabled={!!error} icon={playback.playing ? <Pause size={12} /> : <Play size={12} />} onClick={() => playback.playing ? playback.stop() : playback.play()}>{playback.playing ? "暂停" : cursor >= total ? "重播" : cursor ? "继续" : "播放"}</Button>
            <Slider className="!my-1 min-w-0 flex-1" ariaLabelForHandle="节点预演进度" min={0} max={total} step={0.001} value={cursor} disabled={!!error} tooltip={{ formatter: value => `${value?.toFixed(2)} 秒` }} onChange={value => { const sample = sequenceAt(shots, value); if (sample) playback.seek(sample.shot.id, sample.time); }} />
            <span className="shrink-0 tabular-nums" data-director-preview-time>{cursor.toFixed(2)} / {Number(total.toFixed(3))}s</span>
        </div>}
    </div>;
}
