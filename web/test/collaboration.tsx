import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { BrowserRouter, useNavigate, useParams, Routes, Route } from 'react-router-dom';
import { App, ConfigProvider } from 'antd';
import '@/i18n';
import '@/styles/globals.css';
import { useCanvasCollaboration } from '@/pages/canvas/hooks/use-canvas-collaboration';
import { useCanvasStore, flushCanvasStorage } from '@/stores/canvas/use-canvas-store';
import { useCollaborationStore } from '@/stores/canvas/use-collaboration-store';
import { CanvasCollaborationButton } from '@/components/canvas/canvas-collaboration-button';
import { InfiniteCanvas } from '@/components/canvas/infinite-canvas';
import { CanvasNode } from '@/components/canvas/canvas-node';
import { CanvasCollaborationPresence } from '@/components/canvas/canvas-collaboration-presence';
import { useThemeStore } from '@/stores/use-theme-store';
import { getAntThemeConfig } from '@/lib/app-theme';
import { setImageBlob, getImageBlob } from '@/services/image-storage';
import { setMediaBlob, getMediaBlob } from '@/services/file-storage';
import type { CanvasNodeData, CanvasConnection, ConnectionHandle, ViewportTransform } from '@/types/canvas';
import type { CollaborationPresence } from '@/stores/canvas/use-collaboration-store';
import { hydrateCanvasImages } from '@/lib/canvas/canvas-generation-helpers';

await useCanvasStore.persist.rehydrate();
const seed: CanvasNodeData = { id: 'text', type: 'text', title: '共创文字', position: { x: 100, y: 180 }, width: 300, height: 170, metadata: { content: '原始内容' } };
const saved = useCanvasStore.getState().openProject(location.pathname.split('/').at(-1) || '');
const initial = saved?.id || useCanvasStore.getState().importProject({ title: '测试画布', nodes: [seed] });
if (saved) useCanvasStore.getState().updateProject(initial, { nodes: await hydrateCanvasImages(saved.nodes) });
history.replaceState(null, '', '/canvas/' + initial);

