import * as Y from 'yjs';
import type { CanvasConnection, CanvasNodeData } from '@/types/canvas';

export const LOCAL_EDIT = Symbol('local-canvas-edit');
export const REMOTE_EDIT = Symbol('remote-canvas-edit');
export type SharedCanvas = { title: string; nodes: CanvasNodeData[]; connections: CanvasConnection[] };
export type SharedAsset = { hash: string; mime: string; bytes: number };
const privateFields = /api.?key|access.?token|refresh.?token|secret|password|authorization|cookie|^(?:headers|auth|token|__proto__|constructor|prototype)$/i;
const localFields = new Set(['imageTaskId', 'videoTaskId', 'videoTaskProvider', 'status', 'loadingMessage', 'errorDetails', 'taskId', 'editorOutputId', 'model', 'assistantModel', 'imageModel', 'videoModel', 'audioModel']);
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function sanitizeSharedValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sanitizeSharedValue);
    if (!plain(value)) return value;
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
        if (privateFields.test(key) || localFields.has(key) || key === 'dataUrl' || child === undefined || (key === 'url' && typeof child === 'string' && /^(blob:|file:\/\/|oneyes-canvas:)/i.test(child)) || (value.storageKey && ['content', 'url'].includes(key))) continue;
        result[key] = sanitizeSharedValue(child);
    }
    return result;
}
export function canonicalCanvas(canvas: SharedCanvas): SharedCanvas {
    const nodes = canvas.nodes.map(node => {
        const value = sanitizeSharedValue(node) as CanvasNodeData;
        const metadata = { ...(value.metadata || {}) };
        if (['image', 'video', 'audio'].includes(String(node.type)) && !metadata.storageKey && /^(?:data:|blob:|file:|https?:)/i.test(String(node.metadata?.content || ''))) delete metadata.content;
        if (Array.isArray(metadata.references)) metadata.references = metadata.references.filter(item => typeof item === 'string' && /^(image|video|audio|file|video-reference|audio-reference):.+/.test(item));
        return { ...value, metadata };
    });
    return { ...canvas, nodes };
}

// Compare with the last rendered state, never with newer remote fields: only actual local changes become CRDT operations.
function patchRecord(target: Y.Map<unknown>, next: Record<string, unknown>, previous: Record<string, unknown>) {
    for (const key of Object.keys(previous)) if (!(key in next)) target.delete(key);
    for (const [key, value] of Object.entries(next)) {
        if (equal(value, previous[key])) continue;
        if (plain(value)) {
            let child = target.get(key);
            if (!(child instanceof Y.Map)) { child = new Y.Map(); target.set(key, child); }
            patchRecord(child as Y.Map<unknown>, value, plain(previous[key]) ? previous[key] : {});
        } else target.set(key, value);
    }
}
export function patchSharedCanvas(doc: Y.Doc, next: SharedCanvas, previous: SharedCanvas) {
    doc.transact(() => {
        for (const name of ['nodes', 'connections'] as const) {
            const map = doc.getMap<Y.Map<unknown>>(name), before = new Map<string, CanvasNodeData | CanvasConnection>(previous[name].map(value => [value.id, value]));
            const after = new Map<string, CanvasNodeData | CanvasConnection>(next[name].map(value => [value.id, value]));
            for (const id of before.keys()) if (!after.has(id)) map.delete(id);
            for (const [id, value] of after) {
                const old = before.get(id);
                if (equal(value, old)) continue;
                let record = map.get(id);
                if (!record) {
                    if (old) continue; // A concurrent deletion wins over an edit of that deleted node.
                    record = new Y.Map(); map.set(id, record);
                }
                patchRecord(record, value as unknown as Record<string, unknown>, (old || {}) as Record<string, unknown>);
            }
        }
        if (next.title !== previous.title) doc.getMap('meta').set('title', next.title);
    }, LOCAL_EDIT);
}
export function readSharedCanvas(doc: Y.Doc): SharedCanvas {
    const nodes = Object.values(doc.getMap('nodes').toJSON()) as CanvasNodeData[];
    const connections = Object.values(doc.getMap('connections').toJSON()) as CanvasConnection[];
    const ids = new Set<string>();
    for (const node of nodes) {
        if (!node || typeof node.id !== 'string' || ids.has(node.id) || typeof node.type !== 'string' || typeof node.title !== 'string' || !Number.isFinite(node.position?.x) || !Number.isFinite(node.position?.y) || !Number.isFinite(node.width) || node.width <= 0 || !Number.isFinite(node.height) || node.height <= 0) throw Error('协作画布结构无效，当前本地副本已保留');
        ids.add(node.id);
    }
    return canonicalCanvas({ nodes, connections: connections.filter(value => value && typeof value.id === 'string' && ids.has(value.fromNodeId) && ids.has(value.toNodeId)), title: String(doc.getMap('meta').get('title') || '协作画布') });
}
export function sharedAssetKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== 'object') return keys;
    if ('storageKey' in value && typeof value.storageKey === 'string' && /^(image|video|audio|file|video-reference|audio-reference):.+/.test(value.storageKey)) keys.add(value.storageKey);
    if ('references' in value && Array.isArray(value.references)) for (const key of value.references) if (typeof key === 'string' && /^(image|video|audio|file|video-reference|audio-reference):.+/.test(key)) keys.add(key);
    Object.values(value).forEach(child => sharedAssetKeys(child, keys));
    return keys;
}
export function bytesToBase64(bytes: Uint8Array) {
    let result = ''; for (let index = 0; index < bytes.length; index += 0x8000) result += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return btoa(result);
}
export function base64ToBytes(value: string) { return Uint8Array.from(atob(value), char => char.charCodeAt(0)); }

export function mergeSharedWithLocal(shared: CanvasNodeData[], local: CanvasNodeData[]): CanvasNodeData[] {
    const existing = new Map(local.map(node => [node.id, node]));
    const restore = (value: unknown, previous: unknown): unknown => {
        if (Array.isArray(value)) return value.map((item, index) => restore(item, Array.isArray(previous) ? item?.id ? previous.find(old => old?.id === item.id) : previous[index] : undefined));
        if (!plain(value)) return value;
        const old = plain(previous) ? previous : {}, result: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(value)) result[key] = restore(child, old[key]);
        if (typeof value.storageKey === 'string' && value.storageKey === old.storageKey) for (const key of ['content', 'url', 'dataUrl']) if (old[key] !== undefined) result[key] = old[key];
        for (const key of localFields) if (old[key] !== undefined) result[key] = old[key];
        if ((value.storageKey || typeof value.content === 'string' && value.content) && !result.status) result.status = 'success';
        return result;
    };
    return shared.map(node => restore(node, existing.get(node.id)) as CanvasNodeData);
}
