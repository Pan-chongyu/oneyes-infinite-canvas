import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import type { AiConfig } from '@/stores/use-config-store';
import type { VideoReferenceSummary } from '@/lib/video-capabilities';

const values = new Map<string, string>();
globalThis.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); }, removeItem: k => { values.delete(k); }, clear: () => values.clear(), key: i => [...values.keys()][i] ?? null, get length() { return values.size; } };
globalThis.window = { localStorage } as unknown as Window & typeof globalThis;
const { createVideoGenerationTask, pollVideoGenerationTask, waitForVideoGenerationTask } = await import('./video');
const { defaultConfig } = await import('@/stores/use-config-store');
const { videoModelCatalog } = await import('@/lib/video-model-catalog');
const { useVideoCatalogStore } = await import('@/stores/use-video-catalog-store');
const availableModels = [...videoModelCatalog.flatMap(model => [model.id, ...model.aliases]), 'sora-2', 'seedance-2.5'];
const desktop = () => ({ models: { list: async () => ({ data: availableModels }) } }) as unknown as NonNullable<Window['oneYesDesktop']>;
beforeEach(() => { window.oneYesDesktop = desktop(); useVideoCatalogStore.setState({ catalog: undefined, delayed: true, restore: async () => {} }); });
const interceptor = axios.interceptors.request.use(request => {
    if (request.url?.startsWith('oneyes-canvas://app/oneyes-api')) request.url = request.url.replace('oneyes-canvas://app/oneyes-api', 'https://oneyes.ai');
    return request;
});
const { queryClient } = await import('@/lib/query-client');
after(() => { axios.interceptors.request.eject(interceptor); queryClient.clear(); });
const { isUnsupportedGrokVideoResolution, isUnsupportedMiniMaxVideoResolution, usesGrokVideoReferences } = await import('@/lib/video-capabilities');
const config = { ...defaultConfig, channels: [{ ...defaultConfig.channels[0], apiKey: 'fixture-key' }], model: 'default::grok-imagine-video', videoSeconds: '5', size: '1:1', vquality: '480' };
const original = axios.defaults.adapter;
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
function adapter(handle: (request: AxiosRequestConfig) => { data: unknown; status?: number }) {
    axios.defaults.adapter = async request => ({ status: 200, ...handle(request), statusText: 'OK', headers: {}, config: request });
}

test('browser bridge diagnostics keep the real task ID, capture three stages and cannot interrupt an accepted receipt', async () => {
    const ids = ['a', 'b', 'c'].map(digit => 'br_' + digit.repeat(32));
    const model = videoModelCatalog.find(model => model.id === 'seedance-2.0-fast-discount')!;
    const selected = { ...config, model: 'default::' + model.aliases[0], vquality: '720', videoSeconds: '4', size: '16:9', videoMode: 'reference' };
    const records: Record<string, { bridgeRequestId?: string }> = {};
    let posts = 0, queries = 0;
    const options = { onDiagnostic: (diagnostics: typeof records) => { Object.assign(records, diagnostics); } };
    try {
        axios.defaults.adapter = async request => {
            let data: unknown, id: string;
            if (request.method === 'post') { posts++; assert.equal(request.url, 'https://oneyes.ai/v1/videos'); data = { request_id: 'bv_real_receipt', bridge_request_id: ids[0] }; id = ids[0]; }
            else if (request.url?.endsWith('/content')) { queries++; data = new Blob(['video'], { type: 'video/mp4' }); id = ids[2]; }
            else { queries++; assert.match(request.url!, /\/bv_real_receipt$/); data = { status: 'completed', bridge_request_id: ids[1] }; id = ids[1]; }
            return { data, status: 200, statusText: '', headers: { 'x-request-id': id }, config: request };
        };
        const task = await createVideoGenerationTask(selected, 'private prompt', [], options);
        assert.equal(task.id, 'bv_real_receipt');
        assert.equal((await pollVideoGenerationTask(selected, task, options)).status, 'completed');
        assert.deepEqual(['submit', 'poll', 'download'].map(stage => records[stage].bridgeRequestId), ids);
        assert.equal(posts, 1); assert.equal(queries, 2);
        assert.doesNotMatch(JSON.stringify(records), /private prompt|fixture-key|Bearer|request_id/);
        const second = await createVideoGenerationTask(selected, 'private prompt', [], { onDiagnostic: () => { throw Error('diagnostic storage failed'); } });
        assert.equal(second.id, task.id); assert.equal(posts, 2, 'the diagnostic callback never retries or loses the accepted task');
    } finally { axios.defaults.adapter = original; }
});

