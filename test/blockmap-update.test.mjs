import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const require = createRequire(import.meta.url);
const { createUpdater } = require('../desktop/updater.cjs');
const { createReleaseFetcher } = require('../desktop/release-fetch.cjs');
const { legacyUpdate } = require('./fixtures/legacy-update.cjs');
const { filename, RELEASE_ROOT, readManifest } = require('../desktop/update-policy.cjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const { publicKey, privateKey } = generateKeyPairSync('ed25519');

export function blockmap(bytes, blockSize = 32) {
    const blocks = [];
    for (let offset = 0; offset < bytes.length; offset += blockSize) blocks.push(bytes.subarray(offset, offset + blockSize));
    return gzipSync(JSON.stringify({ version: '2', files: [{ name: 'file', offset: 0, sizes: blocks.map(b => b.length), checksums: blocks.map(hash) }] }));
}

async function fixture(t, { platform = 'win32', arch = 'x64', format = 'nsis', scenario = '', nextVersion = '1.0.1' } = {}) {
    const directory = await mkdtemp(join(tmpdir(), 'canvas-block-')); t.after(() => rm(directory, { recursive: true, force: true }));
    const target = { platform, arch, format }, key = `${platform}-${arch}-${format}`, requests = [], installs = [], states = [];
    const blocks = Array.from({ length: 100 }, (_, i) => Buffer.alloc(32, i));
    const base = scenario === 'many-ranges' ? Buffer.concat(blocks) : Buffer.concat([Buffer.alloc(64, 1), Buffer.alloc(64, 2), Buffer.alloc(64, 3)]);
    const next = scenario === 'many-ranges' ? Buffer.concat(blocks.flatMap((block, i) => [block, Buffer.alloc(32, i + 150)])) : Buffer.concat([Buffer.alloc(64, 3), Buffer.alloc(64, 4), Buffer.alloc(64, 1)]);
    const oldMap = blockmap(base), newMap = blockmap(next);
    function release(version, bytes, map) {
        const file = filename(version, platform, arch, format), url = `${RELEASE_ROOT}/download/v${version}/${file}`;
        const entry = { file, url, size: bytes.length, sha256: hash(bytes), blockmap: { file: file + '.blockmap', url: url + '.blockmap', size: map.length, sha256: hash(map) } };
        const published = version === '1.0.0' ? entry : { ...entry, rangeBlockmap: entry.blockmap, blockmap: undefined };
        const text = JSON.stringify({ schema: 1, version, notes: 'Windows 增量更新', platforms: { [key]: published } });
        return { entry, text, signature: sign(null, Buffer.from(text), privateKey).toString('base64') };
    }
    const previous = release('1.0.0', base, oldMap), current = release(nextVersion, next, newMap);
    const folder = join(directory, 'ota/base-1.0.0'); await mkdir(folder, { recursive: true });
    await writeFile(join(folder, previous.entry.file), scenario === 'corrupt-base' ? Buffer.alloc(base.length) : base);
    await writeFile(join(folder, 'canvas-latest.json'), previous.text); await writeFile(join(folder, 'canvas-latest.json.sig'), previous.signature);
    let interrupted = false;
    const options = { currentVersion: '1.0.0', directory, target: async () => target, publicKey, changed: s => states.push(s), install: async p => installs.push(p), fetcher: async (url, init = {}) => {
        requests.push({ url, headers: init.headers });
        if (url.endsWith('.sig')) return new Response(current.signature);
        if (url.endsWith('.json')) return new Response(current.text);
        if (url === previous.entry.blockmap.url) return scenario === 'missing-map' ? new Response(null, { status: 404 }) : new Response(oldMap);
        if (url === current.entry.blockmap.url) return new Response(scenario === 'corrupt-map' ? Buffer.alloc(newMap.length) : newMap);
        assert.equal(url, current.entry.url);
        if (!init.headers?.Range || scenario === 'range-ignored') return new Response(next);
        const match = /^bytes=(\d+)-(\d+)$/.exec(init.headers.Range), start = Number(match[1]), end = Number(match[2]);
        const headers = { 'Content-Range': `bytes ${start}-${end}/${next.length}`, ETag: '"fixed"' };
        if (scenario === 'bad-range') headers['Content-Range'] = 'bytes 0-0/1';
        if (scenario === 'interrupt' && !interrupted) {
            interrupted = true;
            return new Response(new ReadableStream({ start(c) { c.enqueue(next.subarray(start, start + 7)); }, pull(c) { c.error(Object.assign(new Error('socket disconnected'), { code: 'ECONNRESET' })); } }), { status: 206, headers });
        }
        return new Response(scenario === 'corrupt-range' ? Buffer.alloc(end - start + 1) : next.subarray(start, end + 1), { status: 206, headers });
    } };
    const updater = createUpdater(options); t.after(() => updater.close());
    return { updater, options, directory, requests, installs, states, next, previous, current, oldMap, base };
}

test('all ten native OTA targets download only changed blocks and verify the signed full package', async t => {
    for (const platform of ['win32','darwin','linux']) for (const arch of ['x64', 'arm64']) for (const format of {win32:['nsis'],darwin:['zip'],linux:['AppImage','deb','rpm']}[platform]) await t.test(`${platform}-${arch}-${format}`, async t => {
        const f = await fixture(t, { platform, arch, format }); await f.updater.check();
        assert.equal(f.updater.state().status, 'ready'); assert.equal(f.updater.state().mode, 'delta');
        assert.equal(f.updater.state().total, 64); assert.equal(f.updater.state().reused, 128);
        assert.deepEqual(f.requests.filter(r => r.url === f.current.entry.url).map(r => r.headers.Range), ['bytes=64-127']);
        await f.updater.apply(); assert.equal(f.installs.length, 1); assert.equal(f.installs[0].arch, arch);
        assert.deepEqual(await readFile(f.installs[0].file), f.next);
        const restarted = createUpdater({ ...f.options, fetcher: async () => { throw Error('offline'); } }); t.after(() => restarted.close());
        await restarted.check(); assert.equal(restarted.state().status, 'ready'); await restarted.apply(); assert.equal(f.installs.length, 2);
    });
});

test('a macOS ARM64 update with 100 changed ranges reconstructs under the anonymous API quota', async t => {
    const f = await fixture(t, { platform: 'darwin', arch: 'arm64', format: 'zip', scenario: 'many-ranges' });
    const resources = [`${RELEASE_ROOT}/latest/download/canvas-latest.json`, `${RELEASE_ROOT}/latest/download/canvas-latest.json.sig`, f.current.entry.url, f.current.entry.blockmap.url, f.previous.entry.blockmap.url];
    let apiCalls = 0, resolutions = 0;
    const fetcher = createReleaseFetcher({ request: async (url, init = {}) => {
        if (url.startsWith('https://api.github.com/')) {
            if (++apiCalls > 60) return new Response(null, { status: 403 });
            if (url.includes('/releases/assets/')) { resolutions++; return new Response(null, { status: 302, headers: { location: `https://release-assets.githubusercontent.com/${url.split('/').at(-1)}` } }); }
            return Response.json({ assets: resources.map((url, i) => ({ name: url.split('/').at(-1), id: i + 1, state: 'uploaded' })) });
        }
        assert.ok(url.startsWith('https://release-assets.githubusercontent.com/'), 'normal block updates do not need the fallback route');
        const headers = new Headers(init.headers), Range = headers.get('range'), IfRange = headers.get('if-range');
        return f.options.fetcher(resources[Number(url.split('/').at(-1)) - 1], { ...init, headers: { ...(Range ? { Range } : {}), ...(IfRange ? { 'If-Range': IfRange } : {}) } });
    } });
    const updater = createUpdater({ ...f.options, fetcher }); t.after(() => updater.close());
    await updater.check(); assert.equal(updater.state().status, 'ready'); assert.equal(updater.state().mode, 'delta');
    assert.equal(f.requests.filter(r => r.url === f.current.entry.url).length, 100);
    assert.equal(resolutions, 5); assert.equal(apiCalls, 8);
    await updater.apply(); assert.deepEqual(await readFile(f.installs[0].file), f.next);
});

test('unmodified v0.20.207 updaters upgrade all ten targets without range API storms', async t => {
    const { createUpdater: legacyUpdater } = legacyUpdate('updater.cjs'), { createReleaseFetcher: legacyFetcher } = legacyUpdate('release-fetch.cjs');
    for (const platform of ['win32', 'darwin', 'linux']) for (const arch of ['x64', 'arm64']) for (const format of { win32: ['nsis'], darwin: ['zip'], linux: ['AppImage', 'deb', 'rpm'] }[platform]) await t.test(`${platform}-${arch}-${format}`, async t => {
        const f = await fixture(t, { platform, arch, format, scenario: 'many-ranges' });
        const resources = [`${RELEASE_ROOT}/latest/download/canvas-latest.json`, `${RELEASE_ROOT}/latest/download/canvas-latest.json.sig`, f.current.entry.url];
        let apiCalls = 0, installs = 0;
        const updater = legacyUpdater({ ...f.options, fetcher: legacyFetcher({ request: async (url, init = {}) => {
            if (url.startsWith('https://api.github.com/')) {
                if (++apiCalls > 60) return new Response(null, { status: 403 });
                if (url.includes('/releases/assets/')) return new Response(null, { status: 302, headers: { location: `https://release-assets.githubusercontent.com/${url.split('/').at(-1)}` } });
                return Response.json({ assets: resources.map((url, i) => ({ name: url.split('/').at(-1), id: i + 1, state: 'uploaded' })) });
            }
            const resource = resources[Number(url.split('/').at(-1)) - 1]; assert.ok(resource);
            assert.equal(new Headers(init.headers).get('range'), null, 'legacy upgrades must never request the 100 changed ranges');
            return f.options.fetcher(resource, init);
        } }), install: async plan => { assert.deepEqual(await readFile(plan.file), f.next); installs++; } }); t.after(() => updater.close());
        await updater.check(); assert.equal(updater.state().status, 'ready'); assert.equal(updater.state().mode, 'full');
        assert.equal(f.requests.filter(r => r.url === f.current.entry.url).length, 1); assert.equal(apiCalls, 5);
        await updater.apply(); assert.equal(installs, 1);
    });
});

test('cached block maps stay available offline, skipped versions use the installed base, and restart preserves actual download savings', async t => {
    const f = await fixture(t, {platform:'darwin',format:'zip',scenario:'missing-map',nextVersion:'1.4.9'});
    await writeFile(join(f.directory,'ota/base-1.0.0',f.previous.entry.blockmap.file),f.oldMap);
    await f.updater.check();
    assert.equal(f.updater.state().mode,'delta');
    assert.ok(!f.requests.some(r=>r.url===f.previous.entry.blockmap.url));
    f.updater.close();
    const restarted=createUpdater(f.options);t.after(()=>restarted.close());await restarted.check();
    assert.equal(restarted.state().status,'ready');assert.equal(restarted.state().mode,'delta');
    assert.equal(restarted.state().total,64);assert.equal(restarted.state().downloaded,64);assert.equal(restarted.state().reused,128);
    const upgraded=createUpdater({...f.options,currentVersion:'1.4.9'});t.after(()=>upgraded.close());await upgraded.check();
    assert.equal(upgraded.state().status,'current');
    assert.deepEqual(await readFile(join(f.directory,'ota/base-1.4.9',f.current.entry.file)),f.next);
    assert.ok((await readFile(join(f.directory,'ota/base-1.4.9',f.current.entry.blockmap.file))).length>0);
    assert.ok(!(await readdir(join(f.directory,'ota'))).includes('base-1.0.0'));
});

test('manual Windows installation adopts only a matching signed NSIS cache without downloading the old installer', async t => {
    for(const scenario of ['valid','corrupt-cache','invalid-signature','wrong-architecture'])await t.test(scenario,async t=>{
        const f=await fixture(t),seed=join(f.directory,'installer.exe');
        await rm(join(f.directory,'ota/base-1.0.0'),{recursive:true,force:true});
        await writeFile(seed,scenario==='corrupt-cache'?Buffer.alloc(f.base.length):f.base);
        const older=JSON.parse(f.previous.text);
        if(scenario==='wrong-architecture')older.platforms={'win32-arm64-nsis':older.platforms['win32-x64-nsis']};
        const text=JSON.stringify(older),signature=scenario==='invalid-signature'?'invalid':sign(null,Buffer.from(text),privateKey).toString('base64');
        const seeded=createUpdater({...f.options,installerCache:seed,fetcher:(url,init)=>{
            if(url===`${RELEASE_ROOT}/download/v1.0.0/canvas-latest.json`)return new Response(text);
            if(url===`${RELEASE_ROOT}/download/v1.0.0/canvas-latest.json.sig`)return new Response(signature);
            assert.notEqual(url,f.previous.entry.url,'bootstrapping must never download an old full package');
            return f.options.fetcher(url,init);
        }});t.after(()=>seeded.close());
        await seeded.check();assert.equal(seeded.state().status,'ready');
        assert.equal(seeded.state().mode,scenario==='valid'?'delta':'full');
        if(scenario==='valid')await assert.rejects(readFile(seed));else assert.ok((await readFile(seed)).length);
        if(scenario==='valid'){
            seeded.close();await writeFile(seed,f.base);
            const restarted=createUpdater({...f.options,installerCache:seed});t.after(()=>restarted.close());await restarted.check();
            assert.equal(restarted.state().status,'ready');
            await assert.rejects(readFile(seed),'a verified current base also removes the duplicate kept by NSIS');
            assert.deepEqual(await readFile(join(f.directory,'ota/base-1.0.0',f.previous.entry.file)),f.base);
        }
    });
});

test('block downloads resume inside a changed range after process restart without fetching the full installer', async t => {
    const f = await fixture(t, { scenario: 'interrupt' }); await f.updater.check();
    assert.equal(f.updater.state().status, 'error');
    assert.equal((await readFile(join(f.directory, 'ota/1.0.1', f.current.entry.file + '.blocks.part'))).length, 71);
    const restarted = createUpdater(f.options); t.after(() => restarted.close()); await restarted.check();
    assert.equal(restarted.state().status, 'ready'); assert.equal(restarted.state().mode, 'delta');
    const requests = f.requests.filter(r => r.url === f.current.entry.url);
    assert.deepEqual(requests.map(r => r.headers.Range), ['bytes=64-127', 'bytes=71-127']); assert.equal(requests[1].headers['If-Range'], '"fixed"');
    await restarted.apply(); assert.deepEqual(await readFile(f.installs[0].file), f.next);
});

test('unavailable or invalid block maps, bases, ranges and reconstructed bytes safely fall back to the signed full installer', async t => {
    for (const scenario of ['missing-map', 'corrupt-map', 'corrupt-base', 'bad-range', 'range-ignored', 'corrupt-range']) await t.test(scenario, async t => {
        const f = await fixture(t, { scenario }); await f.updater.check();
        assert.equal(f.updater.state().status, 'ready'); assert.equal(f.updater.state().mode, 'full');
        await f.updater.apply(); assert.deepEqual(await readFile(f.installs[0].file), f.next);
        assert.ok(!(await readdir(join(f.directory, 'ota/1.0.1'))).some(n => n.endsWith('.blocks.part') || n.endsWith('.blocks.part.json')));
    });
});

test('a corrupt resumed prefix never reaches the installer, and block map URLs stay pinned to the architecture-specific release', async t => {
    const f = await fixture(t, { scenario: 'interrupt' }); await f.updater.check();
    const file = join(f.directory, 'ota/1.0.1', f.current.entry.file + '.blocks.part');
    await writeFile(file, Buffer.alloc(71)); await f.updater.check();
    assert.equal(f.updater.state().mode, 'full'); await f.updater.apply(); assert.deepEqual(await readFile(f.installs[0].file), f.next);
    const manifest = JSON.parse(f.current.text); manifest.platforms['win32-x64-nsis'].rangeBlockmap.url = 'https://invalid.test/map';
    const text = JSON.stringify(manifest), signature = sign(null, Buffer.from(text), privateKey).toString('base64');
    assert.equal(readManifest(text, signature, { platform: 'win32', arch: 'x64', format: 'nsis' }, publicKey).blockmap, undefined);
});
