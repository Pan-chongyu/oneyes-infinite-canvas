import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, connect } from 'node:net';
import { once } from 'node:events';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Y = require('yjs');
const { createCollaboration, parseInvite, lanAddress } = require('../desktop/collaboration.cjs');
const { createVault } = require('../desktop/vault.cjs');
const { WebSocket } = require('ws');
const wait = async predicate => { const until = Date.now() + 12000; while (!await predicate()) { if (Date.now() > until) throw Error('协作测试等待失败'); await new Promise(resolve => setTimeout(resolve, 20)); } };
const snapshot = async service => { const doc = new Y.Doc(); Y.applyUpdate(doc, Buffer.from((await service.call('snapshot')).data, 'base64')); return doc; };
const put = (service, bytes) => service.request(new Request('oneyes-canvas://app/collaboration/assets/new', { method: 'PUT', body: bytes, headers: { 'content-type': 'application/octet-stream' } }));

test('invites accept only literal private IPv4 and reject malformed ports and secrets', () => {
    for (const address of ['10.0.1.2', '192.168.0.2', '172.16.0.2', '127.0.0.1']) assert.equal(lanAddress(address), true);
    for (const address of ['192.168.evil.com', '10.999.1.1', '8.8.8.8', 'localhost', '[::1]', '172.32.1.1']) assert.equal(lanAddress(address), false);
    const invite = value => 'ONEYESCANVAS1.' + Buffer.from(JSON.stringify(value)).toString('base64url');
    assert.throws(() => parseInvite(invite({ host: '192.168.evil.com', port: 80, room: 'a'.repeat(32), secret: 'a'.repeat(43) })));
    assert.throws(() => parseInvite('anything'));
});

test('encrypted native rooms merge changes, move original bytes, reconnect without replay and clean up', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'canvas-lan-test-'));
    const events = [], host = createCollaboration({ directory, address: '127.0.0.1' });
    const guest = createCollaboration({ directory, changed: value => events.push(value) });
    const other = createCollaboration({ directory });
    let relay; const connections = new Set();
    try {
        const room = await host.call('host', { projectId: 'host-local' });
        const invite = parseInvite(room.invite);
        const doc = new Y.Doc(); doc.getMap('test').set('host', 'first');
        await host.call('update', { data: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64') });
        relay = createServer(client => { const upstream = connect(invite.port, invite.host); connections.add(client); connections.add(upstream); client.pipe(upstream); upstream.pipe(client); client.on('error', () => {}); upstream.on('error', () => {}); client.on('close', () => upstream.destroy()); upstream.on('close', () => client.destroy()); });
        relay.listen(0, '127.0.0.1'); await once(relay, 'listening');
        const relayedInvite = 'ONEYESCANVAS1.' + Buffer.from(JSON.stringify({ ...invite, port: relay.address().port })).toString('base64url');
        await guest.call('join', { invite: relayedInvite, projectId: 'guest-local' });
        await other.call('join', { invite: room.invite, projectId: 'other-local' });
        await wait(async () => (await snapshot(guest)).getMap('test').get('host') === 'first');
        assert.equal(guest.state().projectId, 'guest-local');
        const copy = await snapshot(guest); copy.getMap('test').set('guest', 'second');
        await guest.call('update', { data: Buffer.from(Y.encodeStateAsUpdate(copy)).toString('base64') });
        await wait(async () => (await snapshot(other)).getMap('test').get('guest') === 'second');
        // Larger than one transfer chunk; two guests can upload different originals simultaneously.
        const bytes = crypto.randomBytes(800000), bytes2 = crypto.randomBytes(600000);
        const [uploaded, uploaded2] = await Promise.all([put(guest, bytes), put(other, bytes2)]);
        assert.equal(uploaded.status, 200); assert.equal(uploaded2.status, 200);
        const { hash } = await uploaded.json(), { hash: hash2 } = await uploaded2.json();
        assert.equal(hash, crypto.createHash('sha256').update(bytes).digest('hex'));
        assert.deepEqual(Buffer.from(await (await host.request(new Request('oneyes-canvas://app/collaboration/assets/' + hash))).arrayBuffer()), bytes);
        const result = await guest.request(new Request('oneyes-canvas://app/collaboration/assets/' + hash2));
        assert.equal(result.status, 200); assert.deepEqual(Buffer.from(await result.arrayBuffer()), bytes2);
        assert.equal((await host.request(new Request('oneyes-canvas://app/collaboration/assets/../secret'))).status, 400);
        const bad = new WebSocket(`ws://${invite.host}:${invite.port}/canvas/${invite.room}`, { origin: 'https://evil.example' }); bad.on('error', () => {});
        await new Promise(resolve => bad.once('close', resolve)); assert.equal(host.state().members, 3);
        const unauthenticated = new WebSocket(`ws://${invite.host}:${invite.port}/canvas/${invite.room}`);
        unauthenticated.on('error', () => {});
        unauthenticated.once('message', () => unauthenticated.send(JSON.stringify({ nonce: 'a'.repeat(43), proof: 'wrong-secret' })));
        await new Promise(resolve => unauthenticated.once('close', resolve)); assert.equal(host.state().members, 3);
        const duplicateBytes = crypto.randomBytes(400000);
        for (const result of await Promise.all([put(guest, duplicateBytes), put(other, duplicateBytes)])) assert.equal(result.status, 200, 'same content uploads publish atomically');
        for (const socket of connections) socket.destroy();
        await wait(() => guest.state().status === 'reconnecting');
        const offline = await snapshot(guest); offline.getMap('test').set('offline', 'retained');
        await guest.call('update', { data: Buffer.from(Y.encodeStateAsUpdate(offline)).toString('base64') });
        await wait(() => guest.state().status === 'online');
        await wait(async () => (await snapshot(host)).getMap('test').get('offline') === 'retained');
        assert(events.some(value => value.status === 'reconnecting'));
        await host.close(); await wait(() => guest.state().status === 'offline' && other.state().status === 'offline');
    } finally {
        await Promise.allSettled([guest.close(), other.close(), host.close()]);
        for (const socket of connections) socket.destroy();
        if (relay) await new Promise(resolve => relay.close(resolve));
        assert.deepEqual(await readdir(directory), []); await rm(directory, { recursive: true, force: true });
    }
});

