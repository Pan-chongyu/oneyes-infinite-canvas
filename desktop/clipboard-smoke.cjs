const assert = require('node:assert/strict');
const { clipboard, ClipboardItem, nativeImage } = require('electron');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

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
    const directory = await mkdtemp(join(tmpdir(), 'canvas-clipboard-smoke-'));
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
        const files = ['原图 中文#1.PNG', '第二张.png'];
        for (const name of files) await writeFile(join(directory, name), image);
        await clipboard.write([new ClipboardItem({ 'text/uri-list': files.map(name => pathToFileURL(join(directory, name)).href).join('\r\n') })]);
        const copied = await window.webContents.executeJavaScript('window.oneYesDesktop.clipboard.read()');
        assert.deepEqual(copied.files.map(file => file.name), files);
        for (const file of copied.files) { assert.equal(file.type, 'image/png'); assert.deepEqual(Buffer.from(file.image), image); }
        console.log('NATIVE_ASYNC_CLIPBOARD_EMPTY_TEXT_IMAGE_IPC_DECODE_OK');
        console.log('NATIVE_CLIPBOARD_IMAGE_FILES_NAMES_ORIGINAL_BYTES_OK');
    } finally {
        if (saved.length) await clipboard.write(saved);
        else await clipboard.clear();
        await rm(directory, { recursive: true, force: true });
    }
}
module.exports = { smokeClipboard };
