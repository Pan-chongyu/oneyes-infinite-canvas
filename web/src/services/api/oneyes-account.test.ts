import { test } from "node:test";
import assert from "node:assert/strict";
const values = new Map<string, string>();
globalThis.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); }, removeItem: k => { values.delete(k); }, clear: () => values.clear(), key: i => [...values.keys()][i] ?? null, get length() { return values.size; } };
globalThis.window = { localStorage } as unknown as Window & typeof globalThis;
const { configureOneYes, configureManual, diagnoseOneYes, selectGroup } = await import("./oneyes-account");
const { defaultConfig, normalizeOneYesConfig, resolveModelRequestConfig, upsertChannelCredentials } = await import("@/stores/use-config-store");
const user = { id: 7, email: "test@example.test" };
const groups = [{ id: 1, name: "VIP", platform: "openai" }, { id: 2, name: "SVIP", platform: "openai" }, { id: 3, name: "DeepSeek", platform: "deepseek" }, { id: 4, name: "Video", platform: "minimax" }, { id: 5, name: "SVIP", platform: "anthropic" }];
type TestKey = { id: number; group_id: number; name: string; key: string; status: string };
function fixture(initial: TestKey[] = []) {
    const keys = [...initial], writes: number[] = [];
    let nextId = 10;
    const call = async <T>(operation: string, args?: Record<string, unknown>): Promise<T> => {
        assert.equal(args?.account_id, 7);
        let result: unknown;
        if (operation === "groups") result = groups;
        else if (operation === "keys") result = { items: keys, total: keys.length };
        else if (operation === "key") result = keys.find(key => key.id === args?.id);
        else if (operation === "create_key") { const group_id = args?.group_id as number; writes.push(group_id); const key = { id: nextId++, name: "Canvas_无限画布", group_id, key: `test-${group_id}`, status: "active" }; keys.push(key); result = key; }
        else throw new Error("unexpected account mutation");
        return result as T;
    };
    return { call, keys, writes };
}
const models = async (channel: { apiKey: string }) => channel.apiKey === "test-2" ? ["gpt-image-2", "gpt-5.5", "gpt-4o-mini-tts"] : channel.apiKey === "test-3" ? ["deepseek-chat", "deepseek-reasoner"] : ["MiniMax-Hailuo-2.3", "unrelated-text"];
test("platform group matching is exact, prefers SVIP, and never borrows another platform", () => {
    assert.equal(selectGroup(groups, "openai").id, 2);
    assert.equal(selectGroup(groups.filter(g => g.id !== 2), "openai").id, 1);
    assert.throws(() => selectGroup(groups.filter(g => g.platform !== "openai"), "openai"));
    assert.throws(() => selectGroup([...groups, { ...groups[1], id: 6 }], "openai"));
});
test("setup reuses same-name keys per group across retries and routes models to their own keys", async () => {
    const f = fixture();
    const first = await configureOneYes(defaultConfig, user, f.call, models);
    assert.equal(first.configured, 3); assert.equal(first.issues.length, 0); assert.deepEqual(f.writes, [2, 3, 4]);
    const again = await configureOneYes(first.config, user, f.call, models);
    assert.equal(again.configured, 3); assert.equal(f.writes.length, 3);
    const config = normalizeOneYesConfig(again.config);
    assert.equal(config.channels.length, 3);
    assert.equal(resolveModelRequestConfig(config, config.imageModel).apiKey, "test-2");
    assert.equal(resolveModelRequestConfig(config, "oneyes-deepseek::deepseek-chat").apiKey, "test-3");
    assert.equal(resolveModelRequestConfig(config, config.videoModel).apiKey, "test-4");
    assert.ok(config.channels[0].models.every(model => model.capability === "image" || model.capability === "text"));
    assert.ok(config.channels[1].models.every(model => model.capability === "text"));
    assert.ok(config.channels[2].models.every(model => model.capability === "video"));
    assert.throws(() => resolveModelRequestConfig(config, "missing-group::deepseek-chat"), /分组配置不存在/);
    assert.equal(upsertChannelCredentials(config, { baseUrl: "https://api.oneyes.ai", apiKey: "manual-test" }).config.channels.length, 3);
});
test("diagnostics identify deletion; explicit repair creates only the missing key, not disabled keys", async () => {
    const f = fixture();
    const { config } = await configureOneYes(defaultConfig, user, f.call, models);
    f.keys.splice(f.keys.findIndex(key => key.group_id === 3), 1);
    const report = await diagnoseOneYes(config, user, f.call, models);
    assert.equal(report.find(item => item.id === "oneyes-deepseek")?.code, "deleted");
    assert.equal(f.writes.length, 3);
    const repaired = await configureOneYes(config, user, f.call, models);
    assert.equal(repaired.configured, 3); assert.deepEqual(f.writes, [2, 3, 4, 3]);
    f.keys.find(key => key.group_id === 2)!.status = "quota_exhausted";
    const blocked = await configureOneYes(repaired.config, user, f.call, models);
    assert.equal(blocked.configured, 2); assert.equal(blocked.issues[0].code, "setupFailed"); assert.equal(f.writes.length, 4);
    const accountReport = await diagnoseOneYes(config, { ...user, id: 8 }, async () => ({ items: [], total: 0 }) as never, models);
    assert.ok(accountReport.every(item => item.code === "account"));
});
test("failed key-list reads never create keys; manual configuration requires no account", async () => {
    let creates = 0;
    await assert.rejects(configureOneYes(defaultConfig, user, async <T>(operation: string) => {
        if (operation === "groups") return groups as T;
        if (operation === "create_key") creates++;
        throw new Error("network unavailable");
    }, models));
    assert.equal(creates, 0);
    const manual = await configureManual(defaultConfig, { openai: "test-2", deepseek: "test-3", minimax: "test-4" }, models);
    assert.equal(manual.channels.length, 3); assert.ok(manual.channels.every(channel => !channel.oneYes));
    assert.equal(resolveModelRequestConfig(manual, manual.videoModel).apiKey, "test-4");
});
test("an existing eligible OpenAI VIP key is reused before creating an SVIP key", async () => {
    const f = fixture([{ id: 9, group_id: 1, name: "Canvas_无限画布", key: "test-2", status: "active" }]);
    const result = await configureOneYes(defaultConfig, user, f.call, models);
    assert.equal(result.config.channels[0].oneYes?.groupId, 1);
    assert.deepEqual(f.writes, [3, 4]);
});
test("desktop Axios transport forwards the custom scheme through Fetch", async () => {
    const { initializeDesktopTransport } = await import("./desktop-transport");
    const axios = (await import("axios")).default, oldFetch = globalThis.fetch, oldAdapter = axios.defaults.adapter;
    const originalDesktop = window.oneYesDesktop;
    try {
        window.oneYesDesktop = {} as NonNullable<Window["oneYesDesktop"]>;
        initializeDesktopTransport();
        globalThis.fetch = async input => { assert.equal((input as Request).url, "oneyes-canvas://app/oneyes-api/v1/models"); return Response.json({ data: [{ id: "gpt-image-test" }] }); };
        const response = await axios.get("oneyes-canvas://app/oneyes-api/v1/models");
        assert.equal(response.data.data[0].id, "gpt-image-test");
    } finally { globalThis.fetch = oldFetch; axios.defaults.adapter = oldAdapter; window.oneYesDesktop = originalDesktop; }
});
