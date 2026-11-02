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

test('string errors, nested causes and fixed operations retain root classifications without private context', () => {
    assert.equal(normalize({ error: 'Invalid image data PRIVATE' }).reason, 'invalid-image');
    const cause = Object.assign(new Error('socket PRIVATE'), { code: 'ECONNRESET', status: 502 });
    const outer = new Error('friendly message PRIVATE', { cause });
    cause.cause = outer;
    const safe = normalize({ component: 'video', stage: 'download', operation: 'video-content', error: outer });
    assert.equal(safe.reason, 'server'); assert.equal(safe.code, 'ECONNRESET'); assert.equal(safe.status, 502); assert.equal(safe.operation, 'video-content');
    assert.doesNotMatch(JSON.stringify(safe), /PRIVATE|socket|friendly/);
    assert.equal(normalize({ error: outer, operation: 'PRIVATE-URL-token' }).operation, undefined);
    assert.equal(normalize({ error: new DOMException('timed out', 'TimeoutError') }).reason, 'timeout');
    assert.equal(normalize({ error: new DOMException('The operation was aborted due to timeout', 'TimeoutError') }).reason, 'timeout');
});

test('verified recovery persists exact receipts across restart, ignores unrelated failures and records recurrence anew', async () => {
    let saved, online = false;
    const received = [], vault = { read: async () => saved, write: async value => { saved = value; } };
    const fetcher = async (_url, init) => { if (!online) throw Error('offline'); received.push(JSON.parse(init.body)); return new Response('{}'); };
    let client = await createDiagnostics({ vault, metadata, fetcher });
    const scope = { component: 'update', stage: 'check', operation: 'update-feed' };
    try {
        await client.report({ ...scope, error: new Error('network') });
        const first = JSON.parse(saved).pending[0].id;
        await client.report({ component: 'video', stage: 'poll', operation: 'video-grok', error: new Error('not found') });
        await client.recover(scope); await client.flush(); await client.close();
        assert.deepEqual(JSON.parse(saved).resolved, [first]); assert.equal(JSON.parse(saved).pending.length, 1);
        online = true;
        client = await createDiagnostics({ vault, metadata, fetcher }); await client.flush();
        assert.deepEqual(received.at(-1).resolved, [first]); assert.equal(received.at(-1).events[0].component, 'video');
        assert.deepEqual(JSON.parse(saved).resolved, []);
        await client.report({ ...scope, error: new Error('network') });
        assert.notEqual(JSON.parse(saved).pending[0].id, first);
        await client.recover({ ...scope, operation: 'update-package' });
        assert.equal(JSON.parse(saved).pending.length, 1);
    } finally { await client.close(); }
});

test('recovery while an error upload is in flight sends a later tombstone without removing a fresh failure', async () => {
    let saved, started, release;
    const received = [], entered = new Promise(resolve => { started = resolve; }), blocked = new Promise(resolve => { release = resolve; });
    const client = await createDiagnostics({ vault: { read: async () => saved, write: async value => { saved = value; } }, metadata,
        fetcher: async (_url, init) => { received.push(JSON.parse(init.body)); if (received.length === 1) { started(); await blocked; } return new Response('{}'); } });
    const input = { component: 'agent', stage: 'request', operation: 'agent-models', error: new Error('network') };
    try {
        await client.flush(); await client.report(input);
        const first = JSON.parse(saved).pending[0].id, upload = client.flush(); await entered;
        await client.recover(input); await client.report(input); release(); await upload; await client.flush();
        assert.deepEqual(received[1].resolved, [first]); assert.equal(received[1].events.length, 1); assert.notEqual(received[1].events[0].id, first);
    } finally { release(); await client.close(); }
});

test('Agent startup diagnostics distinguish configuration, port, permissions and runtime without raw messages', () => {
    for (const [code, reason] of [['ERR_AGENT_CONFIG', 'configuration'], ['EADDRINUSE', 'configuration'], ['EPERM', 'permission'], ['EACCES', 'permission'], ['ERR_MODULE_NOT_FOUND', 'runtime'], ['ERR_AGENT_EXIT', 'runtime']]) {
        const safe = normalize({ component: 'agent', stage: 'startup', error: { code, message: 'PRIVATE token=SECRET' } });
        assert.equal(safe.code, code); assert.equal(safe.reason, reason); assert.equal(safe.stage, 'startup');
        assert.doesNotMatch(JSON.stringify(safe), /PRIVATE|SECRET/);
    }
});
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
