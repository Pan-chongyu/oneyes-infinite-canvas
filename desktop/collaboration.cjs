const crypto = require('node:crypto');
const os = require('node:os');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { join } = require('node:path');
const { Readable, Writable } = require('node:stream');
const { createWriteStream } = require('node:fs');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { WebSocket, WebSocketServer } = require('ws');
const Y = require('yjs');

const prefix = 'ONEYESCANVAS1.';
const hashPattern = /^[a-f0-9]{64}$/;
const random = () => crypto.randomBytes(32).toString('base64url');
const blankPresence = () => ({ cursor: null, selected: [], action: null,connection:null });
function readPresence(value) {
    if (!value || typeof value !== 'object' || (value.cursor !== null && (!value.cursor || !Number.isFinite(value.cursor.x) || !Number.isFinite(value.cursor.y))) || !Array.isArray(value.selected) || value.selected.some(id => typeof id !== 'string') || ![null,'move','resize','connect','edit'].includes(value.action)) throw Error('无效协作状态');
    if(value.connection!=null&&(typeof value.connection.nodeId!=='string'||!['source','target'].includes(value.connection.handleType)))throw Error('无效协作连线预览');
    return { cursor: value.cursor && {x:value.cursor.x,y:value.cursor.y}, selected: [...new Set(value.selected)], action: value.action,connection:value.connection?{nodeId:value.connection.nodeId,handleType:value.connection.handleType}:null };
}
function lanAddress(host) {
    if (typeof host !== 'string' || !/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
    const parts = host.split('.').map(Number);
    return parts.every(n => n >= 0 && n < 256) && (parts[0] === 10 || parts[0] === 127 || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31));
}
function parseInvite(input) {
    try {
        if (typeof input !== 'string' || !input.trim().startsWith(prefix)) throw Error();
        const value = JSON.parse(Buffer.from(input.trim().slice(prefix.length), 'base64url'));
        if (!lanAddress(value.host) || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535 || !/^[a-f0-9]{32}$/.test(value.room) || !/^[\w-]{43}$/.test(value.secret)) throw Error();
        return value;
    } catch { throw Error('邀请无效，请复制房主生成的完整邀请，且双方连接同一局域网'); }
}
const proof = (secret, value) => crypto.createHmac('sha256', Buffer.from(secret, 'base64url')).update(value).digest('base64url');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// A fresh challenge and independent directional keys bind every authenticated frame to this connection.
function channel(ws, secret, challenge, nonce, host) {
    const derive = label => Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret, 'base64url'), Buffer.from(challenge + nonce), Buffer.from(label), 32));
    const outgoing = derive(host ? 'host-to-guest' : 'guest-to-host'), incoming = derive(host ? 'guest-to-host' : 'host-to-guest');
    let sent = 0, received = 0;
    return {
        send(value) {
            const seq = ++sent, iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', outgoing, iv);
            cipher.setAAD(Buffer.from(String(seq)));
            const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
            return new Promise((resolve, reject) => ws.send(JSON.stringify({ seq, iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data: data.toString('base64url') }), error => error ? reject(error) : resolve()));
        },
        read(raw) {
            const frame = JSON.parse(String(raw));
            if (!Number.isSafeInteger(frame.seq) || frame.seq !== received + 1) throw Error('协作帧顺序无效');
            const decipher = crypto.createDecipheriv('aes-256-gcm', incoming, Buffer.from(frame.iv, 'base64url'));
            decipher.setAAD(Buffer.from(String(frame.seq))); decipher.setAuthTag(Buffer.from(frame.tag, 'base64url'));
            const value = JSON.parse(Buffer.concat([decipher.update(Buffer.from(frame.data, 'base64url')), decipher.final()]));
            received = frame.seq; return value;
        },
    };
}

