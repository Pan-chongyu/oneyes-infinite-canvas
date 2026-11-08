import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MousePointer2 } from 'lucide-react';
import { useCollaborationStore, type CollaborationPresence } from '@/stores/canvas/use-collaboration-store';
import { canvasThemes } from '@/lib/canvas-theme';
import { useThemeStore } from '@/stores/use-theme-store';
import type { CanvasNodeData, ConnectionHandle, ViewportTransform } from '@/types/canvas';
import { ActiveConnectionPath } from './canvas-connections';
import { collaborationName, collaborationOperation } from '@/lib/canvas/collaboration-presence';

export function CanvasCollaborationPresence({projectId,containerRef,nodes,viewport,onViewportChange,selectedNodeIds,action=null,connection=null}:{projectId:string;containerRef:React.RefObject<HTMLDivElement|null>;nodes:CanvasNodeData[];viewport:ViewportTransform;onViewportChange:(viewport:ViewportTransform)=>void;selectedNodeIds:ReadonlySet<string>;action?:CollaborationPresence['action'];connection?:ConnectionHandle|null}) {
    const theme=canvasThemes[useThemeStore(state=>state.theme)],room=useCollaborationStore(state=>state.projectId),status=useCollaborationStore(state=>state.status),peers=useCollaborationStore(state=>state.peers),self=useCollaborationStore(state=>state.self),publish=useCollaborationStore(state=>state.publishPresence);
    const active=room===projectId&&status==='online',latest=useRef(viewport),pointer=useRef<{x:number;y:number}|null>(null),[editing,setEditing]=useState(false),[focused,setFocused]=useState(true);
    const latestNodes=useRef(nodes);latestNodes.current=nodes;
    latest.current=viewport;
    useEffect(()=>{
        if(!active)return;
        const locatePeer=(id:string)=>{
            const peer=useCollaborationStore.getState().peers.find(item=>item.id===id),container=containerRef.current;if(!peer||!container)return;
            const selected=latestNodes.current.filter(node=>peer.selected.includes(node.id));
            const point=selected.length?{x:(Math.min(...selected.map(node=>node.position.x))+Math.max(...selected.map(node=>node.position.x+node.width)))/2,y:(Math.min(...selected.map(node=>node.position.y))+Math.max(...selected.map(node=>node.position.y+node.height)))/2}:peer.cursor;
            if(point){const rect=container.getBoundingClientRect(),view=latest.current;onViewportChange({x:rect.width/2-point.x*view.k,y:rect.height/2-point.y*view.k,k:view.k});}
        };
        useCollaborationStore.setState({locatePeer});
        return()=>{if(useCollaborationStore.getState().locatePeer===locatePeer)useCollaborationStore.setState({locatePeer:undefined});};
    },[active,containerRef,onViewportChange]);
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
    const members=self?[self,...peers]:peers;
    const colorFor=(peer:typeof peers[number])=>theme.collaboration[peer.color%theme.collaboration.length];
    return <div className="pointer-events-none absolute left-0 top-0 z-[70]" aria-label="协作者位置" data-collaboration-presence>
        {nodes.map(node=>{
            const owners=peers.filter(peer=>peer.selected.includes(node.id));if(!owners.length)return null;
            return <div key={node.id}>
                {owners.map((peer,index)=>{const gap=(3+index*2)*scale;return <div key={peer.id} data-collaboration-selection={node.id} data-collaboration-owner={peer.id} className="absolute rounded-2xl" style={{left:node.position.x-gap,top:node.position.y-gap,width:node.width+2*gap,height:node.height+2*gap,border:`${1.5*scale}px solid ${colorFor(peer)}`}}/>;})}
                <div className="absolute flex max-w-96 origin-bottom-left flex-wrap gap-1" style={{left:node.position.x,top:node.position.y-8*scale,transform:`translateY(-100%) scale(${scale})`}}>
                    {owners.map(peer=><span key={peer.id} data-collaboration-node-label={node.id} data-collaboration-owner={peer.id} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] leading-4" style={{background:theme.toolbar.panel,color:colorFor(peer)}}><span className="size-1.5 rounded-full" style={{background:'currentColor'}}/>{collaborationName(peer,members)}<span style={{color:theme.node.muted}}>{collaborationOperation(peer)}</span></span>)}
                </div>
            </div>;
        })}
        {peers.map(peer=>{
            const color=colorFor(peer),label=`${collaborationName(peer,members)} · ${collaborationOperation(peer)}`;
            return <div key={peer.id} data-collaboration-peer={peer.id}>
                {peer.connection&&peer.cursor&&<svg className="absolute left-0 top-0 h-px w-px overflow-visible" data-collaboration-connection><ActiveConnectionPath node={byId.get(peer.connection.nodeId)} handle={peer.connection} mouseWorld={peer.cursor} color={color}/></svg>}
                {peer.cursor&&<div data-collaboration-cursor className="absolute origin-top-left" style={{transform:`translate(${peer.cursor.x}px,${peer.cursor.y}px) scale(${scale})`,color}}><MousePointer2 size={18} fill={color} stroke={theme.canvas.background} strokeWidth={1.5}/><span className="ml-4 block whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] leading-4" style={{background:theme.toolbar.panel,color}}>{label}</span></div>}
            </div>;
        })}
    </div>;
}
