import { test } from "node:test";
import assert from "node:assert/strict";
import localforage from "localforage";

const values = new Map<string, string>();
globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); }, clear: () => values.clear(), key: index => [...values.keys()][index] ?? null, get length() { return values.size; } };
globalThis.window = { localStorage, setTimeout, clearTimeout } as unknown as Window & typeof globalThis;
const stores = new Map<string, Map<string, unknown>>();
let beforeWrite = async (_store: string, _key: string, _value: unknown) => {};
let beforeRemove = async (_store: string, _key: string) => {};
localforage.createInstance = (options => {
    const name = options.storeName!;
    const data = stores.get(name) || new Map<string, unknown>();
    stores.set(name, data);
    return { getItem: async (key: string) => data.get(key) ?? null, setItem: async (key: string, value: unknown) => { await beforeWrite(name, key, value); data.set(key, value); return value; }, removeItem: async (key: string) => { await beforeRemove(name, key); data.delete(key); } } as unknown as LocalForage;
}) as typeof localforage.createInstance;
const { importPackageFiles } = await import("./import-package-files");
const item = (storageKey: string) => ({ storageKey, path: `files/${storageKey.replace(":", "_")}`, mimeType: storageKey.startsWith("image:") ? "image/png" : "video/mp4", bytes: 3 });

test("imports preserve image/media bytes and write shared keys only once", async () => {
    let originals = 0;
    beforeWrite = async store => { if (["image_files", "media_files"].includes(store)) originals++; };
    const image = item("image:shared"), video = item("video:shared");
    await importPackageFiles([image, video, image], new Map([[image.path, new Blob(["abc"])], [video.path, new Blob(["xyz"])]]));
    const storedImage = stores.get("image_files")!.get(image.storageKey) as Blob;
    assert.equal(await storedImage.text(), "abc");
    assert.equal(storedImage.type, "image/png");
    assert.equal(await (stores.get("media_files")!.get(video.storageKey) as Blob).text(), "xyz");
    assert.equal(originals, 2);
    beforeWrite = async () => {};
});

test("rollback waits for late writes, restores old data and removes every new partial file", async () => {
    const data = stores.get("media_files")!;
    const old = new Blob(["original"], { type: "video/mp4" });
    data.set("video:existing", old);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const removals: string[] = [];
    beforeWrite = async (_store, key, value) => {
        if (key === "video:late") await gate;
        if (key === "video:failed" && await (value as Blob).text() === "new") throw new Error("disk full");
    };
    beforeRemove = async (_store, key) => { removals.push(key); };
    const files = ["video:existing", "video:late", "video:failed"].map(item);
    const pending = assert.rejects(importPackageFiles(files, new Map(files.map(file => [file.path, new Blob(["new"])]))), /disk full/);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(removals.length, 0, "rollback must not race pending writes");
    assert.equal(await (data.get("video:existing") as Blob).text(), "new");
    release();
    await pending;
    assert.equal(data.get("video:existing"), old);
    assert.equal(data.has("video:late"), false);
    assert.equal(data.has("video:failed"), false);
    assert.deepEqual(removals.sort(), ["video:failed", "video:late"]);
    beforeWrite = async () => {};
    beforeRemove = async () => {};
});