function createCollaboration({ directory = os.tmpdir(), changed = () => {}, address, vault } = {}) {
    let room, server, socket, cache, reconnectTimer, status = 'offline', epoch = 0;
    let doc = new Y.Doc();
    const peers = new Set(), pending = new Map(), incoming = new Map(), available = new Set();
    let closing, saving, saveDirty = false;
    const state = () => ({ status, role: room?.role, roomId: room?.room, projectId: room?.projectId, invite: room?.invite, invitations: room?.invitations, members: room?.role === 'host' ? peers.size + 1 : status === 'online' ? room?.members || 2 : 0 });
    const emit = () => changed({ kind: 'state', ...state() });
    const saveResume = () => {
        if (!vault || room?.role !== 'guest' || !room.projectId) return;
        saveDirty = true;
        if (saving) return;
        const active = room;
        saving = Promise.resolve().then(async () => {
            while (saveDirty && room === active) {
                saveDirty = false;
                await vault.write(JSON.stringify({ projectId: active.projectId, invite: active.invite, data: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64') }));
            }
        }).finally(() => { saving = undefined; });
        void saving.catch(() => changed({ kind: 'error', message: '协作恢复记录未能保存，请检查本机磁盘后重试；当前画布仍保留本机。' }));
    };
    const send = (peer, value) => peer?.secure && peer.readyState === WebSocket.OPEN ? peer.secure.send(value) : Promise.reject(Error('协作连接已断开，恢复后继续同步'));
    const broadcast = (value, except) => Promise.allSettled([...peers].filter(peer => peer !== except).map(peer => send(peer, value).catch(() => peer.terminate())));
    const publishPresence = () => {
        if (room?.role !== 'host') return;
        const list = [{id:room.peerId,name:'房主',...room.presence},...[...peers].map(peer=>({id:peer.peerId,name:`协作者 ${peer.peerId.slice(0,4)}`,...peer.presence}))];
        changed({kind:'presence',peers:list.filter(peer=>peer.id!==room.peerId)});
        void broadcast({type:'presence',peers:list});
    };
    const filePath = hash => { if (!hashPattern.test(hash) || !cache) throw Error('无效素材标识'); return join(cache, hash); };
    const digest = async path => { const hash = crypto.createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex'); };
    const publishAsset = async (temp, hash) => {
        const target = filePath(hash);
        try { await fs.link(temp, target); }
        catch (error) { if (error.code !== 'EEXIST' || await digest(target) !== hash) throw error; }
        await fs.rm(temp, { force: true }); available.add(hash);
    };
    const failPending = () => { for (const entry of pending.values()) entry.reject(Error('协作连接已断开，恢复后继续同步')); pending.clear(); };
    const ensure = async () => { if (!cache) { await fs.mkdir(directory, { recursive: true }); cache = await fs.mkdtemp(join(directory, 'canvas-lan-')); } };
    const sendAsset = (peer, hash) => {
        if (!peer) return Promise.reject(Error('协作连接已断开'));
        const operation = (peer.assets || Promise.resolve()).then(async () => {
        if (!available.has(hash)) { await send(peer, { type: 'asset-missing', hash }); return; }
        const path = filePath(hash), info = await fs.stat(path);
        await send(peer, { type: 'asset-start', hash, size: info.size });
        for await (const chunk of createReadStream(path, { highWaterMark: 256 * 1024 })) await send(peer, { type: 'asset-chunk', hash, data: chunk.toString('base64') });
        await send(peer, { type: 'asset-end', hash });
        });
        peer.assets = operation.catch(() => {}); return operation;
    };
    const receive = async (peer, value) => {
        if (!value || typeof value !== 'object') throw Error('无效协作消息');
        if (value.type === 'update') {
            const update = Buffer.from(value.data, 'base64');
            Y.applyUpdate(doc, update, peer);
            saveResume();
            changed({ kind: 'update', data: update.toString('base64') });
        } else if (value.type === 'presence') {
            if (room?.role === 'host') { peer.presence = readPresence(value.presence); publishPresence(); }
            else {
                if (!Array.isArray(value.peers)) throw Error('无效协作者列表');
                const list=value.peers.map(item=>{if(typeof item.id!=='string'||typeof item.name!=='string')throw Error('无效协作者');return {id:item.id,name:item.name,...readPresence(item)};});
                changed({kind:'presence',peers:list.filter(item=>item.id!==room?.peerId)});
            }
        } else if (value.type === 'members') {
            if(room?.role!=='guest'||!Number.isSafeInteger(value.count)||value.count<1)throw Error('无效协作成员数量');
            room.members=value.count;emit();
        }
        else if (value.type === 'end') { if (room?.role !== 'guest') throw Error('只有房主可以结束协作'); await close({ forget: true }); changed({ kind: 'ended' }); return; }
        else if (value.type === 'asset-get') await sendAsset(peer, value.hash);
        else if (value.type === 'asset-start') {
            if (!hashPattern.test(value.hash) || !Number.isSafeInteger(value.size) || value.size < 0) throw Error('无效素材清单');
            const previous = incoming.get(peer); if (previous) { await previous.handle.close(); await fs.rm(previous.path, { force: true }); }
            const path = filePath(value.hash) + '.' + crypto.randomBytes(8).toString('hex') + '.part';
            incoming.set(peer, { hash: value.hash, size: value.size, written: 0, path, handle: await fs.open(path, 'wx', 0o600) });
        } else if (value.type === 'asset-chunk') {
            const entry = incoming.get(peer); if (!entry || entry.hash !== value.hash) throw Error('素材传输顺序无效');
            const chunk = Buffer.from(value.data, 'base64'); entry.written += chunk.length;
            if (entry.written > entry.size) throw Error('素材长度无效');
            await entry.handle.writeFile(chunk);
        } else if (value.type === 'asset-end') {
            const entry = incoming.get(peer); if (!entry || entry.hash !== value.hash) throw Error('素材传输未开始');
            await entry.handle.close(); incoming.delete(peer);
            if (entry.written !== entry.size || await digest(entry.path) !== entry.hash) { await fs.rm(entry.path, { force: true }); throw Error('素材校验失败，请重新同步'); }
            await publishAsset(entry.path, entry.hash);
            const waiter = pending.get(entry.hash); pending.delete(entry.hash); waiter?.resolve();
            if (room?.role === 'host') await send(peer, { type: 'asset-ack', hash: entry.hash });
        } else if (value.type === 'asset-ack') { const waiter = pending.get(value.hash); pending.delete(value.hash); waiter?.resolve(); }
        else if (value.type === 'asset-missing') { const waiter = pending.get(value.hash); pending.delete(value.hash); waiter?.reject(Error('房间暂缺原始素材，请让素材所在设备保持连接后重试同步')); }
        else throw Error('不支持的协作消息');
        if (room?.role === 'host' && value.type === 'update') void broadcast(value, peer);
    };
    const attach = peer => {
        // Authenticate in wire order; only file writes wait for earlier file work.
        const current = epoch;
        peer.queue = Promise.resolve();
        peer.on('message', raw => {
            let value; try { value = peer.secure.read(raw); } catch { peer.close(); return; }
            if (current !== epoch) return;
            if (!value || typeof value !== 'object') { peer.close(); return; }
            if (['update','presence','members','end'].includes(value.type) || value.type === 'asset-get') void receive(peer,value).catch(()=>peer.close());
            else peer.queue = peer.queue.then(() => current === epoch ? receive(peer, value) : undefined).catch(() => { peer.close(); });
        });
    };
    const hostPeer = peer => {
        const challenge = random(), current = epoch;
        peer.on('error', () => undefined);
        peer.send(JSON.stringify({ type: 'challenge', challenge, room: room.room }));
        peer.once('message', raw => {
            try {
                const auth = JSON.parse(String(raw));
                if (current !== epoch || !/^[\w-]{43}$/.test(auth.nonce) || !same(auth.proof, proof(room.secret, `guest:${challenge}:${auth.nonce}:${room.room}`))) throw Error();
                peer.secure = channel(peer, room.secret, challenge, auth.nonce, true);
                peer.peerId = crypto.randomBytes(8).toString('hex'); peer.presence = blankPresence();
                peer.send(JSON.stringify({ type: 'authenticated', peerId:peer.peerId, proof: proof(room.secret, `host:${challenge}:${auth.nonce}:${room.room}:${peer.peerId}`) }));
                peers.add(peer); attach(peer); emit();
                void send(peer, { type: 'update', data: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64') }).catch(() => peer.terminate());
                void send(peer, { type: 'members', count: peers.size + 1 }).catch(() => peer.terminate());
                void broadcast({ type: 'members', count: peers.size + 1 }, peer);
                publishPresence();
            } catch { peer.close(); }
        });
        peer.on('close', () => {
            peers.delete(peer); const entry = incoming.get(peer); incoming.delete(peer);
            if (entry) void entry.handle.close().then(() => fs.rm(entry.path, { force: true })).catch(() => {});
            if (current === epoch && room?.role === 'host') { emit(); void broadcast({ type: 'members', count: peers.size + 1 }); publishPresence(); }
        });
    };
    const connect = current => {
        if (current !== epoch || !room || room.role !== 'guest') return;
        clearTimeout(reconnectTimer); reconnectTimer = undefined;
        const peer = socket = new WebSocket(`ws://${room.host}:${room.port}/canvas/${room.room}`, { perMessageDeflate: false, maxPayload: 0 });
        peer.on('error', () => undefined);
        let challenge, nonce;
        const handshake = raw => {
            try {
                if (current !== epoch || socket !== peer || !room) return;
                const value = JSON.parse(String(raw));
                if (value.type === 'challenge' && !challenge) {
                    if (value.room !== room.room || !/^[\w-]{43}$/.test(value.challenge)) throw Error();
                    challenge = value.challenge; nonce = random();
                    peer.send(JSON.stringify({ nonce, proof: proof(room.secret, `guest:${challenge}:${nonce}:${room.room}`) }));
                } else if (value.type === 'authenticated' && challenge && same(value.proof, proof(room.secret, `host:${challenge}:${nonce}:${room.room}:${value.peerId}`))) {
                    if (!/^[a-f0-9]{16}$/.test(value.peerId)) throw Error();
                    room.peerId = value.peerId;
                    peer.removeListener('message', handshake); peer.secure = channel(peer, room.secret, challenge, nonce, false); attach(peer);
                    status = 'online'; emit();
                    void send(peer, { type: 'update', data: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64') }).catch(() => peer.terminate());
                    void send(peer, { type:'presence',presence:room.presence }).catch(()=>peer.terminate());
                } else throw Error();
            } catch { peer.close(); }
        };
        peer.on('message', handshake);
        peer.on('close', () => {
            if (current !== epoch || socket !== peer) return;
            socket = undefined;
            failPending(); const entry = incoming.get(peer); incoming.delete(peer);
            if (entry) void entry.handle.close().then(() => fs.rm(entry.path, { force: true })).catch(() => {});
            room.presence = blankPresence(); changed({kind:'presence',peers:[]});
            status = 'reconnecting'; emit(); reconnectTimer = setTimeout(() => connect(current), 3000);
        });
    };
    async function close({ forget = false } = {}) {
        if (closing) return closing;
        closing = (async () => {
        epoch++; clearTimeout(reconnectTimer); failPending();
        if (room?.role === 'host') await broadcast({ type: 'end' });
        socket?.terminate(); socket = undefined;
        if (server) { for (const peer of server.clients) peer.terminate(); await new Promise(resolve => server.close(resolve)); server = undefined; }
        await Promise.allSettled([...incoming.values()].map(entry => entry.handle.close())); incoming.clear(); peers.clear();
        if (cache) await fs.rm(cache, { recursive: true, force: true }); cache = undefined; available.clear();
        await saving;
        if (forget) await vault?.remove();
        doc.destroy(); doc = new Y.Doc(); room = undefined; status = 'offline'; changed({kind:'presence',peers:[]}); emit();
        })();
        try { await closing; } finally { closing = undefined; }
    }
    return {
        state,
        async call(operation, args = {}) {
            if (operation === 'state') return state();
            if (operation === 'leave') { await close({ forget: true }); return state(); }
            if (operation === 'saved') {
                await saving;
                try {
                    const text = await vault?.read(); if (!text) return {};
                    const saved = JSON.parse(text);
                    if (typeof saved.projectId !== 'string' || typeof saved.data !== 'string') throw Error();
                    parseInvite(saved.invite);
                    return saved.projectId === args.projectId ? { invite: saved.invite, data: saved.data } : {};
                } catch { throw Error('协作恢复记录无法读取，已保留原文件和本地画布；可重新粘贴房主邀请加入。'); }
            }
            if (operation === 'reconnect') {
                if (!closing && room?.role === 'guest') {
                    if (socket) socket.terminate();
                    else { clearTimeout(reconnectTimer); connect(epoch); }
                }
                return state();
            }
            if (operation === 'host') {
                await close({ forget: true }); await ensure();
                const hosts = [...new Set(Object.values(os.networkInterfaces()).flat().filter(item => item?.family === 'IPv4' && !item.internal && lanAddress(item.address)).map(item => item.address))];
                if (address) hosts.unshift(address);
                if (!hosts.length) throw Error('未找到局域网地址，请连接 Wi-Fi 或网线后重试');
                room = { role: 'host', projectId: args.projectId, room: crypto.randomBytes(16).toString('hex'), secret: random(), host: hosts[0], port: 0, peerId:crypto.randomBytes(8).toString('hex'),presence:blankPresence() };
                server = new WebSocketServer({ host: '0.0.0.0', port: 0, perMessageDeflate: false, maxPayload: 0, verifyClient: info => !info.origin && info.req.url === `/canvas/${room?.room}` });
                await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
                room.port = server.address().port;
                room.invitations = hosts.map(host => ({ address: host, invite: prefix + Buffer.from(JSON.stringify({ host, port: room.port, room: room.room, secret: room.secret })).toString('base64url') }));
                room.invite = room.invitations[0].invite;
                server.on('connection', hostPeer); status = 'online'; emit(); return state();
            }
            if (operation === 'join') {
                const invite = parseInvite(args.invite), restored = new Y.Doc();
                try { if (args.data) Y.applyUpdate(restored, Buffer.from(args.data, 'base64')); }
                catch { restored.destroy(); throw Error('协作恢复数据无效，原画布已保留'); }
                await close(); await ensure(); doc.destroy(); doc = restored;
                room = { ...invite, invite: args.invite, role: 'guest', projectId: args.projectId,presence:blankPresence() };
                status = 'reconnecting'; saveResume(); emit(); connect(epoch); return state();
            }
            if (operation === 'presence') {
                if (!room) throw Error('协作房间已关闭');
                room.presence = readPresence(args.presence);
                if (room.role === 'host') publishPresence();
                else if (status === 'online') { const peer=socket; void send(peer,{type:'presence',presence:room.presence}).catch(()=>peer?.terminate()); }
                return state();
            }
            if (operation === 'update') {
                if (!room) throw Error('协作房间已关闭');
                const data = Buffer.from(args.data, 'base64'); Y.applyUpdate(doc, data, 'local');
                saveResume();
                if (room.role === 'host') void broadcast({ type: 'update', data: data.toString('base64') });
                else if (status === 'online') { const peer=socket; void send(peer, { type: 'update', data: data.toString('base64') }).catch(()=>peer?.terminate()); }
                return state();
            }
            if (operation === 'snapshot') return { data: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64') };
            throw Error('不支持的协作操作');
        },
        async request(request) {
            if (!room) return new Response('协作房间已关闭', { status: 409 });
            const pathname = new URL(request.url).pathname, hash = pathname.split('/').at(-1);
            if (request.method === 'POST' && pathname.endsWith('/hash')) {
                const digest = crypto.createHash('sha256'); let bytes = 0;
                if (request.body) await pipeline(Readable.fromWeb(request.body), new Transform({ transform(chunk, _encoding, done) { digest.update(chunk); bytes += chunk.length; done(null, chunk); } }), new Writable({ write(_chunk, _encoding, done) { done(); } }));
                const result = digest.digest('hex'); return Response.json({ hash: result, bytes });
            }
            if (request.method === 'PUT' && hash === 'new') {
                await ensure(); const temp = join(cache, crypto.randomBytes(16).toString('hex') + '.part'), digest = crypto.createHash('sha256');
                const current = epoch;
                try {
                    if (request.body) await pipeline(Readable.fromWeb(request.body), new Transform({ transform(chunk, _encoding, done) { digest.update(chunk); done(null, chunk); } }), createWriteStream(temp, { flags: 'wx', mode: 0o600 }));
                    else { await fs.writeFile(temp, Buffer.alloc(0), { flag: 'wx', mode: 0o600 }); digest.update(Buffer.alloc(0)); }
                    const hash = digest.digest('hex'), stat = await fs.stat(temp);
                    if (current !== epoch || !room) throw Error('协作房间已关闭');
                    await publishAsset(temp, hash);
                    if (room.role === 'guest') {
                        const acknowledged = new Promise((resolve, reject) => pending.set(hash, { resolve, reject }));
                        acknowledged.catch(() => {});
                        try { await sendAsset(socket, hash); await acknowledged; } catch (error) { pending.get(hash)?.reject(error); pending.delete(hash); await acknowledged.catch(() => {}); throw error; }
                    }
                    return Response.json({ hash, bytes: stat.size, mime: request.headers.get('content-type') || 'application/octet-stream' });
                } catch (error) { await fs.rm(temp, { force: true }); return new Response(error.message, { status: 409 }); }
            }
            if (!hashPattern.test(hash)) return new Response(null, { status: 400 });
            if (request.method === 'PUT') {
                await ensure(); const path = filePath(hash), temp = path + '.' + crypto.randomBytes(8).toString('hex') + '.part';
                const handle = await fs.open(temp, 'wx', 0o600);
                try {
                    if (request.body) await pipeline(Readable.fromWeb(request.body), handle.createWriteStream()); else await handle.close();
                    if (await digest(temp) !== hash) throw Error('素材内容校验失败');
                    await publishAsset(temp, hash);
                    if (room.role === 'guest') {
                        const acknowledged = new Promise((resolve, reject) => pending.set(hash, { resolve, reject }));
                        acknowledged.catch(() => {});
                        try { await sendAsset(socket, hash); await acknowledged; } catch (error) { pending.get(hash)?.reject(error); pending.delete(hash); await acknowledged.catch(() => {}); throw error; }
                    }
                    return new Response(null, { status: 204 });
                } catch (error) { await handle.close().catch(() => {}); await fs.rm(temp, { force: true }); return new Response(error.message, { status: 409 }); }
            }
            if (request.method === 'HEAD') return new Response(null, { status: available.has(hash) ? 200 : 404 });
            if (request.method === 'GET') {
                if (!available.has(hash)) {
                    if (room.role !== 'guest' || status !== 'online') return new Response(null, { status: 404 });
                    if (!pending.has(hash)) {
                        let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
                        pending.set(hash, { resolve, reject, promise });
                        void send(socket, { type: 'asset-get', hash }).catch(reject);
                    }
                    try { await pending.get(hash).promise; } catch { return new Response(null, { status: 409 }); }
                }
                return new Response(Readable.toWeb(createReadStream(filePath(hash))), { headers: { 'content-type': 'application/octet-stream' } });
            }
            return new Response(null, { status: 405 });
        },
        close,
    };
}
module.exports = { createCollaboration, parseInvite, lanAddress };
