import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { appendFile, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createBuildDownloader } from './build-download.mjs';

const repositories = { electron: 'electron/electron', binaries: 'electron-userland/electron-builder-binaries', uv: 'astral-sh/uv' };
export function relayResource(path) {
    const match = path.match(/^\/(electron|binaries|uv)\/([^/?#]+)\/([^/?#]+)$/);
    if (!match || match.slice(2).some(value => /[\\/]|^\.{1,2}$/.test(decodeURIComponent(value)))) throw Error('Invalid build resource path');
    return `https://github.com/${repositories[match[1]]}/releases/download/${match[2]}/${match[3]}`;
}

async function serve() {
    const download = createBuildDownloader();
    const server = createServer(async (request, response) => {
        const abort = new AbortController(); response.on('close', () => abort.abort());
        try {
            if (request.method !== 'GET') throw Error('Only GET is supported');
            const result = await download(relayResource(request.url), { signal: abort.signal });
            response.writeHead(result.status, Object.fromEntries(['content-type', 'content-length'].map(key => [key, result.headers.get(key)]).filter(([, value]) => value)));
            await pipeline(Readable.fromWeb(result.body), response);
        } catch (error) { if (!response.headersSent) response.writeHead(502); response.end('Official build resource is unavailable'); console.error(error.message); }
    });
    server.listen(0, '127.0.0.1', () => process.send?.({ port: server.address().port }));
    process.on('SIGTERM', () => server.close());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const [operation, state] = process.argv.slice(2);
    if (operation === 'serve') await serve();
    else if (operation === 'start') {
        if (!process.env.GITHUB_ENV || !state) throw Error('Build relay requires the GitHub runner environment');
        const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve'], { detached: true, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
        const { port } = await new Promise((resolve, reject) => { child.once('message', resolve); child.once('error', reject); child.once('exit', code => reject(Error(`Build relay exited (${code})`))); });
        const base = `http://127.0.0.1:${port}`;
        await appendFile(process.env.GITHUB_ENV, `ELECTRON_MIRROR=${base}/electron/\nELECTRON_BUILDER_BINARIES_MIRROR=${base}/binaries/\nELECTRON_BUILDER_BINARIES_ALLOW_HTTP=true\nONEYES_BUILD_ASSET_RELAY=${base}\n`);
        await writeFile(state, JSON.stringify({ pid: child.pid })); child.disconnect(); child.unref();
        console.log('Official asset relay ready on the isolated runner loopback interface');
    } else if (operation === 'stop') {
        const { pid } = JSON.parse(await readFile(state, 'utf8')); process.kill(pid, 'SIGTERM');
    } else throw Error('Unknown build relay operation');
}
