import { test } from "node:test";
import assert from "node:assert/strict";
import { ImageTaskManager, ImageTaskHttpError, imageCredentialFingerprint, imageTaskRequest, taskImageSources, type ImageTask, type ImageTaskDependencies } from "./image-tasks";
import { applyCanvasImageTask, failMissingCanvasImageTasks, markCanvasImageTask } from "../../lib/canvas/canvas-image-task";
import { CanvasNodeType, type CanvasNodeData } from "../../types/canvas";

const image = { id: "local-0", storageKey: "image:blob", width: 1024, height: 768, bytes: 1234, mimeType: "image/png" };
const seed = { id: "local", credential: "key-fingerprint", model: "default::gpt-image-2", prompt: "离线恢复测试", config: { model: "default::gpt-image-2", imageModel: "default::gpt-image-2", quality: "high", size: "4:3", count: "1" }, logId: "log-local", createdAt: Date.now() };
const processing = (): ImageTask => ({ ...structuredClone(seed), remoteId: "imgtask_remote", status: "processing", pollMs: 3000, images: [], expiresAt: Date.now() + 100000 });
const complete = { value: { id: "imgtask_remote", status: "completed", result: { data: [{ url: "https://images.example/1.png" }] } } };
function fixture(saved = new Map<string, ImageTask>(), overrides: Partial<ImageTaskDependencies> = {}) {
    const calls = { submits: 0, polls: 0, saves: [] as string[], logs: [] as string[] };
    const deps: ImageTaskDependencies = {
        automatic: false,
        storage: { list: async () => [...saved.values()].map(value => structuredClone(value)), put: async task => { saved.set(task.id, structuredClone(task)); }, remove: async id => { saved.delete(id); } },
        credentials: async () => "sk-test-private",
        submit: async () => { calls.submits++; assert.equal(saved.get("local")?.status, "submitting"); return { value: { task_id: "imgtask_remote", status: "processing" }, pollMs: 3000 }; },
        poll: async id => { calls.polls++; assert.equal(id, "imgtask_remote"); return complete; },
        saveImage: async source => { calls.saves.push(source); return image; },
        completed: async task => { calls.logs.push(task.id); }, changed: () => {}, ...overrides,
    };
    return { manager: new ImageTaskManager(deps), calls, saved, deps };
}
async function until(check: () => boolean) {
    for (let n = 0; n < 100; n++) { if (check()) return; await new Promise(resolve => setImmediate(resolve)); }
    assert.fail("Task did not reach expected state");
}

test("receipt is persisted before polling, network recovery only queries the original paid task", async () => {
    let polls = 0;
    const f = fixture(new Map(), { poll: async () => { if (!polls++) throw new TypeError("offline"); return complete; } });
    const pending = f.manager.submit(seed, "/images/generations/async", { prompt: seed.prompt }, "sk-test-private");
    await until(() => f.manager.tasks.get("local")?.status === "processing");
    assert.equal(f.saved.get("local")?.remoteId, "imgtask_remote");
    await f.manager.refresh("local");
    assert.equal(f.saved.get("local")?.status, "waiting");
    await f.manager.resumeAll();
    assert.deepEqual(await pending, [image]);
    assert.equal(f.calls.submits, 1);
    assert.equal(polls, 2);
    assert.ok(!JSON.stringify([...f.saved.values()]).includes("sk-test-private"));
});

test("restart recovers all pending slots and interrupted local downloads without any POST", async () => {
    const saved = new Map([["local", processing()]]);
    let download = 0;
    const first = fixture(saved, { saveImage: async () => { download++; throw new TypeError("download disconnected"); } });
    await first.manager.initialize(); await first.manager.refresh("local"); first.manager.close();
    assert.equal(saved.get("local")?.status, "waiting");
    const restored = fixture(saved);
    await restored.manager.initialize(); await restored.manager.resumeAll();
    assert.equal(restored.manager.tasks.get("local")?.status, "completed");
    assert.equal(restored.calls.submits, 0); assert.equal(download, 1); assert.equal(restored.calls.saves.length, 1);
    await restored.manager.resumeAll(); assert.equal(restored.calls.saves.length, 1);
});