test('an initial encrypted send failure on either side reconnects without an unhandled rejection', async t => {
    for (const hostSide of [true, false]) await t.test(hostSide ? 'host' : 'guest', async t => {
        const directory = await mkdtemp(join(tmpdir(), 'canvas-lan-send-'));
        const host = createCollaboration({ directory, address: '127.0.0.1' }), guest = createCollaboration({ directory });
        const original = WebSocket.prototype.send; let failed = false;
        t.mock.method(WebSocket.prototype, 'send', function (data, options, callback) {
            const done = typeof options === 'function' ? options : callback;
            if (!failed && this._isServer === hostSide && JSON.parse(String(data)).seq && done) {
                failed = true; queueMicrotask(() => done(Error('connection closed during initial sync'))); return;
            }
            return original.call(this, data, options, callback);
        });
        try {
            const room = await host.call('host');
            const doc = new Y.Doc(); doc.getMap('test').set('retained', 'after reconnect');
            await host.call('update', { data: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64') });
            await guest.call('join', { invite: room.invite });
            await wait(() => failed && guest.state().status === 'reconnecting');
            await wait(() => guest.state().status === 'online');
            await wait(async () => (await snapshot(guest)).getMap('test').get('retained') === 'after reconnect');
        } finally { await guest.close(); await host.close(); await rm(directory, { recursive: true, force: true }); }
    });
});

test('encrypted guest recovery survives restart with the same Yjs identities, reconnects, and forgets explicit exits', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'canvas-lan-resume-'));
    const vault = createVault(directory, 'collaboration'), host = createCollaboration({ directory, address: '127.0.0.1' });
    let guest = createCollaboration({ directory, vault });
    try {
        const room = await host.call('host'), doc = new Y.Doc(); doc.getMap('test').set('original', 'kept');
        await host.call('update', { data: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64') });
        await guest.call('join', { projectId: 'replica', invite: room.invite });
        await wait(async () => (await snapshot(guest)).getMap('test').get('original') === 'kept');
        const local = await snapshot(guest); local.getMap('test').set('guest', 'before restart');
        await guest.call('update', { data: Buffer.from(Y.encodeStateAsUpdate(local)).toString('base64') });
        await guest.close();
        const encrypted = await readFile(join(directory, 'collaboration.enc'));
        assert.equal(encrypted.includes(Buffer.from(room.invite)), false, 'room credentials are encrypted at rest');
        assert.equal(encrypted.includes(Buffer.from('before restart')), false);
        guest = createCollaboration({ directory, vault: createVault(directory, 'collaboration') });
        assert.deepEqual(await guest.call('saved', { projectId: 'unrelated' }), {}, 'never reconnect an unrelated canvas');
        const saved = await guest.call('saved', { projectId: 'replica' });
        const remote = await snapshot(host); remote.getMap('test').set('host-offline', 'during restart');
        await host.call('update', { data: Buffer.from(Y.encodeStateAsUpdate(remote)).toString('base64') });
        await guest.call('join', { projectId: 'replica', ...saved });
        await wait(async () => (await snapshot(guest)).getMap('test').get('host-offline') === 'during restart');
        assert.equal((await snapshot(guest)).getMap('test').get('guest'), 'before restart');
        await guest.call('reconnect'); await wait(() => guest.state().status === 'reconnecting');
        const offline = await snapshot(guest); offline.getMap('test').set('offline', 'retained');
        await guest.call('update', { data: Buffer.from(Y.encodeStateAsUpdate(offline)).toString('base64') });
        await wait(() => guest.state().status === 'online');
        await wait(async () => (await snapshot(host)).getMap('test').get('offline') === 'retained');
        assert.equal(host.state().members, 2, 'only one guest connection remains');
        await guest.call('leave'); assert.deepEqual(await guest.call('saved', { projectId: 'replica' }), {});
        await guest.call('join', { projectId: 'replica', invite: room.invite }); await wait(() => guest.state().status === 'online');
        await host.close(); await wait(() => guest.state().status === 'offline');
        assert.deepEqual(await guest.call('saved', { projectId: 'replica' }), {}, 'host end clears automatic recovery');
    } finally { await guest.close(); await host.close(); await rm(directory, { recursive: true, force: true }); }
});

test('live operations and presence bypass a paused original transfer and disappear after leaving',async t=>{
    const directory=await mkdtemp(join(tmpdir(),'canvas-lan-live-')),hostEvents=[],guestEvents=[];
    const host=createCollaboration({directory,address:'127.0.0.1',changed:event=>hostEvents.push(event)}),guest=createCollaboration({directory,changed:event=>guestEvents.push(event)}),other=createCollaboration({directory});
    const original=WebSocket.prototype.send;let release,paused=false;
    t.mock.method(WebSocket.prototype,'send',function(data,options,callback){
        const done=typeof options==='function'?options:callback;
        if(this._isServer&&done&&String(data).length>300000&&!paused){paused=true;return original.call(this,data,error=>{release=()=>done(error);});}
        return original.call(this,data,options,callback);
    });
    try {
        const room=await host.call('host');await guest.call('join',{invite:room.invite});await other.call('join',{invite:room.invite});await wait(()=>host.state().members===3&&guest.state().status==='online'&&other.state().status==='online');
        const bytes=crypto.randomBytes(800000),uploaded=await put(host,bytes),{hash}=await uploaded.json();
        const download=guest.request(new Request('oneyes-canvas://app/collaboration/assets/'+hash));await wait(()=>!!release);
        const doc=await snapshot(guest);doc.getMap('test').set('drag','moving before media finishes');await guest.call('update',{data:Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64')});
        const presence={cursor:{x:321,y:123},selected:['node'],action:'move'};await guest.call('presence',{presence});
        await wait(async()=> (await snapshot(host)).getMap('test').get('drag')==='moving before media finishes' && (await snapshot(other)).getMap('test').get('drag')==='moving before media finishes');
        await wait(()=>hostEvents.some(event=>event.kind==='presence'&&event.peers.some(peer=>peer.cursor?.x===321&&peer.action==='move')));
        const peer=hostEvents.findLast(event=>event.kind==='presence'&&event.peers.some(peer=>peer.cursor?.x===321)).peers.find(peer=>peer.cursor?.x===321);
        assert.deepEqual(peer.selected,['node']);assert.equal(guestEvents.findLast(event=>event.kind==='presence').peers.some(item=>item.id===peer.id),false,'own cursor is not echoed');
        assert.equal((await snapshot(guest)).getMap('presence').size,0,'presence never enters persistent shared data');
        await assert.rejects(guest.call('presence',{presence:{...presence,cursor:{x:Infinity,y:0}}}),/无效/);
        release();release=undefined;const result=await download;assert.deepEqual(Buffer.from(await result.arrayBuffer()),bytes);
        await guest.close();await wait(()=>hostEvents.findLast(event=>event.kind==='presence').peers.every(item=>item.id!==peer.id));
        await host.close();await wait(()=>other.state().status==='offline');
    } finally {release?.();await Promise.allSettled([host.close(),guest.close(),other.close()]);await rm(directory,{recursive:true,force:true});}
});