test('explicit retirement, outage or managed pause stops paid creation while the original receipt still recovers', async () => {
    const { parseVideoCatalog } = await import('../../../../desktop/video-catalog.mjs');
    let posts = 0, queries = 0, discoveries = 0;
    window.oneYesDesktop!.models.list = async () => { discoveries++; return { data: availableModels }; };
    try {
        adapter(request => {
            if (request.method === 'post') { posts++; return { data: { request_id: 'new-task' } }; }
            queries++; assert.match(request.url!, /\/videos\/original-receipt$/);
            return { data: { status: 'processing' } };
        });
        for (const [status, enabled, pattern] of [['retired', false, /已下架/], ['unavailable', false, /暂不可用/], ['active', false, /暂停新建/]] as const) {
            useVideoCatalogStore.setState({ catalog: parseVideoCatalog({ schema_version: 1, generated_at: new Date().toISOString(), check: { stale: false }, data: [{ id: 'grok-imagine-video', request_ids: ['grok-imagine-video'], status, new_tasks_enabled: enabled, stale: false, price_stale: false, parameters_stale: false }] }) });
            await assert.rejects(createVideoGenerationTask(config, 'new paid task'), pattern);
            assert.equal((await pollVideoGenerationTask(config, { id: 'original-receipt', provider: 'openai', model: config.model })).status, 'pending');
        }
        assert.equal(posts, 0); assert.equal(discoveries, 0); assert.equal(queries, 3);
        useVideoCatalogStore.setState({ catalog: undefined, delayed: true });
        // A feed request that never returns must not hold a permitted generation hostage.
        let release!: (value: { error: string }) => void;
        window.oneYesDesktop!.models.videoCatalog = async () => new Promise(resolve => { release = resolve; });
        assert.equal((await createVideoGenerationTask(config, 'explicit user generation')).id, 'new-task');
        assert.equal(posts, 1); assert.equal(discoveries, 1);
        release({ error: 'delayed' }); await turn();
    } finally { axios.defaults.adapter = original; queryClient.clear(); }
});

test('video waits past the old 120-poll limit and retries only the original GET after transient failures', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const task = { id: 'long-running', provider: 'openai' as const, model: config.model };
    const controller = new AbortController();
    let queries = 0, downloads = 0;
    try {
        axios.defaults.adapter = async request => {
            assert.equal(request.method, 'get'); assert.equal(request.timeout, 0);
            if (request.url?.includes('storage.example')) {
                assert.equal(request.headers?.Authorization, undefined);
                if (++downloads === 1) throw new AxiosError('download disconnected', 'ERR_NETWORK', request);
                return { data: new Blob(['video'], { type: 'video/mp4' }), status: 200, statusText: '', headers: {}, config: request };
            }
            assert.ok(request.url?.endsWith('/videos/long-running'));
            queries++;
            if (queries === 3) throw new AxiosError('offline', 'ERR_NETWORK', request);
            if (queries === 4) throw new AxiosError('temporary', 'ERR_BAD_RESPONSE', request, undefined, { data: {}, status: 504, statusText: '', headers: {}, config: request });
            return { data: queries <= 130 ? { status: 'processing' } : { status: 'completed', url: 'https://storage.example/clip.mp4' }, status: 200, statusText: '', headers: {}, config: request };
        };
        const waiting = waitForVideoGenerationTask(config, task, { signal: controller.signal });
        for (let n = 0; n < 140; n++) { await turn(); t.mock.timers.tick(2500); }
        assert.equal((await waiting).blob?.size, 5);
        assert.equal(queries, 132); assert.equal(downloads, 2);
        const events = await import('node:events') as unknown as { getEventListeners(target: EventTarget, type: string): unknown[] };
        assert.equal(events.getEventListeners(controller.signal, 'abort').length, 0);
    } finally { controller.abort(); axios.defaults.adapter = original; t.mock.timers.reset(); }
});

test('indefinite video waiting still stops on cancellation or authentication failure without resubmitting', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const task = { id: 'pending', provider: 'openai' as const, model: config.model };
    let calls = 0;
    try {
        adapter(request => { calls++; assert.equal(request.method, 'get'); return { data: { status: 'pending' } }; });
        const controller = new AbortController();
        const waiting = waitForVideoGenerationTask(config, task, { signal: controller.signal });
        const canceled = assert.rejects(waiting, error => (error as Error).name === 'AbortError');
        await turn(); controller.abort(); await canceled;
        assert.equal(calls, 1);
        axios.defaults.adapter = async request => { calls++; throw new AxiosError('authentication', 'ERR_BAD_REQUEST', request, undefined, { data: {}, status: 401, statusText: '', headers: {}, config: request }); };
        await assert.rejects(waitForVideoGenerationTask(config, task));
        assert.equal(calls, 2);
    } finally { axios.defaults.adapter = original; t.mock.timers.reset(); }
});

