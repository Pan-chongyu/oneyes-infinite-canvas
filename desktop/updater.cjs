const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { FEED, CHECK_INTERVAL, readManifest, newer } = require('./update-policy.cjs');
const { applyDelta } = require('./update-delta.cjs');

async function fileHash(file) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
}
async function validateFile(file, entry) {
    const info = await fs.lstat(file);
    if (!info.isFile() || info.size !== entry.size || await fileHash(file) !== entry.sha256) throw new Error('更新包校验失败，已停止安装。请重新下载');
}
function createUpdater({ currentVersion, directory, target, fetcher, install, changed = () => {}, publicKey, enabled = true, feed = FEED }) {
    const root = path.join(directory, 'ota');
    let state = { status: 'idle', currentVersion, version: '', progress: 0, downloaded: 0, total: 0, notes: '', error: '', supported: enabled, mode: 'full', phase: '' };
    let selected, entry, saved, operation, installation, checking, timer, closed = false;
    const controller = new AbortController();
    const emit = patch => { state = { ...state, ...patch }; changed({ ...state }); };
    const failure = error => emit({ status: 'error', error: error.userMessage || (/^(更新|未找到|当前|无法识别|请将)/.test(error.message) ? error.message : '连接更新服务失败，请检查网络或代理后重试') });
    const serial = action => {
        if (operation) return operation;
        operation = action().catch(error => {
            if (!closed && !installation) failure(error);
        }).finally(() => { operation = null; });
        return operation;
    };
    async function cleanup(keep = '') {
        await fs.mkdir(root, { recursive: true, mode: 0o700 });
        for (const name of await fs.readdir(root)) {
            if (name === keep || name === `base-${currentVersion}` || name === 'install-error.txt' || name === `installed-${currentVersion}.ok`) continue;
            await fs.rm(path.join(root, name), { recursive: true, force: true });
        }
    }
    async function chooseTarget() {
        try { return selected ||= await target(); }
        catch (error) { error.userMessage = error.message; emit({ supported: false }); throw error; }
    }
    async function restore() {
        const destination = await chooseTarget();
        // Older updaters leave the just-installed full package here. Promote it
        // before cleanup so the first delta-enabled release can use it next time.
        const installed = path.join(root, currentVersion);
        try {
            const [text, signature] = await Promise.all(['canvas-latest.json', 'canvas-latest.json.sig'].map(file => fs.readFile(path.join(installed, file), 'utf8')));
            const base = readManifest(text, signature, destination, publicKey);
            if (base.version === currentVersion) {
                await validateFile(path.join(installed, base.file), base);
                await fs.rm(path.join(root, `base-${currentVersion}`), { recursive: true, force: true });
                await fs.rename(installed, path.join(root, `base-${currentVersion}`));
            }
        } catch {}
        let pending;
        for (const name of (await fs.readdir(root).catch(() => [])).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))) {
            if (!/^\d+\.\d+\.\d+$/.test(name) || !newer(name, currentVersion)) continue;
            const folder = path.join(root, name);
            try {
                const [text, signature] = await Promise.all(['canvas-latest.json', 'canvas-latest.json.sig'].map(file => fs.readFile(path.join(folder, file), 'utf8')));
                const candidate = readManifest(text, signature, destination, publicKey);
                if (candidate.version !== name) continue;
                pending ||= { text, signature, folder };
                await validateFile(path.join(folder, candidate.file), candidate);
                entry = candidate; saved = { text, signature, folder };
                await cleanup(name);
                emit({ status: 'ready', version: entry.version, notes: entry.notes, progress: 100, downloaded: entry.size, total: entry.size, mode: 'full' });
                return true;
            } catch {}
        }
        await cleanup(pending ? path.basename(pending.folder) : '');
        return false;
    }
    async function response(url, init = {}) {
        const result = await fetcher(url, { ...init, signal: checking ? AbortSignal.any([controller.signal, checking.signal]) : controller.signal, cache: 'no-store' });
        if (!result.ok) throw new Error('连接更新服务失败，请检查网络或代理后重试');
        return result;
    }
    async function downloadBytes(url, file, size, sha256) {
        const partial = file + '.part', receipt = partial + '.json';
        const discard = async () => { await fs.rm(partial, { force: true }); await fs.rm(receipt, { force: true }); };
        try { await validateFile(file, { size, sha256 }); return; } catch {}
        let offset = 0, validator, invalid = false, resumable = true;
        try {
            const info = await fs.lstat(partial), saved = JSON.parse(await fs.readFile(receipt, 'utf8'));
            if (info.isFile() && info.size <= size && saved.url === url && saved.size === size && saved.sha256 === sha256) {
                offset = info.size; validator = saved.validator;
            } else await discard();
        } catch { await discard(); }
        try {
            if (offset === size) {
                await validateFile(partial, { size, sha256 });
                await fs.rename(partial, file); await fs.rm(receipt, { force: true }); return;
            }
            let result = await fetcher(url, { signal: controller.signal, cache: 'no-store', headers: offset ? { Range: `bytes=${offset}-`, ...(validator ? { 'If-Range': validator } : {}) } : {} });
            const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(result.headers.get('content-range') || '');
            const validRange = result.status === 206 && range && Number(range[1]) === offset && Number(range[2]) >= offset && Number(range[2]) < size && Number(range[3]) === size;
            if (offset && (result.status === 416 || result.status === 206 && !validRange)) {
                await result.body?.cancel(); await discard(); offset = 0;
                result = await fetcher(url, { signal: controller.signal, cache: 'no-store' });
            } else if (result.status === 200) offset = 0;
            if (!result.ok) { resumable = false; throw new Error('连接更新服务失败，请检查网络或代理后重试'); }
            if (result.status !== 200 && !(validRange && offset)) { invalid = true; await result.body?.cancel(); throw new Error('更新包续传响应无效，请重试'); }
            if (!result.body) throw new Error('更新包下载失败，请重试');
            const etag = result.headers.get('etag');
            await fs.writeFile(receipt, JSON.stringify({ url, size, sha256, ...(etag && !etag.startsWith('W/') ? { validator: etag } : {}) }), { mode: 0o600 });
            const hash = createHash('sha256');
            if (offset) for await (const chunk of createReadStream(partial)) hash.update(chunk);
            const handle = await fs.open(partial, offset ? 'a' : 'w', 0o600);
            let bytes = offset;
            emit({ downloaded: bytes, progress: Math.floor(bytes / size * 100) });
            try {
                for await (const chunk of result.body) {
                    bytes += chunk.length;
                    if (bytes > size) { invalid = true; throw new Error('更新包长度无效，请重试'); }
                    hash.update(chunk); await handle.writeFile(chunk);
                    const progress = Math.floor(bytes / size * 100);
                    if (progress !== state.progress) emit({ downloaded: bytes, progress });
                }
            } finally { try { await handle.sync(); } finally { await handle.close(); } }
            if (bytes < size) throw new Error('更新包下载中断，重试后将继续下载');
            if (hash.digest('hex') !== sha256) { await discard(); throw new Error('更新包校验失败，请重新下载'); }
            await fs.rename(partial, file);
            await fs.rm(receipt, { force: true });
        } catch (error) {
            if (invalid || offset === size) await discard();
            error.resumableDownload = resumable && !invalid && !/更新包(校验失败|长度无效)/.test(error.message);
            throw error;
        }
    }
    async function findBase(delta) {
        if (!delta || delta.from !== currentVersion) return null;
        const folder = path.join(root, `base-${currentVersion}`);
        try {
            const [text, signature] = await Promise.all(['canvas-latest.json', 'canvas-latest.json.sig'].map(file => fs.readFile(path.join(folder, file), 'utf8')));
            const savedBase = readManifest(text, signature, await chooseTarget(), publicKey);
            if (savedBase.version !== currentVersion || savedBase.file !== delta.baseFile || savedBase.size !== delta.baseSize || savedBase.sha256 !== delta.baseSha256) return null;
            const file = path.join(folder, savedBase.file);
            await validateFile(file, savedBase);
            return file;
        } catch { return null; }
    }
    async function downloadFull() {
        emit({ status: 'downloading', mode: 'full', phase: '', error: '', progress: 0, downloaded: 0, total: entry.size });
        await downloadBytes(entry.url, path.join(saved.folder, entry.file), entry.size, entry.sha256);
    }
    async function download() {
        await cleanup(entry.version);
        await fs.mkdir(saved.folder, { recursive: true, mode: 0o700 });
        await fs.writeFile(path.join(saved.folder, 'canvas-latest.json'), saved.text, { mode: 0o600 });
        await fs.writeFile(path.join(saved.folder, 'canvas-latest.json.sig'), saved.signature, { mode: 0o600 });
        const base = await findBase(entry.delta);
        if (base && entry.delta.size < entry.size) {
            try {
                const delta = entry.delta, patch = path.join(saved.folder, delta.file), output = path.join(saved.folder, entry.file + '.delta.part');
                emit({ status: 'downloading', mode: 'delta', phase: '', error: '', progress: 0, downloaded: 0, total: delta.size });
                await downloadBytes(delta.url, patch, delta.size, delta.sha256);
                await fs.rm(output, { force: true });
                emit({ phase: 'reconstructing' });
                await applyDelta({ baseFile: base, patchFile: patch, outputFile: output, targetSize: entry.size, signal: controller.signal });
                await validateFile(output, entry);
                await fs.rename(output, path.join(saved.folder, entry.file));
                await fs.rm(patch, { force: true });
            } catch (error) {
                if (closed || error.resumableDownload) throw error;
                await fs.rm(path.join(saved.folder, entry.file + '.delta.part'), { force: true });
                for (const suffix of ['', '.part', '.part.json']) await fs.rm(path.join(saved.folder, entry.delta.file + suffix), { force: true });
                // A missing/corrupt base or patch must never block an update.
                // Re-fetching the signed full installer is the safe fallback.
                await downloadFull();
            }
        } else {
            await downloadFull();
        }
        await fs.writeFile(path.join(saved.folder, 'canvas-latest.json'), saved.text, { mode: 0o600 });
        await fs.writeFile(path.join(saved.folder, 'canvas-latest.json.sig'), saved.signature, { mode: 0o600 });
        emit({ status: 'ready', downloaded: state.total, progress: 100, phase: '' });
    }
    return {
        state: () => ({ ...state }),
        check() { return serial(async () => {
            if (!enabled || closed || installation || state.status === 'installing') return;
            checking = new AbortController();
            const check = checking;
            emit({ status: 'checking', error: '' });
            const destination = await chooseTarget();
            const restored = await restore();
            if (check.signal.aborted || closed) return;
            let text, signature;
            try {
                [text, signature] = await Promise.all([feed, feed + '.sig'].map(async url => (await response(url)).text()));
            } catch (error) { if (restored) return; throw error; }
            if (check.signal.aborted || closed) return;
            const candidate = readManifest(text, signature, destination, publicKey, currentVersion);
            if (restored && !newer(candidate.version, entry.version)) return;
            if (!newer(candidate.version, currentVersion)) { emit({ status: 'current', version: '', notes: '', progress: 0 }); return; }
            entry = candidate; saved = { text, signature, folder: path.join(root, entry.version) };
            emit({ version: entry.version, notes: entry.notes });
            await download();
        }); },
        apply() {
            if (installation) return installation;
            if (!enabled || closed || state.status !== 'ready' || !saved) return;
            const ready = saved;
            checking?.abort();
            emit({ status: 'installing', error: '' });
            installation = (async () => {
                const verified = readManifest(ready.text, ready.signature, await chooseTarget(), publicKey, currentVersion);
                if (!newer(verified.version, currentVersion)) throw new Error('更新版本无效，请重新检查');
                const file = path.join(ready.folder, verified.file);
                await validateFile(file, verified);
                if (closed) return;
                try { await install({ ...selected, file, version: verified.version, folder: ready.folder, root }); }
                catch (error) { error.userMessage = error.message; throw error; }
            })().catch(error => { if (!closed) failure(error); }).finally(() => { installation = null; });
            return installation;
        },
        async start() {
            if (!enabled) return;
            await fs.mkdir(root, { recursive: true, mode: 0o700 });
            try {
                const error = await fs.readFile(path.join(root, 'install-error.txt'), 'utf8');
                await fs.rm(path.join(root, 'install-error.txt'), { force: true });
                if (error) emit({ status: 'error', error: '上次更新未完成，当前版本已保留。请点击重试；macOS 请确认应用位于“应用程序”，Linux 请完成系统授权' });
            } catch {}
            if (state.status !== 'error') await this.check();
            timer = setInterval(() => void this.check(), CHECK_INTERVAL); timer.unref?.();
        },
        close() { closed = true; controller.abort(); clearInterval(timer); },
    };
}
module.exports = { createUpdater, validateFile, fileHash };
