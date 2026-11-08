import { useEffect, useLayoutEffect, useRef } from 'react';
import * as Y from 'yjs';
import { useNavigate } from 'react-router-dom';
import { flushCanvasStorage, useCanvasStore } from '@/stores/canvas/use-canvas-store';
import { useCollaborationStore, type CollaborationPresence } from '@/stores/canvas/use-collaboration-store';
import { base64ToBytes, bytesToBase64, canonicalCanvas, LOCAL_EDIT, REMOTE_EDIT, mergeSharedWithLocal, patchSharedCanvas, readSharedCanvas, sharedAssetKeys, trackSharedUndoAction, type SharedCanvas, type SharedAsset } from '@/lib/canvas/collaboration-document';
import { getImageBlob, setImageBlob, resolveImageUrl } from '@/services/image-storage';
import { getMediaBlob, setMediaBlob, resolveMediaUrl } from '@/services/file-storage';
import type { CanvasNodeData, CanvasConnection } from '@/types/canvas';

const empty = (): SharedCanvas => ({ title: '', nodes: [], connections: [] });
const native = () => window.oneYesDesktop?.collaboration;
const state = useCollaborationStore;
let session: { projectId: string; doc: Y.Doc; baseline: SharedCanvas; canonical:WeakMap<CanvasNodeData,CanvasNodeData>; undo: Y.UndoManager; origin: 'host' | 'guest'; ready: boolean; assets: Set<string>; jobs: Map<string, Promise<void>>; assetRun?: Promise<void>; assetDirty?: boolean; unsubscribe: () => void; apply?: () => void; flush?: () => void; serial: Promise<unknown>; abort: AbortController } | undefined;
let lifecycle = 0;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '协作同步失败，请检查局域网连接后重试';
const blobFor = (key: string) => key.startsWith('image:') ? getImageBlob(key) : getMediaBlob(key);
const assetUrl = (hash: string) => `oneyes-canvas://app/collaboration/assets/${hash}`;
async function hashBlob(blob: Blob, signal: AbortSignal) {
    const response = await fetch('oneyes-canvas://app/collaboration/hash', { method: 'POST', body: blob, signal });
    if (!response.ok) throw Error('素材读取失败，请重新尝试同步');
    return response.json() as Promise<{ hash: string; bytes: number }>;
}