test('browser polling and media GET respect Retry-After without recreating the task', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-11-17T00:00:00Z') });
    const task = { id: 'opaque/receipt?value', provider: 'openai' as const, model: config.model };
    const controller = new AbortController(); let queries = 0, downloads = 0;
    try {
        axios.defaults.adapter = async request => {
            assert.equal(request.method, 'get'); assert.equal(request.timeout, 0);
            if (request.url?.includes('storage.example')) {
                downloads++; assert.equal(request.headers?.Authorization, undefined); assert.equal(request.headers?.Cookie, undefined);
                if (downloads === 1) throw new AxiosError('busy', 'ERR_BAD_RESPONSE', request, undefined, { config: request, status: 503, statusText: '', headers: { 'retry-after': '9' }, data: {} });
                return { config: request, status: 200, statusText: '', headers: {}, data: new Blob(['original'], { type: 'video/mp4' }) };
            }
            assert.ok(request.url?.endsWith('/videos/opaque%2Freceipt%3Fvalue'));
            queries++;
            if (queries === 1) return { config: request, status: 202, statusText: '', headers: { 'retry-after': '7' }, data: '' };
            return { config: request, status: 200, statusText: '', headers: {}, data: { status: 'completed', url: 'https://storage.example/video' } };
        };
        const waiting = waitForVideoGenerationTask(config, task, { signal: controller.signal });
        await turn(); assert.equal(queries, 1);
        t.mock.timers.tick(6999); await turn(); assert.equal(queries, 1);
        t.mock.timers.tick(1); await turn(); assert.equal(queries, 2); assert.equal(downloads, 1);
        t.mock.timers.tick(8999); await turn(); assert.equal(queries, 2);
        t.mock.timers.tick(1); await turn(); assert.equal((await waiting).blob?.size, 8);
        assert.equal(queries, 3); assert.equal(downloads, 2);
    } finally { controller.abort(); axios.defaults.adapter = original; t.mock.timers.reset(); }
});

test('both server cancellation spellings stop waiting and use a distinct safe message', async () => {
    try {
        for (const status of ['cancelled', 'canceled']) {
            let calls = 0;
            adapter(request => { calls++; assert.equal(request.method, 'get'); return { data: { status, error: { message: 'private provider balance secret' } } }; });
            await assert.rejects(waitForVideoGenerationTask(config, { id: 'original', provider: 'openai', model: config.model }), /服务端已取消原视频任务/);
            assert.equal(calls, 1);
        }
    } finally { axios.defaults.adapter = original; }
});

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

test('OneYes Video routes exact bare and priced Grok IDs through create/query/content while foreign native stays native', async () => {
    const calls: AxiosRequestConfig[] = [];
    try {
        adapter(request => {
            calls.push(request);
            return { data: request.method === 'post' ? { request_id: 'public-bridge-task' } : request.url?.endsWith('/content') ? new Blob(['video'], { type: 'video/mp4' }) : { status: 'done', video: { url: '/v1/videos/public-bridge-task/content' } } };
        });
        for (const info of videoModelCatalog.filter(model => model.id.startsWith('grok-'))) for (const id of [info.id, ...info.aliases]) {
            const model = 'oneyes-minimax::' + id;
            const selected = { ...config, model, channels: [{ ...config.channels[0], id: 'oneyes-minimax' }], videoMode: 'frames', size: '16:9', vquality: '720' };
            const before = JSON.stringify(selected), count = calls.length;
            const references = [{ id: 'public-ref', name: 'reference.png', type: 'image/png', dataUrl: 'https://cdn.example.com/ref.png', url: 'https://cdn.example.com/ref.png' }];
            const task = await createVideoGenerationTask(selected, 'offline fixture', references);
            assert.equal(task.id, 'public-bridge-task'); assert.equal(task.model, model);
            assert.equal(calls[count].url, 'https://oneyes.ai/v1/videos');
            assert.deepEqual(JSON.parse(await (calls[count].data as Blob).text()), { model: id, prompt: 'offline fixture', resolution: '720p', duration: 5, aspect_ratio: '16:9', image: 'https://cdn.example.com/ref.png' });
            assert.equal((await pollVideoGenerationTask(selected, task)).status, 'completed');
            assert.equal(calls.length, count + 3);
            assert.match(calls[count + 1].url!, /\/v1\/videos\/public-bridge-task$/);
            assert.match(calls[count + 2].url!, /\/v1\/videos\/public-bridge-task\/content$/);
            assert.equal(calls[count + 2].headers?.Authorization, 'Bearer fixture-key');
            for (const media of [{ videos: [{ id: 'v', name: 'clip.mp4', type: 'video/mp4', url: 'https://cdn.example.com/clip.mp4' }] }, { audios: [{ id: 'a', name: 'sound.mp3', type: 'audio/mpeg', url: 'https://cdn.example.com/sound.mp3' }] }]) await assert.rejects(createVideoGenerationTask(selected, 'unsupported', references, media), /不支持参考视频、视频编辑或上传参考音频/);
            assert.equal(calls.length, count + 3, 'unsupported media never sends a paid POST or /edits');
            assert.equal(JSON.stringify(selected), before);
        }
        const native = { ...config, channels: [{ ...config.channels[0], id: 'oneyes-minimax', baseUrl: 'https://native.example' }], model: 'oneyes-minimax::grok-imagine-video' };
        await createVideoGenerationTask(native, 'native fixture');
        assert.match(calls.at(-1)!.url!, /^https:\/\/native\.example\/v1\/videos\/generations$/);
        assert.equal(JSON.parse(calls.at(-1)!.data).model, 'grok-imagine-video');
        const count = calls.length;
        window.oneYesDesktop!.models.list = async () => ({ data: ['unrelated-model'] });
        await assert.rejects(createVideoGenerationTask({ ...config, channels: [{ ...config.channels[0], id: 'oneyes-minimax' }], model: 'oneyes-minimax::grok-imagine-video' }, 'unauthorized'), /当前 API Key.*不包含/);
        assert.equal(calls.length, count, 'catalog recognition never bypasses this Key exact admission');
    } finally { axios.defaults.adapter = original; }
});

