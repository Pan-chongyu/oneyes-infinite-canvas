import test from 'node:test';
import assert from 'node:assert/strict';
import { videoErrorText, videoErrorMessages as messages, videoSiteRequestId } from '../desktop/video-errors.mjs';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { createVideoTasks } = createRequire(import.meta.url)('../desktop/video-tasks.cjs');
const privateText = '智赢 88API VendorOther https://private.invalid/clip?token=secret 192.0.2.8 channel=account-private Bearer sk-private balance=123.45 credits=6789';

test('latest six sanitized incidents use fixed categories; generic 500 never guesses a cause', () => {
    for (const code of ['content_policy', 'creation_outcome_unknown', 'duration_invalid', 'duration_invalid', 'model_unavailable', 'creation_outcome_unknown']) {
        assert.equal(videoErrorText({ error: { code, message: 'private opaque detail' } }), messages[code]);
    }
    assert.equal(videoErrorText({ error: { message: 'Video creation outcome is unknown; task id could not be confirmed' } }), messages.creation_outcome_unknown);
    assert.equal(videoErrorText({ message: 'The requested upstream video model is not available' }), messages.model_unavailable);
    assert.equal(videoErrorText({ message: 'duration outside selected model range' }), messages.duration_invalid);
    for (const message of ['gateway error', 'service failed duration=5 resolution=720', '服务错误，时长=5 分辨率=720']) assert.equal(videoErrorText({ message }, { status: 500 }), messages.unknown);
});

test('untrusted money codes and details never become a site recharge instruction', () => {
    for (const code of ['INSUFFICIENT_BALANCE', 'insufficient_quota', 'credit_exhausted', 'unknown']) {
        const message = videoErrorText({ error: { code, message: privateText } }, { status: 402 });
        assert.equal(message, messages.service_unavailable); assert.doesNotMatch(message, /充值|余额|积分|123|6789/);
    }
    assert.equal(videoErrorText({ code: 'INSUFFICIENT_BALANCE' }), messages.service_unavailable);
});

test('known and unknown nested/HTML errors cannot echo body, URLs, accounts or secrets in ordinary details', () => {
    for (const input of [privateText, { message: privateText }, { error: { code: 'media_too_large', message: privateText } }, { detail: [{ loc: ['body', 'watermark'], msg: privateText, input: 'sk-private' }] }, '<html>' + privateText + '</html>', JSON.stringify({ error: { message: privateText } })]) {
        const result = videoErrorText(input);
        assert.ok(Object.values(messages).includes(result));
        assert.doesNotMatch(result, /智赢|88API|VendorOther|https?:|192\.0\.2|account-private|Bearer|sk-private|123\.45|6789|<html>/);
        assert.equal(videoErrorText(new Error(result)), result, 'renderer, history and copy boundaries are idempotent');
    }
    assert.equal(videoErrorText(messages.duration_invalid + ' secret'), messages.duration_invalid);
    assert.equal(videoErrorText(messages.unknown + ' arbitrary-private'), messages.unknown);
    assert.equal(videoErrorText(new DOMException(privateText, 'AbortError')), messages.cancelled);
});

test('only validated IDs from site response headers can be shown, never response-body task IDs', () => {
    const id = '12345678-1234-1234-1234-123456789abc';
    assert.equal(videoSiteRequestId('https://oneyes.ai/v1/videos', new Headers({ 'x-request-id': id })), id);
    assert.equal(videoSiteRequestId('https://private.invalid/v1/videos', new Headers({ 'x-request-id': id })), undefined);
    assert.equal(videoSiteRequestId('https://oneyes.ai/v1/videos', new Headers({ 'x-request-id': 'sk-private' })), undefined);
    const text = videoErrorText({ error: { message: 'opaque' }, request_id: 'upstream-private' }, { requestId: id });
    assert.equal(text, messages.unknown + '\n本站请求编号：' + id); assert.equal(videoErrorText(text), text);
    assert.equal(videoErrorText({ message: 'opaque', request_id: id }), messages.unknown);
});

test('native receipt, persisted failure and restart projection stay safe and never create a paid request', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'canvas-video-safe-'));
    let stored, posts = 0;
    const options = { directory, vault: { read: async () => stored, write: async value => { stored = value; } }, credentials: async () => [], fetcher: async () => { posts++; throw Error(privateText); }, probe: async () => ({}) };
    const manager = createVideoTasks(options);
    const key = await manager.prepare({ site: 'https://oneyes.ai', apiKey: 'fixture', channelId: 'c', model: 'fixture', provider: 'openai' });
    await manager.beforeSubmit(key, 'https://oneyes.ai/v1/videos', { Authorization: 'Bearer fixture' });
    await manager.receipt(key, Response.json({ error: { code: 'creation_outcome_unknown', message: privateText } }, { status: 409 }));
    const job = (await manager.list())[0];
    assert.equal(job.state, 'unknown'); assert.equal(job.taskId, undefined); assert.equal(job.key, key);
    assert.doesNotMatch(job.reason, /secret|Bearer|private|123|6789/);
    assert.equal(JSON.parse(stored).jobs[0].reason, job.reason);
    await manager.close();
    // Old raw reasons are also projected safely; no migration or fake receipt.
    const journal = JSON.parse(stored); journal.jobs[0].reason = privateText; stored = JSON.stringify(journal);
    const restored = createVideoTasks(options);
    t.after(async () => { await restored.close(); await rm(directory, { recursive: true, force: true }); });
    assert.equal((await restored.list())[0].reason, messages.creation_outcome_unknown);
    await assert.rejects(restored.retry(key), /没有任务 ID/); assert.equal(posts, 0);
});
