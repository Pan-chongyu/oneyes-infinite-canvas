import { test } from 'node:test';
import assert from 'node:assert/strict';
import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import type { AiConfig } from '@/stores/use-config-store';
import type { VideoReferenceSummary } from '@/lib/video-capabilities';

const values = new Map<string, string>();
globalThis.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); }, removeItem: k => { values.delete(k); }, clear: () => values.clear(), key: i => [...values.keys()][i] ?? null, get length() { return values.size; } };
globalThis.window = { localStorage } as unknown as Window & typeof globalThis;
const { createVideoGenerationTask, pollVideoGenerationTask, waitForVideoGenerationTask } = await import('./video');
const { defaultConfig } = await import('@/stores/use-config-store');
const { isUnsupportedGrokVideoResolution, isUnsupportedMiniMaxVideoResolution, usesGrokVideoReferences } = await import('@/lib/video-capabilities');
const config = { ...defaultConfig, channels: [{ ...defaultConfig.channels[0], apiKey: 'fixture-key' }], model: 'default::grok-imagine-video', videoSeconds: '5', size: '1:1', vquality: '480' };
const original = axios.defaults.adapter;
function adapter(handle: (request: AxiosRequestConfig) => { data: unknown; status?: number }) {
    axios.defaults.adapter = async request => ({ status: 200, ...handle(request), statusText: 'OK', headers: {}, config: request });
}

test('Grok video uses canonical JSON and request_id, while other models retain multipart', async () => {
    try {
        const calls: AxiosRequestConfig[] = [];
        adapter(request => { calls.push(request); return { data: { request_id: 'grok-task' } }; });
        const task = await createVideoGenerationTask(config, '服装模特');
        assert.equal(task.id, 'grok-task');
        assert.equal(calls.length, 1);
        assert.match(calls[0].url!, /\/v1\/videos\/generations$/);
        assert.equal(calls[0].headers?.['Content-Type'], 'application/json');
        assert.equal(calls[0].headers?.Authorization, 'Bearer fixture-key');
        assert.deepEqual(JSON.parse(calls[0].data), { model: 'grok-imagine-video', prompt: '服装模特', duration: 5, aspect_ratio: '1:1', resolution: '480p' });
        adapter(request => { calls.push(request); return { data: { id: 'other-task' } }; });
        await createVideoGenerationTask({ ...config, model: 'default::sora-2', vquality: '1080' }, 'other');
        assert.ok(calls[1].data instanceof FormData);
        assert.equal(calls[1].data.get('resolution_name'), '1080p');
        assert.match(calls[1].url!, /\/v1\/videos$/);
    } finally { axios.defaults.adapter = original; }
});

test('MiniMax H accepts only 768P, 1080P and 2K without submitting unsupported requests', async () => {
    const miniMax = { ...config, model: 'default::minimax-h3', vquality: '480' };
    assert.equal(isUnsupportedMiniMaxVideoResolution(miniMax), true);
    let posts = 0;
    const calls: AxiosRequestConfig[] = [];
    try {
        adapter(() => { posts++; return { data: { id: 'unexpected' } }; });
        await assert.rejects(createVideoGenerationTask(miniMax, 'invalid resolution'), /MiniMax H.*768P.*1080P.*2K/);
        assert.equal(posts, 0);

        for (const [resolution, expected] of [['768', '768P'], ['1080', '1080P'], ['2k', '2K']] as const) {
            adapter(request => { posts++; calls.push(request); return { data: { id: `mini-${expected}` } }; });
            const task = await createVideoGenerationTask({ ...miniMax, vquality: resolution }, 'valid resolution');
            assert.equal(task.id, `mini-${expected}`);
            assert.equal((calls.at(-1)?.data as FormData).get('resolution_name'), expected);
        }
        assert.equal(posts, 3);
    } finally { axios.defaults.adapter = original; }
});

