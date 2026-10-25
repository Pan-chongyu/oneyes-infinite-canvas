import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { builtinPlugins } from '../web/build/builtin-plugins.mjs';
const webRequire = createRequire(resolve('web/package.json'));
const { createServer } = await import(pathToFileURL(webRequire.resolve('vite')).href);
const { default: react } = await import(pathToFileURL(webRequire.resolve('@vitejs/plugin-react')).href);
const server = await createServer({
    configFile: false, root: resolve('web'), logLevel: 'error',
    resolve: { alias: { '@': resolve('web/src') } }, define: { __APP_VERSION__: JSON.stringify('test') },
    plugins: [react(), builtinPlugins(), { name: 'chat-fixture', configureServer(server) {
        server.middlewares.use('/__agent-chat', async (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end(await server.transformIndexHtml('/__agent-chat', '<div id="root"></div><script type="module" src="/test/agent-chat.tsx"></script>'));
        });
    } }], server: { host: '127.0.0.1', port: 0 },
});
try {
    await server.listen();
    const require = createRequire(import.meta.url), electron = require('electron');
    const args = [resolve('test/fixtures/agent-chat.cjs'), `http://127.0.0.1:${server.httpServer.address().port}/__agent-chat`];
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const child = process.platform === 'linux' ? spawn('xvfb-run', ['-a', electron, ...args, '--no-sandbox'], { env, stdio: 'inherit' }) : spawn(electron, args, { env, stdio: 'inherit', windowsHide: true });
    process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
} finally { await server.close(); }
