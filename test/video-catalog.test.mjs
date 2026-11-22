import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createVideoCatalog, parseVideoCatalog, parseVideoParameters, videoCatalogExpired } from '../desktop/video-catalog.mjs';

const fixture = () => ({ schema_version: 1, generated_at: new Date().toISOString(), refresh_after_seconds: 300, check: { checked_at: '2026-11-18T00:00:00Z', stale: false }, data: [
    { id: '中文视频-v2', request_ids: ['中文视频-v2', '中文视频-v2【1080p 4秒 ￥0/条】'], recommended_request_id: '中文视频-v2【1080p 4秒 ￥0/条】', model_name: '中文视频-v2', model_info: '1080p 4秒 ￥0/条', status: 'active', stale: false, price_stale: false, parameters_stale: false, new_tasks_enabled: true },
] });

test('reviewed dynamic constraints survive native/renderer validation; arbitrary data cannot become capabilities', () => {
    const source = JSON.parse(readFileSync(new URL('./fixtures/video-catalog-dynamic.json', import.meta.url), 'utf8'));
    const model = source.data.find(model => model.id === 'SP-特价');
    const parameters = parseVideoParameters({ ...model.parameters, endpoint: 'private-endpoint', apiKey: 'private-key', modes: ['frames'] });
    assert.deepEqual(parameters, model.parameters);
    assert.equal(parameters.default_duration, 30);
    assert.equal(parameters.reference_limits.videos, 0);
    assert.deepEqual(parseVideoParameters(parameters), parameters);
    for (const patch of [{ resolutions: {} }, { resolutions: { '1080p': { durations: [5, 5] } } }, { default_duration: 31 }, { aspect_ratios: ['url'] }, { prompt_max: -1 }, { reference_limits: { images: 9 } }, { reference_file_max_bytes: { image: -1 } }, { reference_modes: ['frames'] }, { cancel_supported: 'true' }]) assert.throws(() => parseVideoParameters({ ...model.parameters, ...patch }), /更新延迟/);
    const output = parseVideoCatalog(source, Date.parse(source.generated_at));
    assert.deepEqual(parseVideoCatalog(output, Date.parse(source.generated_at)), output);
});

test('the sanitized live public snapshot retains 26 active and two explicitly retired historic models', () => {
    const source = JSON.parse(readFileSync(new URL('./fixtures/video-catalog-public.json', import.meta.url), 'utf8'));
    const catalog = parseVideoCatalog(source, Date.parse(source.generated_at));
    assert.equal(catalog.data.filter(model => model.status === 'active').length, 26);
    assert.deepEqual(catalog.data.filter(model => model.status === 'retired').map(model => model.id), ['sd-2.5-fullblood-line2', 'sd-2.5-fullblood-line3']);
    assert.ok(catalog.data.filter(model => model.status === 'retired').every(model => model.new_tasks_enabled === false));
    assert.equal(JSON.stringify(catalog).includes('Authorization'), false);
});

test('feed natural expiry and clock grace ignore a false stale flag without inventing retirement', () => {
    const now = Date.parse('2026-11-18T00:00:00Z');
    for (const [offset, expired] of [[-660_000, false], [-660_001, true], [60_000, false], [60_001, true]]) {
        const input = { ...fixture(), generated_at: new Date(now + offset).toISOString() };
        assert.equal(videoCatalogExpired(input, now), expired);
        if (offset > 60_000) assert.throws(() => parseVideoCatalog(input, now), /更新延迟/);
        else assert.equal(parseVideoCatalog(input, now).data[0].status, 'active');
    }
    assert.equal(videoCatalogExpired({ ...fixture(), generated_at: 'invalid' }, now), true);
});

test('public video status catalog keeps exact IDs and safe display fields, never service labels or private metadata', () => {
    const input = fixture();
    Object.assign(input.data[0], { status_label: 'private-service-label', upstream: 'private', balance: '999', prices: [{ secret: 'private' }] });
    const output = parseVideoCatalog(input);
    assert.equal(output.data[0].status, 'active');
    assert.deepEqual(output.data[0].request_ids, input.data[0].request_ids);
    assert.equal(output.data[0].recommended_request_id, input.data[0].recommended_request_id);
    assert.doesNotMatch(JSON.stringify(output), /private|balance|999|status_label/);
    assert.deepEqual(parseVideoCatalog(output), output, 'native sanitization survives renderer validation');
    for (const status of ['retired', 'unavailable', 'unknown', '__proto__', 'mystery']) {
        input.data[0].status = status;
        assert.equal(parseVideoCatalog(input).data[0].status, ['retired', 'unavailable', 'unknown'].includes(status) ? status : 'unknown');
    }
});

test('bad/empty/conflicting feeds cannot replace a successful catalog or invent a recommended request ID', () => {
    for (const input of [{}, { ...fixture(), schema_version: 2 }, { ...fixture(), data: [] }, { ...fixture(), generated_at: 'invalid' }, { ...fixture(), data: [fixture().data[0], fixture().data[0]] }]) assert.throws(() => parseVideoCatalog(input), /更新延迟/);
    const input = fixture(); input.data[0].recommended_request_id = 'not-returned';
    assert.equal(parseVideoCatalog(input).data[0].recommended_request_id, undefined);
    input.check.stale = true;
    assert.equal(parseVideoCatalog(input).data[0].stale, true);
});

test('native feed GET uses a fixed direct address without credentials and never accepts redirects/error bodies', async () => {
    let calls = 0;
    const read = createVideoCatalog(async (url, init) => {
        calls++; assert.equal(url, 'https://oneyes.ai/video-models/catalog.json');
        assert.equal(init.method, 'GET'); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
        assert.deepEqual(init.headers, { Accept: 'application/json' });
        return Response.json(fixture());
    });
    assert.equal((await read()).data[0].status, 'active'); assert.equal(calls, 1);
    for (const status of [302, 401, 403, 429, 500, 504]) await assert.rejects(createVideoCatalog(async () => new Response('private', { status }))(), /更新延迟/);
});
