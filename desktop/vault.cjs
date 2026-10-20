const { randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');
const { readFile, writeFile, rename, unlink, mkdir } = require('node:fs/promises');
const { join } = require('node:path');
// AES-GCM local files, without Keychain. A process running as the same OS user
// can also read the key; this protects files at rest, not a compromised account.
function createVault(directory) {
    const keyPath = join(directory, 'config.key'), path = join(directory, 'config.enc');
    let queue = Promise.resolve();
    const serial = action => { const next = queue.then(action); queue = next.catch(() => {}); return next; };
    async function key(create = false) {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        if (create) {
            try { await writeFile(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
            catch (error) { if (error.code !== 'EEXIST') throw error; }
        }
        const bytes = await readFile(keyPath);
        if (bytes.length !== 32) throw new Error('配置加密密钥损坏，已保留原文件');
        return bytes;
    }
    return {
        read: () => serial(async () => {
            let bytes;
            try { bytes = await readFile(path); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
            const decipher = createDecipheriv('aes-256-gcm', await key(), bytes.subarray(0, 12));
            decipher.setAuthTag(bytes.subarray(12, 28));
            return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
        }),
        write: value => serial(async () => {
            if (typeof value !== 'string') throw new Error('配置格式无效');
            JSON.parse(value);
            const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', await key(true), iv);
            const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
            const temporary = path + '.tmp';
            await writeFile(temporary, Buffer.concat([iv, cipher.getAuthTag(), data]), { mode: 0o600 });
            await rename(temporary, path);
        }),
        remove: () => serial(async () => { try { await unlink(path); } catch(e) { if (e.code !== 'ENOENT') throw e; } }),
    };
}
module.exports = { createVault };
