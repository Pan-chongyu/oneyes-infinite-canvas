import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createTransport, parseProxy } from '../canvas-proxy/transport.js';
import { createProxyServer } from '../canvas-proxy/index.js';
const { createNetwork } = createRequire(import.meta.url)('../desktop/network.cjs');
// Local, publicly committed test credentials/certificate, never production secrets.
const username = 'proxy-user', password = 'p@ss:/#%word';
const auth = 'Basic ' + Buffer.from(username + ':' + password).toString('base64');
const cert = await readFile(new URL('./fixtures/proxy-cert.pem', import.meta.url), 'utf8');
const key = await readFile(new URL('./fixtures/proxy-key.pem', import.meta.url), 'utf8');
tls.setDefaultCACertificates([...tls.getCACertificates('default'), cert]);

async function listen(t, server) {
    const sockets = new Set();
    server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); socket.on('error', () => {}); });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
    return server.address().port;
}

function origin() {
    return async (req, res) => {
        if (req.url === '/stream') { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: first\n\n'); return; }
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ url: req.url, method: req.method, body: Buffer.concat(chunks).toString('base64'), headers: req.headers }));
    };
}

function httpProxy(secure = false) {
    const seen = [];
    const authenticated = (req, output, tunnel = false) => {
        seen.push({ method: req.method, url: req.url });
        if (req.headers['proxy-authorization'] === auth) return true;
        if (tunnel) output.end('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n');
        else { output.writeHead(407); output.end(); }
        return false;
    };
    const handle = (req, res) => {
        if (!authenticated(req, res)) return;
        const headers = { ...req.headers }; delete headers['proxy-authorization'];
        const forward = http.request(req.url, { method: req.method, headers }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
        forward.on('error', () => res.destroy()); res.on('close', () => forward.destroy()); req.pipe(forward);
    };
    const server = secure ? https.createServer({ key, cert }, handle) : http.createServer(handle);
    server.on('connect', (req, socket, head) => {
        if (!authenticated(req, socket, true)) return;
        const target = new URL('http://' + req.url);
        const upstream = net.connect({ host: target.hostname, port: Number(target.port) }, () => {
            socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head);
            socket.pipe(upstream); upstream.pipe(socket);
        });
        upstream.on('error', () => socket.destroy()); socket.on('close', () => upstream.destroy());
    });
    return { server, seen };
}

