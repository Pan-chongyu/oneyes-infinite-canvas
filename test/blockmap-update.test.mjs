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
const { filename, RELEASE_ROOT, readManifest } = require('../desktop/update-policy.cjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const { publicKey, privateKey } = generateKeyPairSync('ed25519');

export function blockmap(bytes, blockSize = 32) {
    const blocks = [];
    for (let offset = 0; offset < bytes.length; offset += blockSize) blocks.push(bytes.subarray(offset, offset + blockSize));
    return gzipSync(JSON.stringify({ version: '2', files: [{ name: 'file', offset: 0, sizes: blocks.map(b => b.length), checksums: blocks.map(hash) }] }));
}

async function fixture(t, { arch = 'x64', scenario = '' } = {}) {
    const directory = await mkdtemp(join(tmpdir(), 'canvas-block-')); t.after(() => rm(directory, { recursive: true, force: true }));
    const target = { platform: 'win32', arch, format: 'nsis' }, key = `win32-${arch}-nsis`, requests = [], installs = [], states = [];
    const base = Buffer.concat([Buffer.alloc(64, 1), Buffer.alloc(64, 2), Buffer.alloc(64, 3)]);
    const next = Buffer.concat([Buffer.alloc(64, 3), Buffer.alloc(64, 4), Buffer.alloc(64, 1)]);
    const oldMap = blockmap(base), newMap = blockmap(next);
    function release(version, bytes, map) {
        const file = filename(version, 'win32', arch, 'nsis'), url = `${RELEASE_ROOT}/download/v${version}/${file}`;
        const entry = { file, url, size: bytes.length, sha256: hash(bytes), blockmap: { file: file + '.blockmap', url: url + '.blockmap', size: map.length, sha256: hash(map) } };
        const text = JSON.stringify({ schema: 1, version, notes: 'Windows 增量更新', platforms: { [key]: entry } });
        return { entry, text, signature: sign(null, Buffer.from(text), privateKey).toString('base64') };
    }
    const previous = release('1.0.0', base, oldMap), current = release('1.0.1', next, newMap);
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
    return { updater, options, directory, requests, installs, states, next, previous, current };
}

test('Windows x64 and ARM64 download changed blocks, copy reordered blocks and verify the signed full installer', async t => {
    for (const arch of ['x64', 'arm64']) await t.test(arch, async t => {
        const f = await fixture(t, { arch }); await f.updater.check();
        assert.equal(f.updater.state().status, 'ready'); assert.equal(f.updater.state().mode, 'delta');
        assert.equal(f.updater.state().total, 64); assert.equal(f.updater.state().reused, 128);
        assert.deepEqual(f.requests.filter(r => r.url === f.current.entry.url).map(r => r.headers.Range), ['bytes=64-127']);
        await f.updater.apply(); assert.equal(f.installs.length, 1); assert.equal(f.installs[0].arch, arch);
        assert.deepEqual(await readFile(f.installs[0].file), f.next);
        const restarted = createUpdater({ ...f.options, fetcher: async () => { throw Error('offline'); } }); t.after(() => restarted.close());
        await restarted.check(); assert.equal(restarted.state().status, 'ready'); await restarted.apply(); assert.equal(f.installs.length, 2);
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
    const manifest = JSON.parse(f.current.text); manifest.platforms['win32-x64-nsis'].blockmap.url = 'https://invalid.test/map';
    const text = JSON.stringify(manifest), signature = sign(null, Buffer.from(text), privateKey).toString('base64');
    assert.equal(readManifest(text, signature, { platform: 'win32', arch: 'x64', format: 'nsis' }, publicKey).blockmap, undefined);
});
