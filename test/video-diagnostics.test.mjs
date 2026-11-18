import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { videoRequestDiagnostic, safeVideoDiagnostics, videoDiagnosticReport } from '../desktop/video-diagnostics.mjs';
const { createVideoTasks } = createRequire(import.meta.url)('../desktop/video-tasks.cjs');
const base = 'https://oneyes.ai', task = 'bv_fixture_video';
const br = digit => 'br_' + digit.repeat(32);
const gateway = '12345678-1234-1234-1234-123456789abc';
const secret = 'sk-private https://private.invalid/ref.png C:\\private\\image.png prompt-secret';

test('bridge IDs are exact, separate from task IDs and accepted only from the account response', () => {
    assert.equal(videoRequestDiagnostic(base, { bridge_request_id: br('a'), request_id: task }, {}, 200).bridgeRequestId, br('a'));
    assert.equal(videoRequestDiagnostic(base, {}, new Headers({ 'X-Request-ID': br('b') }), 200).bridgeRequestId, br('b'));
    assert.equal(videoRequestDiagnostic(base, { bridge_request_id: br('a').toUpperCase() }, {}, 200).bridgeRequestId, undefined);
    assert.equal(videoRequestDiagnostic('https://external.invalid', { bridge_request_id: br('a') }, { 'x-request-id': gateway }, 400).bridgeRequestId, undefined);
    assert.equal(videoRequestDiagnostic(base, { request_id: br('a') }, {}, 200).bridgeRequestId, undefined);
    const diagnostic = videoRequestDiagnostic(base, { error: { code: 'invalid_reference_format', message: secret } }, { 'x-request-id': gateway }, 400);
    assert.equal(diagnostic.gatewayRequestId, gateway); assert.equal(diagnostic.errorCode, 'invalid_reference_format');
    assert.doesNotMatch(diagnostic.message, /private|prompt-secret/);
    assert.deepEqual(safeVideoDiagnostics({ arbitrary: diagnostic, poll: { ...diagnostic, bridgeRequestId: secret, apiKey: secret } }).poll.bridgeRequestId, undefined);
});

async function fixture(t, fetcher) {
    const directory = await mkdtemp(join(tmpdir(), 'canvas-diagnostics-'));
    let stored; const vault = { read: async () => stored, write: async value => { stored = value; } };
    const done = Promise.withResolvers();
    const manager = () => createVideoTasks({ directory, vault, credentials: async () => [], fetcher,
        probe: async () => ({ width: 4, height: 3, durationMs: 1000, mimeType: 'video/mp4' }),
        changed: jobs => { if (jobs[0]?.state === 'saved') done.resolve(jobs[0]); } });
    const instance = manager(); t.after(async () => { await instance.close(); await rm(directory, { recursive: true, force: true }); });
    const key = await instance.prepare({ site: base, apiKey: secret, channelId: 'fixture', model: 'fixture::seedance-2.0-fast-discount [720p 4-15s ¥1.078/条]', provider: 'openai', parameters: { prompt: secret } });
    const headers = { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json', 'Idempotency-Key': key };
    await instance.beforeSubmit(key, base + '/v1/videos', headers, JSON.stringify({ model: 'fixture', prompt: secret }));
    return { instance, key, manager, done: done.promise, journal: () => JSON.parse(stored) };
}

test('creation, latest query and binary download diagnostics survive restart without changing the receipt or issuing POST', async t => {
    const paths = [];
    const f = await fixture(t, async (url, options) => {
        assert.equal(options.method, 'GET'); paths.push(url);
        return url.endsWith('/content') ? new Response('video', { headers: { 'Content-Type': 'video/mp4', 'X-Request-ID': br('c') } })
            : Response.json({ status: 'completed', bridge_request_id: br('b') }, { headers: { 'X-Request-ID': br('b') } });
    });
    await f.instance.receipt(f.key, Response.json({ request_id: task, bridge_request_id: br('a') }));
    const job = await f.done; await f.instance.close();
    assert.equal(job.taskId, task); assert.equal(job.diagnostics.submit.bridgeRequestId, br('a')); assert.equal(job.diagnostics.poll.bridgeRequestId, br('b')); assert.equal(job.diagnostics.download.bridgeRequestId, br('c'));
    assert.equal(paths.length, 2); assert.ok(paths.every(url => url.includes('/' + task)));
    const report = videoDiagnosticReport(job), copy = JSON.parse(report);
    assert.equal(copy.taskId, task); assert.equal(copy.jobId, job.diagnosticId); assert.notEqual(copy.jobId, f.key);
    assert.equal(copy.modelId, 'seedance-2.0-fast-discount [720p 4-15s ¥1.078/条]');
    assert.doesNotMatch(report, /sk-private|prompt-secret|private.invalid|private\\|idempotency|credential|parameters|reference|fixture::/);
    assert.ok(!report.includes(f.key));
    const restored = f.manager(); t.after(() => restored.close());
    assert.deepEqual((await restored.list())[0].diagnostics, job.diagnostics);
    assert.equal((await restored.list())[0].diagnosticId, job.diagnosticId); assert.equal(paths.length, 2);
});

test('gateway-replaced HTTP 409 keeps the original idempotency record and safe gateway ID without fabricating a task or replaying', async t => {
    let calls = 0;
    const f = await fixture(t, async () => { calls++; throw Error('must never query without a receipt'); });
    await f.instance.receipt(f.key, new Response('<html>' + secret + '</html>', { status: 409, headers: { 'X-Request-ID': gateway } }));
    const job = (await f.instance.list())[0]; assert.equal(job.state, 'unknown'); assert.equal(job.taskId, undefined);
    assert.equal(job.idempotencyKey, f.key); assert.equal(job.diagnostics.submit.gatewayRequestId, gateway); assert.equal(job.diagnostics.submit.bridgeRequestId, undefined);
    assert.equal(f.journal().jobs[0].idempotencyKey, f.key); assert.equal(calls, 0);
    assert.doesNotMatch(videoDiagnosticReport(job), /prompt-secret|sk-private|private.invalid|idempotency/);
    assert.ok(!videoDiagnosticReport(job).includes(f.key));
});
