import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildDownloader } from '../scripts/build-download.mjs';
import { createRequire } from 'node:module';
import { relayResource } from '../scripts/build-resource-relay.mjs';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const { createReleaseFetcher } = createRequire(import.meta.url)('../desktop/release-fetch.cjs');
const { createUpdater } = createRequire(import.meta.url)('../desktop/updater.cjs');
const { filename, RELEASE_ROOT } = createRequire(import.meta.url)('../desktop/update-policy.cjs');

test('build downloads pin one release and send credentials only to its official API', async () => {
    const calls = [], assets = ['canvas-latest.json', 'canvas-latest.json.sig'].map((name, index) => ({ name, id: index + 1, state: 'uploaded' }));
    const download = createBuildDownloader({ token: 'fixture-secret', request: async (url, options) => {
        calls.push({ url, options });
        if (url.endsWith('/releases/latest')) return Response.json({ assets });
        if (url.includes('/releases/assets/')) return new Response(null, { status: 302, headers: { location: `https://release-assets.githubusercontent.com/original/${url.split('/').at(-1)}` } });
        return new Response(`original-${url.split('/').at(-1)}`);
    } });
    const files = await Promise.all(assets.map(asset => download(`https://github.com/owner/repo/releases/latest/download/${asset.name}`).then(response => response.text())));
    assert.deepEqual(files, ['original-1', 'original-2']);
    assert.equal(calls.filter(call => call.url.endsWith('/releases/latest')).length, 1, 'manifest and signature use the same release snapshot');
    assert.ok(calls.filter(call => call.url.startsWith('https://api.github.com/')).every(call => call.options.headers.Authorization === 'Bearer fixture-secret'));
    assert.ok(calls.filter(call => call.url.startsWith('https://release-assets.githubusercontent.com/')).every(call => !new Headers(call.options.headers).has('authorization')), 'no API token reaches asset storage');
    assert.ok(calls.every(call => !call.url.startsWith('https://github.com/')), 'the failing webpage download entry is not requested');
});

test('desktop downloads retain byte ranges, cancellation and 416 semantics and refresh the latest snapshot on each check', async () => {
    const calls = [], abort = new AbortController(); let generation = 0;
    const download = createReleaseFetcher({ token: 'fixture-secret', request: async (url, options) => {
        calls.push({ url, options });
        if (url.endsWith('/latest')) return Response.json({ assets: [{ name: 'installer.exe', id: ++generation, state: 'uploaded' }] });
        if (url.includes('/assets/')) return new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/original' } });
        return new Response('remaining bytes', { status: generation === 1 ? 206 : 416 });
    } });
    const resource = 'https://github.com/owner/repo/releases/latest/download/installer.exe';
    const options = { headers: { Range: 'bytes=12-', 'If-Range': 'fixture-etag', Authorization: 'do-not-forward', Cookie: 'private' }, signal: abort.signal };
    assert.equal((await download(resource, options)).status, 206);
    assert.equal(new Headers(calls.at(-1).options.headers).get('range'), 'bytes=12-');
    assert.equal(new Headers(calls.at(-1).options.headers).get('if-range'), 'fixture-etag');
    assert.deepEqual([...new Headers(calls.at(-1).options.headers).keys()].sort(), ['if-range', 'range']);
    assert.ok(calls.every(call => call.options.signal === abort.signal));
    assert.equal((await download(resource, options)).status, 206); assert.equal(generation, 1);
    download.reset();
    assert.equal((await download(resource, options)).status, 416); assert.equal(generation, 2);
    const cancelled = createReleaseFetcher(); abort.abort();
    await assert.rejects(cancelled(resource, { signal: abort.signal }), { name: 'AbortError' });
});

test('the runner relay only resolves fixed official repositories and rejects paths outside release assets', () => {
    assert.equal(relayResource('/electron/v44.9.1/electron-v44.9.1-win32-x64.zip'), 'https://github.com/electron/electron/releases/download/v44.9.1/electron-v44.9.1-win32-x64.zip');
    assert.equal(relayResource('/binaries/nsis-3.0.4.1/nsis-3.0.4.1.7z'), 'https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis-3.0.4.1/nsis-3.0.4.1.7z');
    assert.equal(relayResource('/uv/0.6.17/uv-x86_64-pc-windows-msvc.zip'), 'https://github.com/astral-sh/uv/releases/download/0.6.17/uv-x86_64-pc-windows-msvc.zip');
    for (const path of ['/other/v1/file', '/electron/v1/../file', '/electron/v1/%2fsecret', '/electron/v1/%5csecret', '/electron/../file', '/electron/%2e%2e/file', '/electron/v1/file?target=other', '/electron/v1/%ZZ']) assert.throws(() => relayResource(path));
});

