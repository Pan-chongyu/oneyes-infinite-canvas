import { test } from 'node:test';
import assert from 'node:assert/strict';
import axios, { AxiosError } from 'axios';
import { submitVideoBridge } from './video-bridge-submit';

test('explicit large_material_busy retries the exact binary body and idempotency key after Retry-After', async t => {
    const original = axios.defaults.adapter, body = new Blob(['unchanged binary']), calls: unknown[] = [];
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-11-18T00:00:00Z') });
    try {
        axios.defaults.adapter = async config => {
            calls.push(config.data); assert.equal(config.headers['Idempotency-Key'], 'persisted-fixture-key');
            const response = { config, headers: { 'retry-after': '5' }, status: 429, statusText: '', data: { error: { code: 'large_material_busy' } } };
            if (calls.length === 1) throw new AxiosError('busy', 'ERR_BAD_REQUEST', config, undefined, response);
            return { ...response, status: 200, data: { id: 'only-upstream-task' } };
        };
        const pending = submitVideoBridge('https://oneyes.ai/v1/videos', body, { 'Idempotency-Key': 'persisted-fixture-key' });
        await new Promise(resolve => setImmediate(resolve)); assert.equal(calls.length, 1);
        t.mock.timers.tick(4999); await new Promise(resolve => setImmediate(resolve)); assert.equal(calls.length, 1);
        t.mock.timers.tick(1); assert.deepEqual((await pending).data, { id: 'only-upstream-task' });
        assert.deepEqual(calls, [body, body]); assert.equal(calls[0], calls[1]);
    } finally { axios.defaults.adapter = original; t.mock.timers.reset(); }
});

test('other 429, network/500/413 and missing idempotency never replay a paid create', async () => {
    const original = axios.defaults.adapter;
    try {
        for (const [status, code, key] of [[429, 'rate_limit_exceeded', 'key'], [500, 'large_material_busy', 'key'], [413, 'bridge_request_too_large', 'key'], [429, 'large_material_busy', '']] as const) {
            let calls = 0;
            axios.defaults.adapter = async config => { calls++; throw new AxiosError('rejected', 'ERR_BAD_REQUEST', config, undefined, { config, headers: { 'retry-after': '0' }, status, statusText: '', data: { code } }); };
            await assert.rejects(submitVideoBridge('https://oneyes.ai/v1/videos', new Blob(), { 'Idempotency-Key': key })); assert.equal(calls, 1);
        }
        let calls = 0;
        axios.defaults.adapter = async config => { calls++; throw new AxiosError('offline', 'ERR_NETWORK', config); };
        await assert.rejects(submitVideoBridge('https://oneyes.ai/v1/videos', new Blob(), { 'Idempotency-Key': 'key' })); assert.equal(calls, 1);
    } finally { axios.defaults.adapter = original; }
});

test('cancel during large-material wait stops before the next submission', async () => {
    const original = axios.defaults.adapter, controller = new AbortController(); let calls = 0;
    try {
        axios.defaults.adapter = async config => { calls++; throw new AxiosError('busy', 'ERR_BAD_REQUEST', config, undefined, { config, headers: { 'retry-after': '5' }, status: 429, statusText: '', data: { code: 'large_material_busy' } }); };
        const pending = submitVideoBridge('https://oneyes.ai/v1/videos', new Blob(), { 'Idempotency-Key': 'same-key' }, controller.signal);
        const rejected = assert.rejects(pending); await new Promise(resolve => setImmediate(resolve)); controller.abort(); await rejected; assert.equal(calls, 1);
    } finally { axios.defaults.adapter = original; }
});