function Fixture() {
    const { id = initial } = useParams(), navigate = useNavigate(), project = useCanvasStore(store => store.projects.find(project => project.id === id));
    const [nodes, setNodes] = useState<CanvasNodeData[]>(project?.nodes || []), [connections, setConnections] = useState<CanvasConnection[]>(project?.connections || []);
    const [loadedId, setLoadedId] = useState(id), [dark, setDark] = useState(false), ref = useRef<HTMLDivElement>(null);
    const loaded = loadedId === id;
    const [selected,setSelected]=useState<Set<string>>(new Set()),[action,setAction]=useState<CollaborationPresence['action']>(null),[viewport,setViewport]=useState<ViewportTransform>({x:0,y:0,k:1}),[connection,setConnection]=useState<ConnectionHandle|null>(null);
    const drag=useRef<{id:string;x:number;y:number;left:number;top:number}|null>(null);
    const change=useCallback((nodeId:string,patch:Partial<CanvasNodeData>)=>setNodes(old=>old.map(node=>node.id===nodeId?{...node,...patch}:node)),[]);
    const resize=useCallback((nodeId:string,width:number,height:number,position?:{x:number;y:number})=>change(nodeId,{width,height,...position?{position}:{}}),[change]);
    const resizeEnd=useCallback(()=>setAction(null),[]);
    const metadata=(nodeId:string,patch:CanvasNodeData['metadata'])=>setNodes(old=>old.map(node=>node.id===nodeId?{...node,metadata:{...node.metadata,...patch}}:node));
    useEffect(()=>{const move=(event:MouseEvent)=>{const value=drag.current;if(value)change(value.id,{position:{x:value.left+(event.clientX-value.x)/viewport.k,y:value.top+(event.clientY-value.y)/viewport.k}});};const up=()=>{drag.current=null;setAction(null);setConnection(null);};window.addEventListener('mousemove',move);window.addEventListener('mouseup',up);return()=>{window.removeEventListener('mousemove',move);window.removeEventListener('mouseup',up);};},[viewport.k]);
    const previous = useRef(id);
    useEffect(() => { if (previous.current === id) return; previous.current = id; const source = useCanvasStore.getState().openProject(id)!; setNodes(source.nodes); setConnections(source.connections); setLoadedId(id); }, [id]);
    useCanvasCollaboration({ projectId: id, nodes, connections, title: project?.title || '测试画布', setNodes, setConnections, loaded });
    useEffect(() => { if (loaded) useCanvasStore.getState().updateProject(id, { nodes, connections }); }, [id, nodes, connections, loaded]);
    Object.assign(window, { collabTest: {
        host: () => useCollaborationStore.getState().host!(), join: (invite: string) => useCollaborationStore.getState().join!(invite), leave: () => useCollaborationStore.getState().leave!(),
        room: () => useCollaborationStore.getState(), state: () => ({ id, nodes, connections, title: project?.title }),
        interaction: () => action,
        modify: (nodeId: string, patch: Partial<CanvasNodeData>) => flushSync(() => setNodes(old => old.map(node => node.id === nodeId ? { ...node, ...patch } : node))),
        add: () => flushSync(() => setNodes(old => [...old, { ...seed, id: 'extra', title: '新增',position:{x:650,y:180} }])),
        connect: () => flushSync(() => setConnections([{ id: 'link', fromNodeId: 'text', toNodeId: 'extra' }])),
        undo: () => useCollaborationStore.getState().undo!(), redo: () => useCollaborationStore.getState().redo!(),
        originalProjects: () => useCanvasStore.getState().projects,
        open: (projectId: string) => navigate('/canvas/' + projectId),
        media: async () => {
            const canvas = new OffscreenCanvas(17, 13); canvas.getContext('2d')!.fillRect(0, 0, 17, 13);
            const blob = await canvas.convertToBlob({ type: 'image/png' });
            const url = await setImageBlob('image:shared', blob);
            await setMediaBlob('file:shared', new Blob(['original-file-bytes'], { type: 'application/octet-stream' }));
            flushSync(() => setNodes(old => [...old, { id: 'image', type: 'image', title: '原始图片', position: { x: 450, y: 180 }, width: 170, height: 130, metadata: { storageKey: 'image:shared', content: url, status: 'success', naturalWidth: 17, naturalHeight: 13, references: ['file:shared'] } }]));
        },
        bytes: async () => ({ image: Array.from(new Uint8Array(await (await getImageBlob('image:shared'))!.arrayBuffer())), file: await (await getMediaBlob('file:shared'))?.text() }),
        save: flushCanvasStorage,
        theme: (value: boolean) => { useThemeStore.getState().setTheme(value ? 'dark' : 'light'); setDark(value); },
        viewport:(value:ViewportTransform)=>flushSync(()=>setViewport(value)),
        selected:(ids:string[])=>flushSync(()=>setSelected(new Set(ids))),
        action:(value:CollaborationPresence['action'])=>flushSync(()=>setAction(value)),
    } });
    return <ConfigProvider theme={getAntThemeConfig(dark)}><App><div className="relative h-screen" style={{ background: dark ? '#181715' : '#f4f2ed' }}>
        <div className="absolute right-4 top-4 z-50"><CanvasCollaborationButton /></div>
        <InfiniteCanvas containerRef={ref} viewport={viewport} tool="select" onViewportChange={setViewport}>
            {nodes.map(node => <CanvasNode key={node.id} data={node} scale={viewport.k} isSelected={selected.has(node.id)} isRelated={false} isFocusRelated={false} isConnectionTarget={false} isConnecting={action==='connect'} showPanel={false} showImageInfo={false} onMouseDown={(event,nodeId)=>{event.stopPropagation();drag.current={id:nodeId,x:event.clientX,y:event.clientY,left:node.position.x,top:node.position.y};setAction('move');}} onSelectCapture={(_event,nodeId)=>setSelected(new Set([nodeId]))} onHoverStart={()=>{}} onHoverEnd={()=>{}} onConnectStart={(event,nodeId,handleType)=>{event.stopPropagation();setSelected(new Set([nodeId]));setAction('connect');setConnection({nodeId,handleType});}} onResizeStart={()=>setAction('resize')} onResize={resize} onResizeEnd={resizeEnd} onContentChange={(nodeId,content)=>metadata(nodeId,{content})} onTitleChange={(nodeId,title)=>change(nodeId,{title})} onContextMenu={()=>{}}/>)}
            <CanvasCollaborationPresence projectId={id} containerRef={ref} nodes={nodes} viewport={viewport} selectedNodeIds={selected} action={action} connection={connection}/>
        </InfiniteCanvas>
    </div></App></ConfigProvider>;
}
createRoot(document.getElementById('root')!).render(<BrowserRouter><Routes><Route path="/canvas/:id" element={<Fixture />} /></Routes></BrowserRouter>);