test('Grok reference resolution validation never changes the chosen quality or dimensions', async () => {
    const fullHd = { ...config, vquality: '1080p', size: '1920x1080', videoMode: 'reference' };
    const references = { imageCount: 1, audioCount: 0, videoCount: 0 };
    for (const [override, inputs, limited] of [
        [{}, references, true],
        [{ videoMode: 'frames' }, references, false],
        [{ videoMode: 'frames' }, { ...references, imageCount: 3 }, true],
        [{ videoMode: 'frames' }, { ...references, audioCount: 1 }, true],
        [{}, { ...references, imageCount: 0 }, false],
        [{}, { ...references, imageCount: 0, audioCount: 1 }, true],
        [{}, { ...references, videoCount: 1 }, false],
        [{ model: 'default::sora-2' }, references, false],
        [{ model: 'default::grok-imagine-video-1.5' }, references, true],
        [{ channels: [{ ...config.channels[0], models: [{ name: 'grok-imagine-video', capability: 'video' as const, script: 'return 1' }] }] }, references, false],
        [{ channels: [{ ...config.channels[0], apiFormat: 'gemini' as const }] }, references, false],
    ] as [Partial<AiConfig>, VideoReferenceSummary, boolean][]) {
        const current = { ...fullHd, ...override };
        assert.equal(usesGrokVideoReferences(current, inputs), limited);
        assert.equal(isUnsupportedGrokVideoResolution(current, inputs), limited);
        assert.equal(current.vquality, '1080p');
        assert.equal(current.size, '1920x1080');
    }
    for (const vquality of ['480', '720', '720p']) assert.equal(isUnsupportedGrokVideoResolution({ ...fullHd, vquality }, references), false);
    let calls = 0;
    adapter(() => { calls++; return { data: { request_id: 'unexpected' } }; });
    try {
        await assert.rejects(createVideoGenerationTask(fullHd, 'test', [{ id: 'reference', name: 'ref.png', dataUrl: 'data:image/png;base64,invalid', type: 'image/png' }]), /1080p.*保留.*分辨率/);
        assert.equal(calls, 0, 'unsupported combinations must fail before any paid POST or image processing');
        assert.equal(fullHd.vquality, '1080p');
        assert.equal(fullHd.size, '1920x1080');
    } finally { axios.defaults.adapter = original; }
});

test('Grok done downloads the authenticated relay from the account endpoint; external media receives no API key', async () => {
    try {
        const calls: AxiosRequestConfig[] = [];
        adapter(request => {
            calls.push(request);
            if (request.url?.endsWith('/content')) return { data: new Blob(['video'], { type: 'video/mp4' }) };
            return { data: { status: 'done', video: { url: 'https://api.oneyes.ai/v1/videos/grok-task/content', respect_moderation: true } } };
        });
        const task = { id: 'grok-task', provider: 'openai' as const, model: config.model };
        const result = await pollVideoGenerationTask(config, task);
        assert.equal(result.status, 'completed');
        assert.equal(calls.length, 2);
        assert.equal(calls[1].headers?.Authorization, 'Bearer fixture-key');
        assert.match(calls[1].url!, /^https:\/\/oneyes.ai\/v1\/videos\/grok-task\/content$/);
        calls.length = 0;
        adapter(request => {
            calls.push(request);
            return request.url?.includes('storage.example') ? { data: new Blob(['video'], { type: 'video/mp4' }) } : { data: { status: 'done', video: { url: 'https://storage.example/clip.mp4?signature=a%2Fb', respect_moderation: true } } };
        });
        assert.equal((await pollVideoGenerationTask(config, task)).status, 'completed');
        assert.equal(calls[1].headers?.Authorization, undefined);
        assert.equal(calls[1].headers?.Cookie, undefined);
        assert.equal(calls[1].url, 'https://storage.example/clip.mp4?signature=a%2Fb');
    } finally { axios.defaults.adapter = original; }
});

test('expired, moderated and done-without-content tasks stop without resubmitting; 415 errors are actionable', async () => {
    try {
        const task = { id: 'grok-task', provider: 'openai' as const, model: config.model };
        for (const data of [{ status: 'expired' }, { status: 'failed', error: { message: 'upstream failed' } }, { status: 'done', video: { respect_moderation: false } }, { status: 'done' }]) {
            let calls = 0;
            adapter(request => { calls++; assert.equal(request.method, 'get'); return { data }; });
            await assert.rejects(waitForVideoGenerationTask(config, task));
            assert.equal(calls, 1);
        }
        let posts = 0;
        axios.defaults.adapter = async request => { posts++; throw new AxiosError('error', 'ERR_BAD_RESPONSE', request, undefined, { data: { error: { message: 'xAI upstream returned status 415' } }, status: 400, statusText: '', headers: {}, config: request }); };
        await assert.rejects(createVideoGenerationTask(config, 'test'), /415.*客户端/);
        assert.equal(posts, 1, 'never retry or fall back after a paid POST');
        await assert.rejects(createVideoGenerationTask({ ...config, model: 'default::grok-imagine-video-1.5' }, 'test'), /需要参考图片/);
        assert.equal(posts, 1, 'image-only models must fail before a paid request when the image is missing');
        axios.defaults.adapter = async request => { posts++; throw new AxiosError('error', 'ERR_BAD_RESPONSE', request, undefined, { data: { error: { message: '1080p video resolution is not supported for reference-to-video requests.' } }, status: 400, statusText: '', headers: {}, config: request }); };
        await assert.rejects(createVideoGenerationTask(config, 'test'), /参考模式.*1080p.*保留.*分辨率/);
        assert.equal(posts, 2, 'an upstream rejection must not trigger automatic paid resubmission');
    } finally { axios.defaults.adapter = original; }
});
