import { test } from "node:test";
import assert from "node:assert/strict";
const values = new Map<string, string>();
globalThis.localStorage = {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => {
        values.set(k, v);
    },
    removeItem: (k) => {
        values.delete(k);
    },
    clear: () => values.clear(),
    key: (i) => [...values.keys()][i] ?? null,
    get length() {
        return values.size;
    },
};
globalThis.window = { localStorage } as unknown as Window & typeof globalThis;
const { transcribeAudio } = await import("./transcription");
const { defaultConfig, useConfigStore } = await import("@/stores/use-config-store");
const config = { ...defaultConfig, channels: [{ ...defaultConfig.channels[0], id: "speech", apiKey: "fixture-secret", models: [] }] };
test("speech uploads exact WAV multipart once, preserves selected group and validates timestamps without leaking responses", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    try {
        globalThis.fetch = async (url, options) => {
            calls++;
            assert.match(String(url), /\/v1\/audio\/transcriptions$/);
            assert.equal((options?.headers as Record<string, string>).Authorization, "Bearer fixture-secret");
            const form = options?.body as FormData;
            assert.equal(form.get("model"), "whisper-1");
            assert.equal(form.get("response_format"), "verbose_json");
            assert.equal(form.get("timestamp_granularities[]"), "segment");
            assert.equal(await (form.get("file") as Blob).text(), "fixture-audio");
            assert.ok(options?.signal);
            return Response.json({ segments: [{ start: 0, end: 1.5, text: "你好，画布" }] });
        };
        const cues = await transcribeAudio(config, new Blob(["fixture-audio"], { type: "audio/wav" }), "speech::whisper-1", new AbortController().signal);
        assert.deepEqual(cues, [{ start: 0, end: 1.5, text: "你好，画布" }]);
        assert.equal(calls, 1);
        await assert.rejects(transcribeAudio(config, new Blob(), ""), /选择或填写/);
        assert.equal(calls, 1);
        for (const response of [Response.json({ text: "no times" }), Response.json({ segments: [null] }), Response.json({ segments: [{ start: 2, end: 1, text: "bad" }] }), new Response("<html>fixture-secret</html>", { status: 403 })]) {
            globalThis.fetch = async () => {
                calls++;
                return response;
            };
            await assert.rejects(transcribeAudio(config, new Blob(), "speech::whisper-1"), (error) => {
                assert.doesNotMatch((error as Error).message, /fixture-secret|<html>/);
                return true;
            });
        }
        assert.equal(calls, 5, "invalid responses do not retry paid POST");
        globalThis.window = { localStorage, oneYesDesktop: {} } as unknown as Window & typeof globalThis;
        useConfigStore.setState({ config: { ...defaultConfig, proxyEnabled: false } });
        globalThis.fetch = async (url) => {
            assert.match(String(url), /^oneyes-canvas:\/\/app\/oneyes-api\/v1\/audio\/transcriptions$/);
            return Response.json({ segments: [{ start: 0, end: 1, text: "native" }] });
        };
        assert.equal((await transcribeAudio(config, new Blob(), "speech::whisper-1"))[0].text, "native");
    } finally {
        globalThis.fetch = original;
    }
});
