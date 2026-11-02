import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, cp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { directorFixture } from './director-fixture.mjs';
import { builtinPlugins } from '../web/build/builtin-plugins.mjs';
const require = createRequire(import.meta.url), webRequire = createRequire(resolve('web/package.json'));
const { build } = await import(pathToFileURL(webRequire.resolve('vite')).href), { default: react } = await import(pathToFileURL(webRequire.resolve('@vitejs/plugin-react')).href);
const fixture = await directorFixture({ build, react, builtinPlugins, fixture: 'smart-edit' });
await cp(resolve('web/dist/editor'),join(fixture.root,'editor'),{recursive:true});
const profile = await mkdtemp(join(tmpdir(), 'canvas-edit-restart-'));
try {
    for (const phase of ['run', 'restore']) {
        const env = { ...process.env, CANVAS_EDIT_TEST_ROOT: fixture.root, CANVAS_EDIT_TEST_PROFILE: profile, CANVAS_EDIT_TEST_PHASE: phase }; delete env.ELECTRON_RUN_AS_NODE;
        const electron = require('electron'), args = [resolve('test/fixtures/smart-edit.cjs'), fixture.url];
        const child = process.platform === 'linux' ? spawn('xvfb-run', ['-a', electron, ...args, '--no-sandbox'], { env, stdio: 'inherit' }) : spawn(electron, args, { env, stdio: 'inherit', windowsHide: true });
        process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
        if (process.exitCode) break;
        if(await readFile(join(profile,phase+'.passed'),'utf8').catch(()=>null)!=='passed')throw Error('Editor regression exited without finishing '+phase);
    }
} finally { await fixture.close(); await rm(profile, { recursive: true, force: true }); }
