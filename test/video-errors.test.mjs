import test from 'node:test';
import assert from 'node:assert/strict';
import { videoErrorText, videoErrorMessages as messages, videoSiteRequestId } from '../desktop/video-errors.mjs';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { createVideoTasks } = createRequire(import.meta.url)('../desktop/video-tasks.cjs');
const privateText = '智赢 88API VendorOther https://private.invalid/clip?token=secret 192.0.2.8 channel=account-private Bearer sk-private balance=123.45 credits=6789';
const personRejection = '参考图片可能包含真人或可识别人物，未通过上游内容审核。请更换参考图片后重试。';
const requestId = '12345678-1234-1234-1234-123456789abc';

test('reference format contract accepts synchronous and asynchronous errors independent of type, including exact legacy text', () => {
    for (const status of [400, 415, 422, 200]) for (const type of ['invalid_request_error', 'upstream_error', 'video_error', undefined]) for (const code of ['invalid_reference_format', undefined]) {
        const data = { ...(status === 200 ? { status: 'failed' } : {}), error: { code, type, message: messages.invalid_reference_format } };
        const expected = messages.invalid_reference_format + '\n本站请求编号：' + requestId;
        assert.equal(videoErrorText({ response: { status, data } }, { stage: status === 200 ? 'poll' : 'submit', requestId }), expected);
        assert.equal(videoErrorText(JSON.parse(JSON.stringify(data)), { state: 'unknown' }), messages.creation_outcome_unknown);
    }
    assert.equal(videoErrorText({ error: { type: 'video_error', message: messages.invalid_reference_format + ' ' + privateText } }), messages.service_unavailable, 'legacy matching accepts only the complete fixed text');
});

test('documented public material/parameter codes survive hostile raw messages and IPC serialization as fixed actionable text', () => {
    for (const [code, kind] of [['invalid_reference_format', 'invalid_reference_format'], ['material_count', 'material_count'], ['media_too_large', 'media_too_large'], ['duration_invalid', 'duration_invalid'], ['resolution_or_ratio_invalid', 'resolution_invalid'], ['unsupported_field', 'parameters_invalid']]) {
        const expected = messages[kind] + '\n本站请求编号：' + requestId;
        for (const stage of ['submit', 'poll', 'download']) {
            let text = videoErrorText({ error: { code, message: privateText } }, { stage, requestId });
            assert.equal(text, expected);
            text = JSON.parse(JSON.stringify({ reason: text })).reason;
            assert.equal(videoErrorText(new Error(text), { state: 'failed' }), expected);
        }
        assert.equal(videoErrorText({ error: { code, message: privateText } }, { state: 'unknown' }), messages.creation_outcome_unknown);
    }
});

test('actionable submit and async errors persist across a native journal restart without clearing receipts or replaying POST', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'canvas-video-actionable-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    for (const [code, kind] of [['invalid_reference_format', 'invalid_reference_format'], ['material_count', 'material_count'], ['media_too_large', 'media_too_large'], ['duration_invalid', 'duration_invalid'], ['resolution_or_ratio_invalid', 'resolution_invalid']]) {
        let stored, gets = 0, done;
        const complete = new Promise(resolve => { done = resolve; });
        const input = { site: 'https://oneyes.ai', apiKey: 'fixture', channelId: 'c', model: 'exact-original-model', provider: 'openai', parameters: { vquality: '1080', videoSeconds: '5' }, references: [{ id: 'kept', storageKey: 'original' }] };
        const options = { directory: join(directory, code), vault: { read: async () => stored, write: async value => { stored = value; } }, credentials: async () => [{ id: 'c', baseUrl: input.site, apiKey: input.apiKey }], changed: jobs => { if (jobs.some(job => job.taskId && job.state === 'failed')) done(); }, probe: async () => ({}), fetcher: async (url, init) => {
            gets++; assert.equal(init.method, 'GET'); assert.equal(url, 'https://oneyes.ai/v1/videos/original');
            return Response.json({ status: 'failed', error: { code, message: privateText } }, { headers: { 'x-request-id': requestId } });
        } };
        const manager = createVideoTasks(options), key = await manager.prepare(input);
        await manager.beforeSubmit(key, 'https://oneyes.ai/v1/videos', { Authorization: 'Bearer fixture' });
        await manager.receipt(key, Response.json({ error: { code, message: privateText } }, { status: 400, headers: { 'x-request-id': requestId } }));
        const receipt = await manager.adopt({ ...input, taskId: 'original' });
        await manager.retry(receipt); await complete; await manager.close();
        const restored = createVideoTasks(options);
        const jobs = await restored.list();
        for (const job of jobs) { assert.equal(job.reason, messages[kind] + '\n本站请求编号：' + requestId); assert.equal(job.parameters.vquality, input.parameters.vquality); assert.equal(job.parameters.videoSeconds, input.parameters.videoSeconds); assert.deepEqual(job.references, input.references); }
        assert.equal(jobs.find(job => job.key === receipt).taskId, 'original');
        assert.equal(jobs.find(job => job.key === key).taskId, undefined);
        await assert.rejects(restored.retry(key), /没有任务 ID/); assert.equal(gets, 1);
        await restored.close();
    }
});

