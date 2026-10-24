// Runs only with --smoke-test, against isolated local servers and test configuration.
const http = require('node:http');
const assert = require('node:assert/strict');
async function runProxySmoke(window) {
    const sockets = new Set(), servers = [];
    const listen = server => new Promise(resolve => {
        servers.push(server);
        server.on('connection', socket => { sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket)); });
        server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });
    try {
        const invalidModel = await window.webContents.executeJavaScript("window.oneYesDesktop.models.list('')");
        assert.match(invalidModel.error, /有效的 OneYes API Key/);
        let seen = 0;
        const origin = await listen(http.createServer(async (req, res) => {
            const chunks = []; for await (const chunk of req) chunks.push(chunk);
            assert.equal(req.headers['proxy-authorization'], undefined);
            res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ value: Buffer.concat(chunks).toString() }));
        }));
        const proxy = await listen(http.createServer((req, res) => {
            if (req.headers['proxy-authorization'] !== 'Basic ' + Buffer.from('smoke:password').toString('base64')) { res.writeHead(407); res.end(); return; }
            seen++;
            const headers = { ...req.headers }; delete headers['proxy-authorization'];
            const forward = http.request(req.url, { method: req.method, headers }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
            forward.on('error', () => res.destroy()); res.on('close', () => forward.destroy()); req.pipe(forward);
        }));
        const settings = { proxyMode: 'upstream', proxyEnabled: true, upstreamProxyUrl: `http://127.0.0.1:${proxy}`, upstreamProxyUsername: 'smoke', upstreamProxyPassword: 'password' };
        const target = 'oneyes-canvas://app/proxy?url=' + encodeURIComponent(`http://127.0.0.1:${origin}/echo`);
        const result = await window.webContents.executeJavaScript(`(async () => {
            const key = 'infinite-canvas:ai_config_store';
            const previous = await window.oneYesDesktop.storage.getItem(key);
            const state = JSON.parse(previous || '{}');
            try {
                await window.oneYesDesktop.storage.setItem(key, JSON.stringify({ ...state, state: { ...state.state, config: ${JSON.stringify(settings)} } }));
                const response = await fetch(${JSON.stringify(target)}, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'proxy-smoke' });
                if (!response.ok) throw new Error('Packaged proxy request failed: ' + response.status);
                return await response.json();
            } finally {
                if (previous) await window.oneYesDesktop.storage.setItem(key, previous);
                else await window.oneYesDesktop.storage.removeItem(key);
            }
        })()`);
        assert.equal(result.value, 'proxy-smoke'); assert.equal(seen, 1);
    } finally {
        for (const socket of sockets) socket.destroy();
        await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
    }
}
module.exports = { runProxySmoke };
