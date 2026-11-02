import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Container } from './di/container';
import { TOKENS } from './di/tokens';
import { TsEngineAdapter } from '@velocut/runtime/engine';
import { Store } from './state/store';
import { HistoryTree } from './state/history';
import { loadMedia, kvGet, kvPut } from '@velocut/collab-sdk';
import { MediaLibrary, RendererClient, Playback, AudioEngine, WhisperTranscriber, Observer, ConfigurableTts } from '@velocut/render-sdk';
import { FontLibrary } from './services/fonts';
import { storageKeys, bindCanvasProject } from './services/projects';
import { initializeLink, importCanvasSources, watchInputs } from './oneYes';
import { syncMotionAsset } from './services/motion';
import { syncSceneAsset, bindSceneAuthoring } from './services/scene';
import './styles.css';
import './oneyes.css';

async function bootstrap() {
  const report=(stage:string,error:unknown)=>{void window.oneYesEditor?.report(stage,{name:error instanceof Error?error.name:'Error',message:error instanceof Error?error.message:String(error),stack:error instanceof Error?error.stack:''});};
  window.addEventListener('error',event=>report('renderer',event.error));
  window.addEventListener('unhandledrejection',event=>report('renderer',event.reason));
  const link = await initializeLink();
  bindCanvasProject(`canvas-${link.key}`, link.title);
  const storage = storageKeys(`canvas-${link.key}`), media = new MediaLibrary(storage.mediaScope);
  // An initial project follows the original source size. Reopening always uses the saved document.
  let width = 1920, height = 1080;
  const first = link.inputs.find(i => i.kind !== 'audio');
  const raw = await kvGet(storage.history + ':oneyes-v1');
  if(first && !raw) {
    const file = new File([first.blob],first.name,{type:first.blob.type});
    if(first.kind === 'image') {const frame=await media.probeImage(file);width=frame.displayWidth;height=frame.displayHeight;frame.close();}
    else {const probe=await media.probeVideo(file);const p=probe.probe();width=p.width;height=p.height;media.releaseVideoProbe(probe);}
  }
  const restoredHistory = raw ? HistoryTree.deserialize(JSON.parse(new TextDecoder().decode(raw))) : undefined;
  let writes = Promise.resolve();
  const persist = (tree: HistoryTree) => {const data=new TextEncoder().encode(JSON.stringify(tree.serializeCompact()));writes=writes.catch(()=>{}).then(()=>kvPut(storage.history+':oneyes-v1',data));void writes.catch(error=>{report('save',error);window.dispatchEvent(new CustomEvent('oneyes-editor-error',{detail:'剪辑项目未能保存，请检查磁盘空间后重试；暂时不要退出软件。'}));});};
  const engine = new TsEngineAdapter(link.title,width,height,30,1);
  const store = new Store(engine,{localUser:{kind:'user',peerId:'canvas',name:'我'},restoredHistory,onHistory:persist});
  // The history head is the single durable document. Do not overwrite a newer
  // head with a separately debounced collaboration snapshot on restart.
  const renderer = new RendererClient(), audio = new AudioEngine(media), playback = new Playback(store,media,renderer,audio);
  const fonts = new FontLibrary(renderer); await fonts.restore();
  const missing:string[]=[];
  const restoreMedia = async () => {
    for(const asset of store.getState().doc.assets) {
      if(asset.src.startsWith('motion://')) {await syncMotionAsset(store,media,asset);continue;}
      if(asset.src.startsWith('scene://')) {await syncSceneAsset(store,media,asset);continue;}
      if(media.hasAsset(asset.id))continue;
      const file=await loadMedia(asset.src,storage.mediaDir);if(!file){missing.push(asset.name);continue;}
      if(asset.kind==='video')media.attachVideo(asset.id,await media.probeVideo(file),file);
      else if(asset.kind==='audio')await media.attachAudio(asset.id,(await media.probeAudio(file)).buffer);
      else media.attachImage(asset.id,await media.probeImage(file));
    }
  };
  await restoreMedia();
  const flush = async () => {persist(store.getHistory());await writes;};
  window.oneYesEditorFlush = flush;
  bindSceneAuthoring(store,media);
  await importCanvasSources(store,media,flush);await flush();watchInputs(store,media,flush);
  const container = new Container().registerValue(TOKENS.Engine,engine).registerValue(TOKENS.Store,store).registerValue(TOKENS.Media,media)
    .registerValue(TOKENS.Renderer,renderer).registerValue(TOKENS.Audio,audio).registerValue(TOKENS.Playback,playback).registerValue(TOKENS.Fonts,fonts)
    .registerValue(TOKENS.Observer,new Observer(media)).registerValue(TOKENS.Transcriber,new WhisperTranscriber()).registerValue(TOKENS.Tts,new ConfigurableTts(()=>({})));
  window.oneYesEditing={store,media,flush};
  createRoot(document.getElementById('root')!).render(<App container={container}/>);
  document.body.dataset.editorReady='true';
  if(missing.length)requestAnimationFrame(()=>window.dispatchEvent(new CustomEvent('oneyes-editor-error',{detail:`原始素材缺失：${missing.join('、')}。时间线已保留，请重新导入原文件并替换对应片段；缺失素材不能导出。`})));
}
bootstrap().catch(error=>{
  const root=document.getElementById('root')!;root.replaceChildren();const box=document.createElement('div');box.className='startup-error';
  const title=document.createElement('h2');title.textContent='剪辑器暂时无法打开';const text=document.createElement('p');text.textContent=error.message;
  const retry=document.createElement('button');retry.textContent='重新打开';retry.onclick=()=>location.reload();
  box.append(title,text,retry);root.append(box);
  void window.oneYesEditor?.report('startup',{name:error.name,message:error.message,stack:error.stack});
});
