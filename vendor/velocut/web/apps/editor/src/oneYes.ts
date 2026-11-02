import { writeEditorLink, readEditorLink, editorChannel, type EditorLink } from '../../../../../../web/src/services/editor-link';
import { importMediaFiles } from './services/import';
import { kvGet, kvPut } from '@velocut/collab-sdk';
import type { Store } from './state/store';
import type { MediaLibrary } from '@velocut/render-sdk';
import type { VDocument } from '@velocut/protocol';

declare global {
  interface Window {
    oneYesEditor?: { platform: string; close(): Promise<void>; report(stage:string,error:object):Promise<void> };
    oneYesEditorFlush?: () => Promise<void>;
    oneYesEditing?: { store: Store; media: MediaLibrary; flush(): Promise<void> };
  }
}
const key = new URLSearchParams(location.search).get('project') || '';
let link: EditorLink;
const channel = new BroadcastChannel(editorChannel);
let hostOffline = false;
const hostClosed = () => { hostOffline = true; window.dispatchEvent(new Event('oneyes-host-disconnected')); };
window.addEventListener('oneyes-host-offline', hostClosed);
channel.addEventListener('message', e => {
  if (e.data?.key !== key) return;
  if (e.data.operation === 'host-offline') hostClosed();
  else if (e.data.operation === 'inputs' && e.data.session === link?.session) hostOffline = false;
});
export async function initializeLink() {
  const saved = await readEditorLink(key);
  if (!saved || saved.version !== 1 || saved.key !== key) throw Error('找不到剪辑项目，请从画布节点重新打开');
  link = saved;
  document.documentElement.dataset.theme = link.theme;
  document.documentElement.dataset.platform = window.oneYesEditor?.platform || '';
  document.title = `${link.title} · OneYes 剪辑`;
  return link;
}
export function canvasTitle() { return link?.title || '智能剪辑'; }
export const closeEditor = () => window.oneYesEditor?.close();
export const editorContext = () => ({key,session:link.session});

export async function importCanvasSources(store: Store, media: MediaLibrary, flush: () => Promise<void>) {
  const current = await readEditorLink(key);
  if (!current || current.session !== link.session) throw Error('画布连接已改变，请重新打开剪辑器');
  const importedKey = `oneyes-inputs:${key}`;
  const raw = await kvGet(importedKey), imported: Record<string,string> = raw ? JSON.parse(new TextDecoder().decode(raw)) : {};
  for (const input of current.inputs) {
    const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await input.blob.arrayBuffer()))].map(n => n.toString(16).padStart(2,'0')).join('');
    const identity = `${input.id}:${sha}`;
    if (imported[identity] && store.getState().doc.assets.some(a => a.id === imported[identity])) continue;
    const fallback = input.kind === 'image' ? 'image/png' : input.kind === 'audio' ? 'audio/mpeg' : 'video/mp4';
    const assets = await importMediaFiles(store, media, [new File([input.blob], input.name, {type: input.blob.type || fallback})]);
    if (!assets.length) throw Error(`无法导入「${input.name}」，请检查原始素材格式；其他已导入素材已保留`);
    imported[identity] = assets[0].assetId;
    await flush();
    await kvPut(importedKey, new TextEncoder().encode(JSON.stringify(imported)));
  }
}
export async function sendOutput(blob: Blob, doc: VDocument, durationUs: number) {
  await window.oneYesEditorFlush?.();
  await writeEditorLink(key,current=>{
    if (!current || current.session !== link.session) throw Error('画布连接已改变，成片未回填，请保存文件后重开节点');
    return {...current,output:{id:crypto.randomUUID(),blob,name:`${doc.name || 'OneYes 剪辑'}.mp4`,width:doc.width,height:doc.height,durationUs}};
  });
  channel.postMessage({key, session: link.session, operation: 'output'});
}
type Reply = { id: string; operation: string; error?: string; text?: string; models?: {value:string;label:string}[]; defaultModel?: string };
export function hostRequest(operation: 'models' | 'generate', data: { prompt?: string; system?: string; model?: string } = {}, signal?: AbortSignal): Promise<Reply> {
  const offlineError = () => Error('原画布已关闭或切换，请返回原节点重新打开；手动剪辑仍可使用');
  if (hostOffline) return Promise.reject(offlineError());
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const clean = () => {channel.removeEventListener('message', listener); signal?.removeEventListener('abort', abort); window.removeEventListener('oneyes-host-disconnected', disconnected);};
    const disconnected = () => { clean(); reject(offlineError()); };
    const abort = () => {clean(); channel.postMessage({key,session:link.session,id,operation:'cancel'}); reject(new DOMException('已取消','AbortError'));};
    const listener = (e: MessageEvent) => {const r=e.data;if(r.key!==key || r.session !== link.session || r.id !== id || r.operation !== 'response')return;clean();r.error ? reject(Error(r.error)) : resolve(r);};
    channel.addEventListener('message',listener);
    window.addEventListener('oneyes-host-disconnected', disconnected);
    signal?.addEventListener('abort',abort,{once:true});
    if (signal?.aborted) {abort();return;}
    channel.postMessage({key,session:link.session,id,operation,...data});
  });
}
export function watchInputs(store: Store, media: MediaLibrary, flush: () => Promise<void>) {
  let pending = Promise.resolve();
  channel.addEventListener('message', e => {
    if(e.data?.key !== key || e.data.session !== link.session || e.data.operation !== 'inputs')return;
    pending = pending.then(()=>importCanvasSources(store,media,flush)).then(flush).catch(error=>{window.dispatchEvent(new CustomEvent('oneyes-editor-error',{detail:error.message}));});
  });
}