test("a transient task-cache startup failure can retry recovery without resubmitting", async () => {
    const saved = new Map([["local", processing()]]);
    const f = fixture(saved);
    const list = f.deps.storage.list;
    let fail = true;
    f.deps.storage.list = async () => { if (fail) { fail = false; throw new Error("temporary IndexedDB error"); } return list(); };
    await assert.rejects(f.manager.initialize(), /temporary IndexedDB error/);
    await f.manager.resumeAll();
    assert.equal(f.manager.tasks.get("local")?.status, "completed");
    assert.equal(f.calls.submits, 0);
    assert.equal(f.calls.polls, 1);
});

test("a lost submission response, invalid receipt and crash before receipt never trigger a second generation", async () => {
    for (const submit of [async () => { throw new TypeError("receipt lost"); }, async () => ({ value: { status: "processing" } })]) {
        const f = fixture(new Map(), { submit });
        await assert.rejects(f.manager.submit(seed, "/images/generations/async", {}, "private"), /不会自动重发/);
        assert.equal(f.saved.get("local")?.status, "uncertain");
        const restart = fixture(f.saved); await restart.manager.initialize(); await restart.manager.resumeAll();
        await restart.manager.resume("local"); assert.equal(restart.calls.submits + restart.calls.polls, 0);
    }
    const task = { ...processing(), remoteId: undefined, status: "submitting" as const };
    const f = fixture(new Map([["local", task]])); await f.manager.initialize(); await f.manager.resumeAll();
    assert.equal(f.saved.get("local")?.status, "uncertain"); assert.equal(f.calls.submits, 0);
});

test("no paid request is sent if local persistence or canvas association fails", async () => {
    const f = fixture(); f.deps.storage.put = async () => { throw new Error("disk full"); };
    await assert.rejects(f.manager.submit(seed, "/images/edits/async", new FormData(), "private"), /disk full/);
    assert.equal(f.calls.submits, 0);
    const g = fixture();
    await assert.rejects(g.manager.submit(seed, "/images/edits/async", new FormData(), "private", { onTask: async () => { throw new Error("canvas not saved"); } }), /canvas not saved/);
    assert.equal(g.calls.submits, 0); assert.equal(g.saved.size, 0);
});

test("account/Key changes block polling and an invalid/expired/failed task is not regenerated", async () => {
    const f = fixture(new Map([["local", processing()]]), { credentials: async () => undefined });
    await f.manager.initialize(); await f.manager.refresh("local");
    assert.equal(f.saved.get("local")?.status, "credentials"); assert.equal(f.calls.polls, 0);
    f.deps.credentials = async () => "original-key"; await f.manager.resume("local");
    assert.equal(f.saved.get("local")?.status, "completed");
    for (const status of [401, 403, 404, 410, 503]) {
        const g = fixture(new Map([["local", processing()]]), { poll: async () => { throw new ImageTaskHttpError(status, "server failure"); } });
        await g.manager.initialize(); await g.manager.refresh("local");
        assert.equal(g.saved.get("local")?.status, [401, 403].includes(status) ? "credentials" : [404, 410].includes(status) ? "failed" : "waiting"); assert.equal(g.calls.submits, 0);
    }
    const failed = fixture(new Map([["local", processing()]]), { poll: async () => ({ value: { status: "failed", error: { message: "余额不足" } } }) });
    await failed.manager.initialize(); await failed.manager.refresh("local");
    assert.equal(failed.saved.get("local")?.error, "余额不足"); assert.equal(failed.calls.saves.length, 0);
});

test("partially saved multi-image results resume at the next image and survive a history write failure", async () => {
    const task = { ...processing(), status: "waiting" as const, expectedImages: 2, images: [image] };
    let logFailure = true;
    const f = fixture(new Map([["local", task]]), { poll: async () => ({ value: { ...complete.value, result: { data: [{ url: "https://images.example/1.png" }, { b64_json: "second" }] } } }), completed: async () => { if (logFailure) { logFailure = false; throw Error("history unavailable"); } } });
    await f.manager.initialize(); await f.manager.refresh("local");
    assert.deepEqual(f.calls.saves, ["data:image/png;base64,second"]);
    assert.equal(f.saved.get("local")?.status, "waiting");
    f.deps.credentials = async () => undefined;
    await f.manager.resume("local");
    assert.equal(f.saved.get("local")?.status, "completed"); assert.equal(f.calls.saves.length, 1);
});

