import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import type { CanvasNodeMetadata } from '@/types/canvas';
import { canonicalCanvas, patchSharedCanvas, readSharedCanvas, LOCAL_EDIT, REMOTE_EDIT, mergeSharedWithLocal, sharedAssetKeys, trackSharedUndoAction, type SharedCanvas } from './collaboration-document';
const empty = (): SharedCanvas => ({ title: '', nodes: [], connections: [] });
const canvas = (): SharedCanvas => ({ title: '创作', nodes: [{ id: 'one', type: 'text', title: '文字', position: { x: 0, y: 0 }, width: 200, height: 100, metadata: { content: '原文' } }], connections: [] });
const sync = (from: Y.Doc, to: Y.Doc) => Y.applyUpdate(to, Y.encodeStateAsUpdate(from), REMOTE_EDIT);

test('a held gesture is one undo across pauses, including its final commit, without undoing remote edits', async () => {
    const a = new Y.Doc(), b = new Y.Doc(), initial = canvas();
    patchSharedCanvas(a, initial, empty()); sync(a, b);
    const undo = new Y.UndoManager([a.getMap('nodes')], { trackedOrigins: new Set([LOCAL_EDIT]) });
    const timeout = undo.captureTimeout, action = trackSharedUndoAction(undo);
    action('move');
    const moved = structuredClone(initial); moved.nodes[0].position.x = 20;
    patchSharedCanvas(a, moved, initial);
    await new Promise(resolve => setTimeout(resolve, timeout + 1));
    const edited = structuredClone(initial); edited.nodes[0].metadata!.content = '协作者继续输入';
    patchSharedCanvas(b, edited, initial); sync(b, a);
    action(null);
    const final = structuredClone(moved); final.nodes[0].position.x = 60;
    patchSharedCanvas(a, final, moved);
    await Promise.resolve();
    assert.equal(undo.captureTimeout, timeout);
    assert.equal(undo.undoStack.length, 1);
    undo.undo(); assert.equal(readSharedCanvas(a).nodes[0].position.x, 0);
    assert.equal(readSharedCanvas(a).nodes[0].metadata!.content, '协作者继续输入');
    undo.redo(); assert.equal(readSharedCanvas(a).nodes[0].position.x, 60);
    action('resize');
    const previous = readSharedCanvas(a), resized = structuredClone(previous); resized.nodes[0].width = 320;
    patchSharedCanvas(a, resized, previous); action(null); await Promise.resolve();
    assert.equal(undo.undoStack.length, 2);
    undo.undo(); assert.equal(readSharedCanvas(a).nodes[0].width, 200);
    assert.equal(readSharedCanvas(a).nodes[0].position.x, 60);
    undo.destroy(); a.destroy(); b.destroy();
});

test('concurrent field changes converge and local undo preserves collaborator edits', () => {
    const a = new Y.Doc(), b = new Y.Doc(), initial = canvas();
    patchSharedCanvas(a, initial, empty()); sync(a, b);
    const undo = new Y.UndoManager([a.getMap('nodes')], { trackedOrigins: new Set([LOCAL_EDIT]) });
    const moved = structuredClone(initial), edited = structuredClone(initial);
    moved.nodes[0].position.x = 300; edited.nodes[0].metadata!.content = '协作者改写';
    patchSharedCanvas(a, moved, initial); patchSharedCanvas(b, edited, initial);
    sync(a, b); sync(b, a);
    assert.deepEqual(readSharedCanvas(a), readSharedCanvas(b));
    assert.equal(readSharedCanvas(a).nodes[0].metadata?.content, '协作者改写');
    assert.equal(readSharedCanvas(a).nodes[0].position.x, 300);
    undo.undo();
    assert.equal(readSharedCanvas(a).nodes[0].position.x, 0);
    assert.equal(readSharedCanvas(a).nodes[0].metadata?.content, '协作者改写');
    undo.redo(); assert.equal(readSharedCanvas(a).nodes[0].position.x, 300);
});
test('deletion wins over a stale edit without resurrecting the removed node', () => {
    const a = new Y.Doc(), b = new Y.Doc(), initial = canvas(); patchSharedCanvas(a, initial, empty()); sync(a, b);
    patchSharedCanvas(a, { ...initial, nodes: [] }, initial); sync(a, b);
    const edited = structuredClone(initial); edited.nodes[0].title = '旧编辑'; patchSharedCanvas(b, edited, initial); sync(b, a);
    assert.equal(readSharedCanvas(a).nodes.length, 0);
});

