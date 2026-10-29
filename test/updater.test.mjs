import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir, rm, access, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const require = createRequire(import.meta.url);
const { createUpdater } = require('../desktop/updater.cjs');
const { updateTarget } = require('../desktop/update-platform.cjs');
const { prepareInstall } = require('../desktop/update-install.cjs');
const { readManifest, filename, RELEASE_ROOT, newer } = require('../desktop/update-policy.cjs');
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const target = { platform: 'win32', arch: 'arm64', format: 'nsis', destination: 'C:\\Apps\\OneYes Canvas', executable: 'C:\\Apps\\OneYes Canvas\\OneYes Canvas.exe' };
function release(version = '0.21.0', payload = Buffer.from('fixture-installer')) {
    const file = filename(version, target.platform, target.arch, target.format);
    const entry = { file, url: `${RELEASE_ROOT}/download/v${version}/${file}`, size: payload.length, sha256: createHash('sha256').update(payload).digest('hex') };
    const text = JSON.stringify({ schema: 1, version, notes: '更新内容', platforms: { 'win32-arm64-nsis': entry } });
    return { text, signature: sign(null, Buffer.from(text), privateKey).toString('base64'), payload, entry };
}
async function fixture(t, extra = {}) {
    const directory = await mkdtemp(join(tmpdir(), 'canvas-ota-')); t.after(() => rm(directory, { recursive: true, force: true }));
    let current = release(), corrupt = false, offline = false, installs = [], requests = [];
    const options = { currentVersion: '0.20.20', directory, target: async () => target, publicKey,
        fetcher: async url => {
            requests.push(url); if (offline) throw new Error('network');
            if (url.endsWith('.sig')) return new Response(current.signature);
            if (url.endsWith('.json')) return new Response(current.text);
            return new Response(corrupt ? Buffer.from('bad-installer') : (url.endsWith('.delta') ? (current.deltaPayload || current.payload) : current.payload));
        }, install: async plan => installs.push(plan), ...extra };
    const updater = createUpdater(options); t.after(() => updater.close());
    return { updater, options, directory, installs, requests, setRelease: value => { current = value; }, corrupt: value => { corrupt = value; }, offline: value => { offline = value; } };
}
test('manifest pins signatures, stable versions, release destination, native arch and independent formats', () => {
    const r = release(); assert.equal(readManifest(r.text, r.signature, target, publicKey).version, '0.21.0');
    assert.throws(() => readManifest(r.text + ' ', r.signature, target, publicKey), /签名/);
    assert.throws(() => readManifest(r.text, r.signature, target, generateKeyPairSync('ed25519').publicKey), /签名/);
    assert.throws(() => readManifest(r.text, r.signature, { ...target, arch: 'x64' }, publicKey), /未找到/);
    const changed = JSON.parse(r.text); changed.platforms['win32-arm64-nsis'].url = 'https://evil.test/payload.exe';
    const text = JSON.stringify(changed), sig = sign(null, Buffer.from(text), privateKey).toString('base64');
    assert.throws(() => readManifest(text, sig, target, publicKey), /未找到/);
    assert.ok(newer('1.2.0', '1.1.9')); assert.ok(!newer('1.0.0', '2.0.0'));
    assert.match(filename('1.2.3', 'linux', 'arm64', 'rpm'), /aarch64\.rpm$/);
    assert.match(filename('1.2.3', 'linux', 'x64', 'deb'), /amd64\.deb$/);
});
test('download persists verified bytes, restores offline after restart, revalidates before install, cleans prior versions', async t => {
    const f = await fixture(t);
    await mkdir(join(f.directory, 'ota/0.19.0'), { recursive: true }); await writeFile(join(f.directory, 'ota/0.19.0/old.exe'), 'old');
    await f.updater.check(); assert.equal(f.updater.state().status, 'ready'); assert.equal(f.updater.state().progress, 100);
    await assert.rejects(access(join(f.directory, 'ota/0.19.0')));
    const restarted = createUpdater(f.options); t.after(() => restarted.close()); f.offline(true);
    await restarted.check(); assert.equal(restarted.state().status, 'ready');
    await restarted.apply(); assert.equal(f.installs.length, 1); assert.equal(f.installs[0].arch, 'arm64');
    const file = join(f.directory, 'ota/0.21.0', release().entry.file); await writeFile(file, 'tamper');
    const tampered = createUpdater(f.options); t.after(() => tampered.close());
    f.offline(false); await tampered.check(); await writeFile(file, 'tamper'); await tampered.apply();
    assert.equal(tampered.state().status, 'error'); assert.equal(f.installs.length, 1);
    await tampered.check(); assert.equal(tampered.state().status, 'ready');
    const installed = createUpdater({ ...f.options, currentVersion: '0.21.0' }); t.after(() => installed.close());
    await installed.check(); assert.equal(installed.state().status, 'current'); await assert.rejects(access(join(f.directory, 'ota/0.21.0')));
});
async function deltaFixture(t, scenario = '') {
    const f = await fixture(t);
    const base = Buffer.from('fixture-installer-'.repeat(2000)), next = Buffer.from('fixture-installer-'.repeat(1999) + 'small-change');
    const work = await mkdtemp(join(tmpdir(), 'canvas-delta-')); t.after(() => rm(work, { recursive: true, force: true }));
    await writeFile(join(work, 'base.bin'), base); await writeFile(join(work, 'next.bin'), next);
    const { loadBsdiff } = await import('bsdiff-wasm');
    const module = await loadBsdiff(); module.FS.mkdir('/working'); module.FS.mount(module.NODEFS, { root: work }, '/working'); module.FS.chdir('/working'); module.callMain(['base.bin', 'next.bin', 'patch.bin']);
    const patch = await readFile(join(work, 'patch.bin'));
    const baseFile = filename('0.20.20', target.platform, target.arch, target.format), deltaFile = `${filename('0.21.0', target.platform, target.arch, target.format)}.from-0.20.20.delta`;
    const baseHash = createHash('sha256').update(base).digest('hex'), nextHash = createHash('sha256').update(next).digest('hex'), patchHash = createHash('sha256').update(patch).digest('hex');
    const delta = { from: '0.20.20', file: deltaFile, url: `${RELEASE_ROOT}/download/v0.21.0/${deltaFile}`, size: patch.length, sha256: patchHash, baseFile, baseSize: base.length, baseSha256: baseHash, targetSha256: nextHash, targetSize: next.length };
    if (scenario === 'wrong-platform') delta.file = delta.file.replace('Windows-arm64', 'Windows-x64');
    const text = JSON.stringify({ schema: 1, version: '0.21.0', notes: 'delta', platforms: { [target.platform + '-' + target.arch + '-' + target.format]: { file: filename('0.21.0', target.platform, target.arch, target.format), url: `${RELEASE_ROOT}/download/v0.21.0/${filename('0.21.0', target.platform, target.arch, target.format)}`, size: next.length, sha256: nextHash } }, deltas: { [target.platform + '-' + target.arch + '-' + target.format]: { '0.20.20': delta } } });
    const signature = sign(null, Buffer.from(text), privateKey).toString('base64');
    const baseText = JSON.stringify({ schema: 1, version: '0.20.20', notes: 'base', platforms: { [target.platform + '-' + target.arch + '-' + target.format]: { file: baseFile, url: `${RELEASE_ROOT}/download/v0.20.20/${baseFile}`, size: base.length, sha256: baseHash } } });
    const baseFolder = join(f.directory, 'ota', scenario === 'legacy-cache' ? '0.20.20' : 'base-0.20.20');
    await mkdir(baseFolder, { recursive: true }); await writeFile(join(baseFolder, baseFile), scenario === 'corrupt-base' ? Buffer.alloc(base.length) : base); await writeFile(join(baseFolder, 'canvas-latest.json'), baseText); await writeFile(join(baseFolder, 'canvas-latest.json.sig'), sign(null, Buffer.from(baseText), privateKey).toString('base64'));
    if (scenario === 'missing-base') await rm(baseFolder, { recursive: true, force: true });
    if (scenario === 'invalid-base-signature') await writeFile(join(baseFolder, 'canvas-latest.json.sig'), 'untrusted');
    let deltaPayload = scenario === 'corrupt-patch' ? Buffer.alloc(patch.length) : scenario === 'truncated-patch' ? patch.subarray(0, 12) : patch;
    if (scenario === 'wrong-target') {
        // This patch has a valid signed hash but reconstructs different bytes.
        await writeFile(join(work, 'next.bin'), Buffer.alloc(next.length)); module.callMain(['base.bin', 'next.bin', 'wrong.bin']);
        deltaPayload = await readFile(join(work, 'wrong.bin'));
        const data = JSON.parse(text), wrong = data.deltas['win32-arm64-nsis']['0.20.20'];
        wrong.sha256 = createHash('sha256').update(deltaPayload).digest('hex'); wrong.size = deltaPayload.length;
        const changed = JSON.stringify(data);
        f.setRelease({ text: changed, signature: sign(null, Buffer.from(changed), privateKey).toString('base64'), payload: next, deltaPayload });
    } else f.setRelease({ text, signature, payload: next, deltaPayload });
    return { ...f, next, patch, baseFolder, baseFile };
}
test('uses a signed delta when the verified current installer is cached, then validates the reconstructed full installer', async t => {
    const f = await deltaFixture(t), { next } = f;
    await f.updater.check(); assert.equal(f.updater.state().mode, 'delta'); assert.equal(f.updater.state().status, 'ready');
    await f.updater.apply(); assert.equal(f.installs.length, 1); assert.deepEqual(await readFile(f.installs[0].file), next); assert.ok(f.requests.some(url => url.endsWith('.delta')));
});
test('delta failures fall back to the signed full package and never execute partial updates', async t => {
    for (const scenario of ['missing-base', 'corrupt-base', 'invalid-base-signature', 'wrong-platform', 'corrupt-patch', 'truncated-patch', 'wrong-target']) await t.test(scenario, async t => {
        const f = await deltaFixture(t, scenario);
        await f.updater.check(); assert.equal(f.updater.state().status, 'ready'); assert.equal(f.updater.state().mode, 'full');
        await f.updater.apply(); assert.deepEqual(await readFile(f.installs[0].file), f.next);
        const files = await readdir(join(f.directory, 'ota/0.21.0')); assert.ok(!files.some(file => /\.(delta|part)$/.test(file)));
    });
});
test('promotes legacy OTA cache, retains the installed base after restart and removes older bases', async t => {
    const f = await deltaFixture(t, 'legacy-cache');
    await mkdir(join(f.directory, 'ota/base-0.19.0'), { recursive: true });
    await f.updater.check(); assert.equal(f.updater.state().mode, 'delta');
    await access(join(f.directory, 'ota/base-0.20.20', f.baseFile)); await assert.rejects(access(f.baseFolder)); await assert.rejects(access(join(f.directory, 'ota/base-0.19.0')));
    f.offline(true);
    const upgraded = createUpdater({ ...f.options, currentVersion: '0.21.0' }); t.after(() => upgraded.close());
    await upgraded.check();
    assert.deepEqual(await readFile(join(f.directory, 'ota/base-0.21.0', filename('0.21.0', target.platform, target.arch, target.format))), f.next);
    await assert.rejects(access(join(f.directory, 'ota/base-0.20.20')));
});
test('corrupt/truncated downloads and network failures are retryable and never installed; newer cache is replaced', async t => {
    const f = await fixture(t); f.corrupt(true); await f.updater.check();
    assert.equal(f.updater.state().status, 'error'); await f.updater.apply(); assert.equal(f.installs.length, 0);
    f.corrupt(false); await f.updater.check(); assert.equal(f.updater.state().status, 'ready');
    f.setRelease(release('0.22.0')); await f.updater.check(); assert.equal(f.updater.state().version, '0.22.0');
    await assert.rejects(access(join(f.directory, 'ota/0.21.0')));
    await writeFile(join(f.directory, 'ota/install-error.txt'), 'cancelled');
    const restarted = createUpdater(f.options); t.after(() => restarted.close()); await restarted.start();
    assert.equal(restarted.state().status, 'error'); assert.match(restarted.state().error, /当前版本已保留/);
    await restarted.check(); assert.equal(restarted.state().status, 'ready');
});
test('checks are serialized and stop after shutdown; unknown formats never install', async t => {
    const f = await fixture(t); await Promise.all([f.updater.check(), f.updater.check()]);
    assert.equal(f.requests.filter(s => s.endsWith('.exe')).length, 1);
    f.updater.close(); const before = f.requests.length; await f.updater.check(); assert.equal(f.requests.length, before);
    let failTarget = true;
    const unsupported = await fixture(t, { target: async () => { if (failTarget) throw new Error('当前安装格式不支持自动更新'); return target; } });
    await unsupported.updater.check(); assert.equal(unsupported.updater.state().supported, true); assert.equal(unsupported.updater.state().status, 'error'); assert.equal(unsupported.requests.length, 0);
    failTarget = false;
    await unsupported.updater.check(); assert.equal(unsupported.updater.state().status, 'ready');
});
test('native hardware selection handles Windows emulation and Rosetta independently of installed programs', async () => {
    assert.equal((await updateTarget({ platform: 'win32', machine: 'ARM64', execPath: 'C:\\Apps\\Canvas.exe' })).arch, 'arm64');
    const home = await mkdtemp(join(tmpdir(), 'canvas-target-'));
    try {
        const result = await updateTarget({ platform: 'darwin', machine: 'x86_64', execPath: join(home, 'OneYes Canvas.app/Contents/MacOS/OneYes Canvas'), command: async () => ({ stdout: '1\n' }) });
        assert.equal(result.arch, 'arm64'); assert.equal(result.format, 'zip');
        const appimage = join(home, 'app.AppImage'); await writeFile(appimage, 'fixture');
        assert.equal((await updateTarget({ platform: 'linux', machine: 'aarch64', env: { APPIMAGE: appimage } })).format, 'AppImage');
        assert.equal((await updateTarget({ platform: 'linux', machine: 'x86_64', env: {}, execPath: appimage, command: async (bin) => { if (bin === 'dpkg-query') throw Error(); return { stdout: 'oneyes-canvas' }; } })).format, 'rpm');
    } finally { await rm(home, { recursive: true, force: true }); }
});
test('installer plans use quoted argument arrays, verify macOS identity and retain original until successful startup', async t => {
    const root = await mkdtemp(join(tmpdir(), 'canvas-plan-')); t.after(() => rm(root, { recursive: true, force: true }));
    const plan = { ...target, root, folder: root, file: join(root, 'setup.exe'), version: '0.21.0' }, starts = [];
    const apply = await prepareInstall(plan, { parentPid: 123, start: async (...args) => starts.push(args) });
    await apply(); assert.equal(starts[0][0], 'powershell.exe');
    assert.deepEqual(JSON.parse(await readFile(join(root, 'install-plan.json'), 'utf8')).destination, target.destination);
    const mac = { ...plan, platform: 'darwin', format: 'zip', destination: join(root, 'OneYes Canvas.app'), executable: join(root, 'OneYes Canvas.app/Contents/MacOS/OneYes Canvas') };
    await assert.rejects(prepareInstall(mac, { command: async () => ({ stdout: 'other.app' }) }), /身份/);
    const script = await readFile('desktop/update-unix.sh', 'utf8'); assert.match(script, /while \[ ! -f "\$ack" \]/); assert.match(script, /mv "\$backup" "\$destination"/);
});
test('Linux AppImage helper replaces and reopens, rolls back a failed launch without deleting the installed version', { skip: process.platform !== 'linux' }, async t => {
    const root = await mkdtemp(join(tmpdir(), 'canvas-install-')); t.after(() => rm(root, { recursive: true, force: true }));
    const destination = join(root, 'OneYes Canvas.AppImage'), stage = join(root, 'new.AppImage'), ack = join(root, 'ready'), errorFile = join(root, 'error'), oldMarker = join(root, 'old-opened');
    const quote = text => "'" + text.replaceAll("'", "'\\''") + "'";
    const old = `#!/bin/sh\ntouch ${quote(oldMarker)}\n`;
    await writeFile(destination, old, { mode: 0o755 }); await writeFile(stage, `#!/bin/sh\ntouch ${quote(ack)}\n`, { mode: 0o755 });
    const run = promisify(execFile), args = ['desktop/update-unix.sh', 'AppImage', '2147483647', destination, stage, errorFile, destination, ack];
    await run('/bin/sh', args); await assert.rejects(access(destination + '.oneyes-previous')); await access(ack);
    await rm(ack); await writeFile(destination, old, { mode: 0o755 }); await writeFile(stage, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    await assert.rejects(run('/bin/sh', args)); assert.equal(await readFile(destination, 'utf8'), old); await access(errorFile);
    // The rollback intentionally reopens the original app asynchronously; wait for that fixture to finish writing before cleanup.
    while (!await access(oldMarker).then(() => true, () => false)) await new Promise(resolve => setTimeout(resolve, 10));
});
