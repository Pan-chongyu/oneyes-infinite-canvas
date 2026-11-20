import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const { readClipboard } = createRequire(import.meta.url)('../desktop/clipboard.cjs');
const item = data => ({ types: Object.keys(data), getType: async type => new Blob([data[type]], { type }) });

test('copied image files retain original names, bytes and order without reading folders, text paths or remote URLs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'canvas-clipboard-'));
    try {
        const first = join(dir, '中文 空格#1.PNG'), second = join(dir, '第二张.webp');
        await writeFile(first, new Uint8Array([1, 2, 3]));
        await writeFile(second, new Uint8Array([4, 5]));
        await mkdir(join(dir, 'folder.png'));
        await writeFile(join(dir, 'not-image.txt'), 'plain file');
        const uri = pathToFileURL(first).href;
        const list = ['# copied files', uri, pathToFileURL(second).href, uri, pathToFileURL(join(dir, 'folder.png')).href, pathToFileURL(join(dir, 'not-image.txt')).href, 'https://example.com/image.png', 'file://remote-host/shared/photo.png', 'file:///invalid%2Fpath.png'].join('\r\n');
        const result = await readClipboard({ read: async () => [item({ 'text/uri-list': list, 'text/plain': first, 'image/png': 'thumbnail must not replace original' })] });
        assert.deepEqual(result, { files: [
            { name: '中文 空格#1.PNG', image: new Uint8Array([1, 2, 3]), type: 'image/png' },
            { name: '第二张.webp', image: new Uint8Array([4, 5]), type: 'image/webp' },
        ] });
        assert.ok(!JSON.stringify(result).includes(dir), 'renderer only receives bytes and basename');
        assert.deepEqual(await readClipboard({ read: async () => [item({ 'text/plain': first })] }), { text: first });
        assert.deepEqual(await readClipboard({ read: async () => [item({ 'text/uri-list': 'https://example.com/image.png', 'text/plain': 'copied link text' })] }), { text: 'copied link text' });
        assert.deepEqual(await readClipboard({ read: async () => [item({ 'text/uri-list': pathToFileURL(join(dir, 'not-image.txt')).href, 'text/plain': 'file path is not text content' })] }), {});
        await assert.rejects(readClipboard({ read: async () => [item({ 'text/uri-list': pathToFileURL(join(dir, 'deleted.png')).href })] }), error => /无法读取.*图片文件/.test(error.message) && !error.message.includes(dir));
    } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Electron 44 async clipboard keeps image bytes and MIME before mixed text or HTML', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const clipboard = { read: async () => [item({ 'text/plain': 'mixed text', 'text/html': '<b>text</b>' }), item({ 'image/webp': bytes, 'image/png': bytes })] };
    assert.deepEqual(await readClipboard(clipboard), { image: bytes, type: 'image/png' });
    assert.deepEqual(await readClipboard({ read: async () => [item({ 'image/jpeg': bytes })] }), { image: bytes, type: 'image/jpeg' });
    assert.deepEqual(await readClipboard({ read: async () => [item({ 'text/uri-list': 'https://example.com/photo.png', 'text/plain': 'copied image link', 'image/png': bytes })] }), { image: bytes, type: 'image/png' });
});

test('Electron 44 text is awaited, empty and HTML-only clipboard stay empty, failures propagate', async () => {
    const text = '  中文提示词\n第二行  ';
    assert.deepEqual(await readClipboard({ read: async () => [item({ 'text/html': '<b>ignored</b>' }), item({ 'text/plain': text })] }), { text });
    for (const items of [[], [item({})], [item({ 'text/html': '<script>ignored</script>' })]]) assert.deepEqual(await readClipboard({ read: async () => items }), {});
    const error = new Error('clipboard unavailable');
    await assert.rejects(readClipboard({ read: async () => { throw error; } }), value => value === error);
    await assert.rejects(readClipboard({ read: async () => [{ types: ['image/png'], getType: async () => { throw error; } }] }), value => value === error);
});
