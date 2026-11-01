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
const { jevQuestion, readJevResult, requestJevDecision } = await import("./jev");
const { defaultConfig, normalizeOneYesConfig, selectableModelsByCapability } = await import("@/stores/use-config-store");
const config = normalizeOneYesConfig({
    ...defaultConfig,
    channels: [
        ...defaultConfig.channels,
        {
            id: "oneyes-typesafe",
            name: "JEV",
            baseUrl: "https://oneyes.ai",
            apiKey: "fixture-jev-key",
            apiFormat: "openai",
            models: [{ name: "jev-latest", capability: "decision" }],
        },
    ],
});
const selected = "oneyes-typesafe::jev-latest";
test("JEV uses its own native decision route, key and typed questions, never a text endpoint", async () => {
    const previous = globalThis.fetch;
    const question = jevQuestion("choice", "选择合适的方案", "保留\n修改");
    try {
        window.oneYesDesktop = {} as NonNullable<Window["oneYesDesktop"]>;
        let calls = 0;
        globalThis.fetch = async (input, init) => {
            calls++;
            assert.equal(input, "oneyes-canvas://app/oneyes-api/v1/systemone");
            assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer fixture-jev-key");
            assert.equal(new Headers(init?.headers).get("TypeSafe-Danger-Zone-Images"), null);
            assert.equal(new Headers(init?.headers).get("TypeSafe-Danger-Zone-Long-Context"), null);
            assert.deepEqual(JSON.parse(String(init?.body)), { model: "jev-latest", state: "创作方案", questions: { decision: question } });
            return Response.json({ model: "jev-1.14.0", answers: { decision: { type: "choice", choice: "保留", confidence: 0.9, probabilities: { 保留: 0.8, 修改: 0.2 } } }, usage: { input_tokens: 100, output_tokens: 10 }, private: "not persisted" });
        };
        const result = await requestJevDecision(config, selected, "创作方案", question);
        assert.equal(result.answer.type, "choice");
        assert.equal("private" in result, false);
        assert.equal(calls, 1);
        assert.deepEqual(selectableModelsByCapability(config, "decision"), [selected]);
        assert.ok(!selectableModelsByCapability(config, "text").includes(selected));
        const { requestImageQuestion } = await import("./image");
        await assert.rejects(
            requestImageQuestion({ ...config, model: selected }, [], () => {}),
            /决策节点/,
        );
        assert.equal(calls, 1);
    } finally {
        globalThis.fetch = previous;
        delete window.oneYesDesktop;
    }
});
test("invalid input, authorization failure, malformed results and abort never replay decisions", async () => {
    const previous = globalThis.fetch;
    try {
        let calls = 0;
        globalThis.fetch = async () => {
            calls++;
            return new Response("secret upstream details", { status: 403 });
        };
        const question = jevQuestion("noul", "符合要求吗");
        await assert.rejects(requestJevDecision(config, selected, "", question));
        await assert.rejects(requestJevDecision(config, config.textModel, "输入", question));
        await assert.rejects(requestJevDecision(config, "oneyes-typesafe::removed-model", "输入", question));
        assert.equal(calls, 0);
        await assert.rejects(requestJevDecision(config, selected, "输入", question), /JEV 分组权限/);
        assert.equal(calls, 1);
        globalThis.fetch = async () => {
            calls++;
            return Response.json({ model: "jev-latest", answers: { decision: { type: "noul", noul: 2 } } });
        };
        await assert.rejects(requestJevDecision(config, selected, "输入", question), /结果不完整/);
        assert.equal(calls, 2);
        globalThis.fetch = async (_, init) => {
            calls++;
            init!.signal!.throwIfAborted();
            throw Error("unexpected");
        };
        const abort = new AbortController();
        abort.abort();
        await assert.rejects(requestJevDecision(config, selected, "输入", question, abort.signal), { name: "AbortError" });
        assert.equal(calls, 3);
    } finally {
        globalThis.fetch = previous;
    }
});
test("choice and score validation reject duplicate criteria, missing probabilities and mismatched legends", () => {
    assert.throws(() => jevQuestion("noul", ""));
    assert.throws(() => jevQuestion("choice", "选择", "同名\n同名"));
    assert.throws(() => jevQuestion("score", "评分", "只有一级"));
    const question = jevQuestion("score", "质量", "需修改\n可交付\n优秀");
    const payload = { model: "jev-latest", answers: { decision: { type: "score", score: 1.7, confidence: 0.9, probabilities: { "0": 0.1, "1": 0.1, "2": 0.8 }, legend: { "0": "需修改", "1": "可交付", "2": "优秀" } } } };
    assert.equal(readJevResult(payload, question).answer.type, "score");
    assert.throws(() => readJevResult({ ...payload, answers: { decision: { ...payload.answers.decision, score: Infinity } } }, question));
    assert.throws(() => readJevResult({ ...payload, answers: { decision: { ...payload.answers.decision, probabilities: { "0": 1 } } } }, question));
    assert.throws(() => readJevResult({ ...payload, answers: { decision: { ...payload.answers.decision, legend: { "0": "差", "1": "好", "2": "优" } } } }, question));
    assert.equal(readJevResult({ model: "jev-latest", answers: { decision: { type: "noul", noul: 0.5 } } }, jevQuestion("noul", "是吗")).answer.type, "noul");
});
