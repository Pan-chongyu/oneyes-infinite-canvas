const { readFile, lstat } = require('node:fs/promises');
const { join } = require('node:path');
const { homedir } = require('node:os');
const net = require('node:net');

function brokerDirectory() {
    const base = process.platform === 'win32' ? process.env.APPDATA : process.platform === 'darwin'
        ? join(homedir(), 'Library/Application Support') : process.env.XDG_DATA_HOME || join(homedir(), '.local/share');
    if (!base) throw new Error('无法读取 OneYes 用户目录');
    return join(base, 'ai.oneyes.desktop/canvas-link');
}
async function brokerCall(operation, args = {}, accountId, directory = brokerDirectory()) {
    const metadata = await lstat(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || (process.getuid && (metadata.uid !== process.getuid() || (metadata.mode & 0o077)))) throw new Error('OneYes 本机连接权限无效');
    const info = JSON.parse(await readFile(join(directory, 'connection.json'), 'utf8'));
    const validEndpoint = process.platform === 'win32' ? /^\\\\\.\\pipe\\OneYesCanvas-[A-Za-z0-9_-]+$/.test(info.endpoint) : info.endpoint === join(directory, 'canvas.sock');
    if (!validEndpoint || !/^[A-Za-z0-9_-]{43}$/.test(info.secret)) throw new Error('OneYes 本机连接无效');
    return new Promise((resolve, reject) => {
        const socket = net.createConnection(info.endpoint);
        let response = '', settled = false;
        const finish = (error, data) => { if (settled) return; settled = true; socket.destroy(); error ? reject(error) : resolve(data); };
        socket.setEncoding('utf8');
        socket.on('connect', () => socket.write(JSON.stringify({ secret: info.secret, operation, args, account_id: accountId }) + '\n'));
        socket.on('data', data => {
            response += data;
            if (!response.includes('\n')) return;
            try { const value = JSON.parse(response); finish(value.error ? new Error(value.error) : null, value.data); }
            catch { finish(new Error('OneYes 本机响应无效')); }
        });
        socket.on('error', () => finish(new Error('请先打开并登录 OneYes 客户端，再连接登录态')));
        socket.on('close', () => { if (!settled) finish(new Error('OneYes 本机连接已断开，请重新连接')); });
    });
}
function safeUser(value) {
    if (!Number.isSafeInteger(value?.id) || value.id <= 0) throw new Error('OneYes 账户资料无效');
    return Object.fromEntries(['id', 'email', 'username', 'balance'].map(key => [key, value[key]]));
}
function createAccount({ vault, fetcher, broker = brokerCall }) {
    let session, access, challenge, queue = Promise.resolve();
    const serial = action => { const next = queue.then(action); queue = next.catch(() => {}); return next; };
    // Canvas is a standalone application. Keep both official routes fixed and
    // deterministic so it works without the OneYes Desktop broker.
    const apiBases = ['https://oneyes.ai/api/v1', 'https://api.oneyes.ai/api/v1'];
    async function raw(method, path, payload, token) {
        for (let index = 0; index < apiBases.length; index += 1) {
            let response;
            try {
                response = await fetcher(apiBases[index] + path, {
                    method, redirect: 'manual', headers: { 'Content-Type': 'application/json', 'Accept-Language': 'zh-CN', ...(token ? { Authorization: 'Bearer ' + token, 'X-User-UI-Request': '1' } : {}) },
                    ...(method === 'GET' ? {} : { body: JSON.stringify(payload || {}) }),
                });
            } catch (error) {
                if (index + 1 < apiBases.length) continue;
                throw error instanceof Error ? error : new Error('无法连接 OneYes，请检查网络后重试');
            }
            if (response.status >= 300 && response.status < 400) throw new Error('OneYes 接口重定向，已停止请求');
            // Reads can safely fall back after a gateway failure. A write that
            // received an HTTP response is never replayed to avoid double charge.
            if (method === 'GET' && index + 1 < apiBases.length && (response.status === 408 || response.status >= 500)) continue;
            const body = await response.json().catch(() => ({}));
            if (!response.ok || (body.code !== undefined && body.code !== 0)) {
                const error = new Error(body.message || `OneYes 请求失败（${response.status}）`);
                error.status = response.status;
                throw error;
            }
            return body.code !== undefined ? body.data : body;
        }
        throw new Error('无法连接 OneYes，请检查网络后重试');
    }
    async function save(next) { await vault.write(JSON.stringify(next)); session = next; }
    function view() { return session?.user ? { user: session.user, source: session.source } : { user: null }; }
    async function refresh() {
        if (!session?.refresh_token) throw new Error('登录已过期，请重新登录');
        try {
            const data = await raw('POST', '/auth/refresh', { refresh_token: session.refresh_token });
            if (!data.access_token) throw new Error('登录响应缺少令牌');
            await save({ ...session, refresh_token: data.refresh_token || session.refresh_token });
            access = data.access_token;
        } catch (error) {
            if (error.status === 401 || error.status === 403) { access = null; await save({ disabled: true }); }
            throw error;
        }
    }
    async function request(method, path, payload) {
        if (!session?.user || session.source !== 'login') throw new Error('请先登录 OneYes');
        if (!access) await refresh();
        try { return await raw(method, path, payload, access); }
        catch (error) {
            if (error.status !== 401 || !session.refresh_token) throw error;
            await refresh();
            return raw(method, path, payload, access);
        }
    }
    async function share() {
        const user = safeUser(await broker('profile'));
        await save({ source: 'desktop', user });
        access = null;
        return view();
    }
    async function call(operation, args = {}) {
        if (!session) session = JSON.parse(await vault.read() || '{}');
        if (operation === 'settings') return raw('GET', '/settings/public');
        if (operation === 'reuse') return share();
        if (operation === 'restore') {
            if (session.source === 'desktop') {
                const user = safeUser(await broker('profile'));
                if (user.id !== session.user?.id) throw new Error('主客户端登录账号已变更，请重新连接');
                await save({ ...session, user });
            } else if (session.source === 'login') {
                await refresh();
                await save({ ...session, user: safeUser(await request('GET', '/auth/me')) });
            } else if (!session.disabled) {
                try { return await share(); } catch { /* Standalone login remains available. */ }
            }
            return view();
        }
        if (operation === 'login' || operation === 'login_2fa') {
            if (operation === 'login') {
                const settings = await raw('GET', '/settings/public');
                if (settings.turnstile_enabled || settings.tencent_captcha_enabled || settings.aliyun_captcha_enabled || settings.login_agreement_enabled) throw new Error('当前账号登录需要官网验证，请在 OneYes 客户端登录后复用登录态');
            }
            const data = await raw('POST', operation === 'login' ? '/auth/login' : '/auth/login/2fa', operation === 'login'
                ? { email: args.email, password: args.password } : { temp_token: challenge, totp_code: args.code, code: args.code });
            if (data.requires_2fa) { challenge = data.temp_token; return { requires_2fa: true }; }
            if (!data.access_token) throw new Error('登录响应缺少令牌');
            await save({ source: 'login', user: safeUser(data.user), refresh_token: data.refresh_token });
            access = data.access_token; challenge = null;
            return view();
        }
        if (operation === 'logout') {
            const old = session, token = access;
            await save({ disabled: true }); access = null; challenge = null;
            if (old.source === 'login' && old.refresh_token) {
                try { await raw('POST', '/auth/logout', { refresh_token: old.refresh_token }, token); } catch { /* Local logout is already durable. */ }
            }
            return view();
        }
        const accountId = args.account_id;
        if (!session.user || accountId !== session.user.id) throw new Error('登录账号已变更，请重新登录');
        if (!['groups', 'keys', 'key', 'create_key'].includes(operation)) throw new Error('不支持的账户操作');
        if (session.source === 'desktop') return broker(operation, args, session.user.id);
        if (operation === 'groups') return request('GET', '/groups/available');
        if (operation === 'keys') return request('GET', `/keys?page=${Number(args.page) || 1}&page_size=100`);
        if (operation === 'key') {
            if (!Number.isSafeInteger(args.id) || args.id <= 0) throw new Error('Key ID 无效');
            return request('GET', `/keys/${args.id}`);
        }
        if (!Number.isSafeInteger(args.group_id) || args.group_id <= 0) throw new Error('分组 ID 无效');
        const groups = await request('GET', '/groups/available');
        if (!Array.isArray(groups) || !groups.some(group => group.id === args.group_id && ({ openai: ['vip', 'svip'], deepseek: ['deepseek'], grok: ['video'] })[group.platform?.trim().toLowerCase()]?.includes(group.name?.trim().toLowerCase()))) throw new Error('该分组不能用于 Canvas 一键配置');
        return request('POST', '/keys', { name: 'Canvas_无限画布', group_id: args.group_id });
    }
    return { call: (operation, args) => serial(() => call(operation, args)) };
}
module.exports = { createAccount, brokerCall, brokerDirectory };
