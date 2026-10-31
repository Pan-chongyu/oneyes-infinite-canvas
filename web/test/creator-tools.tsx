import React, { useState } from 'react';
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
registerBuiltinNodes(); registerNodeDefinitions(creatorToolsPlugin.nodes,'creator-tools');
const input = new OffscreenCanvas(9,7), context = input.getContext('2d')!;
context.fillStyle='red';context.fillRect(0,0,9,7);
const original = await uploadImage(await input.convertToBlob({type:'image/png'}));
const source:CanvasNodeData={id:'source',type:'image',title:'原始图',position:{x:0,y:0},width:9,height:7,metadata:imageMetadata(original)};
const tool=(name:string,status='idle'):CanvasNodeData=>({id:'tool',type:'creator-tools:'+name,title:'处理节点',position:{x:20,y:20},width:320,height:190,metadata:{status:status as any,creatorSettings:{sourceIds:['source']}}});
function Fixture(){
 const [nodes,setNodes]=useState([source,tool('compose')]);
 const [connections,setConnections]=useState<CanvasConnection[]>([]);
 const [projectId,setProjectId]=useState('A');const [dark,setDark]=useState(new URLSearchParams(location.search).get('theme')==='dark');
 document.documentElement.classList.toggle('dark',dark);
 const updateMetadata:CanvasPluginHost['updateMetadata']=(id,patch)=>setNodes(prev=>prev.map(n=>n.id===id?{...n,metadata:{...n.metadata,...patch}}:n));
 const applyOps:CanvasPluginHost['applyOps']=ops=>{const next=applyCanvasAgentOps({nodes,connections,projectId,title:'test',viewport:{x:0,y:0,k:1},selectedNodeIds:[]},ops);setNodes(next.nodes);setConnections(next.connections);};
 const processing=useCreatorProcessing({nodes,connections,projectId,updateMetadata,applyOps});
 const host={getNode:id=>nodes.find(n=>n.id===id)||null,getNodes:()=>nodes,getConnections:()=>connections,getUpstream:()=>[],getDownstream:()=>[],updateMetadata,updateNode:()=>{},applyOps,ai:{} as any,openPanel:()=>{},closePanel:()=>{},processing} satisfies CanvasPluginHost;
 const node=nodes.find(n=>n.id==='tool'),definition=creatorToolsPlugin.nodes.find(n=>n.type===node?.type),theme=canvasThemes[dark?'dark':'light'];
 const ctx=node?buildNodeContext(host,node,theme,1):undefined;
 Object.assign(window,{creatorTest:{
  state:()=>({nodes,connections,projectId}),
  seed:(name='compose',status='idle')=>flushSync(()=>{setProjectId('A');setNodes([source,tool(name,status)]);setConnections([]);}),
  start:()=>processing.start('tool'),cancel:()=>processing.cancel('tool'),
  pair:async()=>{const first=processing.start('tool'),second=processing.start('tool');const same=first===second;await first;return same;},
  switchProject:()=>flushSync(()=>{setProjectId('B');setNodes([source]);setConnections([]);}),
  remove:()=>flushSync(()=>setNodes(prev=>prev.filter(n=>n.id!=='tool'))),
  theme:(value:boolean)=>flushSync(()=>{setDark(value);document.documentElement.classList.toggle('dark',value);}),
  original:async()=>Array.from(new Uint8Array(await (await getImageBlob(original.storageKey!))!.arrayBuffer())),
  clear:async()=>deleteStoredImages(nodes.filter(n=>n.id!=='source').map(n=>n.metadata?.storageKey).filter((v):v is string=>!!v)),
 }});
 return <ConfigProvider theme={getAntThemeConfig(dark)}><App><main style={{background:theme.canvas.background,color:theme.node.text,minHeight:'100vh',padding:20}}><div style={{width:320,height:190,background:theme.node.panel,borderRadius:16}}>{ctx&&definition?.Content&&<definition.Content ctx={ctx}/>}</div><div style={{maxWidth:600,marginTop:16}}>{ctx&&definition?.Panel&&<definition.Panel ctx={ctx} onClose={()=>{}}/>}</div></main></App></ConfigProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