test("overlapping refreshes are coalesced and pause/removal win over an in-flight response", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const f = fixture(new Map([["local", processing()]]), { poll: async () => { await gate; return complete; } });
    await f.manager.initialize();
    const first = f.manager.refresh("local"); await f.manager.refresh("local");
    await f.manager.pause("local"); release(); await first;
    assert.equal(f.saved.get("local")?.status, "paused");
    await f.manager.resume("local"); assert.equal(f.saved.get("local")?.status, "completed");
    let releaseRemoved!: () => void;
    const removedGate = new Promise<void>(resolve => { releaseRemoved = resolve; });
    const g = fixture(new Map([["local", processing()]]), { poll: async () => { await removedGate; return complete; } });
    await g.manager.initialize(); const running = g.manager.refresh("local");
    await g.manager.remove("local"); releaseRemoved(); await running;
    assert.equal(g.saved.size, 0); assert.equal(g.manager.tasks.size, 0);
});

test("offline recovery keeps the task and server expiry is terminal", async () => {
    const f = fixture(new Map([["local", processing()]]), { online: () => false });
    await f.manager.initialize(); await f.manager.refresh("local"); assert.equal(f.calls.polls, 0);
    assert.equal(f.saved.get("local")?.status, "waiting");
    f.deps.online = () => true; await f.manager.resumeAll(); assert.equal(f.saved.get("local")?.status, "completed");
    const g = fixture(new Map([["local", { ...processing(), expiresAt: Date.now() - 1 }]]));
    await g.manager.initialize(); await g.manager.refresh("local");
    assert.equal(g.saved.get("local")?.status, "failed"); assert.equal(g.calls.polls + g.calls.submits, 0);
});

test("JSON and multipart use the real async protocol and obey server Retry-After without enabling SSE", async () => {
    const original = globalThis.fetch;
    const seen: RequestInit[] = [];
    try {
        globalThis.fetch = async (_url, options) => { seen.push(options!); return Response.json({ task_id: "remote", status: "processing" }, { status: 202, headers: { "Retry-After": "3" } }); };
        assert.equal((await imageTaskRequest("https://oneyes.ai/v1/images/generations/async", "private", { model: "gpt-image-2", prompt: "test", n: 1 })).pollMs, 3000);
        const body = new FormData(); body.set("image", new Blob(["ref"]), "ref.png");
        await imageTaskRequest("https://oneyes.ai/v1/images/edits/async", "private", body);
        assert.equal(JSON.parse(String(seen[0].body)).stream, undefined);
        assert.equal(new Headers(seen[1].headers).has("content-type"), false); assert.ok(seen[1].body instanceof FormData);
        assert.equal(seen[1].redirect, "error"); assert.equal(seen[1].cache, "no-store");
        globalThis.fetch = async () => Response.json({ error: { message: "异步接口未开启" } }, { status: 404 });
        await assert.rejects(imageTaskRequest("https://oneyes.ai/v1/images/generations/async", "private", {}), /异步接口未开启/);
    } finally { globalThis.fetch = original; }
    assert.notEqual(await imageCredentialFingerprint("key-A"), await imageCredentialFingerprint("key-B"));
    assert.deepEqual(taskImageSources({ status: "completed", image_url: "https://images.example/fallback.png" }), ["https://images.example/fallback.png"]);
    for (const url of ["file:///secret", "http://insecure/image", "javascript:alert(1)"]) assert.throws(() => taskImageSources({ image_url: url }));
});

