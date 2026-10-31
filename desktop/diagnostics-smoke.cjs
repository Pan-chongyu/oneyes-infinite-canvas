const { createServer } = require('node:http');
const { join } = require('node:path');
const { createVault } = require('./vault.cjs');
const { createDiagnostics } = require('./diagnostics.cjs');
// Exercise Electron net.fetch + native report persistence against loopback only.
async function smokeDiagnostics(fetcher, directory) {
    let online = false, registered = false, token;
    const reports = [];
    const server = createServer(async (req, res) => {
        let text = ''; for await (const chunk of req) text += chunk;
        const data = JSON.parse(text);
        if (req.url === '/api/canvas/register') { registered = true; token = req.headers.authorization; }
        else if (registered) reports.push(data.events);
        res.writeHead(registered ? 200 : 401); res.end('{}');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const transport = (url, init) => {
        if (!online) throw new Error('offline');
        if (new URL(url).origin !== 'https://admin.oneyes.ai') throw new Error('Unexpected diagnostic origin');
        return fetcher(`http://127.0.0.1:${server.address().port}${new URL(url).pathname}`, init);
    };
    const vault = createVault(join(directory, 'diagnostic-smoke'), 'diagnostics');
    const metadata = { version:'0.20.63', platform:'macos', arch:'arm64', os_release:'24.6.0', electron:process.versions.electron };
    let client;
    try {
        client = await createDiagnostics({ vault, fetcher: transport, metadata });
        await client.report({component:'image',stage:'poll',error:new Error('fetch failed sk-private-prompt')});
        await client.flush(); await client.close();
        online = true;
        client = await createDiagnostics({ vault, fetcher: transport, metadata }); await client.flush();
        if (reports.length !== 1 || reports[0].length !== 1 || !token || JSON.stringify(reports).includes('sk-private-prompt') || JSON.parse(await vault.read()).pending.length) throw new Error('Native diagnostics recovery failed');
        console.log('NATIVE_DIAGNOSTICS_OK: encrypted offline persistence, restart, native HTTP authentication, redaction, acknowledgement');
    } finally { await client?.close(); await new Promise(resolve => server.close(resolve)); }
}
module.exports = { smokeDiagnostics };
