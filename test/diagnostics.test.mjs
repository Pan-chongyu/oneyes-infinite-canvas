import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
const require = createRequire(import.meta.url);
const { createVault } = require('../desktop/vault.cjs');
const { createDiagnostics } = require('../desktop/diagnostics.cjs');
const { normalize } = require('../desktop/diagnostic-format.cjs');
const metadata = { version: '0.20.63', platform: 'macos', arch: 'arm64', os_release: '24.6.0', electron: '44.9.1' };
test('redaction keeps technical classification and source locations without credentials or user content', () => {
    const value = normalize({ component: 'image', stage: 'submit', error: { name: 'TypeError', message: 'Invalid image data; prompt: private content sk-SECRET', code: 'Bearer SECRET', stack: 'Error: secret\n at method (/Users/private-name/app/desktop/main.cjs:2:4)\n at https://file.test/secret.png?token=PRIVATE\n at index-abc.js:1:2' }, prompt: 'PRIVATE', apiKey: 'SECRET' });
    assert.equal(value.reason, 'invalid-image'); assert.equal(value.error_type, 'TypeError');
    assert.deepEqual(value.stack, ['main.cjs:2:4', 'index-abc.js:1:2']);
    assert.doesNotMatch(JSON.stringify(value), /SECRET|PRIVATE|private-name|prompt|file.test|secret/);
});
test('encrypted offline queue survives restart, authenticates and deduplicates without replaying business requests', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'canvas-diagnostics-'));
    const received = []; let registered = false, online = false, identity;
    const server = createServer(async (req, res) => {
        let raw = ''; for await (const chunk of req) raw += chunk;
        received.push({ path: req.url, data: JSON.parse(raw), token: req.headers.authorization });
        if (req.url.endsWith('/register')) { registered = true; identity = req.headers.authorization; }
        res.writeHead(registered ? 200 : 401); res.end('{}');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const fetcher = (url, init) => { if (!online) throw Error('offline'); assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit'); return fetch('http://127.0.0.1:' + server.address().port + new URL(url).pathname, init); };
    let client;
    try {
        client = await createDiagnostics({ vault: createVault(dir, 'diagnostics'), fetcher, metadata });
        const input = { component: 'image', stage: 'poll', error: new TypeError('fetch failed APIKey=PRIVATE prompt=PRIVATE') };
        await client.report(input); await client.report(input); await client.flush(); await client.close();
        assert.doesNotMatch(await readFile(join(dir, 'diagnostics.enc'), 'utf8'), /PRIVATE|TypeError/);
        const pending = JSON.parse(await createVault(dir, 'diagnostics').read());
        assert.equal(pending.pending.length, 1); assert.equal(pending.pending[0].count, 2);
        online = true;
        client = await createDiagnostics({ vault: createVault(dir, 'diagnostics'), fetcher, metadata });
        await client.flush();
        assert.equal(received.length, 3);
        assert.equal(received[0].path, '/api/canvas/errors'); assert.equal(received[1].path, '/api/canvas/register');
        assert.equal(received[0].token, identity); assert.equal(received[2].token, identity);
        assert.equal(received[2].data.events[0].count, 2);
        assert.doesNotMatch(JSON.stringify(received), /PRIVATE|prompt|APIKey/);
        assert.equal(JSON.parse(await createVault(dir, 'diagnostics').read()).pending.length, 0);
        await client.report({ component: 'app', stage: 'request', error: new DOMException('cancelled', 'AbortError') });
        assert.equal(JSON.parse(await createVault(dir, 'diagnostics').read()).pending.length, 0);
    } finally { await client?.close(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});
test('disabled diagnostics do not read storage or contact production', async () => {
    const client = await createDiagnostics({ enabled: false, vault: { read() { throw Error('unexpected'); } }, fetcher() { throw Error('unexpected'); } });
    await client.report({ error: new Error('test') }); await client.flush(); await client.close();
});
test('an acknowledgement cannot remove a later occurrence; failed uploads retain data', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'canvas-diagnostics-race-'));
    let release, entered, responseStatus = 200;
    const started = new Promise(resolve => { entered = resolve; });
    const wait = new Promise(resolve => { release = resolve; });
    const vault = createVault(dir, 'diagnostics');
    const client = await createDiagnostics({ vault, metadata, fetcher: async () => { entered(); await wait; return new Response('{}', { status: responseStatus }); } });
    const input = { component: 'webdav', stage: 'sync', error: new Error('network') };
    try {
        await client.flush(); // Initial empty flush.
        await client.report(input);
        const upload = client.flush(); await started;
        await client.report(input); release(); await upload;
        let state = JSON.parse(await vault.read());
        assert.equal(state.pending.length, 1); assert.equal(state.pending[0].count, 1);
        responseStatus = 503; await client.flush();
        assert.equal(JSON.parse(await vault.read()).pending.length, 1);
        responseStatus = 200; await client.flush();
        assert.equal(JSON.parse(await vault.read()).pending.length, 0);
    } finally { release(); await client.close(); await rm(dir, { recursive: true, force: true }); }
});
