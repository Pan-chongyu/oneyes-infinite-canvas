import assert from "node:assert/strict";
import test from "node:test";
import { readSystemClipboard } from "./system-clipboard";

test("clipboard prioritizes images, preserves text and supports native and browser reads", async () => {
    const originals = ["window", "navigator"].map(key => Object.getOwnPropertyDescriptor(globalThis, key));
    const bridge = { oneYesDesktop: undefined as unknown };
    let clipboard: unknown;
    Object.defineProperty(globalThis, "window", { configurable: true, value: bridge });
    Object.defineProperty(globalThis, "navigator", { configurable: true, get: () => ({ clipboard }) });
    const text = "  中文提示词\n第二行  ";
    try {
        clipboard = { read: async () => [{ types: ["text/plain"], getType: async () => new Blob([text]) }, { types: ["image/png"], getType: async () => new Blob(["image-bytes"], { type: "image/png" }) }] };
        const image = await readSystemClipboard();
        assert.ok(image instanceof File);
        assert.equal(image.type, "image/png"); assert.equal(await image.text(), "image-bytes");
        clipboard = { read: async () => [{ types: ["text/html", "text/plain"], getType: async () => new Blob([text]) }] };
        assert.equal(await readSystemClipboard(), text);
        clipboard = { readText: async () => text };
        assert.equal(await readSystemClipboard(), text);
        clipboard = { read: async () => [] };
        assert.equal(await readSystemClipboard(), null);
        clipboard = { read: async () => [{ types: ["text/html"] }] };
        assert.equal(await readSystemClipboard(), null, "HTML-only data must not execute markup");
        const denied = new Error("permission denied");
        clipboard = { read: async () => { throw denied; }, readText: () => assert.fail("must not repeat a denied read") };
        await assert.rejects(readSystemClipboard, error => error === denied);
        clipboard = undefined;
        await assert.rejects(readSystemClipboard);
        bridge.oneYesDesktop = { clipboard: { read: async () => ({ text }) } };
        assert.equal(await readSystemClipboard(), text, "native read needs no browser clipboard permission");
        bridge.oneYesDesktop = { clipboard: { read: async () => ({ image: new Uint8Array([1, 2, 3]), type: "image/webp", text }) } };
        const nativeImage = await readSystemClipboard();
        assert.ok(nativeImage instanceof File);
        assert.equal(nativeImage.type, "image/webp");
        assert.deepEqual(new Uint8Array(await nativeImage.arrayBuffer()), new Uint8Array([1, 2, 3]));
        bridge.oneYesDesktop = { clipboard: { read: async () => ({ files: [
            { name: "原图 中文.png", image: new Uint8Array([4, 5, 6]), type: "image/png" },
            { name: "第二张.webp", image: new Uint8Array([7, 8]), type: "image/webp" },
        ] }) } };
        const files = await readSystemClipboard();
        assert.ok(Array.isArray(files));
        assert.deepEqual(files.map(file => [file.name, file.type]), [["原图 中文.png", "image/png"], ["第二张.webp", "image/webp"]]);
        assert.deepEqual(await Promise.all(files.map(async file => [...new Uint8Array(await file.arrayBuffer())])), [[4, 5, 6], [7, 8]]);
        bridge.oneYesDesktop = { clipboard: { read: async () => { throw denied; } } };
        await assert.rejects(readSystemClipboard, error => error === denied);
    } finally {
        for (const [index, key] of ["window", "navigator"].entries()) {
            const descriptor = originals[index];
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    }
});
