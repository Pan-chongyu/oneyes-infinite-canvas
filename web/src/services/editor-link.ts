import localforage from 'localforage';

export type EditorInput = { id: string; name: string; kind: 'video' | 'image' | 'audio'; blob: Blob };
export type EditorOutput = { id: string; blob: Blob; name: string; width: number; height: number; durationUs: number };
export type EditorLink = { version: 1; key: string; session: string; canvasId: string; nodeId: string; title: string; theme: 'light' | 'dark'; inputs: EditorInput[]; output?: EditorOutput; sourceSignature: string };
export type EditorRequest = { key: string; session: string; id: string; operation: 'models' | 'generate' | 'cancel' | 'output'; prompt?: string; system?: string; model?: string };
export const editorLinks = localforage.createInstance({ name: 'oneyes-editor', storeName: 'links' });
export const editorChannel = 'oneyes-editor-link-v1';
export async function editorKey(canvasId: string, nodeId: string) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([canvasId, nodeId])));
    return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join('');
}
export function readEditorLink(key: string) { return editorLinks.getItem<EditorLink>(key); }
export function writeEditorLink(key: string, update: (current: EditorLink | null) => EditorLink) {
    return navigator.locks.request('oneyes-editor-link:' + key, async () => editorLinks.setItem(key, update(await readEditorLink(key))));
}