test('transferred repositories use the canonical asset API from release metadata without forwarding credentials to storage', async () => {
    const calls = [];
    const resource = 'https://github.com/old-owner/repo/releases/download/v1/original.zip';
    const download = createBuildDownloader({ token: 'fixture-secret', request: async (url, options) => {
        calls.push({ url, options });
        if (url.includes('/releases/tags/')) return Response.json({ assets: [{ name: 'original.zip', id: 9, state: 'uploaded', url: 'https://api.github.com/repos/new-owner/repo/releases/assets/9' }] });
        if (url.startsWith('https://api.github.com/')) return new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/original' } });
        return new Response('pinned original bytes');
    } });
    assert.equal(await (await download(resource)).text(), 'pinned original bytes');
    assert.equal(calls[1].url, 'https://api.github.com/repos/new-owner/repo/releases/assets/9');
    assert.equal(calls[1].options.headers.Authorization, 'Bearer fixture-secret');
    assert.equal(new Headers(calls[2].options.headers).has('authorization'), false);
    for (const url of ['https://example.test/releases/assets/9', 'https://api.github.com/repos/new/repo/releases/assets/10', 'https://api.github.com/user', 'https://secret@api.github.com/repositories/1/releases/assets/9']) {
        const invalid = createBuildDownloader({ request: async () => Response.json({ assets: [{ name: 'original.zip', id: 9, state: 'uploaded', url }] }) });
        await assert.rejects(invalid(resource), /Invalid GitHub asset API address/);
    }
});

test('the desktop updater verifies the signed manifest and package after official API resolution', async t => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519'), payload = Buffer.from('original package bytes');
    const target = { platform: 'win32', arch: 'arm64', format: 'nsis', destination: 'C:\\Canvas', executable: 'C:\\Canvas\\OneYes Canvas.exe' };
    const file = filename('0.21.0', target.platform, target.arch, target.format);
    const text = JSON.stringify({ schema: 1, version: '0.21.0', notes: 'fixture', platforms: { 'win32-arm64-nsis': { file, url: `${RELEASE_ROOT}/download/v0.21.0/${file}`, size: payload.length, sha256: createHash('sha256').update(payload).digest('hex') } } });
    const files = [Buffer.from(text), Buffer.from(sign(null, Buffer.from(text), privateKey).toString('base64')), payload];
    const assets = ['canvas-latest.json', 'canvas-latest.json.sig', file].map((name, index) => ({ name, id: index + 1, state: 'uploaded' }));
    const directory = await mkdtemp(join(tmpdir(), 'canvas-api-ota-')); t.after(() => rm(directory, { recursive: true, force: true }));
    const fetcher = createReleaseFetcher({ request: async (url, options) => {
        assert.ok(!new Headers(options?.headers).has('authorization'));
        if (/\/releases\/(latest|tags\/)/.test(url)) return Response.json({ assets });
        if (url.includes('/releases/assets/')) return new Response(null, { status: 302, headers: { location: `https://release-assets.githubusercontent.com/${url.split('/').at(-1)}` } });
        assert.ok(url.startsWith('https://release-assets.githubusercontent.com/'));
        return new Response(files[Number(url.split('/').at(-1)) - 1]);
    } });
    const updater = createUpdater({ currentVersion: '0.20.116', directory, target: async () => target, fetcher, publicKey, install: () => assert.fail('check must not install automatically') });
    t.after(() => updater.close());
    await updater.check();
    assert.equal(updater.state().status, 'ready'); assert.equal(updater.state().version, '0.21.0');
    assert.deepEqual(await readFile(join(directory, 'ota', '0.21.0', file)), payload);
});

test('tagged files, raw GitHub content and other origins keep their exact contents and authentication scope', async () => {
    const calls = [];
    const download = createBuildDownloader({ token: 'fixture-secret', request: async (url, options) => {
        calls.push({ url, options });
        if (url.includes('/releases/tags/')) return Response.json({ assets: [{ name: 'original file.bin', id: 9, state: 'uploaded' }] });
        return new Response('original bytes');
    } });
    assert.equal(await (await download('https://github.com/owner/repo/releases/download/v1.2.3/original%20file.bin')).text(), 'original bytes');
    assert.equal(calls[0].url, 'https://api.github.com/repos/owner/repo/releases/tags/v1.2.3');
    await download('https://api.github.com/repos/owner/repo/contents/font?ref=pinned');
    assert.equal(calls.at(-1).options.headers.Accept, 'application/vnd.github.raw+json');
    await download('https://api.github.com.example.test/original.bin');
    assert.equal(calls.at(-1).options.headers, undefined);
});

