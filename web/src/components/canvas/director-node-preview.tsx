import { useEffect, useRef, useState } from "react";
import { createDirectorRuntime, type DirectorRuntime } from "./director-runtime";
import { readDirectorScene } from "@/lib/canvas/director-scene";
import type { DirectorScene } from "@/types/director";

export default function DirectorNodePreview({ scene }: { scene: DirectorScene }) {
    const container = useRef<HTMLDivElement>(null), runtime = useRef<DirectorRuntime | null>(null);
    const [error, setError] = useState("");
    useEffect(() => {
        try {
            runtime.current = createDirectorRuntime(container.current!, readDirectorScene(scene), { camera: () => {}, object: () => {}, select: () => {}, error: setError });
            runtime.current.interactive(false);
        } catch { setError("布景已保存；当前无法显示三维预览，请打开导演台查看硬件加速提示。"); }
        return () => { runtime.current?.dispose(); runtime.current = null; };
    }, []);
    useEffect(() => {
        try { runtime.current?.update(readDirectorScene(scene), null); }
        catch { setError("预览暂不可用，场景数据已保留。"); }
    }, [scene]);
    return <div ref={container} role="img" aria-label="已搭建布景预览" data-director-node-preview className="pointer-events-none relative h-36 w-full shrink-0 overflow-hidden rounded-lg">{error && <p role="status" className="absolute inset-0 z-10 flex items-center justify-center p-3 text-xs">{error}</p>}</div>;
}
