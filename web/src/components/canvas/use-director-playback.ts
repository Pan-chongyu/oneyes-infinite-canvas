import { useEffect, useRef, useState } from "react";
import { sequenceAt, sequenceDuration, shotDuration, shotScene } from "@/lib/canvas/director-sequence";
import type { DirectorScene } from "@/types/director";

/** Playback is ephemeral: it never writes sampled frames into the saved scene. */
export function useDirectorPlayback(scene: DirectorScene) {
    const [preview, setPreview] = useState<{ shotId: string; time: number } | null>(null);
    const [playing, setPlaying] = useState(false);
    const animation = useRef(0), generation = useRef(0);
    const source = useRef(scene); source.current = scene;
    const stop = (restore = false) => { generation.current++; cancelAnimationFrame(animation.current); setPlaying(false); if (restore) setPreview(null); };
    const seek = (shotId: string, time: number) => { stop(); setPreview({ shotId, time }); };
    const play = (shotId?: string) => {
        stop();
        const shots = shotId ? source.current.shots?.filter(shot => shot.id === shotId) || [] : source.current.shots || [];
        if (!shots.length) return;
        const token = generation.current, start = performance.now();
        const total = sequenceDuration(shots);
        const index = shots.findIndex(shot => shot.id === preview?.shotId);
        const cursor = index >= 0 && preview ? sequenceDuration(shots.slice(0,index)) + Math.min(shotDuration(shots[index]),preview.time) : 0;
        const initial = cursor < total ? cursor : 0;
        setPlaying(true);
        const tick = (now: number) => {
            if (token !== generation.current) return;
            const elapsed = Math.min(total, initial + (now - start) / 1000), sample = sequenceAt(shots, elapsed);
            if (sample) setPreview({ shotId: sample.shot.id, time: sample.time });
            if (elapsed < total) animation.current = requestAnimationFrame(tick);
            else setPlaying(false);
        };
        animation.current = requestAnimationFrame(tick);
    };
    useEffect(() => () => { generation.current++; cancelAnimationFrame(animation.current); }, []);
    useEffect(() => { stop(true); }, [scene]);
    const shot = scene.shots?.find(shot => shot.id === preview?.shotId);
    return { preview, playing, display: shot && preview ? shotScene(scene, shot, preview.time) : scene, seek, play, stop };
}
