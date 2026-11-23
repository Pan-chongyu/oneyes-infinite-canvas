import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { App, ConfigProvider } from 'antd';
import '@/i18n';
import '@/styles/globals.css';
import { useCreatorProcessing } from '@/pages/canvas/hooks/use-creator-processing';
import { creatorToolsPlugin } from '@/components/canvas/creator-tools-plugin';
import { registerBuiltinNodes } from '@/components/canvas/nodes/builtin-nodes';
import { registerNodeDefinitions } from '@/lib/canvas/node-registry';
import { applyCanvasAgentOps } from '@/lib/canvas/canvas-agent-ops';
import { buildNodeContext } from '@/lib/canvas/plugin-node-context';
import { uploadImage, getImageBlob, deleteStoredImages } from '@/services/image-storage';
import { imageMetadata } from '@/lib/canvas/canvas-node-factory';
import { canvasThemes } from '@/lib/canvas-theme';
import { getAntThemeConfig } from '@/lib/app-theme';
import type { CanvasNodeData, CanvasConnection } from '@/types/canvas';
import type { CanvasPluginHost } from '@/types/canvas-plugin';
import { createModelChannel, defaultConfig, encodeChannelModel, useConfigStore } from '@/stores/use-config-store';
import { imageTasks } from '@/stores/use-image-task-store';
import { readFileAsDataUrl } from '@/lib/image-utils';
registerBuiltinNodes(); registerNodeDefinitions(creatorToolsPlugin.nodes,'creator-tools');
const input = new OffscreenCanvas(9,7), context = input.getContext('2d')!;
context.fillStyle='red';context.fillRect(0,0,9,7);
const original = await uploadImage(await input.convertToBlob({type:'image/png'}));
const channel = createModelChannel({ id: 'upscale-test', baseUrl: 'https://oneyes.ai', apiKey: 'fixture-only-key', apiFormat: 'openai', models: [{ name: 'gpt-image-2', capability: 'image' }] });
const imageModel = encodeChannelModel(channel.id, 'gpt-image-2');
const imageConfig = { ...defaultConfig, channelMode: 'local' as const, channels: [channel], imageModel, model: imageModel, models: [imageModel] };
useConfigStore.setState({ config: imageConfig });
const realFetch = window.fetch.bind(window);
let requests: { model: unknown; size: unknown; n: unknown; references: number }[] = [], persisted: CanvasNodeData[] = [], failFlush = false;
const generated = new OffscreenCanvas(1024, 1024); generated.getContext('2d')!.fillRect(0, 0, 1024, 1024);
const generatedUrl = await readFileAsDataUrl(await generated.convertToBlob({ type: 'image/png' }));
window.fetch = async (resource, init) => {
 const raw = new URL(String(resource), location.href);
 const url = raw.pathname.startsWith('/oneyes-api/') ? 'https://oneyes.ai'+raw.pathname.slice('/oneyes-api'.length)+raw.search : raw.pathname === '/proxy' ? raw.searchParams.get('url') || String(resource) : String(resource);
 if (url === 'https://oneyes.ai/v1/images/edits/async') {
  const form = init?.body as FormData;
  const target = persisted.find(n => n.id === persisted.find(n => n.id === 'tool')?.metadata?.creatorSettings?.modelOutputId);
  if (!target?.metadata?.imageTaskId) throw Error('Target and receipt must be persisted before paid submission');
  requests.push({ model: form.get('model'), size: form.get('size'), n: form.get('n'), references: form.getAll('image').length });
  return Response.json({ id: 'upscale-fixture-'+requests.length, status: 'completed', result: { data: [{ b64_json: generatedUrl.split(',')[1] }] } });
 }
 if (new URL(url, location.href).origin === 'https://oneyes.ai') throw Error('Unexpected paid request: '+url);
 return realFetch(resource, init);
};
const source:CanvasNodeData={id:'source',type:'image',title:'原始图',position:{x:0,y:0},width:9,height:7,metadata:imageMetadata(original)};
const tool=(name:string,status='idle'):CanvasNodeData=>({id:'tool',type:'creator-tools:'+name,title:'处理节点',position:{x:20,y:20},width:320,height:190,metadata:{status:status as any,creatorSettings:{sourceIds:['source']}}});
let pending: Promise<void> = Promise.resolve();
function Fixture(){
 const [nodes,setNodes]=useState([source,tool('compose')]);
 const [connections,setConnections]=useState<CanvasConnection[]>([]);
 const [projectId,setProjectId]=useState('A');const [dark,setDark]=useState(new URLSearchParams(location.search).get('theme')==='dark');
 const live = useRef({ nodes, connections, projectId }); live.current = { nodes, connections, projectId };
 document.documentElement.classList.toggle('dark',dark);
 const updateMetadata:CanvasPluginHost['updateMetadata']=(id,patch)=>setNodes(prev=>prev.map(n=>n.id===id?{...n,metadata:{...n.metadata,...patch}}:n));
 const applyOps:CanvasPluginHost['applyOps']=ops=>{const next=applyCanvasAgentOps({...live.current,title:'test',viewport:{x:0,y:0,k:1},selectedNodeIds:[]},ops);live.current={nodes:next.nodes,connections:next.connections,projectId};flushSync(()=>{setNodes(next.nodes);setConnections(next.connections);});};
 const processing=useCreatorProcessing({nodes,connections,projectId,updateMetadata,applyOps,imageConfig,readNodes:()=>live.current.nodes,flush:async()=>{if(failFlush)throw Error('fixture disk full');persisted=structuredClone(live.current.nodes);}});
 const host={getNode:id=>nodes.find(n=>n.id===id)||null,getNodes:()=>nodes,getConnections:()=>connections,getUpstream:()=>[],getDownstream:()=>[],updateMetadata,updateNode:()=>{},applyOps,ai:{} as any,openPanel:()=>{},closePanel:()=>{},processing} satisfies CanvasPluginHost;
 const node=nodes.find(n=>n.id==='tool'),definition=creatorToolsPlugin.nodes.find(n=>n.type===node?.type),theme=canvasThemes[dark?'dark':'light'];
 const ctx=node?buildNodeContext(host,node,theme,1):undefined;
 Object.assign(window,{creatorTest:{
  state:()=>({nodes,connections,projectId}),
  seed:(name='compose',status='idle')=>flushSync(()=>{setProjectId('A');setNodes([source,tool(name,status)]);setConnections([]);}),
  start:()=>pending=processing.start('tool'),cancel:()=>processing.cancel('tool'),settled:()=>pending,
  pair:async()=>{const first=processing.start('tool'),second=processing.start('tool');pending=first;const same=first===second;await first;return same;},
  switchProject:()=>flushSync(()=>{setProjectId('B');setNodes([source]);setConnections([]);}),
  remove:()=>flushSync(()=>setNodes(prev=>prev.filter(n=>n.id!=='tool'))),
  theme:(value:boolean)=>flushSync(()=>{setDark(value);document.documentElement.classList.toggle('dark',value);}),
  original:async()=>Array.from(new Uint8Array(await (await getImageBlob(original.storageKey!))!.arrayBuffer())),
  model:(size='1024x1024',outputStatus?:string)=>flushSync(()=>{
   failFlush=false; const n=tool('superResolution');n.metadata!.creatorSettings={sourceIds:['source'],upscaleMethod:'model',upscaleModel:imageModel,upscaleSize:size,...(outputStatus?{modelOutputId:'previous-output'}:{})};
   setNodes([source,n,...(outputStatus?[{id:'previous-output',type:'image',title:'previous',position:{x:400,y:0},width:200,height:200,metadata:{status:outputStatus as any,imageTaskId:'previous-task'}}]:[])]);setConnections([]);
  }),
  modelInfo:()=>({requests,persisted,tasks:[...imageTasks.tasks.values()].map(task=>({id:task.id,target:task.target,status:task.status,references:task.references}))}),
  failFlush:()=>{failFlush=true;},
  outputPixels:async()=>{const output=nodes.find(n=>n.id!=='source'&&n.id!=='tool')!;const read=async(key:string)=>{const image=await createImageBitmap((await getImageBlob(key))!);const canvas=new OffscreenCanvas(image.width,image.height),context=canvas.getContext('2d')!;context.drawImage(image,0,0);image.close();return Array.from(context.getImageData(0,0,canvas.width,canvas.height).data);};return JSON.stringify(await read(original.storageKey!))===JSON.stringify(await read(output.metadata!.storageKey!));},
  input:(kind:string,url:string)=>flushSync(()=>{
   const image={id:'chosen',status:'success' as const,...imageMetadata(original),content:original.url,storageKey:original.storageKey,naturalWidth:9,naturalHeight:7,bytes:original.bytes,mimeType:original.mimeType};
   const metadata=kind==='remote'?{content:url}:kind==='batch'?{images:[{...image,id:'other',content:'',storageKey:undefined},image],primaryImageId:'chosen'}:kind==='missing-index'?{content:original.url,storageKey:'image:missing-index'}:{content:''};
   setNodes([{...source,metadata},tool('compose')]);setConnections([]);
  }),
  clear:async()=>deleteStoredImages(nodes.filter(n=>n.id!=='source').map(n=>n.metadata?.storageKey).filter((v):v is string=>!!v)),
 }});
 return <ConfigProvider theme={getAntThemeConfig(dark)}><App><main style={{background:theme.canvas.background,color:theme.node.text,minHeight:'100vh',padding:20}}><div style={{width:320,height:190,background:theme.node.panel,borderRadius:16}}>{ctx&&definition?.Content&&<definition.Content ctx={ctx}/>}</div><div style={{maxWidth:600,marginTop:16}}>{ctx&&definition?.Panel&&<definition.Panel ctx={ctx} onClose={()=>{}}/>}</div></main></App></ConfigProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