test('simultaneous Chinese and emoji text edits merge by character and undo only local input',()=>{
    const a=new Y.Doc(),b=new Y.Doc(),initial=canvas();initial.nodes[0].metadata!.content='一起创作🎬';patchSharedCanvas(a,initial,empty());sync(a,b);
    const undo=new Y.UndoManager([a.getMap('nodes')],{trackedOrigins:new Set([LOCAL_EDIT])}),left=structuredClone(initial),right=structuredClone(initial);
    left.nodes[0].metadata!.content='实时一起创作🎬';right.nodes[0].metadata!.content='一起创作🎬完成';patchSharedCanvas(a,left,initial);patchSharedCanvas(b,right,initial);sync(a,b);sync(b,a);
    assert.equal(readSharedCanvas(a).nodes[0].metadata!.content,'实时一起创作🎬完成');assert.deepEqual(readSharedCanvas(a),readSharedCanvas(b));
    undo.undo();sync(a,b);assert.equal(readSharedCanvas(b).nodes[0].metadata!.content,'一起创作🎬完成');undo.redo();sync(a,b);assert.equal(readSharedCanvas(b).nodes[0].metadata!.content,'实时一起创作🎬完成');
    const previous=readSharedCanvas(a),changed=structuredClone(previous);changed.nodes[0].metadata!.content='实时一起创作📽️完成';patchSharedCanvas(a,changed,previous);sync(a,b);assert.equal(readSharedCanvas(b).nodes[0].metadata!.content,'实时一起创作📽️完成');
});

test('remote updates reuse unchanged nodes and local-only state without recreating the whole canvas',()=>{
    const local=mergeSharedWithLocal(canvas().nodes,[]);local.push({...structuredClone(local[0]),id:'two'});const shared=structuredClone(local);shared[1].position.x=123;
    const merged=mergeSharedWithLocal(shared,local);assert.equal(merged[0],local[0]);assert.notEqual(merged[1],local[1]);assert.equal(mergeSharedWithLocal(structuredClone(merged),merged),merged);
});
test('shared structure excludes secrets, local tasks and object URLs but retains content and media keys', () => {
    const source = canvas(); source.nodes[0].metadata = { content: 'prompt image:ordinary-text', status: 'loading', imageTaskId: 'paid-task', references: ['image:ref', 'file:shared'], storageKey: 'image:original', apiKey: 'private-key' } as CanvasNodeMetadata;
    const shared = canonicalCanvas(source), serialized = JSON.stringify(shared);
    for (const secret of ['private-key', 'paid-task', 'loading', 'prompt image:ordinary-text']) assert(!serialized.includes(secret));
    assert.deepEqual([...sharedAssetKeys(shared)], ['image:original', 'image:ref', 'file:shared']);
    const local = canvas(); local.nodes[0].metadata!.content = '旧文';
    const remote = canvas(); remote.nodes[0].metadata!.content = '新文';
    assert.equal(mergeSharedWithLocal(remote.nodes, local.nodes)[0].metadata?.content, '新文');
    const image = canonicalCanvas(source).nodes; source.nodes[0].metadata!.content = 'blob:local';
    assert.equal(mergeSharedWithLocal(image, source.nodes)[0].metadata?.content, 'blob:local');
    assert.equal(mergeSharedWithLocal(image, [])[0].metadata?.imageTaskId, undefined);
    const dimensions = { naturalWidth: 17, naturalHeight: 13, bytes: 1, mimeType: 'image/png' };
    const batch = canvas(); batch.nodes[0].metadata = { images: [{ id: 'local-slot', status: 'loading', content: '', imageTaskId: 'own-task', ...dimensions }] };
    const newSlot = canvas(); newSlot.nodes[0].metadata = { images: [{ id: 'remote-slot', status: 'success', content: 'new', ...dimensions }] };
    assert.equal(mergeSharedWithLocal(newSlot.nodes, batch.nodes)[0].metadata?.images?.[0].imageTaskId, undefined, 'a new remote slot must never inherit a local receipt by array index');
});
