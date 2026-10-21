import { test } from "node:test";
import assert from "node:assert/strict";

const values = new Map<string, string>();
globalThis.localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
        values.set(key, value);
    },
    removeItem: (key: string) => {
        values.delete(key);
    },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
        return values.size;
    },
};
globalThis.window = { localStorage } as unknown as Window & typeof globalThis;

const { CONFIG_STORE_KEY, defaultConfig, normalizeOneYesConfig, upsertChannelCredentials, useConfigStore } = await import("./use-config-store");
const { shouldOpenSetup, getVerifiedSetupIds } = await import("./oneyes-setup");

test("first launch offers setup only without configured models, respecting later and imported credentials", () => {
    const state = { setupStatus: "pending", isConfigOpen: false, config: defaultConfig };
    assert.equal(shouldOpenSetup(state), true);
    for (const setupStatus of ["skipped", "completed"]) assert.equal(shouldOpenSetup({ ...state, setupStatus }), false);
    assert.equal(shouldOpenSetup({ ...state, isConfigOpen: true }), false);
    const config = normalizeOneYesConfig({ ...defaultConfig, channels: [{ ...defaultConfig.channels[0], apiKey: "test-existing" }] });
    assert.equal(shouldOpenSetup({ ...state, config }), false);
    assert.equal(shouldOpenSetup({ ...state, config: { ...config, channels: [{ ...config.channels[0], models: [] }] } }), true);
    assert.equal(shouldOpenSetup({ ...state, config: { ...config, channels: [{ ...config.channels[0], apiKey: "  " }] } }), true);
});

test("setup completion requires verified usable services, with partial failures reported separately", () => {
    const config = normalizeOneYesConfig({ ...defaultConfig, channels: [
        { ...defaultConfig.channels[0], apiKey: "test-openai" },
        { ...defaultConfig.channels[0], id: "oneyes-deepseek", apiKey: "test-deepseek", models: [{ name: "deepseek-chat", capability: "text" }] },
    ] });
    const ok = { id: "default", name: "OneYes", status: "ok" as const, code: "ok" };
    assert.deepEqual(getVerifiedSetupIds(config, [], ""), []);
    assert.deepEqual(getVerifiedSetupIds(config, [ok], "network unavailable"), []);
    assert.deepEqual(getVerifiedSetupIds(defaultConfig, [ok], ""), []);
    assert.deepEqual(getVerifiedSetupIds(config, [{ ...ok, code: "inactive", status: "error" }], ""), []);
    assert.deepEqual(getVerifiedSetupIds(config, [ok, { id: "oneyes-deepseek", name: "DeepSeek", code: "setupFailed", status: "error" }], ""), ["default"]);
    assert.deepEqual(getVerifiedSetupIds(config, [ok, { ...ok, id: "oneyes-deepseek" }], ""), ["default", "oneyes-deepseek"]);
});

test("setup completion and explicit later persist without persisting an open dialog or changing model selections", async () => {
    useConfigStore.setState({ config: defaultConfig, setupStatus: "pending" });
    useConfigStore.getState().openSetup();
    useConfigStore.getState().closeSetup("completed");
    assert.equal(useConfigStore.getState().isSetupOpen, true);
    assert.equal(useConfigStore.getState().setupStatus, "pending");
    useConfigStore.getState().closeSetup();
    let saved = JSON.parse(localStorage.getItem(CONFIG_STORE_KEY)!);
    assert.equal(saved.state.setupStatus, "skipped");
    assert.equal(saved.state.isSetupOpen, undefined);
    useConfigStore.setState({ setupStatus: "pending" }, false);
    localStorage.setItem(CONFIG_STORE_KEY, JSON.stringify(saved));
    await useConfigStore.persist.rehydrate();
    assert.equal(shouldOpenSetup(useConfigStore.getState()), false);
    const config = normalizeOneYesConfig({ ...defaultConfig, channels: [{ ...defaultConfig.channels[0], apiKey: "test-saved", models: [{ name: "gpt-image-test", capability: "image" }] }], imageModel: "default::gpt-image-test" });
    useConfigStore.getState().replaceConfig(config);
    useConfigStore.getState().closeSetup("completed");
    saved = JSON.parse(localStorage.getItem(CONFIG_STORE_KEY)!);
    await useConfigStore.persist.rehydrate();
    assert.equal(saved.state.setupStatus, "completed");
    assert.equal(useConfigStore.getState().config.imageModel, "default::gpt-image-test");
    assert.equal(useConfigStore.getState().config.channels[0].apiKey, "test-saved");
});

