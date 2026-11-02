import {useEffect,useRef,useState} from 'react';
import type {Store} from '../state/store';
import {hostRequest} from '../oneYes';
import {editSystem,parseDraft} from '../services/oneyes-ai';
import {Icon} from './primitives/Icon';

export function AgentConsole({store,open,onOpenChange}: {store:Store;open:boolean;onOpenChange:(v:boolean)=>void;[key:string]:unknown}) {
  const [models,setModels]=useState<{value:string;label:string}[]>([]),[model,setModel]=useState(''),[prompt,setPrompt]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[draft,setDraft]=useState<ReturnType<typeof parseDraft>>();
  const controller=useRef<AbortController>();
  const [,redraw]=useState(0);
  useEffect(()=>store.subscribe(()=>redraw(n=>n+1)),[store]);
  useEffect(()=>{
    if(!open)return;
    const abort=new AbortController();
    const check=()=>{void hostRequest('models',{},abort.signal).then(r=>{setModels(r.models||[]);setModel(current=>r.models?.some(m=>m.value===current)?current:r.defaultModel||r.models?.[0]?.value||'');}).catch(e=>{if(!abort.signal.aborted)setError(e.message);});};
    check();window.addEventListener('focus',check);
    return()=>{abort.abort();window.removeEventListener('focus',check);};
  },[open]);
  useEffect(()=>()=>controller.current?.abort(),[]);
  const generate=async()=>{
    if(busy||!prompt.trim()||!model)return;
    setBusy(true);setError('');setDraft(undefined);
    const abort=new AbortController();controller.current=abort;
    const doc=structuredClone(store.getState().doc);
    try {
      const context={...doc,assets:doc.assets.map(({id,name,kind,durationUs,width,height,hasAudio})=>({id,name,kind,durationUs,width,height,hasAudio}))};
      const result=await hostRequest('generate',{model,system:editSystem,prompt:JSON.stringify({instruction:prompt,document:context})},abort.signal);
      if(!result.text)throw Error('模型没有返回剪辑草稿，时间线保持原样');
      setDraft(parseDraft(result.text,doc));
    }catch(e){if(!abort.signal.aborted)setError((e as Error).message);}
    finally{if(controller.current===abort){controller.current=undefined;setBusy(false);}}
  };
  const apply=()=>{
    if(!draft)return;
    if(JSON.stringify(store.getState().doc)!==draft.base){setError('时间线已改变，请重新生成草稿；不会自动调用模型');return;}
    const result=store.dispatch(draft.command,{kind:'ai',name:'OneYes AI',peerId:'oneyes-ai',model});
    if(!result.ok){setError(result.error.message);return;}
    setDraft(undefined);
  };
  if(!open)return null;
  const stale=draft&&JSON.stringify(store.getState().doc)!==draft.base;
  return <aside className="oneyes-assistant" aria-label="AI 剪辑助手">
    <header><span><Icon name="sparkles" size={17}/>AI 剪辑助手</span><button className="icon-button" aria-label="关闭 AI 助手" onClick={()=>onOpenChange(false)}><Icon name="close"/></button></header>
    <div className="oneyes-assistant-body">
      <p>描述你想怎样剪，先看草稿，再应用到时间线。应用后可以继续手动精修或撤销。</p>
      <label>使用模型<select aria-label="剪辑模型" value={model} onChange={e=>setModel(e.target.value)} disabled={busy}>{models.length?models.map(m=><option key={m.value} value={m.value}>{m.label}</option>):<option value="">请保持原画布打开，并配置文本模型</option>}</select></label>
      <label>剪辑要求<textarea aria-label="剪辑要求" rows={5} value={prompt} disabled={busy} onChange={e=>setPrompt(e.target.value)} placeholder="例如：把素材依次排成片，开头加上标题，结尾淡出；原声保留并降低音量。"/></label>
      <small>发送时间线与素材名称到所选模型，按渠道计费。本次不上传原视频或音频；AI 不会自动识别素材内容。</small>
      <div className="oneyes-ai-actions">{busy?<><span role="status">正在拟定剪辑草稿…</span><button onClick={()=>{controller.current?.abort();setBusy(false);}}>取消</button></>:<button className="primary" onClick={()=>void generate()} disabled={!model||!prompt.trim()}>生成剪辑草稿</button>}</div>
      {error&&<p role="alert" className="oneyes-error">{error}</p>}
      {draft&&<section className="oneyes-draft"><h3>剪辑草稿</h3><p>{draft.summary}</p><p>{draft.command.type==='batch'?draft.command.commands.length:1} 项操作 · {draft.after.tracks.length} 条轨道 · {draft.after.tracks.reduce((n,t)=>n+t.clips.length,0)} 个片段</p><p>输出 {draft.after.width} × {draft.after.height}，原始素材保留。</p>{stale&&<p role="alert">时间线已修改，这份草稿已失效。</p>}<button className="primary" disabled={!!stale||draft.command.type==='batch'&&!draft.command.commands.length} onClick={apply}>应用到时间线</button><button onClick={()=>setDraft(undefined)}>放弃草稿</button></section>}
    </div>
  </aside>;
}
