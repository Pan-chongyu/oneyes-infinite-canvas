import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
const require = createRequire(import.meta.url);
const { createAccount, brokerCall } = require('../desktop/account.cjs');
const memory = () => { let value; return { read: async () => value, write: async v => { value = v; } }; };
const ok = data => Response.json({ code: 0, data });
const user = { id: 7, email: 'test@example.test', password: 'must-not-return' };
test('standalone login, 2FA and rotating refresh survive restart without saving password or exposing tokens', async () => {
    const vault = memory(), calls = [];
    const fetcher = async (url, options) => {
        assert.ok(url.startsWith('https://api.oneyes.ai/api/v1/')); assert.equal(options.redirect, 'manual');
        calls.push(url);
        if (url.endsWith('/settings/public')) return ok({});
        if (url.endsWith('/auth/login')) return ok({ requires_2fa: true, temp_token: 'challenge-test' });
        if (url.endsWith('/auth/login/2fa')) { assert.equal(JSON.parse(options.body).temp_token, 'challenge-test'); return ok({ access_token: 'access-test', refresh_token: 'refresh-test', user }); }
        if (url.endsWith('/auth/refresh')) return ok({ access_token: 'new-access-test', refresh_token: 'rotated-test' });
        if (url.endsWith('/auth/me')) { assert.equal(options.headers.Authorization, 'Bearer new-access-test'); return ok(user); }
        throw new Error('unexpected');
    };
    const account = createAccount({ vault, fetcher, broker: async () => { throw new Error('offline'); } });
    assert.equal((await account.call('restore')).user, null);
    assert.deepEqual(await account.call('login', { email: user.email, password: 'password-test' }), { requires_2fa: true });
    const session = await account.call('login_2fa', { code: '123456' });
    assert.equal(session.user.id, 7); assert.equal(session.source, 'login'); assert.ok(!JSON.stringify(session).includes('token'));
    assert.ok(!(await vault.read()).includes('password'));
    const restored = await createAccount({ vault, fetcher }).call('restore');
    assert.equal(restored.user.id, 7); assert.equal(JSON.parse(await vault.read()).refresh_token, 'rotated-test');
    await assert.rejects(account.call('delete_key', { account_id: 7 }), /不支持/);
    await assert.rejects(account.call('keys', { account_id: 8 }), /账号已变更/);
});
test('desktop sharing binds every key operation to the account and disconnecting never logs out the host', async () => {
    const vault = memory(), calls = [];
    let currentUser = user;
    const broker = async (operation, args, accountId) => {
        calls.push(operation);
        if (operation === 'profile') return currentUser;
        assert.equal(accountId, 7); return { items: [], total: 0 };
    };
    const account = createAccount({ vault, broker, fetcher: () => { throw new Error('must not request tokens'); } });
    assert.equal((await account.call('restore')).source, 'desktop');
    await account.call('keys', { account_id: 7, page: 1 });
    currentUser = { ...user, id: 8 };
    await assert.rejects(account.call('restore'), /账号已变更/);
    await account.call('logout');
    assert.equal((await account.call('restore')).user, null); assert.ok(!calls.includes('logout'));
    assert.ok(!JSON.stringify(await vault.read()).includes('refresh_token'));
});
test('account redirects fail closed and corrupt sessions are preserved', async () => {
    const vault = memory();
    await vault.write('{bad');
    await assert.rejects(createAccount({ vault }).call('restore'));
    assert.equal(await vault.read(), '{bad');
    const account = createAccount({ vault: memory(), fetcher: async () => new Response(null, { status: 302 }) });
    await assert.rejects(account.call('login', {}), /重定向/);
});
test('Canvas key creation accepts only the Grok Video group for video access', async () => {
    const vault = memory(), created = [];
    const fetcher = async (url, options) => {
        if (url.endsWith('/settings/public')) return ok({});
        if (url.endsWith('/auth/login')) return ok({ access_token: 'access-test', user });
        if (url.endsWith('/groups/available')) return ok([
            { id: 4, name: 'Video', platform: 'Grok' },
            { id: 5, name: 'Video', platform: 'MiniMax' },
        ]);
        if (url.endsWith('/keys') && options.method === 'POST') {
            const payload = JSON.parse(options.body);
            created.push(payload);
            return ok({ id: 9, name: payload.name, key: 'grok-video-key', status: 'active', group_id: payload.group_id });
        }
        throw new Error('unexpected request');
    };
    const account = createAccount({ vault, fetcher });
    await account.call('login', { email: user.email, password: 'password-test' });
    const key = await account.call('create_key', { account_id: 7, group_id: 4 });
    assert.equal(key.group_id, 4);
    assert.deepEqual(created, [{ name: 'Canvas_无限画布', group_id: 4 }]);
    await assert.rejects(account.call('create_key', { account_id: 7, group_id: 5 }), /不能用于 Canvas/);
    assert.equal(created.length, 1);
});
test('native broker uses OS-local IPC and a capability instead of passing credentials in URLs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'canvas-broker-'));
    const secret = randomBytes(32).toString('base64url');
    const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\OneYesCanvas-${secret}` : join(dir, 'canvas.sock');
    const server = net.createServer(socket => socket.once('data', bytes => {
        const request = JSON.parse(bytes.toString());
        assert.equal(request.secret, secret); assert.equal(request.operation, 'keys'); assert.equal(request.account_id, 7);
        socket.end(JSON.stringify({ data: { items: [], total: 0 } }) + '\n');
    }));
    try {
        await new Promise(resolve => server.listen(endpoint, resolve));
        await writeFile(join(dir, 'connection.json'), JSON.stringify({ endpoint, secret }), { mode: 0o600 });
        assert.equal((await brokerCall('keys', { page: 1 }, 7, dir)).total, 0);
        await writeFile(join(dir, 'connection.json'), JSON.stringify({ endpoint: 'https://evil.test', secret }));
        await assert.rejects(brokerCall('keys', {}, 7, dir), /无效/);
    } finally { await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});
