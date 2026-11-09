import { after, test } from "node:test";
import assert from "node:assert/strict";
const values = new Map<string, string>();
globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); }, clear: () => values.clear(), key: i => [...values.keys()][i] ?? null, get length() { return values.size; } };
globalThis.window = { localStorage } as unknown as Window & typeof globalThis;
const { queryClient } = await import("@/lib/query-client");
const { fetchModelCatalog } = await import("./model-catalog");
const { configureModelDefaults, defaultConfig, normalizeOneYesConfig, selectableModelsByCapability, syncChannelModels, useConfigStore } = await import("@/stores/use-config-store");
const { useModelCatalogStore } = await import("@/stores/use-model-catalog-store");
const { useOneYesAccountStore } = await import("@/stores/use-oneyes-account-store");
type ModelChannel = typeof defaultConfig.channels[number];
const channel = (apiKey = "fixture-secret-a"): ModelChannel => ({ ...defaultConfig.channels[0], apiKey, models: [] });
function bridge(list: (key: string) => Promise<{ data?: string[]; error?: string }>) {
    window.oneYesDesktop = { models: { list } } as NonNullable<Window["oneYesDesktop"]>;
    queryClient.clear();
    useConfigStore.getState().replaceConfig({ ...defaultConfig, channels: [channel()] });
    useModelCatalogStore.setState({ syncing: false, errors: {}, checked: [], updatedAt: 0 });
    useOneYesAccountStore.setState({ ready: true, busy: false, user: null });
}
after(() => queryClient.clear());

test("discovery adds and classifies upstream models while keeping exclusions, custom scripts and capabilities", () => {
    const saved: ModelChannel = { ...channel(), excludedModels: ["hidden-text"], models: [
        { name: "old-image", capability: "image" }, { name: "custom-name", capability: "video" },
        { name: "manual-only", capability: "audio", manual: true }, { name: "script-only", capability: "image", script: "return result" },
    ] };
    const synced = syncChannelModels(saved, ["custom-name", "hidden-text", "new-image", "seedance-2.5", "new-tts", "deepseek-chat"]);
    assert.equal(synced.models.find(model => model.name === "custom-name")?.capability, "video");
    assert.equal(synced.models.find(model => model.name === "old-image")?.unavailable, true);
    assert.ok(!synced.models.some(model => model.name === "hidden-text"));
    assert.ok(!synced.models.find(model => model.name === "manual-only")?.unavailable);
    assert.equal(synced.models.find(model => model.name === "script-only")?.script, "return result");
    const config = configureModelDefaults(normalizeOneYesConfig({ ...defaultConfig, channels: [synced] }));
    assert.ok(config.imageModel.endsWith("script-only"));
    assert.equal(config.videoModel, "default::custom-name");
    assert.equal(config.textModel, "default::deepseek-chat");
    assert.equal(config.audioModel, "default::manual-only");
    assert.ok(!config.models.includes("default::old-image"));
    assert.equal(useConfigStore.getState().isAiConfigReady(config, "default::old-image"), false);
    assert.equal(selectableModelsByCapability(config, "video").length, 2);
    const restored = normalizeOneYesConfig(JSON.parse(JSON.stringify(config)));
    assert.deepEqual(restored, config);
    const returned = syncChannelModels(restored.channels[0], ["old-image", "custom-name"]);
    assert.equal(returned.models.find(model => model.name === "old-image")?.unavailable, undefined);
    assert.equal(config.videoSeconds, defaultConfig.videoSeconds);
    assert.equal(config.vquality, defaultConfig.vquality);
});

test("cached and simultaneous reads share one native request, explicit refresh is fresh and credentials stay out of cache keys", async () => {
    let calls = 0;
    bridge(async () => { calls++; return { data: ["gpt-image-2", "gpt-5.5", "gpt-4o-mini-tts"] }; });
    const snapshot = useConfigStore.getState().config.channels[0];
    await Promise.all([fetchModelCatalog(snapshot), fetchModelCatalog(snapshot)]);
    await fetchModelCatalog(snapshot);
    assert.equal(calls, 1);
    await fetchModelCatalog(snapshot, true);
    assert.equal(calls, 2);
    await fetchModelCatalog({ ...snapshot, apiKey: "fixture-secret-b" });
    assert.equal(calls, 3);
    useConfigStore.getState().updateConfig("upstreamProxyUrl", "socks5://fixture.test:1080");
    await fetchModelCatalog(snapshot);
    assert.equal(calls, 4);
    assert.doesNotMatch(JSON.stringify(queryClient.getQueryCache().getAll().map(item => [item.queryKey, item.state.data])), /fixture-secret|socks5|1080/);
});

