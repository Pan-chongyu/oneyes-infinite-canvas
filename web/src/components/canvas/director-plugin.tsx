import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Button, Modal } from "antd";
import { Box, Camera, Clapperboard, LoaderCircle, Play, Sparkles } from "lucide-react";
import { DirectorSetup } from "./director-setup";
import { useDirectorDraft } from "./use-director-draft";
import { directorInputSnapshot } from "@/lib/canvas/director-inputs";
import { studioModelChoice } from "@/lib/canvas/studio-assistant";
import type { DirectorAiMode, DirectorDraft } from "@/lib/canvas/director-assistant";
import { directorPrompt, readDirectorScene } from "@/lib/canvas/director-scene";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { createCanvasNode, imageMetadata } from "@/lib/canvas/canvas-node-factory";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { uploadImage, deleteStoredImages } from "@/services/image-storage";
import { reportError } from "@/services/diagnostics";
import type { CanvasNodeContext, CanvasPlugin } from "@/types/canvas-plugin";
import type { DirectorScene } from "@/types/director";

const Editor = lazy(() => import("./director-editor"));
const Preview = lazy(() => import("./director-node-preview"));
function DirectorContent({ ctx }: { ctx: CanvasNodeContext }) {
    const [open, setOpen] = useState(false), [scene, setScene] = useState<DirectorScene | null>(null), [error, setError] = useState("");
    const [setupOpen, setSetupOpen] = useState(!ctx.node.metadata?.directorScene), [applied, setApplied] = useState<DirectorDraft | null>(null);
    const creation = useDirectorDraft(ctx);
    const latest = useRef(ctx); latest.current = ctx;
    const generation = useRef(0), exporting = useRef(false), controller = useRef<AbortController | null>(null);
    const start = (mode?: DirectorAiMode) => { try { generation.current++; const scene = readDirectorScene(latest.current.node.metadata?.directorScene); if (!latest.current.node.metadata?.directorScene || mode) latest.current.updateMetadata({ ...(!latest.current.node.metadata?.directorScene ? { directorScene: scene } : {}), ...(mode ? { directorAssistant: { ...latest.current.node.metadata?.directorAssistant, mode } } : {}) }); creation.clear(); setScene(scene); setError(""); setOpen(true); if (mode) void creation.generate(mode, scene, true); } catch (error) { setError(error instanceof Error ? error.message : "场景读取失败"); } };
    useEffect(() => ctx.on("director:open", payload => { if (payload === ctx.node.id) start(); }), [ctx.node.id]);
    useEffect(() => { generation.current++; setOpen(false); setScene(null); setApplied(null); setSetupOpen(!ctx.node.metadata?.directorScene); return () => { generation.current++; controller.current?.abort(); }; }, [ctx.node.id, ctx.projectId]);
    const change = (next: DirectorScene) => { setScene(next); latest.current.updateMetadata({ directorScene: next }); };
    const build = async () => {
        if (creation.busy || open) return;
        const origin = latest.current, token = ++generation.current, before = JSON.stringify(origin.node.metadata?.directorScene);
        setError("");
        try {
            const draft = await creation.generate("scene", readDirectorScene(origin.node.metadata?.directorScene));
            if (!draft || token !== generation.current || origin.projectId !== latest.current.projectId || !latest.current.getNode(origin.node.id)) return;
            if (JSON.stringify(latest.current.getNode(origin.node.id)?.metadata?.directorScene) !== before) { creation.clear(); throw Error("场景已变化，生成结果未覆盖新修改，请确认后重新生成"); }
            latest.current.updateMetadata({ directorScene: draft.scene, directorAssistant: { ...latest.current.node.metadata?.directorAssistant, mode: "scene" } });
            setApplied(draft); setSetupOpen(false); creation.clear();
        } catch (error) { setError(error instanceof Error ? error.message : "布景生成失败，请检查模型配置后重试"); }
    };
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
    const canUndo = applied && JSON.stringify(summary) === JSON.stringify(applied.scene);
    const canGenerate = studioModelChoice(ctx.ai, settings.model, "text").ready && Boolean(settings.prompt?.trim() || directorInputSnapshot(ctx).inputs.length);
    return <>
        <div className="flex h-full w-full min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain p-3 pt-6" style={{ color: ctx.theme.node.text }} data-director-node onWheel={event => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-2"><div className="inline-flex items-center gap-1.5 text-sm font-semibold"><Clapperboard size={16} />3D 导演台</div><span className="text-[11px]" style={{color:ctx.theme.node.muted}}>描述想法 → 生成布景 → 微调</span></div>
            {summary && !setupOpen && !open && <Suspense fallback={<div className="flex h-36 shrink-0 items-center justify-center text-xs" role="status">正在准备布景预览…</div>}><Preview scene={summary} /></Suspense>}
            <details open={setupOpen || !summary} onToggle={event => setSetupOpen(event.currentTarget.open)} onMouseDown={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
                <summary className={summary ? "cursor-pointer py-1 text-xs" : "hidden"}>生成配置 · 提示词与模型</summary>
                <DirectorSetup ctx={ctx} disabled={open || creation.busy} compact />
            </details>
            <div className="mt-auto space-y-1.5" onMouseDown={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
                {(error || creation.error) && <p role="alert" className="max-h-16 overflow-auto text-xs">{error || creation.error}</p>}
                {creation.busy && !open && <div className="flex items-center justify-between gap-1 text-xs" role="status"><span>{creation.progress}</span><Button type="text" size="small" onClick={() => { generation.current++; creation.clear(); }}>取消生成</Button></div>}
                {canUndo && !creation.busy && <div className="flex items-center justify-between gap-1 text-xs" role="status"><span className="min-w-0 truncate" title={applied.summary}>布景已生成 · {applied.summary}</span><Button type="text" size="small" onClick={() => { if (JSON.stringify(latest.current.getNode(ctx.node.id)?.metadata?.directorScene) !== JSON.stringify(applied.scene)) return; latest.current.updateMetadata({ directorScene: JSON.parse(applied.source) }); setApplied(null); setSetupOpen(true); }}>撤销布景</Button></div>}
                <Button type="primary" className="!h-8 !w-full !rounded-lg" disabled={!canGenerate || open || creation.busy} icon={creation.busy ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" /> : mode === "animation" ? <Play size={14} /> : <Sparkles size={14} />} onClick={() => mode === "scene" ? void build() : start(mode)}>{creation.busy ? "正在搭建…" : mode === "animation" ? "生成预演" : "生成布景"}</Button>
                <div className="flex items-center justify-between gap-1 text-[11px]" style={{color:ctx.theme.node.muted}}><span className="inline-flex min-w-0 items-center gap-1 truncate"><Box size={12} />{summary?.objects?.length ?? 1} 个物体 · {summary?.shots?.length ?? 0} 镜</span><Button type="text" className="!px-1 !text-xs" size="small" icon={<Camera size={13} />} disabled={creation.busy} onClick={() => start()}>打开导演台</Button></div>
                <p className="text-[10px] leading-relaxed" style={{color:ctx.theme.node.muted}}>{mode === "animation" ? "生成调用所选模型；预演后应用，再手动调整。" : "生成调用所选模型，完成后直接搭好当前节点；需要微调时打开导演台。"}</p>
            </div>
        </div>
        <Modal title="3D 导演台" open={open} width="min(1180px, calc(100vw - 32px))" centered footer={null} destroyOnHidden data-canvas-shortcuts-ignore data-canvas-no-zoom onCancel={() => { controller.current?.abort(); creation.clear(); setOpen(false); }} styles={{ body: { paddingTop: 8, maxHeight: "calc(100dvh - 120px)", overflowY: "auto", overscrollBehavior: "contain" } }}>
            {open && scene && <Suspense fallback={<div className="flex min-h-80 items-center justify-center gap-2 text-sm" role="status"><LoaderCircle size={18} className="animate-spin motion-reduce:animate-none" />正在准备导演台…</div>}><Editor scene={scene} ctx={ctx} creation={creation} onChange={change} onCapture={capture} /></Suspense>}
        </Modal>
    </>;
}
export const directorPlugin: CanvasPlugin = {
    id: "director", name: "3D 导演台", version: "1.6.1", description: "提示词或连线直接搭建节点布景，按需打开导演台微调，支持预演、视频反推与原尺寸输出。",
    nodes: [{ type: "director:stage", title: "3D 导演台", icon: <Clapperboard size={18} />, description: "提示词或连接文本／图片生成三维布景、动作预演，再手动微调", defaultSize: { width: 400, height: 370 }, hidePanel: true, renderOwnStatus: true, Content: DirectorContent,
        toolbar: ctx => [{ id: "director-open", title: "打开 3D 导演台", label: "导演台", icon: <Camera size={14} />, onClick: () => ctx.emit("director:open", ctx.node.id) }],
        onDoubleClick: ctx => { ctx.emit("director:open", ctx.node.id); return true; },
    }],
};
