import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Button, Modal } from "antd";
import { Box, Camera, Clapperboard, LoaderCircle } from "lucide-react";
import { readDirectorScene } from "@/lib/canvas/director-scene";
import { createCanvasNode, imageMetadata } from "@/lib/canvas/canvas-node-factory";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { uploadImage, deleteStoredImages } from "@/services/image-storage";
import { reportError } from "@/services/diagnostics";
import type { CanvasNodeContext, CanvasPlugin } from "@/types/canvas-plugin";
import type { DirectorScene } from "@/types/director";

const Editor = lazy(() => import("./director-editor"));
function DirectorContent({ ctx }: { ctx: CanvasNodeContext }) {
    const [open, setOpen] = useState(false), [scene, setScene] = useState<DirectorScene | null>(null), [error, setError] = useState("");
    const latest = useRef(ctx); latest.current = ctx;
    const generation = useRef(0), exporting = useRef(false), controller = useRef<AbortController | null>(null);
    const start = () => { try { const scene = readDirectorScene(latest.current.node.metadata?.directorScene); if (!latest.current.node.metadata?.directorScene) latest.current.updateMetadata({ directorScene: scene }); setScene(scene); setError(""); setOpen(true); } catch (error) { setError(error instanceof Error ? error.message : "场景读取失败"); } };
    useEffect(() => ctx.on("director:open", payload => { if (payload === ctx.node.id) start(); }), [ctx.node.id]);
    useEffect(() => { generation.current++; setOpen(false); setScene(null); return () => { generation.current++; controller.current?.abort(); }; }, [ctx.node.id, ctx.projectId]);
    const change = (next: DirectorScene) => { setScene(next); latest.current.updateMetadata({ directorScene: next }); };
    const capture = async (blob: Blob, scene: DirectorScene) => {
        if (exporting.current) return;
        exporting.current = true;
        const token = generation.current, origin = latest.current, abort = new AbortController(); controller.current = abort;
        let key: string | undefined, committed = false;
        try {
            const image = await uploadImage(blob, { signal: abort.signal }); key = image.storageKey;
            if (token !== generation.current || origin.projectId !== latest.current.projectId || abort.signal.aborted || !latest.current.getNode(origin.node.id)) throw new DOMException("已取消取景图保存", "AbortError");
            if (image.width !== scene.width || image.height !== scene.height) throw new Error("取景图尺寸不符合设置，已停止保存；请释放显存后重试");
            const metadata = imageMetadata(image), output = createCanvasNode("image", { x: 0, y: 0 }, metadata);
            const size = fitNodeSize(image.width, image.height, 460, 360), node = latest.current.node;
            const position = { x: node.position.x + node.width + 100, y: node.position.y };
            for (const neighbor of [...latest.current.getNodes()].sort((a,b) => a.position.y - b.position.y)) {
                if (position.x < neighbor.position.x + neighbor.width && position.x + size.width > neighbor.position.x && position.y < neighbor.position.y + neighbor.height && position.y + size.height > neighbor.position.y) position.y = neighbor.position.y + neighbor.height + 32;
            }
            latest.current.applyOps([{ type: "add_node", id: output.id, nodeType: "image", title: `导演台取景 · ${scene.camera.lens}mm`, position, ...size, metadata }, { type: "connect_nodes", fromNodeId: node.id, toNodeId: output.id }]);
            committed = true;
        } catch (error) { if (!abort.signal.aborted) { reportError("image", "save", error); throw error; } }
        finally { if (!committed && key) await deleteStoredImages([key]); if (controller.current === abort) controller.current = null; exporting.current = false; }
    };
    const summary = ctx.node.metadata?.directorScene;
    return <>
        <div className="flex h-full flex-col justify-between gap-3 p-4" style={{ color: ctx.theme.node.text }}>
            <div className="flex items-start gap-3"><Clapperboard size={23} className="shrink-0" /><div><div className="text-sm font-medium">3D 导演台</div><p className="mt-1 text-xs leading-relaxed" style={{ color: ctx.theme.node.muted }}>先布景，再取景。将镜头构图变成生图参考。</p></div></div>
            <div className="flex items-center gap-4 text-xs" style={{ color: ctx.theme.node.muted }}><span className="inline-flex items-center gap-1"><Box size={13} />{summary?.objects?.length ?? 1} 个物体</span><span className="inline-flex items-center gap-1"><Camera size={13} />{summary?.camera?.lens ?? 50} mm</span></div>
            {error && <p role="alert" className="max-h-16 overflow-auto text-xs">{error}</p>}
            <Button type="text" className="self-start" size="small" icon={<Camera size={14} />} onPointerDown={event => event.stopPropagation()} onClick={start}>打开导演台</Button>
        </div>
        <Modal title="3D 导演台" open={open} width="min(1180px, calc(100vw - 32px))" centered footer={null} destroyOnHidden data-canvas-shortcuts-ignore data-canvas-no-zoom onCancel={() => { controller.current?.abort(); setOpen(false); }} styles={{ body: { paddingTop: 8 } }}>
            {open && scene && <Suspense fallback={<div className="flex min-h-80 items-center justify-center gap-2 text-sm" role="status"><LoaderCircle size={18} className="animate-spin motion-reduce:animate-none" />正在准备导演台…</div>}><Editor scene={scene} theme={ctx.theme} onChange={change} onCapture={capture} /></Suspense>}
        </Modal>
    </>;
}
export const directorPlugin: CanvasPlugin = {
    id: "director", name: "3D 导演台", version: "1.1.0", description: "本地三维布景、物体管理、机位保存与镜头取景，输出构图参考图。",
    nodes: [{ type: "director:stage", title: "3D 导演台", icon: <Clapperboard size={18} />, description: "人物与道具布景、相机、灯光及原尺寸取景图", defaultSize: { width: 320, height: 190 }, hidePanel: true, renderOwnStatus: true, Content: DirectorContent,
        toolbar: ctx => [{ id: "director-open", title: "打开 3D 导演台", label: "导演台", icon: <Camera size={14} />, onClick: () => ctx.emit("director:open", ctx.node.id) }],
        onDoubleClick: ctx => { ctx.emit("director:open", ctx.node.id); return true; },
    }],
};