test("canvas recovery updates only the original node/slot and preserves successful siblings and newer tasks", () => {
    const target = { projectId: "project", nodeId: "node", imageId: "slot-2" };
    const node: CanvasNodeData = { id: "node", type: CanvasNodeType.Image, title: "test", position: { x: 1, y: 2 }, width: 640, height: 480, metadata: { status: "loading", content: "old", primaryImageId: "slot-1", images: [ { id: "slot-1", status: "success", content: "old", naturalWidth: 1, naturalHeight: 1, bytes: 1, mimeType: "image/png" }, { id: "slot-2", status: "loading", content: "", naturalWidth: 0, naturalHeight: 0, bytes: 0, mimeType: "" } ] } };
    const marked = markCanvasImageTask([node], target, "local")[0];
    const task: ImageTask = { ...processing(), status: "completed", target, images: [image] };
    const applied = applyCanvasImageTask(marked, task, { ...image, url: "blob:restored" });
    assert.equal(applied.metadata?.images?.[1].content, "blob:restored"); assert.equal(applied.metadata?.images?.[0].content, "old");
    assert.equal(applied.metadata?.content, "old"); assert.equal(applied.metadata?.status, "success");
    assert.equal(applied.metadata?.images?.[1].imageTaskId, undefined);
    assert.equal(applyCanvasImageTask(applied, task, { ...image, url: "blob:restored" }), applied);
    const newer = markCanvasImageTask([marked], target, "newer")[0]; assert.equal(applyCanvasImageTask(newer, task, { ...image, url: "blob:restored" }), newer);
});

test("missing durable task receipts clear orphaned canvas spinners without resubmitting", () => {
    const node: CanvasNodeData = { id: "node", type: CanvasNodeType.Image, title: "test", position: { x: 0, y: 0 }, width: 320, height: 320, metadata: { status: "loading", imageTaskId: "missing-task", images: [{ id: "slot", status: "loading", imageTaskId: "missing-task", content: "", naturalWidth: 0, naturalHeight: 0, bytes: 0, mimeType: "" }] } };
    const recovered = failMissingCanvasImageTasks(node, new Map(), "project");
    assert.equal(recovered.metadata?.status, "error");
    assert.equal(recovered.metadata?.images?.[0].status, "error");
    assert.match(recovered.metadata?.errorDetails || "", /检查官网用量/);
    assert.equal(node.metadata?.status, "loading", "recovery does not mutate the stored snapshot");
});

test("multi-image recovery settles slots without receipts while preserving active sibling tasks", () => {
    const target = { projectId: "project", nodeId: "node", imageId: "slot-1" };
    const node: CanvasNodeData = { id: "node", type: CanvasNodeType.Image, title: "test", position: { x: 0, y: 0 }, width: 320, height: 320, metadata: { status: "loading", images: [ { id: "slot-1", status: "loading", imageTaskId: "active", content: "", naturalWidth: 0, naturalHeight: 0, bytes: 0, mimeType: "" }, { id: "slot-2", status: "loading", content: "", naturalWidth: 0, naturalHeight: 0, bytes: 0, mimeType: "" } ] } };
    const restored = failMissingCanvasImageTasks(node, new Map([["active", { ...processing(), id: "active", target }]]), "project");
    assert.equal(restored.metadata?.images?.[0].status, "loading");
    assert.equal(restored.metadata?.images?.[1].status, "error");
    assert.equal(restored.metadata?.status, "loading", "the active sibling still owns a spinner");
    const completed = applyCanvasImageTask(restored, { ...processing(), id: "active", target, status: "completed", images: [image] }, { ...image, url: "blob:restored" });
    assert.equal(completed.metadata?.images?.[0].status, "success");
    assert.equal(completed.metadata?.images?.[1].status, "error");
    assert.equal(completed.metadata?.status, "success", "an orphaned sibling cannot leave the node spinning");
});

test("recovery rejects receipts associated with another node or image slot", () => {
    const node: CanvasNodeData = { id: "node", type: CanvasNodeType.Image, title: "test", position: { x: 0, y: 0 }, width: 320, height: 320, metadata: { status: "loading", images: [{ id: "slot", status: "loading", imageTaskId: "wrong", content: "", naturalWidth: 0, naturalHeight: 0, bytes: 0, mimeType: "" }] } };
    const wrongTask = { ...processing(), target: { projectId: "project", nodeId: "other-node", imageId: "slot" } };
    assert.equal(failMissingCanvasImageTasks(node, new Map([["wrong", wrongTask]]), "project").metadata?.status, "error");
    const wrongSlotTask = { ...processing(), target: { projectId: "project", nodeId: "node", imageId: "other-slot" } };
    assert.equal(failMissingCanvasImageTasks(node, new Map([["wrong", wrongSlotTask]]), "project").metadata?.images?.[0].status, "error");
});