async function syncAssets(active: NonNullable<typeof session>) {
    if (active !== session || state.getState().status !== 'online') return;
    const keys = sharedAssetKeys(readSharedCanvas(active.doc).nodes);
    for (const key of keys) {
        if (active.assets.has(key)) continue;
        if (active.jobs.has(key)) { await active.jobs.get(key); continue; }
        const job = (async () => {
            const map = active.doc.getMap<SharedAsset>('assets');
            const manifest = map.get(key);
            let blob = await blobFor(key);
            const local = blob ? await hashBlob(blob, active.abort.signal) : undefined;
            if (blob && (!manifest || local?.hash === manifest.hash)) {
                const result = await fetch(assetUrl('new'), { method: 'PUT', body: blob, headers: { 'content-type': blob.type || 'application/octet-stream' }, signal: active.abort.signal });
                if (!result.ok) throw Error('原始素材暂未同步，请保持设备连接后点击重试');
                const uploaded = await result.json() as { hash?: string; bytes?: number; mime?: string };
                if (!uploaded.hash || !/^[a-f0-9]{64}$/.test(uploaded.hash) || uploaded.bytes !== blob.size) throw Error('原始素材校验失败，请保持设备连接后重试');
                if (active !== session) return;
                if (!manifest || manifest.hash !== uploaded.hash) active.doc.transact(() => map.set(key, { hash: uploaded.hash!, mime: uploaded.mime || blob!.type, bytes: uploaded.bytes! }), 'asset');
            } else if (manifest) {
                if (!/^[a-f0-9]{64}$/.test(manifest.hash) || !Number.isSafeInteger(manifest.bytes) || manifest.bytes < 0) throw Error('协作素材清单无效');
                const response = await fetch(assetUrl(manifest.hash), { signal: active.abort.signal });
                if (!response.ok) throw Error('暂时无法取回协作原图，请让房主保持连接并重试同步');
                blob = new Blob([await response.blob()], { type: manifest.mime });
                if (blob.size !== manifest.bytes || (await hashBlob(blob, active.abort.signal)).hash !== manifest.hash) throw Error('协作素材完整性校验失败，原始素材已保留');
                if (active !== session) return;
                if (await blobFor(key)) throw Error('本机存在同名但内容不同的素材，已保留原件；请在来源设备重新导入该素材后共享');
                if (key.startsWith('image:')) await setImageBlob(key, blob); else await setMediaBlob(key, blob);
            } else return;
            if (active !== session) return;
            active.assets.add(key); active.flush?.(); active.apply?.();
        })();
        active.jobs.set(key, job);
        try { await job; } finally { active.jobs.delete(key); }
    }
}
function retryAssets() {
    const active = session; if (!active || state.getState().status !== 'online') return;
    if (active.assetRun) { active.assetDirty = true; return; }
    if (![...sharedAssetKeys(readSharedCanvas(active.doc).nodes)].some(key=>!active.assets.has(key))) return;
    state.setState({ error: undefined, syncing: true });
    active.assetRun = (async () => {
        do { active.assetDirty = false; await syncAssets(active); } while (active === session && active.assetDirty && state.getState().status === 'online');
    })().then(() => {
        if (active === session) state.setState({ syncing: [...sharedAssetKeys(readSharedCanvas(active.doc).nodes)].some(key => !active.assets.has(key)) && state.getState().status === 'online' });
    }).catch(error => { if (active === session && !active.abort.signal.aborted) state.setState({ syncing: false, error: errorMessage(error) }); }).finally(() => { active.assetRun = undefined; });
}
async function leave() {
    lifecycle++;
    const active = session;
    active?.flush?.(); active?.abort.abort(); active?.unsubscribe(); await flushCanvasStorage(); await active?.serial;
    if (active) { active.undo.destroy(); active.doc.destroy(); }
    session = undefined;
    await native()?.call('leave');
    state.setState({ status: 'offline', role: undefined, roomId: undefined, invite: undefined, invitations: undefined, projectId: undefined, members: 0, error: undefined, syncing: false, canUndo: false, canRedo: false,peers:[],publishPresence:undefined });
}
async function start(role: 'host' | 'guest', projectId: string, initial: SharedCanvas, invite?: string, restored?: string) {
    const doc = new Y.Doc();
    try { if (restored) Y.applyUpdate(doc, base64ToBytes(restored), REMOTE_EDIT); }
    catch { doc.destroy(); throw Error('协作恢复数据无效，原画布与恢复记录已保留'); }
    await leave();
    if (role === 'host') patchSharedCanvas(doc, canonicalCanvas(initial), empty());
    const undo = new Y.UndoManager([doc.getMap('nodes'), doc.getMap('connections'), doc.getMap('meta')], { trackedOrigins: new Set([LOCAL_EDIT]) });
    const undoAction = trackSharedUndoAction(undo);
    const active: NonNullable<typeof session> = { projectId, doc, undo, baseline: role === 'host' ? canonicalCanvas(initial) : restored ? readSharedCanvas(doc) : empty(),canonical:new WeakMap(), origin: role, ready: role === 'host' || Boolean(restored), assets: new Set(), jobs: new Map(), unsubscribe: () => {}, serial: Promise.resolve(), abort: new AbortController() };
    session = active;
    state.setState({ projectId, error: undefined, status: role === 'host' ? 'online' : 'reconnecting', role });
    let updates:Uint8Array[]=[];
    const transmit = (update: Uint8Array, origin: unknown) => {
        if (origin === REMOTE_EDIT) return;
        updates.push(update);
        active.serial = active.serial.then(async () => {
            if(updates.length&&active===session){const batch=updates;updates=[];await native()?.call('update',{data:bytesToBase64(Y.mergeUpdates(batch))});}
        }).catch(error => { if (active === session) state.setState({ error: errorMessage(error) }); });
    };
    const refreshUndo = () => state.setState({ canUndo: undo.canUndo(), canRedo: undo.canRedo() });
    undo.on('stack-item-added', refreshUndo); undo.on('stack-item-popped', refreshUndo); undo.on('stack-cleared', refreshUndo);
    const unsubscribe = native()!.subscribe(event => {
        if (session !== active) return;
        if (event.kind === 'state') {
            const reconnected = event.status === 'online' && state.getState().status === 'reconnecting';
            state.setState({ status: event.status, role: event.role, roomId: event.roomId, invite: event.invite, invitations: event.invitations, members: event.members, ...(event.status === 'online' ? { error: undefined } : { syncing: false }) });
            if (event.status === 'online') {
                if (reconnected && active.origin === 'guest') { active.assets.clear(); if (active.assetRun) void active.assetRun.then(retryAssets); }
                retryAssets();
            }
        } else if (event.kind === 'error') { state.setState({ error: event.message });
        } else if (event.kind === 'presence') { state.setState({peers:event.peers || []}); }
        else if (event.kind === 'update' && event.data) {
            try { active.flush?.(); Y.applyUpdate(doc, base64ToBytes(event.data), REMOTE_EDIT); active.ready = true; active.apply?.(); retryAssets(); }
            catch (error) { state.setState({ error: errorMessage(error) }); }
        } else if (event.kind === 'ended') {
            active.flush?.(); state.setState({ status: 'offline', error: '房主已结束协作，本地副本已保留。需要继续时请重新创建房间。' });
            void leave().then(() => state.setState({ error: '房主已结束协作，本地副本已保留。' }));
        }
    });
    let presence:CollaborationPresence={cursor:null,selected:[],action:null},presenceFrame:number|undefined;
    const publishPresence=(patch:Partial<CollaborationPresence>)=>{
        if(active!==session)return;
        if(patch.action!==undefined)undoAction(patch.action);
        presence={...presence,...patch};
        const send=()=>{presenceFrame=undefined;if(active===session&&state.getState().status==='online')void native()?.call('presence',{presence}).catch(error=>{if(active===session)state.setState({error:errorMessage(error)});});};
        if(patch.cursor===null){if(presenceFrame!==undefined)cancelAnimationFrame(presenceFrame);send();}
        else if(presenceFrame===undefined)presenceFrame=requestAnimationFrame(send);
    };
    active.unsubscribe = () => { unsubscribe(); doc.off('update', transmit);if(presenceFrame!==undefined)cancelAnimationFrame(presenceFrame); };
    try {
        const result = await native()!.call(role === 'host' ? 'host' : 'join', { projectId, ...(invite ? { invite } : {}), ...(restored ? { data: restored } : {}) });
        state.setState(result);
        doc.on('update', transmit);
        if (role === 'host' || restored) { await native()!.call('update', { data: bytesToBase64(Y.encodeStateAsUpdate(doc)) }); undo.clear(); retryAssets(); }
    } catch (error) { await leave(); throw error; }
    state.setState({ leave, retry: retryAssets,publishPresence, undo: () => { active.flush?.(); undo.stopCapturing(); undo.undo(); active.apply?.(); }, redo: () => { active.flush?.(); undo.stopCapturing(); undo.redo(); active.apply?.(); } });
}

