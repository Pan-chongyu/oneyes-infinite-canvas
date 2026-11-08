import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

export async function directorFixture({ build, react, builtinPlugins, fixture = 'director' }) {
    const root = await mkdtemp(join(tmpdir(), 'canvas-director-fixture-'));
    const close = () => rm(root, { recursive: true, force: true });
    try {
        await build({ configFile: false, root: resolve('web'), logLevel: 'error',
            resolve: { alias: { '@': resolve('web/src') } }, define: { __APP_VERSION__: JSON.stringify('test') },
            plugins: [react(), builtinPlugins()],
            worker: { format: 'es' },
            build: { target: 'esnext', outDir: root, rollupOptions: { input: resolve(`web/test/${fixture}.tsx`), output: { entryFileNames: 'fixture.js' } } },
        });
        const styles = (await readdir(join(root, 'assets'))).filter(name => name.endsWith('.css')).map(name => `<link rel="stylesheet" href="/assets/${name}">`).join('');
        await writeFile(join(root, 'index.html'), `${styles}<div id="root"></div><script type="module" src="/fixture.js"></script>`);
        return { root, url: 'oneyes-canvas://app/', listen: async () => {}, close };
    } catch (error) { await close(); throw error; }
}
