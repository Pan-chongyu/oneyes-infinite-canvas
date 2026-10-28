const fs = require('node:fs/promises');
const path = require('node:path');
const { Worker } = require('node:worker_threads');

// bsdiff-wasm is a portable, dependency-free bspatch implementation. Keeping
// the patch engine in the desktop process avoids asking the renderer to read
// installer bytes or execute native code.
async function applyDelta({ baseFile, patchFile, outputFile, targetSize, signal }) {
    const handle = await fs.open(patchFile, 'r'), header = Buffer.alloc(32);
    try { if ((await handle.read(header, 0, 32, 0)).bytesRead !== 32) throw new Error('增量更新包不完整'); }
    finally { await handle.close(); }
    if (header.subarray(0, 8).toString() !== 'BSDIFF40' || header[31] & 128 || header.readBigUInt64LE(24) !== BigInt(targetSize)) throw new Error('增量更新包目标无效');
    signal?.throwIfAborted();
    await new Promise((resolve, reject) => {
        const worker = new Worker(path.join(__dirname, 'update-delta-worker.cjs'), { workerData: { baseFile, patchFile, outputFile } });
        const abort = () => { void worker.terminate().then(() => reject(new Error('更新已取消')), reject); };
        signal?.addEventListener('abort', abort, { once: true });
        worker.once('error', reject);
        worker.once('exit', code => {
            signal?.removeEventListener('abort', abort);
            if (signal?.aborted) reject(new Error('更新已取消'));
            else if (code === 0) resolve(); else reject(new Error('增量更新包应用失败'));
        });
        if (signal?.aborted) abort();
    });
}

module.exports = { applyDelta };
