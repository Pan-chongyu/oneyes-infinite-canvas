const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { gunzip } = require('node:zlib');
const { promisify } = require('node:util');
const { computeOperations, OperationKind } = require('electron-updater/out/differentialDownloader/downloadPlanBuilder');

async function readBlockmap(file, size) {
    const map = JSON.parse((await promisify(gunzip)(await fs.readFile(file))).toString('utf8'));
    const entry = map.files?.[0];
    if (map.version !== '2' || !Array.isArray(map.files) || map.files.length !== 1 || entry?.name !== 'file' || entry.offset !== 0 || !Array.isArray(entry.sizes) || !entry.sizes.length || !Array.isArray(entry.checksums) || entry.checksums.length !== entry.sizes.length || entry.sizes.some(n => !Number.isSafeInteger(n) || n <= 0) || entry.checksums.some(s => typeof s !== 'string' || !s) || entry.sizes.reduce((a, b) => a + b, 0) !== size) throw new Error('更新包分块索引无效');
    return map;
}

// Electron's tested block matching, with our signed metadata, proxy transport,
// cancellation and durable partial file. No installer is executed until the
// reconstructed file has passed the signed full-file SHA-256 check.
async function downloadBlocks({ baseFile, oldMapFile, newMapFile, base, entry, outputFile, fetcher, signal, changed = () => {} }) {
    const [oldMap, newMap] = await Promise.all([readBlockmap(oldMapFile, base.size), readBlockmap(newMapFile, entry.size)]);
    const operations = computeOperations(oldMap, newMap, { info() {}, warn() {} });
    const total = operations.filter(op => op.kind === OperationKind.DOWNLOAD).reduce((n, op) => n + op.end - op.start, 0);
    if (operations.reduce((n, op) => n + op.end - op.start, 0) !== entry.size || total >= entry.size) throw new Error('此版本无法复用本机安装包');
    const receipt = outputFile + '.json', identity = JSON.stringify([base.sha256, entry.sha256, base.blockmap.sha256, entry.blockmap.sha256]);
    const discard = async () => { await fs.rm(outputFile, { force: true }); await fs.rm(receipt, { force: true }); };
    let offset = 0, validator;
    try {
        const [info, saved] = await Promise.all([fs.lstat(outputFile), fs.readFile(receipt, 'utf8').then(JSON.parse)]);
        if (info.isFile() && info.size <= entry.size && saved.identity === identity) { offset = info.size; validator = saved.validator; }
        else await discard();
    } catch { await discard(); }
    signal?.throwIfAborted();
    await fs.writeFile(receipt, JSON.stringify({ identity, validator }), { mode: 0o600 });
    let position = 0, downloaded = 0, progress = -1;
    const handle = await fs.open(outputFile, offset ? 'a' : 'w', 0o600);
    const report = () => {
        const next = total ? Math.floor(downloaded / total * 100) : 100;
        if (next !== progress) { progress = next; changed({ mode: 'delta', phase: '', total, downloaded, progress, reused: entry.size - total }); }
    };
    try {
        for (const op of operations) {
            signal?.throwIfAborted();
            const length = op.end - op.start, skipped = Math.min(length, Math.max(0, offset - position));
            if (op.kind === OperationKind.DOWNLOAD) downloaded += skipped;
            report();
            if (skipped === length) { position += length; continue; }
            let body;
            if (op.kind === OperationKind.COPY) body = createReadStream(baseFile, { start: op.start + skipped, end: op.end - 1, signal });
            else {
                const start = position + skipped, end = position + length - 1;
                let response;
                try { response = await fetcher(entry.url, { signal, cache: 'no-store', headers: { Range: `bytes=${start}-${end}`, ...(validator ? { 'If-Range': validator } : {}) } }); }
                catch (error) { error.resumableDownload = true; throw error; }
                const range = `bytes ${start}-${end}/${entry.size}`, etag = response.headers.get('etag');
                if (response.status !== 206 || response.headers.get('content-range') !== range || !response.body || validator && etag && validator !== etag) {
                    await response.body?.cancel();
                    throw Object.assign(new Error('更新服务暂不支持分块续传，改用完整更新包'), { status: response.status });
                }
                if (etag && !etag.startsWith('W/')) { validator = etag; await fs.writeFile(receipt, JSON.stringify({ identity, validator }), { mode: 0o600 }); }
                body = response.body;
            }
            let written = skipped;
            try {
                for await (const chunk of body) {
                    signal?.throwIfAborted();
                    if (written + chunk.length > length) throw new Error('更新分块长度无效');
                    await handle.writeFile(chunk); written += chunk.length;
                    if (op.kind === OperationKind.DOWNLOAD) { downloaded += chunk.length; report(); }
                }
            } catch (error) {
                if (op.kind === OperationKind.DOWNLOAD && !['ENOSPC', 'EIO', 'EACCES', 'EPERM', 'EBADF'].includes(error.code) && !/分块长度/.test(error.message)) error.resumableDownload = true;
                throw error;
            }
            if (written !== length) throw Object.assign(new Error('更新分块下载中断，重试后将继续下载'), { resumableDownload: true });
            position += length;
        }
        return { total, downloaded, reused: entry.size - total };
    } finally { try { await handle.sync(); } finally { await handle.close(); } }
}

module.exports = { readBlockmap, downloadBlocks };
