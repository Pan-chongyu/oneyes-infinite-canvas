import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), { createVault } = require('../desktop/vault.cjs'), { route } = require('../desktop/protocol.cjs');
test('vault survives restart, serializes writes, detects tampering without replacing data', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'canvas-vault-'));
    try {
        const vault = createVault(dir), value = JSON.stringify({ key: 'sk-test-private' });
        assert.equal(await vault.read(), null);
        await vault.write(value);
        assert.equal(await createVault(dir).read(), value);
        const file = join(dir, 'config.enc'), encrypted = await readFile(file);
        assert.ok(!encrypted.includes(Buffer.from('sk-test-private')));
        await Promise.all([vault.write('{"n":1}'), vault.write('{"n":2}')]);
        assert.equal(await vault.read(), '{"n":2}');
        const bad = await readFile(file); bad[bad.length-1] ^= 1; await writeFile(file,bad);
        await assert.rejects(createVault(dir).read()); assert.deepEqual(await readFile(file),bad);
    } finally { await rm(dir, {recursive:true,force:true}); }
});
test('protocol confines API credentials to OneYes and files to packaged assets', () => {
    const root = resolve('web/dist');
    assert.deepEqual(route('oneyes-canvas://app/oneyes-api/v1/images/generations', root), {apis:['https://oneyes.ai/v1/images/generations', 'https://api.oneyes.ai/v1/images/generations']});
    assert.ok(route('oneyes-canvas://app/canvas/example', root).file.endsWith('/index.html'));
    for(const input of ['https://api.oneyes.ai/v1/models','oneyes-canvas://evil/','oneyes-canvas://app/oneyes-api/admin','oneyes-canvas://app/%2e%2e%2f%2e%2e%2fsecrets.key']) assert.throws(() => route(input, root));
});

test('desktop proxy route accepts only HTTP(S) targets and preserves signed URLs', () => {
    const root = resolve('web/dist'), target = 'https://media.example.test/file?signature=a%2Fb%3D&x=1&x=2';
    assert.deepEqual(route('oneyes-canvas://app/proxy?url=' + encodeURIComponent(target), root), { api: target, proxy: true });
    for (const value of ['file:///secret', 'data:text/plain,secret', 'https://user:password@example.test/', 'invalid']) assert.throws(() => route('oneyes-canvas://app/proxy?url=' + encodeURIComponent(value), root));
});

test('native image downloads preserve signed URLs and never forward app credentials', async () => {
    const { downloadImage } = require('../desktop/image-download.cjs');
    const root = resolve('web/dist'), url = 'https://objects.example.test/image.png?signature=a%2Fb%3D&x=1&x=2';
    assert.deepEqual(route('oneyes-canvas://app/image-download?url=' + encodeURIComponent(url), root), { image: url });
    for (const value of ['file:///secret', 'http://insecure/image.png', 'https://user:password@example.test/', 'invalid']) assert.throws(() => route('oneyes-canvas://app/image-download?url=' + encodeURIComponent(value), root));
    let calls = 0;
    const request = new Request('https://app.test', { headers: { Authorization: 'Bearer private', Cookie: 'private', 'Proxy-Authorization': 'private' } });
    const response = await downloadImage(request, url, async (target, init) => {
        calls++; assert.equal(target, url);
        assert.deepEqual(init.headers, { Accept: 'image/*' });
        assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
        return new Response('image-bytes', { headers: { 'Content-Type': 'image/png' } });
    });
    assert.equal(await response.text(), 'image-bytes'); assert.equal(calls, 1);
    assert.equal((await downloadImage(new Request('https://app.test', { method: 'POST' }), url, () => { throw Error('must not run'); })).status, 405);
    assert.equal((await downloadImage(request, url, async () => new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } }))).status, 502);
    assert.equal((await downloadImage(request, url, async () => new Response(null, { status: 403 }))).status, 403);
});