test('MiniMax H accepts only 768P, 1080P and 2K without submitting unsupported requests', async () => {
    const miniMax = { ...config, model: 'default::minimax-h3', vquality: '480' };
    assert.equal(isUnsupportedMiniMaxVideoResolution(miniMax), true);
    let posts = 0;
    const calls: AxiosRequestConfig[] = [];
    try {
        adapter(() => { posts++; return { data: { id: 'unexpected' } }; });
        await assert.rejects(createVideoGenerationTask(miniMax, 'invalid resolution'), /768p.*1080p.*2K/i);
        assert.equal(posts, 0);

        for (const [resolution, expected] of [['768', '768P'], ['1080', '1080P'], ['2k', '2K']] as const) {
            adapter(request => { posts++; calls.push(request); return { data: { id: `mini-${expected}` } }; });
            const task = await createVideoGenerationTask({ ...miniMax, size: '16:9', vquality: resolution }, 'valid resolution');
            assert.equal(task.id, `mini-${expected}`);
            assert.equal(JSON.parse(await (calls.at(-1)!.data as Blob).text()).resolution, expected.toLowerCase());
        }
        assert.equal(posts, 3);
    } finally { axios.defaults.adapter = original; }
});

test('wan3.0 old and corrected aliases reject 5–9 seconds before POST and preserve failed task GET recovery', async () => {
    const info = videoModelCatalog.find(model => model.id === 'wan3.0')!;
    let posts = 0, gets = 0;
    try {
        adapter(request => {
            if (request.method === 'post') { posts++; return { data: { request_id: 'wan-original' } }; }
            gets++; assert.match(request.url!, /\/videos\/original-five-seconds$/);
            return { data: { status: 'failed', error: { code: 'unsupported_duration' } } };
        });
        for (const id of [info.id, ...info.aliases]) {
            const selected = { ...config, model: 'default::' + id, size: '16:9', vquality: '720', videoMode: 'reference', videoSeconds: '5' };
            const before = JSON.stringify(selected), count = posts;
            for (const videoSeconds of ['5', '9']) await assert.rejects(createVideoGenerationTask({ ...selected, videoSeconds }, 'invalid'), /时长.*保留/);
            assert.equal(posts, count);
            const recovered = await pollVideoGenerationTask(selected, { id: 'original-five-seconds', provider: 'openai', model: selected.model });
            assert.equal(recovered.status, 'failed');
            assert.equal(posts, count, 'invalid old parameters never block original GET or cause a new POST');
            await createVideoGenerationTask({ ...selected, videoSeconds: '10' }, 'valid');
            assert.equal(posts, count + 1);
            assert.equal(JSON.stringify(selected), before);
        }
        assert.equal(gets, 3);
    } finally { axios.defaults.adapter = original; }
});

