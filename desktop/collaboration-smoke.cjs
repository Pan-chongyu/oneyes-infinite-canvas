const assert = require('node:assert/strict');
const { createCollaboration } = require('./collaboration.cjs');
async function smokeCollaboration(directory, window) {
    const a = createCollaboration({ directory, address: '127.0.0.1' }), b = createCollaboration({ directory });
    try {
        const bridge = await window.webContents.executeJavaScript("window.oneYesDesktop.collaboration.call('state')");
        assert.equal(bridge.status, 'offline');
        const room = await a.call('host'); await b.call('join', { invite: room.invite });
        const until = Date.now() + 10000;
        while (b.state().status !== 'online' || a.state().members !== 2) { if (Date.now() > until) throw Error('Packaged collaboration connection failed'); await new Promise(resolve => setTimeout(resolve, 20)); }
        const source = Buffer.from('packaged-original-素材');
        const uploaded = await b.request(new Request('oneyes-canvas://app/collaboration/assets/new', { method: 'PUT', body: source }));
        assert.equal(uploaded.status, 200);
        const { hash } = await uploaded.json();
        const downloaded = await a.request(new Request('oneyes-canvas://app/collaboration/assets/' + hash));
        assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), source);
    } finally { await b.close(); await a.close(); }
}
module.exports = { smokeCollaboration };
