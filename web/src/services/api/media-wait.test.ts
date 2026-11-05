import { test } from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';

const values = new Map<string, string>();
globalThis.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); }, removeItem: k => { values.delete(k); }, clear: () => values.clear(), key: i => [...values.keys()][i] ?? null, get length() { return values.size; } };
globalThis.window = { localStorage } as unknown as Window & typeof globalThis;
const { defaultConfig } = await import('@/stores/use-config-store');
const { runModelPlugin } = await import('./model-plugin');
const { requestGeneration } = await import('./image');
const { fetchImageBlob } = await import('../image-storage');
const config = { ...defaultConfig, count: '1', model: 'default::gpt-image-2', channels: [{ ...defaultConfig.channels[0], baseUrl: 'https://fixture.test', apiKey: 'fixture-key' }] };
const original = axios.defaults.adapter;

test('OpenAI and Gemini image requests explicitly disable client timeouts and retain cancellation', async () => {
    const controller = new AbortController();
    let calls = 0;
    try {
        axios.defaults.adapter = async request => {
            calls++;
            assert.equal(request.timeout, 0);
            assert.equal(request.signal, controller.signal);
            const data = request.url?.includes('generateContent') ? { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } }] } }] } : { data: [{ b64_json: 'aW1hZ2U=' }] };
            return { data, status: 200, statusText: '', headers: {}, config: request };
        };
        assert.equal((await requestGeneration(config, 'fixture', { signal: controller.signal })).length, 1);
        assert.equal((await requestGeneration({ ...config, channels: [{ ...config.channels[0], apiFormat: 'gemini' }] }, 'fixture', { signal: controller.signal })).length, 1);
        assert.equal(calls, 2);
    } finally { axios.defaults.adapter = original; }
});

test('image/video script HTTP and polling keep waiting beyond legacy deadlines, while text keeps its policy', async t => {
    let now = 0;
    t.mock.method(performance, 'now', () => now += 600001);
    try {
        axios.defaults.adapter = async request => {
            assert.equal(request.timeout, 0);
            return { data: 'ok', status: 200, statusText: '', headers: {}, config: request };
        };
        for (const capability of ['image', 'video'] as const) {
            const controller = new AbortController();
            const result = await runModelPlugin({ capability, config, signal: controller.signal, script: `
                await http.post('/fixture', {});
                await request({method:'get',url:'/fixture',timeout:1});
                let queries=0;
                return poll(async()=>++queries, value=>value>150?value:null, {intervalMs:0,timeoutMs:1});
            ` });
            assert.equal(result, 151);
            const events = await import('node:events') as unknown as { getEventListeners(target: EventTarget, type: string): unknown[] };
            assert.equal(events.getEventListeners(controller.signal, 'abort').length, 0);
        }
        await assert.rejects(runModelPlugin({ capability: 'text', config, script: 'return poll(async()=>null, value=>value, {intervalMs:0,timeoutMs:1});' }));
        const controller = new AbortController(); controller.abort();
        await assert.rejects(runModelPlugin({ capability: 'video', config, signal: controller.signal, script: 'return poll(async()=>null,value=>value);' }), error => (error as Error).name === 'AbortError');
    } finally { axios.defaults.adapter = original; t.mock.restoreAll(); }
});

test('image downloads can finish after ten minutes without a timer and still accept user cancellation', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const fetcher = globalThis.fetch;
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    let calls = 0;
    try {
        globalThis.fetch = async (_url, options) => {
            calls++;
            await gate;
            assert.ok(!options?.signal?.aborted);
            return new Response(new Blob(['image'], { type: 'image/png' }));
        };
        const pending = fetchImageBlob('https://fixture.test/image.png');
        t.mock.timers.tick(3600000); finish();
        assert.equal((await pending).size, 5); assert.equal(calls, 1);
        const controller = new AbortController(); controller.abort();
        globalThis.fetch = async (_url, options) => { assert.equal(options?.signal, controller.signal); throw controller.signal.reason; };
        await assert.rejects(fetchImageBlob('https://fixture.test/image.png', { signal: controller.signal }), error => (error as Error).name === 'AbortError');
    } finally { globalThis.fetch = fetcher; t.mock.timers.reset(); }
});
