import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
const electron = createRequire(import.meta.url)('electron');
const args = [resolve('test/fixtures/image-codec.cjs'), ...(process.platform === 'linux' ? ['--no-sandbox'] : [])];
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = process.platform === 'linux' ? spawn('xvfb-run', ['-a', electron, ...args], { env, stdio: 'inherit' }) : spawn(electron, args, { env, stdio: 'inherit', windowsHide: true });
process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
