const { workerData } = require('node:worker_threads');
const path = require('node:path');

// The portable bspatch engine ships with the app; CPU work stays off the UI.
(async () => {
    const { loadBspatch } = await import('bsdiff-wasm');
    const engine = await loadBspatch({ print: () => {}, printErr: () => {} });
    const { baseFile, patchFile, outputFile } = workerData;
    for (const [mount, file] of [['/base', baseFile], ['/patch', patchFile], ['/output', outputFile]]) {
        engine.FS.mkdir(mount);
        engine.FS.mount(engine.NODEFS, { root: path.dirname(file) }, mount);
    }
    const status = engine.callMain([`/base/${path.basename(baseFile)}`, `/output/${path.basename(outputFile)}`, `/patch/${path.basename(patchFile)}`]);
    if (status !== 0) process.exitCode = 1;
})().catch(() => { process.exitCode = 1; });
