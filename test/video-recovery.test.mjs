import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fork, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
const { createVault } = createRequire(import.meta.url)('../desktop/vault.cjs');
const { createVideoTasks } = createRequire(import.meta.url)('../desktop/video-tasks.cjs');

async function fixture(t, provider = 'openai') {
    const directory = await mkdtemp(join(tmpdir(), 'canvas-video-recovery-'));
    const video = join(directory, 'fixture.mp4');
    await promisify(execFile)(resolve('desktop/media-bin/ffmpeg' + (process.platform === 'win32' ? '.exe' : '')), ['-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=320x180:r=10:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', video], { windowsHide: true });
    const bytes = await readFile(video), children = new Set();
    const state = { posts: 0, accepted: 0, bodies: [], keys: [], queries: 0, downloads: 0, ranges: 0, mode: 'pending', badUrl: true, downloadStarted: false };
    const server = createServer(async (req, res) => {
        if (req.method === 'POST') {
            state.posts++; const parts = []; for await (const chunk of req) parts.push(chunk);
            state.bodies.push(Buffer.concat(parts)); state.keys.push(req.headers['idempotency-key']);
            if (state.mode === 'busy') { res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '0.1' }); res.end(JSON.stringify({ error: { code: 'large_material_busy' } })); return; }
            state.accepted++;
            res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(provider === 'gemini' ? { name: 'operations/receipt-1' } : { request_id: 'receipt-1' })); return;
        }
        assert.equal(req.method, 'GET', 'recovery can never POST');
        if (provider === 'gemini' && req.url === '/v1beta/operations/receipt-1') {
            state.queries++; assert.equal(req.headers['x-goog-api-key'], 'fixture-key'); assert.equal(req.headers.authorization, undefined);
            res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(state.mode === 'pending' ? { done: false } : { done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: base + '/v1beta/files/result' } }] } } })); return;
        }
        if (req.url.startsWith('/v1/videos/receipt-1') && !req.url.includes('/content')) {
            state.queries++; assert.equal(req.headers.authorization, 'Bearer fixture-key');
            if (state.mode === 'offline') { res.writeHead(503).end(); return; }
            if (state.mode === 'retry-after') { res.writeHead(429, { 'Retry-After': '1' }).end(); return; }
            if (state.mode === 'missing') { res.writeHead(404).end(); return; }
            if (state.mode === 'moderated') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ status: 'done', video: { respect_moderation: false } })); return; }
            const data = state.mode === 'pending' ? { status: 'processing' } : { status: 'completed', url: state.mode === 'expired-url' && state.badUrl ? `${base}/external/expired` : `${base}/external/fresh` };
            res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); return;
        }
        state.downloads++; state.downloadStarted = true;
        if (provider === 'gemini') assert.equal(req.headers['x-goog-api-key'], 'fixture-key');
        assert.equal(req.headers.authorization, undefined, 'storage never receives an API key');
        if (req.url === '/external/expired') { state.badUrl = false; res.writeHead(403).end(); return; }
        const start = Number(req.headers.range?.match(/^bytes=(\d+)-$/)?.[1] || 0);
        if (start) { state.ranges++; assert.equal(req.headers['if-range'], '"fixture-video"'); }
        res.writeHead(start ? 206 : 200, { 'Content-Type': 'video/mp4', ETag: '"fixture-video"', 'Content-Length': bytes.length - start, ...(start ? { 'Content-Range': `bytes ${start}-${bytes.length - 1}/${bytes.length}` } : {}) });
        if (state.mode === 'partial') res.write(bytes.subarray(0, Math.floor(bytes.length / 2)));
        else if (state.mode === 'block-download') { /* Simulates process loss before the first response byte. */ }
        else res.end(bytes.subarray(start));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    function worker(mode = 'restore', options = {}) {
        const child = fork(resolve('test/fixtures/video-recovery-worker.cjs'), { env: { ...process.env, VIDEO_TEST_DIRECTORY: directory, VIDEO_TEST_BASE: base, VIDEO_TEST_MODE: mode, VIDEO_TEST_PROVIDER: provider, ...options }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
        children.add(child); const messages = []; let stderr = '';
        child.stderr.on('data', chunk => stderr += chunk);
        child.on('message', value => messages.push(value));
        async function until(predicate) {
            const end = Date.now() + 20000;
            for (;;) {
                const fatal = messages.find(item => item.fatal); if (fatal) throw Error(fatal.fatal);
                const result = messages.find(predicate); if (result) return result;
                if (child.exitCode !== null || Date.now() > end) throw Error(`Recovery child did not finish: ${stderr}\n${JSON.stringify(messages.slice(-4))}`);
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }
        const waitState = status => until(item => item.jobs?.some(job => job.state === status)).then(item => item.jobs.find(job => job.state === status));
        async function kill() {
            if (child.exitCode !== null) return;
            await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGKILL'); }); children.delete(child);
        }
        return { child, until, waitState, kill };
    }
    t.after(async () => { for (const child of children) await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGKILL'); }); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { force: true, recursive: true }); });
    async function saved(child) {
        const job = await child.waitState('saved');
        assert.equal(job.taskId, provider === 'gemini' ? 'operations/receipt-1' : 'receipt-1'); assert.deepEqual(job.target, { projectId: 'persisted-project', nodeId: 'original-video' });
        assert.equal(job.parameters.vquality, '1080'); assert.equal(job.sentParameters.duration, 5);
        assert.deepEqual(await readFile(join(directory, 'video-results', job.key + '.video')), bytes);
        assert.equal(job.result.width, 320); assert.equal(job.result.height, 180);
        assert.equal(state.posts, 1, 'total creation requests remain exactly one across cold starts');
        const journal = await createVault(directory, 'video-tasks').read();
        assert.doesNotMatch(journal, /fixture-key|external\/|signature=/, 'recovery metadata never depends on a secret or signed URL');
        assert.equal((await readdir(join(directory, 'video-results'))).filter(name => name.endsWith('.video')).length, 1);
        return job;
    }
    return { directory, base, state, worker, saved };
}

test('video generation survives a killed process and cold start; receipt and original parameters are durable', async t => {
    const f = await fixture(t), first = f.worker('submit'); await first.until(item => item.submitted); await first.kill();
    f.state.mode = 'completed'; const restored = f.worker(); await f.saved(restored);
});
test('completed but not downloaded video survives cold start', async t => {
    const f = await fixture(t); f.state.mode = 'block-download'; const first = f.worker('submit'); await first.waitState('querying'); await first.kill();
    f.state.mode = 'completed'; await f.saved(f.worker());
});
test('partial video download resumes with validated Range after process termination', async t => {
    const f = await fixture(t); f.state.mode = 'partial'; const first = f.worker('submit'); await first.waitState('downloading');
    for (;;) { const files = await readdir(join(f.directory, 'video-results')); if (files.some(name => name.endsWith('.part') )) break; await new Promise(resolve => setTimeout(resolve, 10)); }
    await new Promise(resolve => setTimeout(resolve, 40)); await first.kill();
    f.state.mode = 'completed'; await f.saved(f.worker()); assert.equal(f.state.ranges, 1);
});
test('long offline period and unavailable credentials retain the original receipt and recover without a new POST', async t => {
    const f = await fixture(t), first = f.worker('submit'); await first.until(item => item.submitted); await first.kill();
    const vault = createVault(f.directory, 'video-tasks'), history = JSON.parse(await vault.read()); history.jobs[0].createdAt -= 90 * 24 * 60 * 60 * 1000; await vault.write(JSON.stringify(history));
    f.state.mode = 'offline'; const offline = f.worker(); await offline.waitState('waiting'); await offline.kill();
    f.state.mode = 'completed'; const before = f.state.queries, credentials = f.worker('restore', { VIDEO_TEST_CREDENTIALS: 'none' }); await credentials.waitState('credentials');
    assert.equal(f.state.queries, before); credentials.child.send('credentials'); await f.saved(credentials);
});
test('native Gemini operations use their own query and download protocol after cold start', async t => {
    const f = await fixture(t, 'gemini'), first = f.worker('submit'); await first.until(item => item.submitted); await first.kill();
    f.state.mode = 'completed'; await f.saved(f.worker());
});
test('an expired result URL is renewed through the original task before retrying download', async t => {
    const f = await fixture(t); f.state.mode = 'expired-url'; const child = f.worker('submit'); await child.waitState('download_error'); await f.saved(child);
    assert.ok(f.state.queries >= 2); assert.equal(f.state.downloads, 2);
});
test('disk failure retains successful undownloaded tasks and recovers on the next cold start', async t => {
    const f = await fixture(t); f.state.mode = 'completed'; const child = f.worker('submit', { VIDEO_TEST_DISK: 'full' }); await child.waitState('save_error'); await child.kill(); await f.saved(f.worker());
});
test('moderation rejection and missing tasks remain visible instead of regenerating', async t => {
    const f = await fixture(t); f.state.mode = 'moderated'; const child = f.worker('submit'); const failed = await child.waitState('failed'); assert.match(failed.reason, /审核/); await child.kill();
    f.state.mode = 'missing'; const restored = f.worker(); await restored.until(item => item.loaded); assert.equal(f.state.posts, 1);
    restored.child.send('retry'); assert.match((await restored.waitState('missing')).reason, /404/); assert.equal(f.state.posts, 1);
});
test('old project receipts require explicit account confirmation and retain their original node association', async t => {
    const f = await fixture(t); f.state.mode = 'completed'; const child = f.worker('adopt'); const job = await child.waitState('confirmation');
    assert.equal(f.state.posts, 0); assert.equal(f.state.queries, 0); child.child.send('retry'); const saved = await child.waitState('saved');
    assert.deepEqual(saved.target, job.target); assert.equal(f.state.posts, 0);
});
test('unknown submissions are preserved and never reposted; another credential cannot query them', async t => {
    const f = await fixture(t), vault = createVault(f.directory, 'video-tasks');
    const manager = createVideoTasks({ directory: f.directory, vault, fetcher: fetch, probe: async () => ({}), credentials: async () => [], interval: 10000 });
    const input = { site: f.base, apiKey: 'original', channelId: 'same-channel', model: 'm', provider: 'openai', parameters: {} };
    const key = await manager.prepare(input); await manager.beforeSubmit(key, f.base + '/v1/videos', { Authorization: 'Bearer original' }); await manager.close();
    const restored = createVideoTasks({ directory: f.directory, vault, fetcher: fetch, probe: async () => ({}), credentials: async () => [{ id: 'same-channel', baseUrl: f.base, apiKey: 'another-account' }], interval: 10000 });
    t.after(() => restored.close()); const job = (await restored.list())[0]; assert.equal(job.state, 'unknown'); assert.equal(job.key, key);
    await assert.rejects(restored.retry(key), /没有任务 ID/); assert.equal(f.state.posts, 0); assert.equal(f.state.queries, 0);
});

test('server Retry-After is retained across a cold start before querying the same task', async t => {
    const f = await fixture(t); f.state.mode = 'retry-after'; const first = f.worker('submit');
    const job = await first.waitState('waiting'); assert.ok(job.retryAt > Date.now()); await first.kill();
    f.state.mode = 'completed'; const queries = f.state.queries, restored = f.worker();
    await restored.until(item => item.loaded); assert.equal(f.state.queries, queries); await f.saved(restored);
});

test('concurrent attempts to submit the same local receipt permit exactly one POST', async t => {
    const f = await fixture(t), manager = createVideoTasks({ directory: f.directory, vault: createVault(f.directory, 'video-tasks'), fetcher: fetch, probe: async () => ({}), credentials: async () => [], interval: 10000 });
    try {
        const key = await manager.prepare({ site: f.base, apiKey: 'fixture-key', channelId: 'fixture', model: 'fixture', provider: 'openai' });
        const url = f.base + '/v1/videos', headers = { Authorization: 'Bearer fixture-key', 'Content-Type': 'application/json' }, body = JSON.stringify({ model: 'fixture', duration: 5 });
        const send = async () => { await manager.beforeSubmit(key, url, headers, body); await manager.receipt(key, await fetch(url, { method: 'POST', headers, body })); };
        const results = await Promise.allSettled([send(), send()]);
        assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(f.state.posts, 1);
        assert.equal((await manager.list())[0].taskId, 'receipt-1');
    } finally { await manager.close(); }
});

test('large-material busy permits only the same durable key and exact body after Retry-After', async t => {
    const f = await fixture(t), manager = createVideoTasks({ directory: f.directory, vault: createVault(f.directory, 'video-tasks'), fetcher: fetch, probe: async () => ({}), credentials: async () => [], interval: 10000 });
    try {
        const key = await manager.prepare({ site: f.base, apiKey: 'fixture-key', channelId: 'fixture', model: 'fixture', provider: 'openai', retryLargeMaterial: true });
        const url = f.base + '/v1/videos', headers = { Authorization: 'Bearer fixture-key', 'Content-Type': 'application/json', 'Idempotency-Key': key }, body = JSON.stringify({ model: 'fixture', duration: 5 });
        const send = async () => { await manager.beforeSubmit(key, url, headers, body); await manager.receipt(key, await fetch(url, { method: 'POST', headers, body })); };
        f.state.mode = 'busy'; await send();
        const job = (await manager.list())[0]; assert.equal(job.state, 'throttled'); assert.equal(job.idempotencyKey, key); assert.equal(f.state.accepted, 0);
        await assert.rejects(manager.beforeSubmit(key, url, headers, body), /重试时间/);
        await new Promise(resolve => setTimeout(resolve, Math.max(0, job.retryAt - Date.now())));
        await assert.rejects(manager.beforeSubmit(key, url, { ...headers, 'Idempotency-Key': 'another' }, body), /幂等键/);
        await assert.rejects(manager.beforeSubmit(key, url, headers, body + ' '), /停止重复提交/);
        await assert.rejects(manager.beforeSubmit(key, url + '/generations', headers, body), /停止重复提交/);
        await assert.rejects(manager.beforeSubmit(key, url, { ...headers, 'Content-Type': 'application/json; charset=utf-8' }, body), /停止重复提交/);
        await assert.rejects(manager.beforeSubmit(key, url, { Authorization: 'Bearer fixture-key', 'Content-Type': 'application/json' }, body), /停止重复提交/);
        f.state.mode = 'pending'; await send();
        assert.equal((await manager.list())[0].taskId, 'receipt-1'); assert.equal(f.state.accepted, 1); assert.equal(f.state.posts, 2);
        assert.deepEqual(f.state.keys, [key, key]); assert.deepEqual(f.state.bodies[0], f.state.bodies[1]);
        await assert.rejects(send(), /停止重复提交/); assert.equal(f.state.posts, 2);
    } finally { await manager.close(); }
});

test('process loss during a guaranteed unsent busy response retains the key without replaying on cold start', async t => {
    const f = await fixture(t); f.state.mode = 'busy';
    const first = f.worker('submit', { VIDEO_TEST_RETRY_LARGE: '1' }), job = await first.waitState('throttled'); await first.kill();
    f.state.mode = 'completed'; const restored = f.worker();
    const stopped = await restored.waitState('not_submitted'); assert.equal(stopped.idempotencyKey, job.key); assert.equal(stopped.requestHash, job.requestHash);
    assert.equal(f.state.accepted, 0); assert.equal(f.state.posts, 1); assert.equal(f.state.queries, 0);
    const journal = JSON.parse(await createVault(f.directory, 'video-tasks').read()); assert.equal(journal.jobs[0].idempotencyKey, job.key);
});
