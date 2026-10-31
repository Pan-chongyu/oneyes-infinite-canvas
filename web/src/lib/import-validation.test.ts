import { test } from "node:test";
import assert from "node:assert/strict";
import { Zip, ZipPassThrough, zipSync } from "fflate";
import { createZip, readZip } from "./zip";
import { validateAssetExport, validateCanvasExport } from "./import-validation";

const now = "2026-10-01T00:00:00.000Z";
const media = (path = "projects/first/files/image_shared.png") => ({ storageKey: "image:shared", path, mimeType: "image/png", bytes: 3 });
const project = (id: string, files = [media()]) => ({ project: { id, title: id, createdAt: now, updatedAt: now, nodes: [], connections: [], chatSessions: [] }, files });
const canvas = (projects = [project("first")]) => ({ app: "infinite-canvas", version: 3, exportedAt: now, projects });
const archive = (paths = [media().path]) => new Map([["projects.json", new Blob(["manifest"])], ...paths.map(path => [path, new Blob(["abc"])] as [string, Blob])]);

test("ZIP validates raw archive paths, permits inert directory entries and preserves original bytes", async () => {
    const file = await createZip([{ name: "files/原图.png", data: new Uint8Array([0, 1, 255]) }]);
    assert.deepEqual(new Uint8Array(await (await readZip(file)).get("files/原图.png")!.arrayBuffer()), new Uint8Array([0, 1, 255]));
    const directories = zipSync({ "files/": new Uint8Array(), "files/original.png": new Uint8Array([1]) });
    assert.deepEqual([...(await readZip(new Blob([directories]))).keys()], ["files/original.png"]);
    for (const name of ["../secret", "/absolute", "C:/secret", "files\\escape", "files/../secret", "files/%2e%2e/secret", "files/%2fsecret", "a\u0000b", "a\u007fb"]) {
        await assert.rejects(readZip(new Blob([zipSync({ [name]: new Uint8Array([1]) })])), /路径无效/);
    }
});

test("duplicate raw ZIP entries are rejected before fflate can overwrite the first entry", async () => {
    const parts: Uint8Array<ArrayBuffer>[] = [];
    const zip = new Zip((error, bytes) => { if (error) throw error; parts.push(bytes as Uint8Array<ArrayBuffer>); });
    for (const text of ["first", "second"]) {
        const entry = new ZipPassThrough("projects.json");
        zip.add(entry);
        entry.push(new TextEncoder().encode(text), true);
    }
    zip.end();
    await assert.rejects(readZip(new Blob(parts)), /重复文件/);
});

test("multi-canvas packages accept identical shared originals and reject same-key content conflicts", async () => {
    const first = media(), second = media("projects/second/files/image_shared.png");
    const data = canvas([project("first", [first]), project("second", [second])]);
    const files = archive([first.path, second.path]);
    assert.equal((await validateCanvasExport(data, files)).projects.length, 2);
    files.set(second.path, new Blob(["xyz"]));
    await assert.rejects(validateCanvasExport(data, files), /共用媒体内容冲突/);
    files.set(second.path, new Blob(["abc"]));
    await assert.rejects(validateCanvasExport(canvas([project("first", [first]), project("second", [{ ...second, mimeType: "image/webp" }])]), files), /共用媒体内容冲突/);
});

test("malformed, missing, undeclared and repeated manifest files are rejected", async () => {
    const valid = canvas(), files = archive();
    await validateCanvasExport(valid, files);
    for (const data of [{ ...valid, version: 99 }, { ...valid, exportedAt: "invalid" }, { ...valid, projects: [null] }, canvas([project("first"), project("first")]), canvas([project("first", [media(), media()])]), canvas([project("first", [{ ...media(), bytes: 4 }])]), canvas([project("first", [{ ...media(), storageKey: "../bad" }])])]) {
        await assert.rejects(validateCanvasExport(data, files));
    }
    await assert.rejects(validateCanvasExport(valid, new Map([["projects.json", new Blob()]])), /缺失/);
    await assert.rejects(validateCanvasExport(valid, new Map([...files, ["extra.js", new Blob()]])), /未声明/);
    const asset = { app: "infinite-canvas", version: 1, exportedAt: now, assets: [{ id: "asset", kind: "image", title: "原图", tags: [], data: { storageKey: "image:shared" } }], files: [media("files/shared.png")] };
    const assetZip = new Map([["assets.json", new Blob()], ["files/shared.png", new Blob(["abc"])]]);
    assert.equal(validateAssetExport(asset, assetZip).assets.length, 1);
    for (const data of [{ ...asset, assets: [null] }, { ...asset, assets: [...asset.assets, ...asset.assets] }, { ...asset, files: [...asset.files, ...asset.files] }]) assert.throws(() => validateAssetExport(data, assetZip));
});

test("node geometry, connection endpoints and chat records are validated without forbidding an empty node title", async () => {
    const node = { id: "node", type: "text", title: "", position: { x: 0, y: -5 }, width: 100, height: 120 };
    const base = project("first");
    const data = { ...base, project: { ...base.project, nodes: [node] } };
    await validateCanvasExport({ ...canvas(), projects: [data] }, archive());
    for (const patch of [{ nodes: [{ ...node, position: {} }] }, { nodes: [{ ...node, width: null }] }, { nodes: [node, node] }, { connections: [null] }, { connections: [{ id: "line", fromNodeId: "node", toNodeId: "missing" }] }, { chatSessions: [null] }]) {
        await assert.rejects(validateCanvasExport({ ...canvas(), projects: [{ ...data, project: { ...data.project, ...patch } }] }, archive()));
    }
});
