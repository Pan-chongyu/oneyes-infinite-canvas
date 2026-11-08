import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { App, ConfigProvider } from 'antd';
import 'antd/dist/reset.css';
import '@/i18n';
import '@/styles/globals.css';
import { directorPlugin } from '@/components/canvas/director-plugin';
import { createDirectorRuntime } from '@/components/canvas/director-runtime';
import { directorPreset, readDirectorScene } from '@/lib/canvas/director-scene';
import { registerBuiltinNodes } from '@/components/canvas/nodes/builtin-nodes';
import { registerNodeDefinitions } from '@/lib/canvas/node-registry';
import { applyCanvasAgentOps } from '@/lib/canvas/canvas-agent-ops';
import { CanvasNode } from '@/components/canvas/canvas-node';
import { InfiniteCanvas } from '@/components/canvas/infinite-canvas';
import { useThemeStore } from '@/stores/use-theme-store';
import { getImageBlob, deleteStoredImages } from '@/services/image-storage';
import { localForageStorage } from '@/lib/localforage-storage';
import { canvasThemes } from '@/lib/canvas-theme';
import { getAntThemeConfig } from '@/lib/app-theme';
import type { CanvasNodeData, CanvasConnection } from '@/types/canvas';
import type { CanvasPluginHost } from '@/types/canvas-plugin';
registerBuiltinNodes(); registerNodeDefinitions(directorPlugin.nodes, 'director');
const seed: CanvasNodeData = {id:'director',type:'director:stage',title:'3D 导演台',position:{x:0,y:0},width:320,height:190};
const saved = JSON.parse(await localForageStorage.getItem('director-fixture') || 'null');
function Fixture() {
 const [nodes,setNodes] = useState<CanvasNodeData[]>(saved?.nodes || [seed]), [connections,setConnections] = useState<CanvasConnection[]>(saved?.connections || []);
 const [projectId,setProject] = useState('A'), [dark,setDark] = useState(new URLSearchParams(location.search).get('theme') === 'dark');
 const container=useRef<HTMLDivElement>(null),events=useRef({selection:0,drag:0,background:0,context:0,viewport:0});
 const [viewport,setViewport]=useState({x:20,y:20,k:1.86});
 document.documentElement.classList.toggle('dark',dark);
 document.documentElement.style.colorScheme=dark?'dark':'light';
 const applyOps:CanvasPluginHost['applyOps']=ops=>{const result=applyCanvasAgentOps({nodes,connections,projectId,title:'test',viewport:{x:0,y:0,k:1},selectedNodeIds:[]},ops);setNodes(result.nodes);setConnections(result.connections);};
 const host:CanvasPluginHost={projectId,getNode:id=>nodes.find(n=>n.id===id)||null,getNodes:()=>nodes,getConnections:()=>connections,getUpstream:()=>[],getDownstream:()=>[],updateMetadata:(id,patch)=>setNodes(old=>old.map(n=>n.id===id?{...n,metadata:{...n.metadata,...patch}}:n)),updateNode:()=>{},applyOps,ai:{} as any,openPanel:()=>{},closePanel:()=>{}};
 const node=nodes.find(n=>n.id==='director'),theme=canvasThemes[dark?'dark':'light'];
 Object.assign(window,{directorTest:{
  state:()=>({nodes,connections,projectId}),
  events:()=>events.current,
  resetEvents:()=>{events.current={selection:0,drag:0,background:0,context:0,viewport:0};},
  configure:(width=321,height=197)=>flushSync(()=>setNodes(old=>old.map(n=>n.id==='director'?{...n,metadata:{...n.metadata,directorScene:{...directorPreset('dialogue'),width,height}}}:n))),
  save:()=>localForageStorage.setItem('director-fixture',JSON.stringify({nodes,connections})),
  image:async(index=0)=>{const image=nodes.filter(n=>n.type==='image')[index];const blob=await getImageBlob(image.metadata!.storageKey!);if(!blob)throw Error('Missing image');const bitmap=await createImageBitmap(blob);const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d')!;ctx.drawImage(bitmap,0,0);const pixels=ctx.getImageData(0,0,bitmap.width,bitmap.height).data;const colors=new Set<string>();for(let i=0;i<pixels.length;i+=4)colors.add(pixels.slice(i,i+4).join(','));bitmap.close();return {width:canvas.width,height:canvas.height,bytes:blob.size,colors:colors.size,hash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).join(',')};},
  switch:()=>flushSync(()=>{setProject('B');setNodes([{...seed}]);setConnections([]);}),
  remove:()=>flushSync(()=>setNodes(old=>old.filter(n=>n.id!=='director'))),
  theme:(value:boolean)=>flushSync(()=>{setDark(value);useThemeStore.getState().setTheme(value?'dark':'light');}),
  runtime:async()=>{
   const container=document.createElement('div');container.style.cssText='position:fixed;left:0;top:0;width:640px;height:400px';document.body.append(container);
   const scene=directorPreset();scene.width=317;scene.height=191;
   const cameras:any[]=[], patches:any[]=[];
   const runtime=createDirectorRuntime(container,scene,{camera:value=>cameras.push(value),object:(id,patch)=>patches.push({id,patch}),select:()=>{},error:()=>{}});
   try{
    const first=await runtime.capture();scene.objects[0].pose='sit';runtime.update(scene,scene.objects[0].id);runtime.mode('scene');runtime.transform('rotate');const second=await runtime.capture();
    const read=async(blob:Blob)=>{const image=await createImageBitmap(blob);const result=[image.width,image.height];image.close();return result;};
    const hash=async(blob:Blob)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).join(',');
    const sizes=[await read(first),await read(second)];const differs=await hash(first)!==await hash(second);
    const passes=[];for(const output of ['depth','outline','mask','normal','transparent'] as const){const blob=await runtime.capture(output,scene.objects[0].id);passes.push({output,size:await read(blob),hash:await hash(blob)});}
    if(passes.some(pass=>pass.size[0]!==317||pass.size[1]!==191)||new Set(passes.map(pass=>pass.hash)).size!==5)throw Error('Director output passes must be distinct and retain exact pixel dimensions');
    const transparent=await createImageBitmap(await runtime.capture('transparent')),alphaCanvas=new OffscreenCanvas(transparent.width,transparent.height),alphaContext=alphaCanvas.getContext('2d')!;alphaContext.drawImage(transparent,0,0);const alpha=alphaContext.getImageData(0,0,transparent.width,transparent.height).data;transparent.close();
    if(!alpha.some((value,index)=>index%4===3&&value===0)||!alpha.some((value,index)=>index%4===3&&value===255))throw Error('Transparent output must contain transparent background and opaque subjects');
    if(await hash(await runtime.capture())!==await hash(second))throw Error('Output passes must restore all original materials and lighting');
    scene.objects[0].joints={leftArm:[0,0,100],leftElbow:[-50,0,0],head:[0,70,0]};runtime.update(scene,scene.objects[0].id);if(await hash(await runtime.capture())===await hash(second))throw Error('Joint articulation did not change the rendered pose');
    scene.objects[0].joints=undefined;runtime.update(scene,scene.objects[0].id);if(await hash(await runtime.capture())!==await hash(second))throw Error('Reset pose must restore original geometry');
    const light=scene.light;scene.light={...light,color:'#ffb878',ambient:0.3,fill:1,rim:2,shadows:false};runtime.update(scene,null);if(await hash(await runtime.capture())===await hash(second))throw Error('Lighting controls did not affect rendering');scene.light=light;runtime.update(scene,scene.objects[0].id);
    scene.guide='thirds';runtime.update(scene,scene.objects[0].id);runtime.mode('camera');const withGuide=await runtime.capture();const cleanExport=await hash(withGuide)===await hash(second);
    scene.objects[0].visible=false;runtime.update(scene,scene.objects[0].id);const hidden=await runtime.capture();const visibility=await hash(hidden)!==await hash(second);
    scene.objects[0].visible=true;scene.objects[0].position[1]=4;runtime.update(scene,scene.objects[0].id);runtime.ground(scene.objects[0].id);const grounded=patches.at(-1)?.patch.position[1];
    scene.objects[0].locked=true;runtime.update(scene,scene.objects[0].id);runtime.ground(scene.objects[0].id);const lock=patches.length===1;
    runtime.focus(scene.objects[0].id);runtime.view('top');const focused=cameras.length>=2&&cameras.every(camera=>camera.position.every(Number.isFinite)&&camera.target.every(Number.isFinite));
    scene.width=191;scene.height=317;runtime.update(scene,null);runtime.mode('camera');await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const rect=container.querySelector('[data-director-controls]')!.getBoundingClientRect();const portraitControls=Math.abs(rect.width/rect.height-191/317)<0.001;
    const max=Number(container.querySelector('canvas')!.getContext('webgl2')!.getParameter(WebGL2RenderingContext.MAX_TEXTURE_SIZE));scene.width=max+1;runtime.update(scene,null);let reason='';try{await runtime.capture();}catch(error){reason=(error as Error).message;}
    return {sizes,differs,reason,portraitControls,cleanExport,visibility,grounded,lock,focused};
   }finally{runtime.dispose();const canvases=container.querySelectorAll('canvas').length;container.remove();if(canvases)throw Error('Leaked renderer');}
  },
  validation:()=>{const scene=directorPreset();const copy=readDirectorScene(scene);copy.objects[0].position[0]=99;let invalid=0;for(const patch of [{schema:2},{width:0},{objects:[scene.objects[0],scene.objects[0]]},{camera:{...scene.camera,lens:NaN}}])try{readDirectorScene({...scene,...patch});}catch{invalid++;}return {independent:scene.objects[0].position[0]!==99,invalid};},
  clear:async()=>deleteStoredImages(nodes.filter(n=>n.type==='image').map(n=>n.metadata!.storageKey!)),
 }});
 return <ConfigProvider theme={getAntThemeConfig(dark)}><App><main style={{background:theme.canvas.background,color:theme.node.text,height:'100vh'}}><InfiniteCanvas containerRef={container} viewport={viewport} tool="select" onViewportChange={next=>{events.current.viewport++;setViewport(next);}} onCanvasMouseDown={()=>{events.current.background++;}}>
  {node&&<CanvasNode data={node} scale={viewport.k} isSelected isRelated={false} isFocusRelated={false} isConnectionTarget={false} isConnecting={false} showPanel={false} showImageInfo={false} pluginHost={host}
   onSelectCapture={()=>{events.current.selection++;}} onMouseDown={event=>{event.stopPropagation();events.current.drag++;}} onContextMenu={event=>{event.preventDefault();events.current.context++;}}
   onHoverStart={()=>{}} onHoverEnd={()=>{}} onConnectStart={()=>{}} onResizeStart={()=>{}} onResize={()=>{}} onResizeEnd={()=>{}} onContentChange={()=>{}} onTitleChange={()=>{}}/>}
 </InfiniteCanvas></main></App></ConfigProvider>;
}
useThemeStore.getState().setTheme(new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light');
createRoot(document.getElementById('root')!).render(<Fixture/>);
