async function readClipboard(clipboard) {
    const items = await clipboard.read();
    for (const item of items) {
        const type = item.types.includes('image/png') ? 'image/png' : item.types.find(type => type.startsWith('image/'));
        if (type) return { image: new Uint8Array(await (await item.getType(type)).arrayBuffer()), type };
    }
    for (const item of items) {
        if (item.types.includes('text/plain')) return { text: await (await item.getType('text/plain')).text() };
    }
    return {};
}
module.exports = { readClipboard };
