import React, { useEffect, useRef, useState } from 'react';
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
import { useThemeStore } from '@/stores/use-theme-store';
import { getAntThemeConfig } from '@/lib/app-theme';
import { setImageBlob, getImageBlob } from '@/services/image-storage';
import { setMediaBlob, getMediaBlob } from '@/services/file-storage';
import type { CanvasNodeData, CanvasConnection } from '@/types/canvas';
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
    const previous = useRef(id);
    useEffect(() => { if (previous.current === id) return; previous.current = id; const source = useCanvasStore.getState().openProject(id)!; setNodes(source.nodes); setConnections(source.connections); setLoadedId(id); }, [id]);
    useCanvasCollaboration({ projectId: id, nodes, connections, title: project?.title || '测试画布', setNodes, setConnections, loaded });
    useEffect(() => { if (loaded) useCanvasStore.getState().updateProject(id, { nodes, connections }); }, [id, nodes, connections, loaded]);
    Object.assign(window, { collabTest: {
        host: () => useCollaborationStore.getState().host!(), join: (invite: string) => useCollaborationStore.getState().join!(invite), leave: () => useCollaborationStore.getState().leave!(),
        room: () => useCollaborationStore.getState(), state: () => ({ id, nodes, connections, title: project?.title }),
        modify: (nodeId: string, patch: Partial<CanvasNodeData>) => flushSync(() => setNodes(old => old.map(node => node.id === nodeId ? { ...node, ...patch } : node))),
        add: () => flushSync(() => setNodes(old => [...old, { ...seed, id: 'extra', title: '新增' }])),
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
    } });
    return <ConfigProvider theme={getAntThemeConfig(dark)}><App><div className="relative h-screen" style={{ background: dark ? '#181715' : '#f4f2ed' }}>
        <div className="absolute right-4 top-4 z-50"><CanvasCollaborationButton /></div>
        <InfiniteCanvas containerRef={ref} viewport={{ x: 0, y: 0, k: 1 }} tool="select" onViewportChange={() => {}}>
            {nodes.map(node => <section key={node.id} style={{ position: 'absolute', left: node.position.x, top: node.position.y, width: node.width, color: dark ? '#f5f5f4' : '#292524' }}><h3>{node.title}</h3>{node.type === 'image' ? <img alt="协作原图" src={node.metadata?.content} /> : <p>{node.metadata?.content}</p>}</section>)}
        </InfiniteCanvas>
    </div></App></ConfigProvider>;
}
createRoot(document.getElementById('root')!).render(<BrowserRouter><Routes><Route path="/canvas/:id" element={<Fixture />} /></Routes></BrowserRouter>);
