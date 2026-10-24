import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { createModelCatalog } = createRequire(import.meta.url)('../desktop/models.cjs');
const { createNetwork } = createRequire(import.meta.url)('../desktop/network.cjs');

test('native model discovery fixes the destination, forwards the key only in headers and sorts a validated catalog', async () => {
    const list = createModelCatalog(async (url, init) => {
        assert.equal(url, 'https://api.oneyes.ai/v1/models');
        assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'manual');
        assert.equal(init.headers.Authorization, 'Bearer test-model-key');
        return Response.json({ data: [{ id: 'gpt-image-2' }, { id: 'deepseek-chat' }, { id: 'gpt-image-2' }] });
    });
    assert.deepEqual(await list(' test-model-key '), ['deepseek-chat', 'gpt-image-2']);
    for (const invalid of ['', null, {}, 'key\nheader']) await assert.rejects(list(invalid), /有效的 OneYes API Key/);
});

test('model errors provide actions without reflecting keys, raw exceptions or server HTML', async () => {
    for (const status of [401, 403, 429, 500, 502, 524]) {
        const list = createModelCatalog(async () => Response.json({ error: { message: 'secret-model-key' } }, { status }));
        await assert.rejects(list('secret-model-key'), error => {
            assert.match(error.message, new RegExp(`HTTP ${status}`));
            assert.match(error.message, status === 401 || status === 403 ? /Key.*重新配置/ : status === 429 ? /余额/ : /稍后重新检查/);
            assert.doesNotMatch(error.message, /secret-model-key/); return true;
        });
    }
    await assert.rejects(createModelCatalog(async () => { throw new Error('net failure with secret-model-key'); })('secret-model-key'), /检查网络.*代理/);
    await assert.rejects(createModelCatalog(async () => { throw new Error('代理认证失败，请检查用户名和密码'); })('secret-model-key'), /代理认证失败/);
    await assert.rejects(createModelCatalog(async () => new Response('<html>secret</html>', { status: 302 }))('key'), /重定向/);
    for (const body of [{ data: [] }, { data: {} }, { data: [{ name: 'bad' }] }, { data: [{ id: '' }] }]) {
        await assert.rejects(createModelCatalog(async () => Response.json(body))('key'), /没有可用模型|列表格式无效/);
    }
    await assert.rejects(createModelCatalog(async () => new Response('<html>private</html>'))('key'), /列表格式无效/);
});

test('native models respect saved forwarding mode, avoid duplicate prefixes and never bypass an invalid proxy', async () => {
    const seen = [];
    const network = await createNetwork(async (url, init) => {
        seen.push(url); assert.equal(init.headers.Authorization, 'Bearer fixture-key');
        return Response.json({ data: [{ id: 'gpt-image-2' }] });
    });
    try {
        network.configure({ proxyEnabled: true, proxyMode: 'forwarder', proxyUrl: '127.0.0.1:20809' });
        assert.deepEqual(await createModelCatalog(network.fetch)('fixture-key'), ['gpt-image-2']);
        assert.deepEqual(seen, ['http://127.0.0.1:20809/https://api.oneyes.ai/v1/models']);
        await network.fetch(seen[0], { headers: { Authorization: 'Bearer fixture-key' } });
        assert.equal(seen[1], seen[0]);
        network.configure({ proxyEnabled: true, proxyMode: 'forwarder', proxyUrl: '' });
        await assert.rejects(createModelCatalog(network.fetch)('fixture-key'), /代理转发地址无效/);
        assert.equal(seen.length, 2);
    } finally { network.close(); }
});
