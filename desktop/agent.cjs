const fs = require('node:fs/promises');
const { join, isAbsolute } = require('node:path');
const { homedir } = require('node:os');
const { randomBytes } = require('node:crypto');
const { fork } = require('node:child_process');
const toml = require('@iarna/toml');
const { isDeepStrictEqual } = require('node:util');

async function optionalRead(file) {
    try { return await fs.readFile(file, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function privateWrite(file, value) {
    await fs.mkdir(require('node:path').dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
    try { await fs.writeFile(temporary, value, { mode: 0o600, flag: 'wx' }); await fs.rename(temporary, file); }
    finally { await fs.rm(temporary, { force: true }); }
}
function mcpSettings(config) {
    return { url: `${config.url}/mcp`, http_headers: { 'x-canvas-agent-token': config.token }, enabled: true, startup_timeout_sec: 20, tool_timeout_sec: 90 };
}
function parseCodex(text) {
    try { return toml.parse(text || ''); }
    catch { throw new Error('Codex 配置格式有误，原文件未修改。请修复 config.toml 后重试。'); }
}
async function configureCodex(file, config) {
    const original = await optionalRead(file), parsed = parseCodex(original), settings = mcpSettings(config);
    if (isDeepStrictEqual(parsed.mcp_servers?.['infinite-canvas'], settings)) return;
    parsed.mcp_servers ||= {};
    parsed.mcp_servers['infinite-canvas'] = settings;
    const next = toml.stringify(parsed);
    await fs.mkdir(require('node:path').dirname(file), { recursive: true, mode: 0o700 });
    if (original !== null) await fs.writeFile(`${file}.oneyes-${randomBytes(8).toString('hex')}.bak`, original, { flag: 'wx', mode: 0o600 });
    if (await optionalRead(file) !== original) throw new Error('Codex 配置正在被其他程序修改，请稍后重试。');
    await privateWrite(file, next);
}
function createAgent({ directory, runtime, executable = process.execPath, agentHome = process.env.ONEYES_CANVAS_AGENT_HOME || join(homedir(), '.infinite-canvas'), codexHome = process.env.CODEX_HOME || join(homedir(), '.codex') }) {
    if (!isAbsolute(codexHome) || !isAbsolute(agentHome)) throw new Error('Codex 配置目录必须是绝对路径');
    const stateFile = join(directory, 'codex-connection.json'), configFile = join(agentHome, 'canvas-agent.json'), codexFile = join(codexHome, 'config.toml');
    let child, pending, closed = false;
    const serial = action => { if (pending) return pending; pending = action().finally(() => { pending = null; }); return pending; };
    async function config(create) {
        let text = await optionalRead(configFile);
        if (text === null && create) {
            await fs.mkdir(agentHome, { recursive: true, mode: 0o700 });
            try { await fs.writeFile(configFile, JSON.stringify({ url: 'http://127.0.0.1:17371', token: randomBytes(18).toString('hex') }), { flag: 'wx', mode: 0o600 }); }
            catch (error) { if (error.code !== 'EEXIST') throw error; }
            text = await optionalRead(configFile);
        }
        if (text === null) return null;
        try {
            const value = JSON.parse(text), url = new URL(value.url);
            const port = Number(url.port || 17371);
            if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !Number.isInteger(port) || port < 1 || port > 65535 || typeof value.token !== 'string' || !/^[A-Za-z0-9_-]{24,256}$/.test(value.token)) throw new Error();
            return { ...value, url: `http://127.0.0.1:${port}` };
        } catch { throw new Error('本地 Agent 配置无效，原文件已保留。请检查 canvas-agent.json 后重试。'); }
    }
    async function running(value) {
        try {
            const response = await fetch(`${value.url}/agent/desktop-status`, { headers: { 'x-canvas-agent-token': value.token }, signal: AbortSignal.timeout(20_000) });
            const data = await response.json();
            return response.ok && data.desktopBridge === 1 && data.protocolVersion === 6;
        } catch { return false; }
    }
    async function start(value) {
        if (await running(value)) return;
        if (closed) throw new Error('客户端正在退出');
        await new Promise((resolve, reject) => {
            child = fork(join(runtime, 'dist/index.js'), [], { execPath: executable, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
                env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ONEYES_DESKTOP_AGENT: '1', ONEYES_CANVAS_AGENT_HOME: agentHome, CODEX_HOME: codexHome, PORT: new URL(value.url).port || '80' } });
            const owned = child;
            const timer = setTimeout(() => { owned.kill(); finish(new Error('本地 Agent 启动超时，请点击重试。')); }, 20_000);
            function finish(error) { clearTimeout(timer); owned.removeListener('error', fail); owned.removeListener('exit', fail); error ? reject(error) : resolve(); }
            function fail() { finish(new Error('本地 Agent 无法启动，请关闭占用连接端口的旧 Agent 后重试。')); }
            owned.once('error', fail); owned.once('exit', fail);
            owned.on('message', message => { if (message?.type === 'ready' && message.url === value.url && message.token === value.token) finish(); });
        });
        if (!await running(value)) throw new Error('本地 Agent 校验失败，请重试。');
    }
    async function status() {
        const stateText = await optionalRead(stateFile);
        if (!stateText) return { configured: false };
        const state = JSON.parse(stateText), value = await config(false);
        const current = parseCodex(await optionalRead(codexFile)).mcp_servers?.['infinite-canvas'];
        const configured = !!(state.enabled && value && current?.enabled !== false && current?.url === `${value.url}/mcp` && current?.http_headers?.['x-canvas-agent-token'] === value.token);
        return { configured };
    }
    async function connect(setup) {
        if (!setup && !(await status()).configured) return { configured: false };
        // Validate before starting any process; never replace malformed user configuration.
        parseCodex(await optionalRead(codexFile));
        const value = await config(true);
        await start(value);
        if (setup) {
            await configureCodex(codexFile, value);
            await privateWrite(stateFile, JSON.stringify({ enabled: true }));
        }
        return { configured: true, url: value.url, token: value.token };
    }
    return { status, setup: () => serial(() => connect(true)), restore: () => serial(() => connect(false)), stop() { closed = true; child?.kill(); } };
}
module.exports = { createAgent, configureCodex, mcpSettings };
