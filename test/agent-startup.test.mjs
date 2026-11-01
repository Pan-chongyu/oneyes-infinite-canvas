import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url), toml = require('@iarna/toml');

test('background bridge defers workspace/global MCPs and preserves saved configuration on denied access', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'canvas-startup-permissions-'));
    const agentHome = join(dir, 'agent'), codexHome = join(dir, 'codex'), workspacePath = join(dir, 'Documents', 'workspace');
    const marker = join(dir, 'external-starts'), guardMarker = join(dir, 'workspace-access');
    const token = 'isolated-startup-fixture-0123456789';
    let child;
    const stop = async () => {
        if (!child || child.exitCode !== null) return;
        const exited = new Promise(resolve => child.once('exit', resolve));
        child.send('stop'); await exited; child = undefined;
    };
    try {
        await mkdir(agentHome); await mkdir(codexHome);
        const mcp = join(dir, 'external.cjs');
        await writeFile(mcp, `require('node:fs').appendFileSync(${JSON.stringify(marker)},'started\\n');require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line);if(q.id!==undefined)console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result:q.method==='initialize'?{protocolVersion:q.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'external-permissions',version:'1'}}:{tools:[]}}))});`);
        const codexText = toml.stringify({ model: 'preserved-model', mcp_servers: { 'external-permissions': { command: process.execPath, args: [mcp] } } });
        await writeFile(join(codexHome, 'config.toml'), codexText);
        const entry = join(dir, 'server.mjs');
        await writeFile(entry, `import fs from 'node:fs';import path from 'node:path';
const guarded=${JSON.stringify(workspacePath)};
for(const name of ['mkdirSync','readFileSync','existsSync']){const original=fs[name];fs[name]=function(file,...args){if(process.env.CANVAS_GUARD_WORKSPACE==='1'&&(String(file)===guarded||String(file).startsWith(guarded+path.sep))){fs.writeFileSync(${JSON.stringify(guardMarker)},'accessed');throw Object.assign(new Error('fixture workspace permission denied'),{code:'EACCES'})}return original.call(this,file,...args)}}
process.on('message',message=>{if(message==='stop')process.exit(0)});
const {startHttpServer}=await import(${JSON.stringify(pathToFileURL(resolve('canvas-agent/dist/server/http.js')).href)});startHttpServer();`);
        const start = async (guard = false) => {
            child = fork(entry, [], { cwd: agentHome, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: { ...process.env, PORT: String(port), ONEYES_DESKTOP_AGENT: '1', ONEYES_CANVAS_AGENT_HOME: agentHome, CODEX_HOME: codexHome, CANVAS_GUARD_WORKSPACE: guard ? '1' : '0' } });
            child.stderr.resume();
            return new Promise((resolve, reject) => {
                child.on('message', value => { if (value.type === 'ready') resolve(value.url); });
                child.once('error', reject); child.once('exit', code => reject(new Error(`Fixture exited before ready: ${code}`)));
            });
        };
        // Port zero is not persisted: choose a valid ephemeral port, as the desktop does.
        const { createServer } = await import('node:net');
        const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
        const configFile = join(agentHome, 'canvas-agent.json');
        await writeFile(configFile, JSON.stringify({ url: `http://127.0.0.1:${port}`, token, workspace: { workspacePath, pinnedThreadIds: ['pin'] } }));
        const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-canvas-agent-token': token };
        const background = async (url, threadId = '') => {
            const before = await readFile(join(codexHome, 'config.toml'), 'utf8');
            assert.equal((await (await fetch(`${url}/health`)).json()).conversation.status, 'idle');
            const workspace = await (await fetch(`${url}/agent/codex/workspace`, { headers })).json();
            assert.equal(workspace.workspace.activeThreadId || '', threadId);
            const response = await fetch(`${url}/mcp`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) });
            assert.ok((await response.json()).result.tools.some(tool => tool.name === 'canvas_get_state'));
            const events = await fetch(`${url}/events?clientId=permission-test`, { headers });
            await events.body.getReader().cancel();
            assert.equal(await readFile(marker, 'utf8').catch(() => ''), '');
            assert.equal(await readFile(guardMarker, 'utf8').catch(() => ''), '');
            assert.equal(await readFile(join(codexHome, 'config.toml'), 'utf8'), before);
        };
        const initialize = url => fetch(`${url}/agent/codex/initialize`, { method: 'POST', headers, body: JSON.stringify({ permissionMode: 'request', clientId: 'permission-test' }) });
        let url = await start(true);
        await background(url);
        const denied = await initialize(url);
        assert.equal(denied.status, 500);
        assert.equal((await (await fetch(`${url}/health`)).json()).conversation.status, 'failed');
        assert.equal(await readFile(marker, 'utf8').catch(() => ''), '', 'workspace failure must not start permission-seeking MCPs');
        await stop(); await rm(guardMarker);
        url = await start(); await background(url);
        const initialized = await initialize(url), data = await initialized.json();
        assert.equal(initialized.status, 200, data.error);
        assert.equal(data.conversation.status, 'ready');
        const threadId = data.workspace.activeThreadId;
        assert.ok(threadId);
        assert.match(await readFile(marker, 'utf8'), /started/);
        await stop(); await rm(marker);
        url = await start(true); await background(url, threadId);
        assert.equal((await initialize(url)).status, 500, 'saved workspace access still requires explicit use');
        assert.equal(JSON.parse(await readFile(configFile, 'utf8')).workspace.activeThreadId, threadId, 'permission rejection must preserve history');
        await stop(); await rm(guardMarker);
        url = await start(); await background(url, threadId);
        const resumed = await (await initialize(url)).json();
        // Codex may replace an empty draft with no materialized rollout; saved
        // thread identity must remain untouched until explicit initialization.
        assert.ok(resumed.workspace.activeThreadId);
        assert.equal(resumed.conversation.status, 'ready');
        assert.deepEqual(resumed.workspace.pinnedThreadIds, ['pin']);
        const finalConfig = toml.parse(await readFile(join(codexHome, 'config.toml'), 'utf8'));
        assert.equal(finalConfig.model, 'preserved-model');
        assert.deepEqual(finalConfig.mcp_servers, toml.parse(codexText).mcp_servers);
    } finally { await stop(); await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});