test('upstream errors try the official download entry while missing assets and untrusted redirects fail closed', async () => {
    const resource = 'https://github.com/owner/repo/releases/download/v1.2.3/original.bin';
    let calls = 0;
    const failed = createBuildDownloader({ request: async () => { calls++; return new Response('', { status: 503 }); } });
    await assert.rejects(failed(resource), /503/); assert.equal(calls, 2);
    const missing = createBuildDownloader({ request: async () => Response.json({ assets: [] }) });
    await assert.rejects(missing(resource), /unavailable/);
    for (const location of ['https://example.test/file', 'http://release-assets.githubusercontent.com/file', null]) {
        calls = 0;
        const unsafe = createBuildDownloader({ request: async url => {
            calls++;
            return url.includes('/releases/tags/') ? Response.json({ assets: [{ name: 'original.bin', id: 1, state: 'uploaded' }] }) : new Response(null, { status: 302, headers: location ? { location } : {} });
        } });
        await assert.rejects(unsafe(resource), /Invalid GitHub build asset redirect/); assert.equal(calls, 2);
    }
});

test('more than the anonymous API quota of byte ranges share one asset address without leaking credentials', async () => {
    const calls = [], payload = Buffer.from('fixture byte range'), resource = 'https://github.com/owner/repo/releases/download/v1/installer.zip';
    const download = createReleaseFetcher({ token: 'fixture-secret', request: async (url, init) => {
        calls.push({ url, init });
        if (url.includes('/releases/tags/')) return Response.json({ assets: [{ name: 'installer.zip', id: 1, state: 'uploaded' }] });
        if (url.includes('/releases/assets/')) {
            assert.equal(init.cache, 'no-store'); assert.equal(init.headers['Cache-Control'], 'no-cache');
            return new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/fixture' } });
        }
        assert.equal(url, 'https://release-assets.githubusercontent.com/fixture');
        assert.deepEqual([...new Headers(init.headers)], [['if-range', '"fixture"'], ['range', 'bytes=0-17']]);
        return new Response(payload, { status: 206 });
    } });
    for (let i = 0; i < 100; i++) {
        const response = await download(resource, { headers: { Range: 'bytes=0-17', 'If-Range': '"fixture"', Cookie: 'private', Authorization: 'private' } });
        assert.equal(response.status, 206); assert.deepEqual(Buffer.from(await response.arrayBuffer()), payload);
    }
    assert.equal(calls.filter(c => c.url.startsWith('https://api.github.com/')).length, 2, 'one metadata request and one asset resolution, independent of range count');
    assert.equal(calls.filter(c => c.url.startsWith('https://release-assets.githubusercontent.com/')).length, 100);
});

test('expired asset addresses are renewed once and range failures retain their original semantics', async () => {
    let resolutions = 0, downloads = 0;
    const download = createReleaseFetcher({ request: async url => {
        if (url.includes('/tags/')) return Response.json({ assets: [{ name: 'file.zip', id: 1, state: 'uploaded' }] });
        if (url.includes('/assets/')) return new Response(null, { status: 302, headers: { location: `https://release-assets.githubusercontent.com/${++resolutions}` } });
        downloads++;
        return new Response(null, { status: downloads === 1 ? 206 : url.endsWith('/1') ? 403 : 416 });
    } });
    const resource = 'https://github.com/owner/repo/releases/download/v1/file.zip';
    assert.equal((await download(resource)).status, 206);
    assert.equal((await download(resource)).status, 416); assert.equal(resolutions, 2); assert.equal(downloads, 3);
    assert.equal((await download(resource)).status, 416); assert.equal(resolutions, 2); assert.equal(downloads, 4);
});