test('specific moderation requires current response evidence and survives repeated IPC/display sanitization', () => {
    for (const code of [undefined, 'content_policy']) {
        let text = videoErrorText({ error: { code, type: 'upstream_error', message: personRejection + ' ' + privateText } }, { requestId });
        assert.equal(text, messages.reference_person_policy + '\n本站请求编号：' + requestId);
        for (let n = 0; n < 5; n++) { text = videoErrorText(new Error(text), { state: 'failed' }); assert.equal(text, messages.reference_person_policy + '\n本站请求编号：' + requestId); }
        assert.doesNotMatch(text, /上游|智赢|88API|VendorOther|https?:|192\.0\.2|account-private|Bearer|sk-private|123\.45|credits=|不扣费|任务未提交/);
    }
    assert.equal(videoErrorText({ error: { type: 'upstream_error', message: 'Upstream gateway error' }, upstream_error_message: personRejection }, { status: 500 }), messages.unknown);
    assert.equal(videoErrorText({ error: { code: 'content_policy', message: 'Content policy violation' } }), messages.content_policy);
    assert.equal(videoErrorText({ message: '参考图片中有真人，请生成视频' }), messages.content_policy, 'mentioning a person alone is not evidence of this specific rejection');
});

test('unknown submission overrides every stored canonical and ignores unverified no-charge claims', () => {
    for (const canonical of Object.values(messages)) {
        const saved = canonical + '\n本站请求编号：' + requestId;
        assert.equal(videoErrorText(saved, { state: 'unknown' }), messages.creation_outcome_unknown + '\n本站请求编号：' + requestId);
        assert.equal(videoErrorText({ error: { code: 'creation_outcome_unknown', message: saved } }), messages.creation_outcome_unknown + '\n本站请求编号：' + requestId);
    }
    for (const status of [400, 409, 500]) {
        const payload = { error: { type: 'creation_outcome_unknown', message: personRejection + ' 任务未提交，不扣费' }, submitted: false, not_charged: true };
        assert.equal(videoErrorText(payload, { status }), messages.creation_outcome_unknown);
        payload.error.type = 'upstream_error';
        assert.equal(videoErrorText(payload, { status }), messages.reference_person_policy);
    }
});

