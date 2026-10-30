import assert from "node:assert/strict";
import test from "node:test";
import type { AgentModel } from "@/stores/use-agent-store";
import { agentModelEffort, availableAgentModels } from "./agent-models";

const model = (id: string, efforts = ["none", "high", "future-effort"]): AgentModel => ({ id, model: id, displayName: "Same name", defaultReasoningEffort: "high", supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort })) });

test("distinct model IDs survive duplicate names; hidden and review-only entries stay hidden", () => {
    const data = availableAgentModels([model("first"), model("second"), model("first"), model("no-reasoning", []), { ...model("hidden"), hidden: true }, model("codex-auto-review")]);
    assert.deepEqual(data.map((item) => item.model), ["first", "second", "no-reasoning"]);
    assert.deepEqual(data[0].supportedReasoningEfforts.map((item) => item.reasoningEffort), ["none", "high", "future-effort"]);
    assert.equal(data[2].defaultReasoningEffort, "");
});

test("model switching preserves supported effort and only falls back to advertised defaults", () => {
    assert.equal(agentModelEffort(model("first"), "future-effort"), "future-effort");
    assert.equal(agentModelEffort(model("first"), "missing"), "high");
    assert.equal(agentModelEffort(model("second", ["none"]), "high"), "none");
    assert.equal(agentModelEffort(model("no-reasoning", []), "high"), "");
    assert.deepEqual(availableAgentModels([model("duplicates", ["high", "high", "", " "])])[0].supportedReasoningEfforts, [{ reasoningEffort: "high" }]);
});
