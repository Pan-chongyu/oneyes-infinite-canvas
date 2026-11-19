import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { readClipboard } = createRequire(import.meta.url)('../desktop/clipboard.cjs');
const item = data => ({ types: Object.keys(data), getType: async type => new Blob([data[type]], { type }) });

test('Electron 44 async clipboard keeps image bytes and MIME before mixed text or HTML', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const clipboard = { read: async () => [item({ 'text/plain': 'mixed text', 'text/html': '<b>text</b>' }), item({ 'image/webp': bytes, 'image/png': bytes })] };
    assert.deepEqual(await readClipboard(clipboard), { image: bytes, type: 'image/png' });
    assert.deepEqual(await readClipboard({ read: async () => [item({ 'image/jpeg': bytes })] }), { image: bytes, type: 'image/jpeg' });
});

test('Electron 44 text is awaited, empty and HTML-only clipboard stay empty, failures propagate', async () => {
    const text = '  中文提示词\n第二行  ';
    assert.deepEqual(await readClipboard({ read: async () => [item({ 'text/html': '<b>ignored</b>' }), item({ 'text/plain': text })] }), { text });
    for (const items of [[], [item({})], [item({ 'text/html': '<script>ignored</script>' })]]) assert.deepEqual(await readClipboard({ read: async () => items }), {});
    const error = new Error('clipboard unavailable');
    await assert.rejects(readClipboard({ read: async () => { throw error; } }), value => value === error);
    await assert.rejects(readClipboard({ read: async () => [{ types: ['image/png'], getType: async () => { throw error; } }] }), value => value === error);
});