test('rate limits and temporary API failures use only the official download route and preserve range validation', async t => {
    for (const stage of ['metadata', 'asset']) for (const status of [403, 429, 503, 'offline']) await t.test(`${stage}-${status}`, async () => {
        const calls = [], abort = new AbortController();
        const download = createReleaseFetcher({ token: 'fixture-secret', request: async (url, init) => {
            calls.push({ url, init }); assert.equal(init.signal, abort.signal);
            if (url.startsWith('https://api.github.com/')) {
                if (stage === 'asset' && url.endsWith('/latest')) return Response.json({ tag_name: 'v1', assets: [{ name: 'file.zip', id: 1, state: 'uploaded' }] });
                if (status === 'offline') throw TypeError('fetch failed');
                return new Response(null, { status });
            }
            assert.equal(new Headers(init.headers).has('authorization'), false); assert.equal(new Headers(init.headers).has('cookie'), false);
            assert.equal(new Headers(init.headers).get('range'), 'bytes=2-'); assert.equal(new Headers(init.headers).get('if-range'), '"original"');
            if (url.startsWith('https://github.com/')) {
                assert.equal(init.redirect, 'manual'); assert.equal(init.headers['Cache-Control'], 'no-cache');
                if (url.includes('/latest/download/')) {
                    assert.equal(stage, 'metadata');
                    return new Response(null, { status: 302, headers: { location: 'https://github.com/owner/repo/releases/download/v1/file.zip' } });
                }
                assert.equal(url, 'https://github.com/owner/repo/releases/download/v1/file.zip');
                return new Response(null, { status: 302, headers: { location: 'https://objects.githubusercontent.com/fixture' } });
            }
            assert.equal(url, 'https://objects.githubusercontent.com/fixture'); return new Response('remaining bytes', { status: 206 });
        } });
        assert.equal((await download('https://github.com/owner/repo/releases/latest/download/file.zip', { signal: abort.signal, headers: { Range: 'bytes=2-', 'If-Range': '"original"', Cookie: 'private', Authorization: 'private' } })).status, 206);
        assert.equal(calls.length, 4);
    });
    for (const status of [404, 'abort']) {
        let calls = 0;
        const download = createReleaseFetcher({ request: async () => { calls++; if (status === 'abort') throw new DOMException('aborted', 'AbortError'); return new Response(null, { status }); } });
        await assert.rejects(download('https://github.com/owner/repo/releases/download/v1/file.zip'), status === 'abort' ? { name: 'AbortError' } : { status });
        assert.equal(calls, 1, 'cancellation and missing release do not start another route');
    }
    for (const location of ['https://example.test/file', 'https://release-assets.githubusercontent.com:8443/file', 'https://private@objects.githubusercontent.com/file', 'https://github.com/other/repo/releases/download/v1/file.zip', 'https://github.com/owner/repo/releases/download/v1/other.zip', 'https://github.com/owner/repo/releases/download/v1/file.zip?token=private']) {
        const download = createReleaseFetcher({ request: async url => url.startsWith('https://api.github.com/') ? new Response(null, { status: 403 }) : new Response(null, { status: 302, headers: { location } }) });
        await assert.rejects(download('https://github.com/owner/repo/releases/latest/download/file.zip'), /Invalid GitHub build asset redirect/);
    }
});

test('the rate-limited official fallback still rejects tampered manifests and packages before installation', async t => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519'), payload = Buffer.from('signed package');
    const target = { platform: 'darwin', arch: 'arm64', format: 'zip' }, file = filename('0.21.0', target.platform, target.arch, target.format);
    const text = JSON.stringify({ schema: 1, version: '0.21.0', notes: 'fixture', platforms: { 'darwin-arm64-zip': { file, url: `${RELEASE_ROOT}/download/v0.21.0/${file}`, size: payload.length, sha256: createHash('sha256').update(payload).digest('hex') } } });
    const signature = sign(null, Buffer.from(text), privateKey).toString('base64');
    for (const scenario of ['original', 'tampered-manifest', 'tampered-package']) await t.test(scenario, async t => {
        const directory = await mkdtemp(join(tmpdir(), 'canvas-quota-ota-')); t.after(() => rm(directory, { recursive: true, force: true }));
        const fetcher = createReleaseFetcher({ request: async (url, init) => {
            if (url.startsWith('https://api.github.com/')) return new Response(null, { status: 403 });
            if (url.startsWith('https://github.com/')) return new Response(null, { status: 302, headers: { location: `https://release-assets.githubusercontent.com/${url.split('/').at(-1)}` } });
            assert.equal(new Headers(init.headers).has('authorization'), false);
            if (url.endsWith('.json')) return new Response(scenario === 'tampered-manifest' ? text.replace('0.21.0', '0.22.0') : text);
            if (url.endsWith('.sig')) return new Response(signature);
            assert.ok(url.endsWith(file)); return new Response(scenario === 'tampered-package' ? Buffer.alloc(payload.length) : payload);
        } });
        const updater = createUpdater({ currentVersion: '0.20.208', directory, target: async () => target, fetcher, publicKey, install: () => assert.fail('check must not install') }); t.after(() => updater.close());
        await updater.check(); assert.equal(updater.state().status, scenario === 'original' ? 'ready' : 'error');
        if (scenario === 'original') assert.deepEqual(await readFile(join(directory, 'ota/0.21.0', file)), payload);
    });
});
