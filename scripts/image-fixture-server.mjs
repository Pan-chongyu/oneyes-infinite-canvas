import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

// Exercise the same bundled workers/WASM as a release, without development HMR
// or dependency discovery reloading a page in the middle of its task receipt.
export async function imageFixtureServer({ build, preview, react, builtinPlugins, videos = false }) {
    const temporary = await mkdtemp(join(tmpdir(), 'canvas-image-fixture-'));
    const outDir = join(temporary, 'dist');
    const config = { configFile: false, root: resolve('web'), logLevel: 'error',
        resolve: { alias: { '@': resolve('web/src') } }, define: { __APP_VERSION__: JSON.stringify('test') },
        worker: { format: 'es' },
        build: { target: 'esnext', outDir, rollupOptions: {
            input: videos ? { 'video-protocol': resolve('web/test/video-protocol.tsx') } : { 'image-tasks': resolve('web/test/image-tasks.tsx'), 'image-restart': resolve('web/test/image-restart.tsx'), 'image-generation': resolve('web/test/image-generation.tsx') },
            output: { entryFileNames: '[name].js' },
        } },
    };
    const cleanup = async () => {
        if (dirname(temporary) !== resolve(tmpdir()) || !temporary.startsWith(join(resolve(tmpdir()), 'canvas-image-fixture-'))) throw Error('Invalid fixture directory');
        await rm(temporary, { recursive: true, force: true });
    };
    try {
        await build({ ...config, plugins: [react(), builtinPlugins()] });
        const styles = (await readdir(join(outDir, 'assets'))).filter(name => name.endsWith('.css')).map(name => `<link rel="stylesheet" href="/assets/${name}">`).join('');
        const errors = '<script>window.fixtureErrors=[];window.addEventListener("error",e=>window.fixtureErrors.push(e.message));window.addEventListener("unhandledrejection",e=>window.fixtureErrors.push(String(e.reason)));</script>';
        const server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 }, plugins: [{
            name: 'compiled-image-fixtures', configurePreviewServer(server) {
                for (const [path, file] of (videos ? [['/__agent-chat', 'video-protocol']] : [['/__agent-chat', 'image-tasks'], ['/__image-restart', 'image-restart'], ['/__image-generation', 'image-generation']])) server.middlewares.use(path, (_req, res) => {
                    res.setHeader('Content-Type', 'text/html'); res.end(`${styles}<div id="root"></div>${errors}<script type="module" src="/${file}.js"></script>`);
                });
            },
        }] });
        return { httpServer: server.httpServer, listen: async () => {}, close: async () => {
            await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
            await cleanup();
        } };
    } catch (error) { await cleanup(); throw error; }
}