test("automatic setup keeps valid defaults, fills all media defaults and never needs account mutations", async () => {
    bridge(async () => ({ data: ["gpt-image-2", "gpt-5.5", "gpt-4o-mini-tts", "grok-imagine-video"] }));
    await useModelCatalogStore.getState().sync();
    const config = useConfigStore.getState().config;
    for (const key of ["imageModel", "videoModel", "textModel", "audioModel"] as const) assert.equal(config[key], defaultConfig[key]);
    assert.equal(useModelCatalogStore.getState().syncing, false);
    assert.ok(useModelCatalogStore.getState().updatedAt);
    await useConfigStore.persist.rehydrate();
    assert.deepEqual(useConfigStore.getState().config, config);
});

test("partial failure and empty or invalid catalogs retain existing configuration without automatic retries", async () => {
    let calls = 0;
    bridge(async key => { calls++; return key === "deepseek-fixture" ? { data: ["deepseek-new"] } : { error: "读取 OneYes 模型失败（HTTP 401），请检查 Key" }; });
    const saved = { ...channel(), models: [{ name: "saved-image", capability: "image" as const, script: "return image" }] };
    useConfigStore.getState().replaceConfig({ ...defaultConfig, channels: [saved, { ...channel("deepseek-fixture"), id: "oneyes-deepseek" }] });
    await useModelCatalogStore.getState().sync(true);
    assert.equal(calls, 2);
    assert.deepEqual(useConfigStore.getState().config.channels[0].models, normalizeOneYesConfig({ channels: [saved] }).channels[0].models);
    assert.ok(useConfigStore.getState().config.models.includes("oneyes-deepseek::deepseek-new"));
    assert.ok(useModelCatalogStore.getState().errors.default.includes("401"));
    for (const data of [[], [""], [null], { private: true }]) {
        window.oneYesDesktop!.models.list = async () => ({ data }) as never;
        const before = useConfigStore.getState().config;
        await useModelCatalogStore.getState().sync(true);
        assert.deepEqual(useConfigStore.getState().config, before);
    }
});

test("obsolete key responses cannot change the new key; edits made during discovery remain authoritative", async () => {
    let release!: (value: { data: string[] }) => void;
    bridge(async () => new Promise(resolve => { release = resolve; }));
    const old = useModelCatalogStore.getState().sync(true);
    useConfigStore.getState().replaceConfig({ ...defaultConfig, channels: [channel("fixture-new-key")] });
    release({ data: ["obsolete-image"] }); await old;
    assert.ok(!useConfigStore.getState().config.models.includes("default::obsolete-image"));
    const pending = useModelCatalogStore.getState().sync(true);
    const config = useConfigStore.getState().config;
    useConfigStore.getState().replaceConfig({ ...config, channels: [{ ...config.channels[0], excludedModels: ["hidden-image"], models: [{ name: "new-text", capability: "video", script: "custom-call" }] }] });
    release({ data: ["hidden-image", "new-text"] }); await pending;
    assert.ok(!useConfigStore.getState().config.models.includes("default::hidden-image"));
    assert.equal(useConfigStore.getState().config.channels[0].models[0].capability, "video");
    assert.equal(useConfigStore.getState().config.channels[0].models[0].script, "custom-call");
});

test("managed keys wait for the owning account and each platform keeps only appropriate newly discovered models", async () => {
    let calls = 0;
    bridge(async () => { calls++; return { data: ["gpt-image-2", "deepseek-chat", "grok-imagine-video", "jev-latest", "gpt-4o-mini-tts"] }; });
    const managed = { ...channel(), oneYes: { platform: "openai" as const, accountId: 7, keyId: 1, groupId: 2, groupName: "SVIP" } };
    useConfigStore.getState().replaceConfig({ ...defaultConfig, channels: [managed] });
    await useModelCatalogStore.getState().sync(); assert.equal(calls, 0);
    useOneYesAccountStore.setState({ user: { id: 7, email: "fixture@example.test" } });
    await useModelCatalogStore.getState().sync(); assert.equal(calls, 1);
    const names = ["gpt-image-2", "deepseek-chat", "grok-imagine-video", "jev-latest", "gpt-4o-mini-tts"];
    for (const [id, capability] of [["oneyes-deepseek", "text"], ["oneyes-minimax", "video"], ["oneyes-typesafe", "decision"]]) {
        const result = syncChannelModels({ ...channel(), id }, names);
        assert.ok(result.models.length && result.models.every(model => model.capability === capability));
    }
});
