import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Button, Modal } from "antd";
import { Box, Camera, Clapperboard, LoaderCircle, Play, Sparkles } from "lucide-react";
import { DirectorSetup } from "./director-setup";
import { useDirectorDraft } from "./use-director-draft";
import { directorInputSnapshot } from "@/lib/canvas/director-inputs";
import { studioModelChoice } from "@/lib/canvas/studio-assistant";
import type { DirectorAiMode } from "@/lib/canvas/director-assistant";
import { directorPrompt, readDirectorScene } from "@/lib/canvas/director-scene";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { createCanvasNode, imageMetadata } from "@/lib/canvas/canvas-node-factory";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { uploadImage, deleteStoredImages } from "@/services/image-storage";
import { reportError } from "@/services/diagnostics";
import type { CanvasNodeContext, CanvasPlugin } from "@/types/canvas-plugin";
import type { DirectorScene } from "@/types/director";

const Editor = lazy(() => import("./director-editor"));
function DirectorContent({ ctx }: { ctx: CanvasNodeContext }) {
    const [open, setOpen] = useState(false), [scene, setScene] = useState<DirectorScene | null>(null), [error, setError] = useState("");
    const creation = useDirectorDraft(ctx);
    const latest = useRef(ctx); latest.current = ctx;
    const generation = useRef(0), exporting = useRef(false), controller = useRef<AbortController | null>(null);
    const start = (mode?: DirectorAiMode) => { try { const scene = readDirectorScene(latest.current.node.metadata?.directorScene); if (!latest.current.node.metadata?.directorScene || mode) latest.current.updateMetadata({ ...(!latest.current.node.metadata?.directorScene ? { directorScene: scene } : {}), ...(mode ? { directorAssistant: { ...latest.current.node.metadata?.directorAssistant, mode } } : {}) }); creation.clear(); setScene(scene); setError(""); setOpen(true); if (mode) void creation.generate(mode, scene, true); } catch (error) { setError(error instanceof Error ? error.message : "场景读取失败"); } };
    useEffect(() => ctx.on("director:open", payload => { if (payload === ctx.node.id) start(); }), [ctx.node.id]);
    useEffect(() => { generation.current++; setOpen(false); setScene(null); return () => { generation.current++; controller.current?.abort(); }; }, [ctx.node.id, ctx.projectId]);
    const change = (next: DirectorScene) => { setScene(next); latest.current.updateMetadata({ directorScene: next }); };
    useEffect(() => {
        if (!open || !ctx.node.metadata?.directorScene) return;
        try { const next=readDirectorScene(ctx.node.metadata.directorScene); setScene(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next); }
        catch(error) { setError(error instanceof Error?error.message:'共享场景无效，当前画面已保留'); }
    }, [open,ctx.node.metadata?.directorScene]);
    const capture = async (blob: Blob, scene: DirectorScene,label?:string,workflow:boolean|"video"=false,note?:string,seconds?:number) => {
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
            const text = workflow ? createCanvasNode("text", { x: 0, y: 0 }, { content: directorPrompt(scene,note), status: "success" }) : null;
            const target = workflow ? createCanvasNode(workflow === "video" ? "video" : "image", { x: 0, y: 0 }, { ...(workflow === "video" ? { seconds: String(seconds ?? 5) } : { generationType: "edit" as const }), prompt: directorPrompt(scene,note), references: [image.storageKey || image.url] }) : null;
            const footprint = { width: size.width + (target ? 80 + target.width : 0), height: size.height + (text ? 32 + text.height : 0) };
            const position = { x: node.position.x + node.width + 100, y: node.position.y };
            for (const neighbor of [...latest.current.getNodes()].sort((a,b) => a.position.y - b.position.y)) {
                if (position.x < neighbor.position.x + neighbor.width && position.x + footprint.width > neighbor.position.x && position.y < neighbor.position.y + neighbor.height && position.y + footprint.height > neighbor.position.y) position.y = neighbor.position.y + neighbor.height + 32;
            }
            const ops: CanvasAgentOp[] = [{ type: "add_node", id: output.id, nodeType: "image", title: `导演台${label||'取景'} · ${scene.camera.lens}mm`, position, ...size, metadata }, { type: "connect_nodes", fromNodeId: node.id, toNodeId: output.id }];
            if (text && target) ops.push(
                { type: "add_node", id: text.id, nodeType: "text", title: "导演台 · 构图说明", position: { x: position.x, y: position.y + size.height + 32 }, width: size.width, height: text.height, metadata: text.metadata },
                { type: "add_node", id: target.id, nodeType: target.type, title: workflow === "video" ? "导演台 · 待生成视频" : "导演台 · 待生成", position: { x: position.x + size.width + 80, y: position.y }, width: target.width, height: target.height, metadata: target.metadata },
                { type: "connect_nodes", fromNodeId: output.id, toNodeId: target.id }, { type: "connect_nodes", fromNodeId: text.id, toNodeId: target.id },
            );
            latest.current.applyOps(ops);
            committed = true;
        } catch (error) { if (!abort.signal.aborted) { reportError("image", "save", error); throw error; } }
        finally { if (!committed && key) await deleteStoredImages([key]); if (controller.current === abort) controller.current = null; exporting.current = false; }
    };
    const summary = ctx.node.metadata?.directorScene, settings = ctx.node.metadata?.directorAssistant || {}, mode = settings.mode === "animation" ? "animation" : "scene";
    const canGenerate = studioModelChoice(ctx.ai, settings.model, "text").ready && Boolean(settings.prompt?.trim() || directorInputSnapshot(ctx).inputs.length);
    return <>
        <div className="flex h-full w-full min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain p-3 pt-6" style={{ color: ctx.theme.node.text }} data-director-node onWheel={event => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-2"><div className="inline-flex items-center gap-1.5 text-sm font-semibold"><Clapperboard size={16} />3D 导演台</div><span className="text-[11px]" style={{color:ctx.theme.node.muted}}>描述想法 → 预览 → 微调</span></div>
            <DirectorSetup ctx={ctx} disabled={open || creation.busy} compact />
            {error && <p role="alert" className="max-h-16 overflow-auto text-xs">{error}</p>}
            <div className="mt-auto space-y-1.5" onMouseDown={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
                <Button type="primary" className="!h-8 !w-full !rounded-lg" disabled={!canGenerate || open || creation.busy} icon={creation.busy ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" /> : mode === "animation" ? <Play size={14} /> : <Sparkles size={14} />} onClick={() => start(mode)}>{creation.busy ? "正在准备…" : mode === "animation" ? "生成预演" : "生成布景"}</Button>
                <div className="flex items-center justify-between gap-1 text-[11px]" style={{color:ctx.theme.node.muted}}><span className="inline-flex min-w-0 items-center gap-1 truncate"><Box size={12} />{summary?.objects?.length ?? 1} 个物体 · {summary?.shots?.length ?? 0} 镜</span><Button type="text" className="!px-1 !text-xs" size="small" icon={<Camera size={13} />} disabled={creation.busy} onClick={() => start()}>打开导演台</Button></div>
                <p className="text-[10px] leading-relaxed" style={{color:ctx.theme.node.muted}}>生成调用所选模型；预览后应用，再手动调整。</p>
            </div>
        </div>
        <Modal title="3D 导演台" open={open} width="min(1180px, calc(100vw - 32px))" centered footer={null} destroyOnHidden data-canvas-shortcuts-ignore data-canvas-no-zoom onCancel={() => { controller.current?.abort(); creation.clear(); setOpen(false); }} styles={{ body: { paddingTop: 8, maxHeight: "calc(100dvh - 120px)", overflowY: "auto", overscrollBehavior: "contain" } }}>
            {open && scene && <Suspense fallback={<div className="flex min-h-80 items-center justify-center gap-2 text-sm" role="status"><LoaderCircle size={18} className="animate-spin motion-reduce:animate-none" />正在准备导演台…</div>}><Editor scene={scene} ctx={ctx} creation={creation} onChange={change} onCapture={capture} /></Suspense>}
        </Modal>
    </>;
}
export const directorPlugin: CanvasPlugin = {
    id: "director", name: "3D 导演台", version: "1.6.0", description: "提示词或连线直接生成布景与预演，预览后手动微调，支持视频反推与原尺寸输出。",
    nodes: [{ type: "director:stage", title: "3D 导演台", icon: <Clapperboard size={18} />, description: "提示词或连接文本／图片生成三维布景、动作预演，再手动微调", defaultSize: { width: 400, height: 370 }, hidePanel: true, renderOwnStatus: true, Content: DirectorContent,
        toolbar: ctx => [{ id: "director-open", title: "打开 3D 导演台", label: "导演台", icon: <Camera size={14} />, onClick: () => ctx.emit("director:open", ctx.node.id) }],
        onDoubleClick: ctx => { ctx.emit("director:open", ctx.node.id); return true; },
    }],
};