test("stored provider edits cannot remove OneYes, add providers, or change its endpoint", async () => {
    const original = { ...defaultConfig.channels[0], apiKey: "sk-oneyes-test", models: [{ name: "private-image-model", capability: "image" as const }] };
    const foreign = { ...original, id: "foreign", name: "Other", baseUrl: "https://example.test", apiKey: "sk-foreign-test" };
    const saved = { ...defaultConfig, channels: [foreign, { ...original, baseUrl: "https://api.oneyes.ai/v1", name: "Renamed" }], imageModel: "default::private-image-model" };
    localStorage.setItem(CONFIG_STORE_KEY, JSON.stringify({ state: { config: saved }, version: 0 }));
    await useConfigStore.persist.rehydrate();
    let config = useConfigStore.getState().config;
    assert.equal(config.channels.length, 1);
    assert.equal(config.channels[0].name, "OneYes");
    assert.equal(config.channels[0].apiKey, "sk-oneyes-test");
    assert.equal(config.imageModel, "default::private-image-model");
    useConfigStore.getState().updateConfig("channels", [{ ...config.channels[0], baseUrl: "https://example.test", apiFormat: "gemini" }, foreign]);
    useConfigStore.getState().updateConfig("channels", []);
    useConfigStore.getState().updateConfig("baseUrl", "https://example.test");
    useConfigStore.getState().updateConfig("apiFormat", "gemini");
    await useConfigStore.persist.rehydrate();
    config = useConfigStore.getState().config;
    assert.equal(config.channels.length, 1);
    assert.equal(config.channels[0].baseUrl, "https://api.oneyes.ai");
    assert.equal(config.baseUrl, "https://api.oneyes.ai");
    assert.equal(config.apiFormat, "openai");
    assert.equal(config.channels[0].apiKey, "sk-oneyes-test");
    assert.equal(config.imageModel, "default::private-image-model");
});

test("imports accept OneYes credentials only and never copy another provider's key", () => {
    const foreign = { ...defaultConfig.channels[0], baseUrl: "https://example.test", apiKey: "sk-foreign-test" };
    const config = normalizeOneYesConfig({ ...defaultConfig, channels: [foreign] });
    assert.equal(config.channels.length, 1);
    assert.equal(config.channels[0].apiKey, "");
    assert.equal(normalizeOneYesConfig({ baseUrl: "https://api.oneyes.ai", apiKey: "sk-legacy-test" }).channels[0].apiKey, "sk-legacy-test");
    const accepted = upsertChannelCredentials(config, { baseUrl: "https://api.oneyes.ai/v1/", apiKey: "sk-new-test" });
    assert.equal(accepted.status, "updated");
    assert.equal(accepted.config.channels.length, 1);
    assert.equal(accepted.config.channels[0].apiKey, "sk-new-test");
    assert.equal(accepted.config.channels[0].baseUrl, "https://api.oneyes.ai");
    for (const baseUrl of ["https://example.test", "https://api.oneyes.ai.evil.test", "http://api.oneyes.ai", "https://api.oneyes.ai/other", "https://user:pass@api.oneyes.ai", "https://api.oneyes.ai?proxy=1"]) {
        const result = upsertChannelCredentials(config, { baseUrl, apiKey: "sk-foreign-test" });
        assert.equal(result.status, "invalid-base-url");
        assert.equal(result.config, config);
    }
});
