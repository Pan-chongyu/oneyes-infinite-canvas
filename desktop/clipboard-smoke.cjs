const assert = require('node:assert/strict');
const { clipboard, ClipboardItem, nativeImage } = require('electron');

async function smokeClipboard(window) {
    // Materialize lazy OS payloads before writing fixtures, then restore them.
    const saved = [];
    for (const item of await clipboard.read()) {
        if (!item.types.length) continue;
        const data = {};
        for (const type of item.types) data[type] = await item.getType(type);
        saved.push(new ClipboardItem(data));
    }
    const text = '  中文剪贴板\n第二行  ';
    const image = nativeImage.createFromBitmap(Buffer.alloc(16 * 8 * 4, 255), { width: 16, height: 8 }).toPNG();
    try {
        await clipboard.clear();
        assert.deepEqual(await window.webContents.executeJavaScript('window.oneYesDesktop.clipboard.read()'), {});
        await clipboard.writeText(text);
        assert.deepEqual(await window.webContents.executeJavaScript('window.oneYesDesktop.clipboard.read()'), { text });
        await clipboard.write([new ClipboardItem({ 'image/png': new Blob([image], { type: 'image/png' }), 'text/plain': 'mixed text' })]);
        const result = await window.webContents.executeJavaScript(`(async () => {
            const data = await window.oneYesDesktop.clipboard.read();
            const file = new File([new Uint8Array(data.image).buffer], 'clipboard.png', { type: data.type });
            const bitmap = await createImageBitmap(file);
            const result = { type: file.type, width: bitmap.width, height: bitmap.height, hasText: 'text' in data };
            bitmap.close(); return result;
        })()`);
        assert.deepEqual(result, { type: 'image/png', width: 16, height: 8, hasText: false });
        console.log('NATIVE_ASYNC_CLIPBOARD_EMPTY_TEXT_IMAGE_IPC_DECODE_OK');
    } finally {
        if (saved.length) await clipboard.write(saved);
        else await clipboard.clear();
    }
}
module.exports = { smokeClipboard };