function socksProxy() {
    const seen = [];
    const server = net.createServer(socket => {
        let data = Buffer.alloc(0), stage = 'greeting';
        function consume(count) { const value = data.subarray(0, count); data = data.subarray(count); return value; }
        function connect(host, port, reply) {
            seen.push({ host, port }); stage = 'connecting'; socket.pause(); socket.off('data', receive);
            const upstream = net.connect({ host: ['remote.invalid', 'localhost', '::1'].includes(host) ? '127.0.0.1' : host, port }, () => {
                socket.write(reply); if (data.length) upstream.write(data);
                socket.pipe(upstream); upstream.pipe(socket); socket.resume();
            });
            upstream.on('error', () => socket.destroy()); socket.on('close', () => upstream.destroy());
        }
        function receive(chunk) {
            data = Buffer.concat([data, chunk]);
            if (stage === 'greeting' && data.length >= 2) {
                if (data[0] === 4) stage = 'v4';
                else {
                    if (data.length < 2 + data[1]) return;
                    consume(2 + data[1]); socket.write(Buffer.from([5, 2])); stage = 'auth';
                }
            }
            if (stage === 'auth' && data.length >= 2) {
                const ulen = data[1]; if (data.length < 3 + ulen) return;
                const plen = data[2 + ulen]; if (data.length < 3 + ulen + plen) return;
                const ok = data.subarray(2, 2 + ulen).toString() === username && data.subarray(3 + ulen, 3 + ulen + plen).toString() === password;
                consume(3 + ulen + plen); socket.write(Buffer.from([1, ok ? 0 : 1])); if (!ok) { socket.end(); return; } stage = 'connect';
            }
            if (stage === 'connect' && data.length >= 5) {
                const type = data[3], length = type === 1 ? 4 : type === 4 ? 16 : data[4];
                const start = type === 3 ? 5 : 4; if (data.length < start + length + 2) return;
                const address = data.subarray(start, start + length);
                const host = type === 3 ? address.toString() : type === 1 ? [...address].join('.') : '::1';
                const port = data.readUInt16BE(start + length); consume(start + length + 2);
                connect(host, port, Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
            }
            if (stage === 'v4' && data.length >= 9) {
                const userEnd = data.indexOf(0, 8); if (userEnd < 0) return;
                const domain = data[4] === 0 && data[5] === 0 && data[6] === 0 && data[7] !== 0;
                const hostEnd = domain ? data.indexOf(0, userEnd + 1) : userEnd; if (hostEnd < 0) return;
                const host = domain ? data.subarray(userEnd + 1, hostEnd).toString() : [...data.subarray(4, 8)].join('.');
                const port = data.readUInt16BE(2); consume(hostEnd + 1);
                connect(host, port, Buffer.from([0, 90, 0, 0, 0, 0, 0, 0]));
            }
        }
        socket.on('data', receive);
    });
    return { server, seen };
}

test('proxy URL validation and special credentials', () => {
    assert.equal(parseProxy('127.0.0.1:8080').protocol, 'http:');
    assert.equal(parseProxy('socks://localhost:1080').protocol, 'socks5h:');
    const url = parseProxy({ url: 'socks5://localhost:1080', username, password });
    assert.equal(decodeURIComponent(url.password), password);
    for (const value of ['', 'file:///etc/passwd', 'ftp://localhost', 'http://localhost:99999', 'http://localhost/path', 'http://localhost/?token=secret', 'socks5://user:%QQ@localhost:1080']) assert.throws(() => parseProxy(value));
});

test('authenticated HTTP and HTTPS proxies forward HTTP bodies and HTTPS CONNECT', { timeout: 15000 }, async t => {
    const plain = await listen(t, http.createServer(origin()));
    const encrypted = await listen(t, https.createServer({ key, cert }, origin()));
    for (const secure of [false, true]) {
        const proxy = httpProxy(secure), port = await listen(t, proxy.server);
        const transport = createTransport({ url: `${secure ? 'https' : 'http'}://127.0.0.1:${port}`, username, password }); t.after(() => transport.close());
        for (const target of [`http://127.0.0.1:${plain}`, `https://127.0.0.1:${encrypted}`]) {
            const body = Buffer.from([0, 1, 255, 128]);
            const response = await transport.fetch(target + '/echo?signature=a%2Fb%2Bc%3D&x=1&x=2', { method: 'POST', headers: { authorization: 'Bearer test-only-key' }, body });
            assert.equal(response.status, 200); const value = await response.json();
            assert.equal(value.body, body.toString('base64')); assert.equal(value.method, 'POST');
            assert.equal(value.url, '/echo?signature=a%2Fb%2Bc%3D&x=1&x=2');
            assert.equal(value.headers.authorization, 'Bearer test-only-key'); assert.equal(value.headers['proxy-authorization'], undefined);
        }
        assert.ok(proxy.seen.some(item => item.method === 'CONNECT'));
    }
});

test('SOCKS5 authentication, remote DNS, SOCKS4/4a and HTTPS tunnels', { timeout: 15000 }, async t => {
    const plain = await listen(t, http.createServer(origin())), encrypted = await listen(t, https.createServer({ key, cert }, origin()));
    const proxy = socksProxy(), port = await listen(t, proxy.server);
    for (const protocol of ['socks5', 'socks5h', 'socks', 'socks4', 'socks4a']) {
        const transport = createTransport({ url: `${protocol}://127.0.0.1:${port}`, username, password }); t.after(() => transport.close());
        for (const target of [`http://127.0.0.1:${plain}`, `https://127.0.0.1:${encrypted}`]) {
            const response = await transport.fetch(target + '/echo'); assert.equal(response.status, 200); await response.json();
        }
        if (['socks5h', 'socks', 'socks4a'].includes(protocol)) {
            const response = await transport.fetch(`http://remote.invalid:${plain}/echo`); await response.json();
            assert.equal(proxy.seen.at(-1).host, 'remote.invalid');
        }
    }
});

test('forwarding service preserves uploads, signed query bytes and redacts logs', { timeout: 10000 }, async t => {
    const target = await listen(t, http.createServer(origin())), proxy = socksProxy(), proxyPort = await listen(t, proxy.server);
    const logs = [], port = await listen(t, createProxyServer({ proxy: `socks5h://${encodeURIComponent(username)}:${encodeURIComponent(password)}@127.0.0.1:${proxyPort}`, logger: line => logs.push(line) }));
    const response = await fetch(`http://127.0.0.1:${port}/http://127.0.0.1:${target}/echo?signature=private%2Fvalue`, { method: 'POST', headers: { authorization: 'Bearer test-key', 'proxy-authorization': 'secret' }, body: 'payload' });
    const value = await response.json(); assert.equal(value.url, '/echo?signature=private%2Fvalue'); assert.equal(Buffer.from(value.body, 'base64').toString(), 'payload');
    assert.equal(value.headers['proxy-authorization'], undefined); assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.ok(logs.length); assert.doesNotMatch(logs.join('\n'), /private|test-key|proxy-user|p@ss|secret/);
});

test('native DAV methods and Basic auth survive saved HTTP/SOCKS proxy transport', async t => {
    const { requestWebdav } = createRequire(import.meta.url)('../desktop/webdav.cjs');
    const originPort = await listen(t, http.createServer(origin()));
    for (const [scheme, proxy] of [['http', httpProxy()], ['socks5h', socksProxy()]]) {
        const proxyPort = await listen(t, proxy.server);
        const network = await createNetwork(() => { throw Error('must not bypass proxy'); }); t.after(() => network.close());
        network.configure({ proxyEnabled: true, proxyMode: 'upstream', upstreamProxyUrl: `${scheme}://127.0.0.1:${proxyPort}`, upstreamProxyUsername: username, upstreamProxyPassword: password });
        for (const method of ['MKCOL', 'PROPFIND', 'PUT', 'GET']) {
            const request = new Request('https://app.test', { method, headers: { Authorization: 'Basic dav-account-only', Depth: '0', 'If-Match': '"version-1"' }, ...(method === 'PUT' ? { body: new Uint8Array([0, 1, 255, 128]) } : method === 'PROPFIND' ? {body:'<d:propfind xmlns:d="DAV:"/>'} : {}) });
            const result = await (await requestWebdav(request, `http://127.0.0.1:${originPort}/dav/%E7%94%BB%E5%B8%83/`, network.fetch)).json();
            assert.equal(result.method, method); assert.equal(result.headers.authorization, 'Basic dav-account-only'); assert.equal(result.headers.depth, '0'); assert.equal(result.headers['if-match'], '"version-1"');
            assert.equal(result.headers['proxy-authorization'], undefined);
            if (method === 'PUT') assert.equal(result.body, Buffer.from([0, 1, 255, 128]).toString('base64'));
            if (method === 'PROPFIND') assert.equal(result.body, Buffer.from('<d:propfind xmlns:d="DAV:"/>').toString('base64'));
        }
    }
});

test('desktop streams immediately, cancels upstream and switches proxy without breaking active streams', { timeout: 10000 }, async t => {
    let closed; const cancelled = new Promise(resolve => { closed = resolve; });
    const server = http.createServer((req, res) => { if (req.url === '/stream') req.once('close', closed); void origin()(req, res); });
    const target = await listen(t, server), proxy = socksProxy(), port = await listen(t, proxy.server);
    let direct = 0; const network = await createNetwork(async () => { direct++; return new Response('direct'); }); t.after(() => network.close());
    const config = { proxyMode: 'upstream', proxyEnabled: true, upstreamProxyUrl: `socks5h://127.0.0.1:${port}`, upstreamProxyUsername: username, upstreamProxyPassword: password };
    network.configure(config);
    const response = await network.fetch(`http://127.0.0.1:${target}/stream`), reader = response.body.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /data: first/);
    network.configure({ ...config, proxyEnabled: false }); assert.equal(await (await network.fetch('https://unused.test/')).text(), 'direct');
    await assert.rejects(network.fetch(`http://127.0.0.1:${target}/echo`, {}, true), /代理配置尚未生效/); assert.equal(direct, 1);
    await reader.cancel(); await cancelled;
    network.configure({ ...config, upstreamProxyUrl: 'file:///invalid' });
    await assert.rejects(network.fetch(`http://127.0.0.1:${target}/echo`), /代理地址无效/); assert.equal(direct, 1);
    network.configure({ ...config, upstreamProxyPassword: 'wrong' });
    await assert.rejects(network.fetch(`http://127.0.0.1:${target}/echo`), /代理认证失败/); assert.equal(direct, 1);
});

test('forwarder cancellation aborts streaming and requests waiting for headers', { timeout: 10000 }, async t => {
    for (const stream of [false, true]) {
        let closed, arrived; const cancelled = new Promise(resolve => { closed = resolve; }), started = new Promise(resolve => { arrived = resolve; });
        const target = await listen(t, http.createServer((req, res) => { req.once('close', closed); arrived(); if (stream) { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: first\n\n'); } }));
        const proxy = httpProxy(), proxyPort = await listen(t, proxy.server);
        const port = await listen(t, createProxyServer({ proxy: { url: `http://127.0.0.1:${proxyPort}`, username, password }, logger: () => {} }));
        const controller = new AbortController();
        const pending = fetch(`http://127.0.0.1:${port}/http://127.0.0.1:${target}/stream`, { signal: controller.signal });
        const rejection = pending.catch(error => error);
        await started;
        if (stream) { const response = await pending; const reader = response.body.getReader(); assert.match(new TextDecoder().decode((await reader.read()).value), /first/); await reader.cancel(); }
        else { controller.abort(); assert.equal((await rejection).name, 'AbortError'); }
        await cancelled;
    }
});
