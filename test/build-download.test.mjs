import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildDownloader } from '../scripts/build-download.mjs';

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
    assert.ok(calls.filter(call => call.url.startsWith('https://release-assets.githubusercontent.com/')).every(call => call.options === undefined), 'no API token reaches asset storage');
    assert.ok(calls.every(call => !call.url.startsWith('https://github.com/')), 'the failing webpage download entry is not requested');
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
