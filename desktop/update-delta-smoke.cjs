const fs = require('node:fs/promises');
const path = require('node:path');
const { applyDelta } = require('./update-delta.cjs');

// A reference BSDIFF40 patch tests the actual packaged worker and WASM,
// without network access or touching the user's updater cache.
async function smokeDelta(directory) {
    const root = await fs.mkdtemp(path.join(directory, 'ota-delta-smoke-'));
    const baseFile = path.join(root, 'base'), patchFile = path.join(root, 'patch'), outputFile = path.join(root, 'next');
    const expected = Buffer.from('OneYes Canvas delta smoke next');
    try {
        await fs.writeFile(baseFile, 'OneYes Canvas delta smoke base');
        await fs.writeFile(patchFile, Buffer.from('QlNESUZGNDAvAAAAAAAAACcAAAAAAAAAHgAAAAAAAABCWmg5MUFZJlNZMDHD5gAACOBAXCAAEEAAIAAhKB6QhgOXQpJPF3JFOFCQMDHD5kJaaDkxQVkmU1lMfTf1AAAAYABAAAEAIAAhAIKDF3JFOFCQTH039UJaaDkxQVkmU1l5zE5dAAAAgYACAQRAIAAhmmgzTQy8XckU4UJB5zE5dA==', 'base64'));
        await applyDelta({ baseFile, patchFile, outputFile, targetSize: expected.length });
        if (!(await fs.readFile(outputFile)).equals(expected)) throw new Error('Packaged OTA delta reconstruction failed');
        const { gzipSync } = require('node:zlib'), { createHash } = require('node:crypto');
        const { downloadBlocks } = require('./update-blockmap.cjs');
        const base = Buffer.from('AAAAAAAABBBBBBBB'), next = Buffer.from('BBBBBBBBCCCCCCCC');
        const map = bytes => gzipSync(JSON.stringify({ version: '2', files: [{ name: 'file', offset: 0, sizes: [8, 8], checksums: [bytes.subarray(0, 8), bytes.subarray(8)].map(b => createHash('sha256').update(b).digest('hex')) }] }));
        await fs.writeFile(baseFile, base); await fs.writeFile(path.join(root, 'old.blockmap'), map(base)); await fs.writeFile(path.join(root, 'new.blockmap'), map(next));
        await fs.rm(outputFile);
        await downloadBlocks({ baseFile, oldMapFile: path.join(root, 'old.blockmap'), newMapFile: path.join(root, 'new.blockmap'), base: { size: base.length, sha256: 'base', blockmap: { sha256: 'old' } }, entry: { size: next.length, sha256: 'next', blockmap: { sha256: 'new' }, url: 'https://invalid.test/offline-fixture' }, outputFile,
            fetcher: async (_url, init) => { if (init.headers.Range !== 'bytes=8-15') throw Error('Invalid packaged block request'); return new Response(next.subarray(8), { status: 206, headers: { 'content-range': 'bytes 8-15/16' } }); } });
        if (!(await fs.readFile(outputFile)).equals(next)) throw new Error('Packaged block OTA reconstruction failed');
    } finally { await fs.rm(root, { recursive: true, force: true }); }
}
module.exports = { smokeDelta };
