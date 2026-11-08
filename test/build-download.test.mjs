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

test('missing assets, upstream errors and untrusted redirects fail without extra download attempts', async () => {
    const resource = 'https://github.com/owner/repo/releases/download/v1.2.3/original.bin';
    let calls = 0;
    const failed = createBuildDownloader({ request: async () => { calls++; return new Response('', { status: 503 }); } });
    await assert.rejects(failed(resource), /503/); assert.equal(calls, 1);
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
