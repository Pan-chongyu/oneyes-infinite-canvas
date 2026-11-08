import { create } from 'zustand';
export type CollaborationMember = { id: string; name: string; color: number; role?: 'host' | 'guest' };
export type CollaborationState = { status?: 'offline' | 'online' | 'reconnecting'; role?: 'host' | 'guest'; roomId?: string; projectId?: string; invite?: string; invitations?: Array<{ address: string; invite: string }>; members?: number; self?: CollaborationMember; nickname?: string };
export type CollaborationPresence = {cursor:{x:number;y:number}|null;selected:string[];action:'move'|'resize'|'connect'|'edit'|null;connection?:import('@/types/canvas').ConnectionHandle|null};
export type CollaborationPeer = CollaborationPresence & CollaborationMember;
type CollaborationStore = CollaborationState & {
    projectId?: string; busy: boolean; syncing: boolean; error?: string; canUndo: boolean; canRedo: boolean;
    host?: () => Promise<void>; join?: (invite: string) => Promise<void>; leave?: () => Promise<void>;
    retry?: () => void; undo?: () => void; redo?: () => void;
    rename?: (nickname: string) => Promise<void>; locatePeer?: (id: string) => void;
    peers:CollaborationPeer[]; publishPresence?: (patch:Partial<CollaborationPresence>)=>void;
};
export const useCollaborationStore = create<CollaborationStore>(() => ({ status: 'offline', busy: false, syncing: false, canUndo: false, canRedo: false,peers:[] }));
