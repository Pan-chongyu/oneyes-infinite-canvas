import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { builtinPlugins } from '../web/build/builtin-plugins.mjs';
import { imageFixtureServer } from './image-fixture-server.mjs';
const webRequire = createRequire(resolve('web/package.json'));
const { createServer, build, preview } = await import(pathToFileURL(webRequire.resolve('vite')).href);
const { default: react } = await import(pathToFileURL(webRequire.resolve('@vitejs/plugin-react')).href);
const updates = process.argv.includes('--updates');
const images = process.argv.includes('--images');
const webdav = process.argv.includes('--webdav');
const plugins = process.argv.includes('--plugins');
const videos = process.argv.includes('--videos');
const fixture = videos ? 'video-protocol' : plugins ? 'canvas-plugins' : images ? 'image-tasks' : updates ? 'desktop-update' : webdav ? 'webdav-sync' : 'agent-chat';
const server = (images || videos) ? await imageFixtureServer({ build, preview, react, builtinPlugins, videos }) : await createServer({
    configFile: false, root: resolve('web'), logLevel: 'error',
    resolve: { alias: { '@': resolve('web/src') } }, define: { __APP_VERSION__: JSON.stringify('test') },
    plugins: [react(), builtinPlugins(), { name: 'chat-fixture', configureServer(server) {
        server.middlewares.use('/__agent-chat', async (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end(await server.transformIndexHtml('/__agent-chat', `<div id="root"></div><script type="module" src="/test/${fixture}.tsx"></script>`));
        });
    } }], server: { host: '127.0.0.1', port: 0 },
});
try {
    await server.listen();
    const require = createRequire(import.meta.url), electron = require('electron');
    const args = [resolve(`test/fixtures/${fixture}.cjs`), `http://127.0.0.1:${server.httpServer.address().port}/__agent-chat`];
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const pluginProfile = plugins ? await mkdtemp(join(tmpdir(), 'canvas-plugin-restart-')) : null;
    if (pluginProfile) env.CANVAS_PLUGIN_TEST_PROFILE = pluginProfile;
    const child = process.platform === 'linux' ? spawn('xvfb-run', ['-a', electron, ...args, '--no-sandbox'], { env, stdio: 'inherit' }) : spawn(electron, args, { env, stdio: 'inherit', windowsHide: true });
    process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
    if (plugins) {
        try {
            if (!process.exitCode) {
                const restartEnv = { ...env, CANVAS_PLUGIN_TEST_PHASE: 'restore' };
                const child = process.platform === 'linux' ? spawn('xvfb-run', ['-a', electron, ...args, '--no-sandbox'], { env: restartEnv, stdio: 'inherit' }) : spawn(electron, args, { env: restartEnv, stdio: 'inherit', windowsHide: true });
                process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
            }
        } finally { await rm(pluginProfile, { recursive: true, force: true }); }
    }
    if (images && !process.exitCode) {
        const profile = await mkdtemp(join(tmpdir(), 'canvas-image-restart-'));
        try {
            for (const phase of ['submit', 'restore', 'completed']) {
                const args = [resolve('test/fixtures/image-restart.cjs'), `http://127.0.0.1:${server.httpServer.address().port}`];
                const restartEnv = { ...env, CANVAS_IMAGE_TEST_PROFILE: profile, CANVAS_IMAGE_TEST_PHASE: phase };
                const child = process.platform === 'linux' ? spawn('xvfb-run', ['-a', electron, ...args, '--no-sandbox'], { env: restartEnv, stdio: 'inherit' }) : spawn(electron, args, { env: restartEnv, stdio: 'inherit', windowsHide: true });
                const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
                if (code) { process.exitCode = code; break; }
            }
        } finally { await rm(profile, { recursive: true, force: true }); }
    }
} finally { await server.close(); }
