import { create } from 'zustand';
export type CollaborationState = { status?: 'offline' | 'online' | 'reconnecting'; role?: 'host' | 'guest'; roomId?: string; projectId?: string; invite?: string; invitations?: Array<{ address: string; invite: string }>; members?: number };
type CollaborationStore = CollaborationState & {
    projectId?: string; busy: boolean; syncing: boolean; error?: string; canUndo: boolean; canRedo: boolean;
    host?: () => Promise<void>; join?: (invite: string) => Promise<void>; leave?: () => Promise<void>;
    retry?: () => void; undo?: () => void; redo?: () => void;
};
export const useCollaborationStore = create<CollaborationStore>(() => ({ status: 'offline', busy: false, syncing: false, canUndo: false, canRedo: false }));