test('OneYes Grok Seedance uses JSON booleans and the exact selected channel; manual keys work too', async () => {
    const calls: AxiosRequestConfig[] = [];
    const grok = { ...config.channels[0], id: 'oneyes-minimax', apiKey: 'seedance-fixture-key', oneYes: { platform: 'grok' as const, groupId: 2, groupName: 'Video', keyId: 3, accountId: 1 } };
    try {
        adapter(request => { calls.push(request); return { data: { id: 'seedance-task' } }; });
        for (const manual of [false, true]) {
            for (const enabled of ['false', 'true']) {
                const selected = { ...config, channels: [...config.channels, { ...grok, ...(manual ? { oneYes: undefined } : {}) }], model: 'oneyes-minimax::seedance-2.5', size: '16:9', vquality: '1080', videoWatermark: enabled, videoGenerateAudio: enabled };
                const task = await createVideoGenerationTask(selected, 'test');
                const request = calls.at(-1)!;
                assert.equal(task.id, 'seedance-task');
                assert.equal(task.model, selected.model);
                assert.match(request.url!, /\/v1\/videos\/generations$/);
                assert.equal(request.headers?.Authorization, 'Bearer seedance-fixture-key');
                assert.equal(request.headers?.['Content-Type'], 'application/json');
                assert.deepEqual(JSON.parse(request.data), { model: 'seedance-2.5', prompt: 'test', duration: 5, aspect_ratio: '16:9', resolution: '1080p', watermark: enabled === 'true', generate_audio: enabled === 'true' });
                assert.equal(selected.vquality, '1080');
            }
        }
        await createVideoGenerationTask({ ...config, channels: [{ ...grok, id: 'other-grok-id' }], model: 'other-grok-id::doubao-seedance-2.5', vquality: '720', size: '16:9' }, 'alias');
        assert.equal(JSON.parse(await (calls.at(-1)!.data as Blob).text()).model, 'doubao-seedance-2.5');
        assert.equal(calls.length, 5);
        adapter(request => { calls.push(request); return { data: { id: 'multipart-task' } }; });
        await createVideoGenerationTask({ ...config, model: 'default::seedance-2.5' }, 'other protocol');
        assert.ok(calls.at(-1)!.data instanceof FormData, 'a model name alone must not change another channel protocol');

        let posts = 0;
        axios.defaults.adapter = async request => {
            posts++;
            throw new AxiosError('rejected', 'ERR_BAD_REQUEST', request, undefined, { data: { error: { message: '水印开关参数无效，请使用 true 或 false。' } }, status: 400, statusText: '', headers: {}, config: request });
        };
        await assert.rejects(createVideoGenerationTask({ ...config, channels: [grok], model: 'oneyes-minimax::seedance-2.5' }, 'test'), /水印开关参数无效/);
        assert.equal(posts, 1, 'never retry a paid request using another protocol');
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
        for (const data of [{ status: 'expired' }, { status: 'cancelled' }, { status: 'canceled' }, { status: 'failed', error: { message: 'upstream failed' } }, { status: 'done', video: { respect_moderation: false } }, { status: 'done' }]) {
            let calls = 0;
            adapter(request => { calls++; assert.equal(request.method, 'get'); return { data }; });
            await assert.rejects(waitForVideoGenerationTask(config, task));
            assert.equal(calls, 1);
        }
        let queries = 0;
        adapter(request => { queries++; assert.equal(request.method, 'get'); return { data: { status: 'failed', error: { code: 'video_generation_failed', message: 'task not found' } } }; });
        await assert.rejects(waitForVideoGenerationTask(config, task), /视频生成未完成.*核对原任务/);
        assert.equal(queries, 1, 'the fixed public failure code takes precedence over untrusted text and never resubmits');
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

test('422 validation arrays identify rejected fields and 404 explains model/group checks without replay or changing settings', async () => {
    let posts = 0;
    const before = structuredClone(config);
    const reports: unknown[] = [];
    window.oneYesDesktop = { ...desktop(), diagnostics: { report: async input => { reports.push(input); }, recover: async () => {} } };
    try {
        for (const [status, data, pattern] of [
            [422, { detail: [{ loc: ['body', 'resolution'], msg: 'unsupported resolution', input: 'private-reference' }, { loc: ['body', 'duration'], msg: 'invalid duration' }] }, /时长.*保留/],
            [422, { error: { message: 'invalid aspect ratio' } }, /分辨率.*比例/],
            [422, {}, /422.*参数已保留/],
            [404, { detail: 'Not Found' }, /404.*Key.*分组.*官网/],
        ] as const) {
            axios.defaults.adapter = async request => {
                posts++;
                throw new AxiosError('rejected', 'ERR_BAD_REQUEST', request, undefined, { data, status, statusText: '', headers: {}, config: request });
            };
            await assert.rejects(createVideoGenerationTask(config, 'test'), error => {
                assert.match(String(error), pattern); assert.doesNotMatch(String(error), /private-reference/);
                assert.equal((error as Error).cause instanceof AxiosError, true); return true;
            });
        }
        assert.equal(posts, 4); assert.deepEqual(config, before);
        assert.ok(reports.every(value => (value as { stage: string }).stage === 'submit'));
    } finally { axios.defaults.adapter = original; }
});

test('each create revalidates this key against exact upstream IDs rather than stale cached names or guessed aliases', async () => {
    const { fetchModelCatalog } = await import('./model-catalog');
    const selected = { ...config, model: 'default::wan3.0-video', size: '16:9', vquality: '720', videoSeconds: '5', videoMode: 'reference' };
    const before = structuredClone(selected); let posts = 0, discoveries = 0;
    try {
        await fetchModelCatalog(selected.channels[0]); // Seed a catalog with this model allowed.
        window.oneYesDesktop!.models.list = async key => { discoveries++; assert.equal(key, 'fixture-key'); return { data: ['wan3.0-video-prime'] }; };
        adapter(() => { posts++; return { data: { id: 'unexpected' } }; });
        await assert.rejects(createVideoGenerationTask(selected, 'fixture'), /当前 API Key.*不包含.*刷新.*分组/);
        assert.equal(posts, 0); assert.equal(discoveries, 1); assert.deepEqual(selected, before);
        const alias = videoModelCatalog.find(model => model.id === 'wan3.0-video')!.aliases[0];
        window.oneYesDesktop!.models.list = async () => ({ data: ['wan3.0-video'] });
        await assert.rejects(createVideoGenerationTask({ ...selected, model: `default::${alias}` }, 'fixture'), /不包含/);
        assert.equal(posts, 0, 'a permitted canonical ID cannot authorize a different priced alias');
        window.oneYesDesktop!.models.list = async key => ({ data: key === 'fixture-other-key' ? ['wan3.0-video-prime'] : ['wan3.0-video'] });
        await assert.rejects(createVideoGenerationTask({ ...selected, channels: [{ ...selected.channels[0], apiKey: 'fixture-other-key' }] }, 'fixture'), /不包含/);
        assert.equal(posts, 0);
        axios.defaults.adapter = async request => { posts++; throw new AxiosError('permission rejected', 'ERR_BAD_REQUEST', request, undefined, { config: request, status: 404, statusText: '', headers: {}, data: { error: { code: 'model_not_allowed', message: 'Not Found' } } }); };
        await assert.rejects(createVideoGenerationTask(selected, 'fixture'), /无权调用.*刷新.*不会自动换 Key/);
        assert.equal(posts, 1); assert.deepEqual(selected, before);
    } finally { axios.defaults.adapter = original; }
});

test('bridge 413 errors distinguish inline text, total envelope and CDN limits without retrying or switching sites', async () => {
    const selected = { ...config, model: 'default::wan3.0-video', size: '16:9', vquality: '720' }; let posts = 0;
    try {
        for (const [code, pattern] of [['inline_text_too_large', /32 MiB.*二进制/], ['bridge_request_too_large', /128 MiB.*CDN/], ['', /模型.*访问入口.*更改接口地址/]] as const) {
            axios.defaults.adapter = async request => { posts++; assert.equal(request.url, 'https://oneyes.ai/v1/videos'); throw new AxiosError('too large', 'ERR_BAD_REQUEST', request, undefined, { config: request, status: 413, statusText: '', headers: {}, data: { code } }); };
            await assert.rejects(createVideoGenerationTask(selected, 'fixture'), pattern);
        }
        assert.equal(posts, 3); assert.equal(selected.baseUrl, config.baseUrl); assert.equal(selected.vquality, '720');
    } finally { axios.defaults.adapter = original; }
});

test('retired Seedance per-second IDs cannot authorize or post replacement Token-priced models', async () => {
    let posts = 0, reads = 0;
    window.oneYesDesktop!.models.list = async () => { reads++; return { data: ['doubao-seedance-2.0', 'doubao-seedance-2.5'] }; };
    try {
        adapter(() => { posts++; return { data: { id: 'must-not-create' } }; });
        for (const model of ['seedance-2.0', 'doubao-seedance-2.0-fast', 'seedance-2.0-mini', 'seedance-2.0 [720p ¥1/秒]']) {
            const selected = { ...config, model: 'default::' + model, videoSeconds: '5', vquality: '720', size: '16:9' };
            const before = structuredClone(selected);
            await assert.rejects(createVideoGenerationTask(selected, 'fixture'), /不包含.*刷新/);
            assert.deepEqual(selected, before);
        }
        assert.equal(reads, 4); assert.equal(posts, 0);
    } finally { axios.defaults.adapter = original; }
});

test('retired video receipts recover only by original task GET and key without model discovery or pricing remap', async () => {
    let discoveries = 0;
    window.oneYesDesktop!.models.list = async () => { discoveries++; throw Error('Recovery must not require a create catalog'); };
    const model = 'old-channel::seedance-2.0 [720p ¥1/秒]';
    const selected = { ...config, videoModel: 'default::doubao-seedance-2.0', channels: [...config.channels, {
        ...config.channels[0], id: 'old-channel', apiKey: 'original-recovery-key',
        models: [{ name: 'seedance-2.0 [720p ¥1/秒]', capability: 'video' as const, unavailable: true }],
    }] };
    const before = structuredClone(selected), requests: AxiosRequestConfig[] = [];
    try {
        adapter(request => {
            requests.push(request);
            assert.equal(request.method, 'get'); assert.equal(request.timeout, 0);
            assert.equal(request.headers?.Authorization, 'Bearer original-recovery-key');
            assert.equal(request.params, undefined); assert.equal(request.data, undefined);
            assert.match(request.url!, /\/v1\/videos\/original-task(?:\/content)?$/);
            return { data: request.url!.endsWith('/content') ? new Blob(['original-video'], { type: 'video/mp4' }) : { status: 'done', url: 'https://oneyes.ai/v1/videos/original-task/content' } };
        });
        const result = await waitForVideoGenerationTask(selected, { id: 'original-task', model, provider: 'openai' });
        assert.equal(await result.blob?.text(), 'original-video');
        assert.equal(discoveries, 0); assert.equal(requests.length, 2);
        assert.deepEqual(selected, before);
    } finally { axios.defaults.adapter = original; }
});

test('submit, terminal status and JSON/HTML download errors never expose private service details or replay a create', async () => {
    const privateText = 'VendorOther https://private.invalid/account Bearer sk-private balance=987654';
    const forbidden = /VendorOther|private.invalid|Bearer|sk-private|987654|充值/;
    const task = { id: 'safe-task', provider: 'openai' as const, model: config.model };
    let posts = 0;
    try {
        for (const code of ['INSUFFICIENT_BALANCE', 'creation_outcome_unknown', 'media_too_large', 'video_generation_failed']) {
            axios.defaults.adapter = async request => { posts++; throw new AxiosError('raw ' + privateText, 'ERR_BAD_RESPONSE', request, undefined, { config: request, status: 409, statusText: '', headers: { 'x-request-id': '12345678-1234-1234-1234-123456789abc' }, data: { error: { code, message: privateText } } }); };
            await assert.rejects(createVideoGenerationTask(config, 'safe'), error => { assert.doesNotMatch((error as Error).message, forbidden); assert.match((error as Error).message, /本站请求编号/); return true; });
        }
        assert.equal(posts, 4);
        adapter(() => ({ data: { status: 'failed', error: { message: privateText } } }));
        const state = await pollVideoGenerationTask(config, task);
        assert.equal(state.status, 'failed'); if (state.status === 'failed') assert.doesNotMatch(state.error, forbidden);
        for (const blob of [new Blob([JSON.stringify({ error: { message: privateText } })], { type: 'application/json' }), new Blob(['<html>' + privateText + '</html>'], { type: 'text/html' })]) {
            adapter(request => request.url?.endsWith('/content') ? { data: blob } : { data: { status: 'completed' } });
            await assert.rejects(pollVideoGenerationTask(config, task), error => { assert.doesNotMatch((error as Error).message, forbidden); return true; });
        }
    } finally { axios.defaults.adapter = original; }
});

test('custom cancellation bodies stay private while the original name and cause stop generation', async () => {
    const { videoUserError, videoErrorText } = await import('@/lib/video-display-text');
    const { isGenerationCanceled } = await import('@/lib/canvas/canvas-generation-helpers');
    for (const name of ['AbortError', 'CanceledError']) {
        const raw = Object.assign(Error('VendorOther https://private.invalid Bearer sk-private balance=987654'), { name });
        const safe = videoUserError(raw);
        assert.equal(safe.name, name); assert.equal(safe.cause, raw); assert.equal(safe.message, videoErrorText(raw));
        assert.doesNotMatch(safe.message, /private|VendorOther|Bearer|987654/); assert.equal(isGenerationCanceled(safe), true);
        try {
            axios.defaults.adapter = async () => { throw raw; };
            await assert.rejects(createVideoGenerationTask(config, 'cancel'), error => (error as Error).name === name && !/private|987654/.test((error as Error).message));
        } finally { axios.defaults.adapter = original; }
    }
});

test('specific rejection, generic gateway and unknown create/poll errors keep safe distinctions without resubmission', async () => {
    const { videoErrorMessages: messages } = await import('../../../../desktop/video-errors.mjs');
    const privateText = '智赢 88API VendorOther https://private.invalid Bearer sk-private balance=987654';
    const rejection = '参考图片可能包含真人或可识别人物，未通过上游内容审核。请更换参考图片后重试。 ' + privateText;
    const id = '12345678-1234-1234-1234-123456789abc';
    const before = structuredClone(config);
    let posts = 0, gets = 0, status = 'failed';
    try {
        for (const [error, expected] of [
            [{ type: 'upstream_error', message: rejection }, messages.reference_person_policy],
            [{ code: 'content_policy', message: 'Content policy violation' }, messages.content_policy],
            [{ type: 'upstream_error', message: 'Upstream gateway error' }, messages.unknown],
            [{ type: 'creation_outcome_unknown', message: rejection + ' 任务未提交，不扣费' }, messages.creation_outcome_unknown],
            [{ code: 'invalid_reference_format', message: privateText }, messages.invalid_reference_format],
            [{ code: 'material_count', message: privateText }, messages.material_count],
            [{ code: 'media_too_large', message: privateText }, messages.media_too_large],
            [{ code: 'duration_invalid', message: privateText }, messages.duration_invalid],
            [{ code: 'resolution_or_ratio_invalid', message: privateText }, messages.resolution_invalid],
            [{ code: 'unsupported_field', message: privateText }, messages.parameters_invalid],
        ] as const) {
            axios.defaults.adapter = async request => {
                if (request.method === 'post') { posts++; throw new AxiosError('opaque', 'ERR_BAD_RESPONSE', request, undefined, { config: request, status: 500, statusText: '', headers: { 'x-request-id': id }, data: { error } }); }
                gets++; assert.equal(request.method, 'get'); assert.match(request.url!, /\/videos\/original-task$/); assert.equal(request.params, undefined);
                return { config: request, status: 200, statusText: '', headers: { 'x-request-id': id }, data: { status, error, video: { respect_moderation: false } } };
            };
            await assert.rejects(createVideoGenerationTask(config, 'mock'), err => (err as Error).message === expected + '\n本站请求编号：' + id);
            for (status of ['failed', 'error']) assert.deepEqual(await pollVideoGenerationTask(config, { id: 'original-task', provider: 'openai', model: config.model }), { status: 'failed', error: expected + '\n本站请求编号：' + id });
        }
        assert.equal(posts, 10); assert.equal(gets, 20); assert.deepEqual(config, before);
    } finally { axios.defaults.adapter = original; }
});


for (const code of ['video_service_busy', 'video_generation_timeout', 'video_status_unavailable', 'video_content_unavailable', 'video_not_ready']) for (const phase of ['poll', 'download']) {
    test('browser temporary 422 ' + code + ' at ' + phase + ' reports safe node progress and respects Retry-After using GET only', async t => {
        t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-11-18T00:00:00Z') });
        const { videoErrorMessages: messages } = await import('../../../../desktop/video-errors.mjs');
        const reasons: (string | undefined)[] = []; let queries = 0, downloads = 0;
        const controller = new AbortController();
        try {
            axios.defaults.adapter = async request => {
                assert.equal(request.method, 'get'); assert.equal(request.timeout, 0);
                const content = request.url!.endsWith('/content'); if (content) downloads++; else queries++;
                if (phase === 'poll' ? queries === 1 : content && downloads === 1) throw new AxiosError('private', 'ERR_BAD_REQUEST', request, undefined, { config: request, status: 422, statusText: '', headers: { 'retry-after': '9' }, data: content ? new Blob([JSON.stringify({ error: { code, message: 'VendorOther https://private.invalid balance=999 sk-private' } })], { type: 'application/json' }) : { error: { code, type: 'unrelated', message: 'VendorOther https://private.invalid balance=999 sk-private' } } });
                return { config: request, status: 200, statusText: '', headers: {}, data: content ? new Blob(['original'], { type: 'video/mp4' }) : { status: 'completed' } };
            };
            const waiting = waitForVideoGenerationTask(config, { id: 'original', provider: 'openai', model: config.model }, { signal: controller.signal, onPending: reason => reasons.push(reason) });
            await turn(); assert.equal(reasons[0], messages[code as keyof typeof messages]);
            t.mock.timers.tick(8999); await turn(); assert.equal(queries, 1);
            t.mock.timers.tick(1); await turn(); assert.equal((await waiting).blob?.size, 8); assert.equal(queries, 2);
        } finally { controller.abort(); axios.defaults.adapter = original; t.mock.timers.reset(); }
    });
}

test('browser saved temporary failures resume original receipts while confirmed terminal and unknown submissions stay stopped', async () => {
    const { hasResumableVideoTask } = await import('@/lib/canvas/canvas-generation-helpers');
    const { CanvasNodeType } = await import('@/types/canvas');
    const node = { id: 'original', type: CanvasNodeType.Video, title: '视频', position: { x: 0, y: 0 }, width: 320, height: 200, metadata: { videoTaskId: 'original-task', videoRecoveryState: 'failed', videoErrorCode: 'video_status_unavailable', vquality: '1080' } };
    const before = structuredClone(node);
    assert.equal(hasResumableVideoTask(node), true);
    for (const videoServerStatus of ['failed', 'error', 'expired', 'canceled', 'cancelled']) assert.equal(hasResumableVideoTask({ ...node, metadata: { ...node.metadata, videoServerStatus } }), false);
    assert.equal(hasResumableVideoTask({ ...node, metadata: { ...node.metadata, videoErrorCode: undefined } }), false);
    assert.equal(hasResumableVideoTask({ ...node, metadata: { ...node.metadata, videoTaskId: undefined, videoErrorCode: 'creation_outcome_unknown' } }), false);
    assert.deepEqual(node, before);
});

test('current queued/processing/completed status ignores historical errors, terminal status reads its fixed code', async () => {
    const { videoErrorMessages: messages } = await import('../../../../desktop/video-errors.mjs');
    const task = { id: 'original', provider: 'openai' as const, model: config.model }; let downloads = 0;
    try {
        for (const status of ['queued', 'processing', 'completed']) {
            adapter(request => {
                assert.equal(request.method, 'get');
                if (request.url!.endsWith('/content')) { downloads++; return { data: new Blob(['original'], { type: 'video/mp4' }) }; }
                return { data: { status, error: { code: 'invalid_reference_format', message: 'private' }, video: { respect_moderation: false } } };
            });
            const result = await pollVideoGenerationTask(config, task); assert.equal(result.status, status === 'completed' ? 'completed' : 'pending');
        }
        assert.equal(downloads, 1);
        for (const status of ['failed', 'error', 'expired', 'canceled', 'cancelled']) {
            const code = status === 'expired' ? 'video_task_expired' : status.startsWith('cancel') ? 'video_task_canceled' : 'video_generation_timeout';
            adapter(() => ({ data: { status, error: { code, message: 'VendorOther balance=99 https://private.invalid' } } }));
            assert.deepEqual(await pollVideoGenerationTask(config, task), { status: 'failed', error: messages[code as keyof typeof messages] });
        }
    } finally { axios.defaults.adapter = original; }
});
