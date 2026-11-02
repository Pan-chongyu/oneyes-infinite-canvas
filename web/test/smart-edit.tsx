import {useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {App,ConfigProvider} from 'antd';
import localforage from 'localforage';
import '@/i18n';
import '@/styles/globals.css';
import {smartEditPlugin} from '@/components/canvas/smart-edit-plugin';
import {registerBuiltinNodes} from '@/components/canvas/nodes/builtin-nodes';
import {registerNodeDefinitions} from '@/lib/canvas/node-registry';
import {buildNodeContext} from '@/lib/canvas/plugin-node-context';
import {applyCanvasAgentOps} from '@/lib/canvas/canvas-agent-ops';
import {uploadMediaFile} from '@/services/file-storage';
import {videoMetadata} from '@/lib/canvas/canvas-node-factory';
import {canvasThemes} from '@/lib/canvas-theme';
import {editorKey,readEditorLink} from '@/services/editor-link';
import type {CanvasNodeData,CanvasConnection} from '@/types/canvas';
import type {CanvasPluginHost} from '@/types/canvas-plugin';
registerBuiltinNodes();registerNodeDefinitions(smartEditPlugin.nodes,smartEditPlugin.id);
const seeds=await localforage.getItem<CanvasNodeData[]>('editor-seeds')||await Promise.all(['red','blue'].map(async(color,i)=>{
 const blob=await(await fetch('/fixture-media/'+color)).blob();const file=await uploadMediaFile(blob,'video');
 return {id:'v'+i,type:'video',title:'同名素材.mp4',position:{x:0,y:0},width:300,height:200,metadata:videoMetadata(file)} as CanvasNodeData;
}));
await localforage.setItem('editor-seeds',seeds);
const saved=await localforage.getItem<{nodes:CanvasNodeData[];connections:CanvasConnection[]}>('editor-state');
let calls=0,modelUsed='',responseMode='valid';let flush=Promise.resolve();
function Fixture(){
 const [state,setState]=useState(saved||{nodes:[...seeds,{id:'tool',type:'smart-edit:editor',title:'测试剪辑',position:{x:0,y:0},width:320,height:170} as CanvasNodeData],connections:[{id:'l0',fromNodeId:'v0',toNodeId:'tool'},{id:'l1',fromNodeId:'v1',toNodeId:'tool'}]});
 const ref=useRef(state);ref.current=state;
 const change=(fn:(s:typeof state)=>typeof state)=>{const next=fn(ref.current);ref.current=next;setState(next);flush=flush.then(()=>localforage.setItem('editor-state',next)).then(()=>{});};
 const host:CanvasPluginHost={projectId:'fixture',getNode:id=>ref.current.nodes.find(n=>n.id===id)||null,getNodes:()=>ref.current.nodes,getConnections:()=>ref.current.connections,
  getUpstream:id=>ref.current.connections.filter(l=>l.toNodeId===id).map(l=>ref.current.nodes.find(n=>n.id===l.fromNodeId)!),getDownstream:()=>[],
  updateNode:(id,patch)=>change(s=>({...s,nodes:s.nodes.map(n=>n.id===id?{...n,...patch}:n)})),
  updateMetadata:(id,patch)=>change(s=>({...s,nodes:s.nodes.map(n=>n.id===id?{...n,metadata:{...n.metadata,...patch}}:n)})),
  applyOps:ops=>change(s=>applyCanvasAgentOps({...s,projectId:'fixture',title:'fixture',selectedNodeIds:[],viewport:{x:0,y:0,k:1}},ops)),openPanel:()=>{},closePanel:()=>{},
  ai:{listModels:()=>[{value:'first::fixture',label:'第一渠道 / fixture'},{value:'second::fixture',label:'第二渠道 / fixture'}],defaultModel:()=> 'second::fixture',isModelReady:()=>true,
    generateImage:async()=>({images:[]}),generateVideo:async()=>({url:'',mimeType:''}),generateText:async(prompt,options)=>{
     calls++;modelUsed=options?.model||'';const {document:doc}=JSON.parse(prompt);
     if(responseMode==='error')throw Error('隔离模型失败，不自动重发');
     if(responseMode==='invalid')return {text:JSON.stringify({summary:'非法操作',commands:[{type:'addAsset',kind:'video',src:'https://invalid.test',name:'remote'}]})};
     const clip=doc.tracks.flatMap((t:any)=>t.clips)[0];
     return {text:JSON.stringify({summary:'把首个片段原声音量设为 50%，保留画面尺寸',commands:[{type:'setClipVolume',clipId:clip.id,volume:.5}]})};
    }}
 };
 const node=state.nodes.find(n=>n.id==='tool')!;const ctx=buildNodeContext(host,node,canvasThemes.dark,1),Content=smartEditPlugin.nodes[0].Content!;
 Object.assign(window,{editTest:{state:()=>ref.current,calls:()=>calls,model:()=>modelUsed,mode:(v:string)=>responseMode=v,flush:()=>flush,link:async()=>readEditorLink(await editorKey('fixture','tool'))}});
 return <ConfigProvider><App><div style={{width:340,height:190,margin:20,background:canvasThemes.dark.node.panel}}><Content ctx={ctx}/></div></App></ConfigProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
