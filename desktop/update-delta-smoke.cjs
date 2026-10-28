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
    } finally { await fs.rm(root, { recursive: true, force: true }); }
}
module.exports = { smokeDelta };