test('latest six sanitized incidents use fixed categories; generic 500 never guesses a cause', () => {
    for (const code of ['content_policy', 'creation_outcome_unknown', 'duration_invalid', 'duration_invalid', 'model_unavailable', 'creation_outcome_unknown']) {
        assert.equal(videoErrorText({ error: { code, message: 'private opaque detail' } }), messages[code]);
    }
    assert.equal(videoErrorText({ error: { message: 'Video creation outcome is unknown; task id could not be confirmed' } }), messages.creation_outcome_unknown);
    assert.equal(videoErrorText({ message: 'The requested upstream video model is not available' }), messages.model_unavailable);
    assert.equal(videoErrorText({ message: 'duration outside selected model range' }), messages.duration_invalid);
    for (const message of ['gateway error', 'service failed duration=5 resolution=720 watermark=false', '服务错误，时长=5 分辨率=720']) assert.equal(videoErrorText({ message }, { status: 500 }), messages.unknown);
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
    const keys = [];
    for (const field of ['code', 'type']) {
        const key = await manager.prepare({ site: 'https://oneyes.ai', apiKey: 'fixture', channelId: 'c', model: 'fixture', provider: 'openai' }); keys.push(key);
        await manager.beforeSubmit(key, 'https://oneyes.ai/v1/videos', { Authorization: 'Bearer fixture' });
        await manager.receipt(key, Response.json({ error: { [field]: 'creation_outcome_unknown', message: privateText } }, { status: 409 }));
        const job = (await manager.list()).find(job => job.key === key);
        assert.equal(job.state, 'unknown'); assert.equal(job.taskId, undefined); assert.equal(job.key, key);
        assert.doesNotMatch(job.reason, /secret|Bearer|private|123|6789/);
        assert.equal(JSON.parse(stored).jobs.find(job => job.key === key).reason, job.reason);
    }
    await manager.close();
    // Old raw reasons are also projected safely; no migration or fake receipt.
    const journal = JSON.parse(stored); journal.jobs[0].reason = privateText; stored = JSON.stringify(journal);
    const restored = createVideoTasks(options);
    t.after(async () => { await restored.close(); await rm(directory, { recursive: true, force: true }); });
    assert.equal((await restored.list())[0].reason, messages.creation_outcome_unknown);
    for (const key of keys) { assert.equal((await restored.list()).find(job => job.key === key).state, 'unknown'); await assert.rejects(restored.retry(key), /没有任务 ID/); }
    assert.equal(posts, 0);
});

test('native create rejection and GET-only terminal rejection persist the specific safe cause with site ID', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'canvas-video-rejected-'));
    let stored, gets = 0, finished;
    const failed = new Promise(resolve => { finished = resolve; });
    const input = { site: 'https://oneyes.ai', apiKey: 'fixture', channelId: 'c', model: 'fixture', provider: 'openai', parameters: { vquality: '1080', videoSeconds: '5' } };
    const options = { directory, vault: { read: async () => stored, write: async value => { stored = value; } }, changed: jobs => { if (jobs.some(job => job.taskId === 'original-task' && job.state === 'failed')) finished(); }, credentials: async () => [{ id: 'c', baseUrl: input.site, apiKey: input.apiKey }], fetcher: async (url, options) => {
        assert.equal(options.method, 'GET'); assert.equal(url, 'https://oneyes.ai/v1/videos/original-task'); gets++;
        return Response.json({ status: 'failed', error: { type: 'content_policy', message: personRejection + ' ' + privateText } }, { headers: { 'x-request-id': requestId } });
    }, probe: async () => ({}) };
    const manager = createVideoTasks(options);
    const expected = messages.reference_person_policy + '\n本站请求编号：' + requestId;
    const key = await manager.prepare(input);
    await manager.beforeSubmit(key, 'https://oneyes.ai/v1/videos', { Authorization: 'Bearer fixture' });
    await manager.receipt(key, Response.json({ error: { type: 'upstream_error', message: personRejection + ' ' + privateText } }, { status: 400, headers: { 'x-request-id': requestId } }));
    assert.equal((await manager.list())[0].reason, expected);
    const original = await manager.adopt({ ...input, taskId: 'original-task' });
    await manager.retry(original);
    await failed;
    await manager.close();
    const persisted = JSON.parse(stored).jobs;
    assert.equal(persisted[0].state, 'failed'); assert.equal(persisted[0].reason, expected);
    assert.equal(persisted[1].state, 'failed'); assert.equal(persisted[1].reason, expected);
    assert.equal(gets, 1); assert.doesNotMatch(stored, /sk-private|account-private|balance=|可识别人物.*private/);
    const restored = createVideoTasks(options);
    t.after(async () => { await restored.close(); await rm(directory, { recursive: true, force: true }); });
    const jobs = await restored.list(); assert.equal(jobs[0].reason, expected); assert.equal(jobs[1].reason, expected);
    await assert.rejects(restored.retry(key), /没有任务 ID/); assert.equal(gets, 1);
});
