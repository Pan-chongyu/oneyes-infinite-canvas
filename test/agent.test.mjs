import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { configureCodex, createAgent } = require('../desktop/agent.cjs');
const toml = require('@iarna/toml');
const settings = { url: 'http://127.0.0.1:17371', token: 'local-test-token-0123456789012345' };

test('persistent Codex setup preserves account/models/other MCP, backs up once, rejects corrupt files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'canvas-codex-'));
    try {
        const file = join(dir, 'config.toml');
        const original = '# My configuration\nmodel="custom-model"\nmodel_provider="oneyes"\n[mcp_servers.other]\ncommand="custom-command"\n[model_providers.oneyes]\nbase_url="https://api.oneyes.ai/v1"\n';
        await writeFile(file, original);
        await configureCodex(file, settings);
        const value = toml.parse(await readFile(file, 'utf8'));
        assert.equal(value.model, 'custom-model');
        assert.equal(value.mcp_servers.other.command, 'custom-command');
        assert.equal(value.model_providers.oneyes.base_url, 'https://api.oneyes.ai/v1');
        assert.equal(value.mcp_servers['infinite-canvas'].http_headers['x-canvas-agent-token'], settings.token);
        await configureCodex(file, settings);
        const backups = (await readdir(dir)).filter(name => name.endsWith('.bak'));
        assert.equal(backups.length, 1);
        assert.equal(await readFile(join(dir, backups[0]), 'utf8'), original);
        await writeFile(file, '[broken');
        await assert.rejects(configureCodex(file, settings), /原文件未修改/);
        assert.equal(await readFile(file, 'utf8'), '[broken');
    } finally { await rm(dir, { recursive: true, force: true }); }
});

test('corrupt Agent config and an occupied port never replace Codex settings', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'canvas-agent-conflict-'));
    const server = createServer(socket => socket.destroy());
    const port = await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
    const options = { directory: dir, agentHome: join(dir, 'agent'), codexHome: join(dir, 'codex'), runtime: resolve('canvas-agent') };
    const agent = createAgent(options);
    try {
        await mkdir(options.agentHome); await mkdir(options.codexHome);
        const file = join(options.codexHome, 'config.toml'), original = 'model="preserved"\n';
        await writeFile(file, original);
        const agentFile = join(options.agentHome, 'canvas-agent.json');
        await writeFile(agentFile, '{broken');
        await assert.rejects(agent.setup(), /原文件已保留/);
        assert.equal(await readFile(agentFile, 'utf8'), '{broken');
        await writeFile(agentFile, JSON.stringify({ ...settings, url: `http://127.0.0.1:${port}` }));
        await assert.rejects(agent.setup(), /无法启动/);
        assert.equal(await readFile(file, 'utf8'), original);
        assert.deepEqual(await agent.status(), { configured: false });
    } finally { agent.stop(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});

test('one click starts an authenticated MCP, persists across restart, and restores only after opt-in', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'canvas-agent-integration-'));
    const port = await new Promise(resolve => { const server = createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });
    const options = { directory: dir, agentHome: join(dir, 'agent'), codexHome: join(dir, 'codex'), runtime: resolve('canvas-agent') };
    let agent = createAgent(options);
    try {
        assert.deepEqual(await agent.restore(), { configured: false });
        assert.deepEqual(await readdir(dir), []);
        await mkdir(options.agentHome);
        await writeFile(join(options.agentHome, 'canvas-agent.json'), JSON.stringify({ ...settings, url: `http://127.0.0.1:${port}` }));
        const [connection, duplicate] = await Promise.all([agent.setup(), agent.setup()]);
        assert.deepEqual(connection, duplicate);
        assert.equal(connection.configured, true);
        const unauthorized = await fetch(`${connection.url}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        assert.equal(unauthorized.status, 401);
        const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-canvas-agent-token': connection.token };
        const rpc = async (method, params = {}) => {
            const response = await fetch(`${connection.url}/mcp`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
            assert.equal(response.status, 200);
            return response.json();
        };
        assert.equal((await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } })).result.serverInfo.name, 'canvas-agent');
        assert.ok((await rpc('tools/list')).result.tools.some(tool => tool.name === 'canvas_get_state'));
        // A second manager can reconnect without spawning or terminating an existing compatible service.
        const restored = createAgent(options);
        assert.deepEqual(await restored.restore(), connection);
        restored.stop();
        assert.equal((await rpc('tools/list')).result.tools.length > 0, true);
        agent.stop();
        await new Promise(resolve => setTimeout(resolve, 300));
        agent = createAgent(options);
        assert.deepEqual(await agent.restore(), connection);
        const cli = require.resolve('../canvas-agent/node_modules/@openai/codex/bin/codex.js');
        const { execFile } = require('node:child_process');
        const { promisify } = require('node:util');
        const { stdout } = await promisify(execFile)(process.execPath, [cli, 'mcp', 'get', 'infinite-canvas', '--json'], { env: { ...process.env, CODEX_HOME: options.codexHome } });
        assert.equal(JSON.parse(stdout).transport.url, `${connection.url}/mcp`);
        // A real thread must discover canvas tools even with an unavailable inherited proxy.
        // No login, model turns, user config, or paid requests are needed.
        const script = `const {CodexAppClient}=await import('./canvas-agent/dist/agent/codex-client.js');const events=[];const c=await CodexAppClient.start((type,value)=>{if(type==='agent_bootstrap')events.push(value)},()=>{});const thread=await c.startThread(${JSON.stringify(dir)},'request',true);const status=await c.request('mcpServerStatus/list',{threadId:thread.id,limit:100,detail:'toolsAndAuthOnly'});const canvas=status.data.find(s=>s.name==='infinite-canvas');if(events.some(e=>e.name==='infinite-canvas'&&e.status==='failed')||!canvas?.tools?.canvas_get_state)throw Error('Canvas MCP handshake/tools failed');console.log('CODEX_APP_SERVER_READY');process.exit(0);`;
        const proxy = 'http://127.0.0.1:1';
        const started = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, CODEX_HOME: options.codexHome, ONEYES_CANVAS_AGENT_HOME: options.agentHome, ONEYES_DESKTOP_AGENT: '1', HTTP_PROXY: proxy, HTTPS_PROXY: proxy, ALL_PROXY: proxy, http_proxy: proxy, https_proxy: proxy, all_proxy: proxy, NO_PROXY: '', no_proxy: '' }, timeout: 20_000 });
        assert.ok(started.stdout.includes('CODEX_APP_SERVER_READY'));
    } finally { agent.stop(); await new Promise(resolve => setTimeout(resolve, 300)); await rm(dir, { recursive: true, force: true }); }
});
