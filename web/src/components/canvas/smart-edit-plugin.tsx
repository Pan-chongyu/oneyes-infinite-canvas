import { useEffect, useRef, useState } from 'react';
import { Button } from 'antd';
import { Scissors, ExternalLink } from 'lucide-react';
import type { CanvasNodeContext, CanvasPlugin } from '@/types/canvas-plugin';
import { creatorSourceBlob } from '@/services/creator-media';
import { editorChannel, editorKey, writeEditorLink, readEditorLink, type EditorLink, type EditorRequest } from '@/services/editor-link';
import { uploadMediaFile } from '@/services/file-storage';
import { videoMetadata } from '@/lib/canvas/canvas-node-factory';

function sourceNodes(ctx: CanvasNodeContext) {
    const ids = ctx.node.metadata?.smartEdit?.sourceIds;
    return (ids ? ids.map(id => ctx.getNode(id)).filter(Boolean) : ctx.getUpstream()).filter(n => n && ['video', 'image', 'audio'].includes(n.type));
}
function Content({ ctx }: { ctx: CanvasNodeContext }) {
    const latest = useRef(ctx); latest.current = ctx;
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    const consuming = useRef(false);
    useEffect(() => {
        if (!ctx.projectId) return;
        let disposed = false;
        const controllers = new Map<string, AbortController>();
        const channel = new BroadcastChannel(editorChannel);
        const consume = async () => {
            if (consuming.current || disposed) return;
            consuming.current = true;
            try {
                const key = await editorKey(ctx.projectId!, ctx.node.id), link = await readEditorLink(key), result = link?.output;
                if (!result || disposed || latest.current.getNode(ctx.node.id)?.metadata?.smartEdit?.editorOutputId === result.id) return;
                const id = `edit-${result.id}`;
                if (!latest.current.getNode(id)) {
                    const stored = await uploadMediaFile(new File([result.blob], result.name, { type: 'video/mp4' }));
                    if (disposed || !latest.current.getNode(ctx.node.id)) return;
                    const node = latest.current.getNode(ctx.node.id)!;
                    latest.current.applyOps([
                        { type: 'add_node', id, nodeType: 'video', title: result.name, position: { x: node.position.x + node.width + 80, y: node.position.y }, width: 400, height: 260, metadata: videoMetadata(stored) },
                        { type: 'connect_nodes', fromNodeId: node.id, toNodeId: id },
                    ]);
                }
                latest.current.updateMetadata({ smartEdit: { ...latest.current.getNode(ctx.node.id)?.metadata?.smartEdit, editorOutputId: result.id }, errorDetails: undefined });
            } catch (e) { if (!disposed) setError((e as Error).message); }
            finally { consuming.current = false; }
        };
        channel.onmessage = event => { void (async () => {
            const request = event.data as EditorRequest;
            const key = await editorKey(ctx.projectId!, ctx.node.id);
            if (disposed || request?.key !== key || !latest.current.getNode(ctx.node.id)) return;
            if (request.operation === 'output') { await consume(); return; }
            const link = await readEditorLink(key);
            if (!link || request.session !== link.session) return;
            if (request.operation === 'cancel') { controllers.get(request.id)?.abort(); return; }
            const reply = (data: object) => { if (!disposed) channel.postMessage({ key, session: request.session, id: request.id, operation: 'response', ...data }); };
            try {
                const ai = latest.current.ai;
                if (request.operation === 'models') { reply({ models: ai.listModels('text'), defaultModel: ai.defaultModel('text') }); return; }
                if (request.operation !== 'generate' || controllers.has(request.id)) return;
                if (!ai.listModels('text').some(m => m.value === request.model) || ai.isModelReady && !ai.isModelReady(request.model!, 'text')) throw Error('此模型未配置或 Key 不可用，请返回 Canvas 配置渠道');
                const controller = new AbortController(); controllers.set(request.id, controller);
                try {
                    const result = await ai.generateText(request.prompt || '', { model: request.model, system: request.system, signal: controller.signal });
                    reply({ text: result.text });
                } finally { controllers.delete(request.id); }
            } catch (e) { reply({ error: (e as Error).message }); }
        })().catch(e => { if (!disposed) setError(e.message); }); };
        void consume();
        const focus = () => { void consume(); };
        window.addEventListener('focus', focus);
        return () => { disposed = true; controllers.forEach(c => c.abort()); void editorKey(ctx.projectId!,ctx.node.id).then(key=>{channel.postMessage({key,operation:'host-offline'});channel.close();});window.removeEventListener('focus', focus); };
    }, [ctx.projectId, ctx.node.id]);
    const open = async () => {
        if (busy) return;
        setBusy(true); setError('');
        try {
            if (!ctx.projectId || !window.oneYesDesktop?.editor) throw Error('请在 OneYes Canvas 桌面版打开完整剪辑器');
            const key = await editorKey(ctx.projectId, ctx.node.id), previous = await readEditorLink(key);
            const sources = sourceNodes(latest.current), inputs: EditorLink['inputs'] = [];
            for (const node of sources) if (node) inputs.push({ id: node.id, name: node.title || node.type, kind: node.type as 'video' | 'image' | 'audio', blob: await creatorSourceBlob(node, new AbortController().signal) });
            const link: EditorLink = { version: 1, key, session: previous?.session || crypto.randomUUID(), canvasId: ctx.projectId, nodeId: ctx.node.id,
                title: ctx.node.title || '智能剪辑', theme: ctx.theme.canvas.background === '#181715' ? 'dark' : 'light', inputs,
                sourceSignature: JSON.stringify(inputs.map(s => [s.id, s.blob.size, s.blob.type])), ...(previous?.output ? { output: previous.output } : {}) };
            await writeEditorLink(key, current => ({...link,...(current?.output?{output:current.output}:{})}));
            await window.oneYesDesktop.editor.open(key);
            const channel = new BroadcastChannel(editorChannel); channel.postMessage({ key, session: link.session, operation: 'inputs' }); channel.close();
        } catch (e) { setError((e as Error).message); }
        finally { setBusy(false); }
    };
    return <div className="flex h-full flex-col justify-between gap-3 p-4" style={{ color: ctx.theme.node.text }} data-smart-edit-node>
        <div className="flex items-center gap-2"><Scissors size={19}/><span className="text-sm font-medium">智能剪辑</span><span className="ml-auto text-xs" style={{ color: ctx.theme.node.muted }}>独立窗口</span></div>
        <p className="m-0 text-xs leading-5" style={{ color: ctx.theme.node.muted }}>{error || '多轨时间线 · AI 剪辑 · 自由精修。连接视频、图片或音频，导出成片回到画布。'}</p>
        <Button type="text" size="small" loading={busy} className="self-start" icon={<ExternalLink size={14}/>} onPointerDown={e => e.stopPropagation()} onClick={() => void open()}>打开剪辑器</Button>
    </div>;
}
export const smartEditPlugin: CanvasPlugin = {
    id: 'smart-edit', name: '智能剪辑', version: '2.0.0', description: '基于 Velocut 的完整多轨剪辑器，AI 与人工共用时间线',
    nodes: [{ type: 'smart-edit:editor', title: '智能剪辑', description: '独立剪辑窗口，AI 草稿／多轨时间线／成片回填', icon: <Scissors size={18}/>,
        defaultSize: { width: 320, height: 170 }, defaultMetadata: { status: 'idle' }, hidePanel: true, renderOwnStatus: true, Content }],
};