export function useCanvasCollaboration({ projectId, nodes, connections, title, setNodes, setConnections, loaded }: {
    projectId: string; nodes: CanvasNodeData[]; connections: CanvasConnection[]; title: string; loaded: boolean;
    setNodes: React.Dispatch<React.SetStateAction<CanvasNodeData[]>>; setConnections: React.Dispatch<React.SetStateAction<CanvasConnection[]>>;
}) {
    const navigate = useNavigate(), latest = useRef({ nodes, connections, title });
    // Layout cleanup flushes the previous project's snapshot before this commit replaces it.
    useLayoutEffect(() => { latest.current = { nodes, connections, title }; });
    const roomProject = state(value => value.projectId), activeStatus = state(value => value.status);
    useLayoutEffect(() => {
        const active = session;
        if (!loaded || !active || active.projectId !== projectId || !active.ready || !active.apply) return;
        const next = canonicalCanvas(latest.current,active.canonical);
        patchSharedCanvas(active.doc, next, active.baseline); active.baseline = next;
        retryAssets();
    }, [connections, loaded, nodes, projectId, title, roomProject]);
    useLayoutEffect(() => {
        const active = session;
        if (!loaded || !active || active.projectId !== projectId) return;
        const apply = () => {
            const shared = readSharedCanvas(active.doc);
            let merged = mergeSharedWithLocal(shared.nodes, latest.current.nodes);
            // Object URLs are resolved separately and never put into the shared document.
            const links=JSON.stringify(shared.connections)===JSON.stringify(latest.current.connections)?latest.current.connections:shared.connections;
            setNodes(merged); setConnections(links);
            if(shared.title!==latest.current.title)useCanvasStore.getState().renameProject(projectId, shared.title);
            active.baseline = canonicalCanvas(shared);
            latest.current = { nodes: merged, connections: links, title: shared.title };
            void (async () => {
                const source = merged;
                merged = await Promise.all(source.map(async node => {
                    if (!node.metadata || !(node.metadata.storageKey&&!node.metadata.content?.startsWith('blob:'))&&!node.metadata.images?.some(image=>image.storageKey&&!image.content?.startsWith('blob:'))) return node;
                    const metadata = { ...node.metadata };
                    if (metadata.storageKey) metadata.content = metadata.storageKey.startsWith('image:') ? await resolveImageUrl(metadata.storageKey, metadata.content) : await resolveMediaUrl(metadata.storageKey, metadata.content);
                    if (metadata.images) metadata.images = await Promise.all(metadata.images.map(async image => ({ ...image, content: await resolveImageUrl(image.storageKey, image.content) })));
                    return JSON.stringify(metadata)===JSON.stringify(node.metadata)?node:{ ...node, metadata };
                }));
                if (active !== session || latest.current.nodes !== source || merged.every((node,index)=>node===source[index])) return;
                latest.current.nodes = merged; setNodes(merged);
                useCanvasStore.getState().updateProject(projectId, { nodes: merged, connections: latest.current.connections });
            })().catch(error => state.setState({ error: errorMessage(error) }));
        };
        active.flush = () => {
            if (!active.ready) return;
            const next = canonicalCanvas(latest.current,active.canonical); patchSharedCanvas(active.doc, next, active.baseline); active.baseline = next;
            useCanvasStore.getState().updateProject(projectId, { nodes: latest.current.nodes, connections: latest.current.connections });
        };
        active.apply = apply;
        if (active.ready) apply();
        return () => { active.flush?.(); active.flush = undefined; active.apply = undefined; };
    }, [loaded, projectId, roomProject, setConnections, setNodes]);
    useEffect(() => {
        state.setState({
            host: async () => { if (!loaded) throw Error('画布尚未加载'); await start('host', projectId, latest.current); },
            join: async invite => {
                const copy = useCanvasStore.getState().importProject({ title: '协作画布', nodes: [], connections: [] });
                try { await start('guest', copy, empty(), invite); navigate(`/canvas/${copy}`); }
                catch (error) { useCanvasStore.getState().deleteProjects([copy]); throw error; }
            },
        });
    }, [loaded, navigate, projectId]);
    useEffect(() => {
        if (!loaded || !native() || session) return;
        let cancelled = false; const current = lifecycle;
        void native()!.call('saved', { projectId }).then(async saved => {
            if (!cancelled && !session && lifecycle === current && saved.invite && saved.data) await start('guest', projectId, latest.current, saved.invite, saved.data);
        }).catch(error => { if (!cancelled) state.setState({ error: errorMessage(error) }); });
        return () => { cancelled = true; };
    }, [loaded, projectId]);
    useEffect(() => {
        if (roomProject && roomProject !== projectId) void leave().catch(error => state.setState({ error: errorMessage(error) }));
    }, [projectId]);
    useEffect(() => {
        const reconnect = () => { if (session?.projectId === projectId && state.getState().role === 'guest') void native()?.call('reconnect').catch(error => state.setState({ error: errorMessage(error) })); };
        const online = () => { reconnect(); retryAssets(); };
        window.addEventListener('online', online); window.addEventListener('offline', reconnect);
        return () => { window.removeEventListener('online', online); window.removeEventListener('offline', reconnect); };
    }, [projectId]);
    useEffect(() => () => {
        const previous = projectId;
        queueMicrotask(() => { if (session?.projectId === previous && location.pathname !== `/canvas/${previous}`) void leave().catch(error => state.setState({ error: errorMessage(error) })); });
    }, [projectId]);
    return { active: roomProject === projectId && activeStatus !== 'offline' };
}
