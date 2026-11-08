import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MousePointer2 } from 'lucide-react';
import { useCollaborationStore, type CollaborationPresence } from '@/stores/canvas/use-collaboration-store';
import { canvasThemes } from '@/lib/canvas-theme';
import { useThemeStore } from '@/stores/use-theme-store';
import type { CanvasNodeData, ConnectionHandle, ViewportTransform } from '@/types/canvas';
import { ActiveConnectionPath } from './canvas-connections';

const actions={move:'移动中',resize:'调整大小',connect:'连线中',edit:'编辑中'};
export function CanvasCollaborationPresence({projectId,containerRef,nodes,viewport,selectedNodeIds,action=null,connection=null}:{projectId:string;containerRef:React.RefObject<HTMLDivElement|null>;nodes:CanvasNodeData[];viewport:ViewportTransform;selectedNodeIds:ReadonlySet<string>;action?:CollaborationPresence['action'];connection?:ConnectionHandle|null}) {
    const theme=canvasThemes[useThemeStore(state=>state.theme)],room=useCollaborationStore(state=>state.projectId),status=useCollaborationStore(state=>state.status),peers=useCollaborationStore(state=>state.peers),publish=useCollaborationStore(state=>state.publishPresence);
    const active=room===projectId&&status==='online',latest=useRef(viewport),pointer=useRef<{x:number;y:number}|null>(null),[editing,setEditing]=useState(false),[focused,setFocused]=useState(true);
    latest.current=viewport;
    useEffect(()=>{
        const container=containerRef.current;if(!active||!container||!publish)return;
        const move=(event:PointerEvent)=>{const rect=container.getBoundingClientRect(),view=latest.current;pointer.current={x:event.clientX-rect.left,y:event.clientY-rect.top};publish({cursor:{x:(pointer.current.x-view.x)/view.k,y:(pointer.current.y-view.y)/view.k}});};
        const leave=()=>{pointer.current=null;publish({cursor:null});};
        const blur=()=>{pointer.current=null;setFocused(false);setEditing(false);publish({cursor:null,selected:[],action:null,connection:null});};
        const focus=()=>{const element=document.activeElement;setFocused(true);setEditing(element instanceof Element&&!!element.closest('[data-node-id]')&&element.matches('input,textarea,[contenteditable="true"]'));};
        const focusOut=()=>queueMicrotask(()=>{if(document.hasFocus())focus();});
        const hidden=()=>{if(document.hidden)blur();};
        container.addEventListener('pointermove',move);container.addEventListener('pointerleave',leave);container.addEventListener('focusin',focus);container.addEventListener('focusout',focusOut);window.addEventListener('blur',blur);window.addEventListener('focus',focus);document.addEventListener('visibilitychange',hidden);
        return()=>{container.removeEventListener('pointermove',move);container.removeEventListener('pointerleave',leave);container.removeEventListener('focusin',focus);container.removeEventListener('focusout',focusOut);window.removeEventListener('blur',blur);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',hidden);leave();};
    },[active,containerRef,publish]);
    useLayoutEffect(()=>{if(active&&publish)publish({selected:focused?[...selectedNodeIds]:[],action:focused?action||(editing?'edit':null):null,connection:focused?connection:null});},[active,publish,selectedNodeIds,action,editing,focused,connection]);
    useLayoutEffect(()=>{if(active&&publish&&pointer.current)publish({cursor:{x:(pointer.current.x-viewport.x)/viewport.k,y:(pointer.current.y-viewport.y)/viewport.k}});},[active,publish,viewport]);
    if(!active)return null;
    const byId=new Map(nodes.map(node=>[node.id,node])),scale=1/viewport.k;
    return <div className="pointer-events-none absolute left-0 top-0 z-[70]" aria-label="协作者位置" data-collaboration-presence>
        {peers.map(peer=>{
            const index=Array.from(peer.id).reduce((sum,char)=>sum+char.charCodeAt(0),0)%theme.collaboration.length,color=theme.collaboration[index],label=`${peer.name}${peer.action?` · ${actions[peer.action]}`:''}`;
            return <div key={peer.id} data-collaboration-peer={peer.id}>
                {peer.connection&&peer.cursor&&<svg className="absolute left-0 top-0 h-px w-px overflow-visible" data-collaboration-connection><ActiveConnectionPath node={byId.get(peer.connection.nodeId)} handle={peer.connection} mouseWorld={peer.cursor} color={color}/></svg>}
                {peer.selected.map(id=>{const node=byId.get(id);return node?<div key={id} data-collaboration-selection={id} className="absolute rounded-2xl" style={{left:node.position.x-3*scale,top:node.position.y-3*scale,width:node.width+6*scale,height:node.height+6*scale,border:`${1.5*scale}px solid ${color}`}}/>:null;})}
                {peer.cursor&&<div data-collaboration-cursor className="absolute origin-top-left" style={{transform:`translate(${peer.cursor.x}px,${peer.cursor.y}px) scale(${scale})`,color}}><MousePointer2 size={18} fill={color} stroke={theme.canvas.background} strokeWidth={1.5}/><span className="ml-4 block whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] leading-4" style={{background:theme.toolbar.panel,color}}>{label}</span></div>}
            </div>;
        })}
    </div>;
}
