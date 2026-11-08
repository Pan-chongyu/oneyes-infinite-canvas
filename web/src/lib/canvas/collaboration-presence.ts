import type { CollaborationMember, CollaborationPeer } from '@/stores/canvas/use-collaboration-store';

export const collaborationActions = { move: '移动中', resize: '调整大小', connect: '连线中', edit: '编辑中' };
export function collaborationName(member: CollaborationMember, members: CollaborationMember[]) {
    return members.some(other => other.id !== member.id && other.name === member.name) ? `${member.name} · ${member.id.slice(0, 4)}` : member.name;
}
export function collaborationOperation(peer: CollaborationPeer) {
    return peer.action ? collaborationActions[peer.action] : peer.selected.length ? `选中 ${peer.selected.length} 个节点` : '浏览中';
}
