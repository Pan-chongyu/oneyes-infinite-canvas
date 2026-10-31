// Isolated renderer fixture: real panel and editor, no accounts or model requests.
import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { App } from "antd";
import "@/i18n";
import { LocalAgentPanel } from "@/components/agent/local-agent-panel";
import { useAgentStore } from "@/stores/use-agent-store";

let source: FixtureEvents;
let revision = 1;
let holdHistory = false;
let failTurn: (() => void) | undefined;
let rejectNextTurn = false;
const pendingHistory: (() => void)[] = [];
let holdPage = false;
let releasePage: (() => void) | undefined;
const pageRequests: string[] = [];
const turns: Record<string, unknown>[] = [];
let failModels = true;
let modelRequests = 0;
let holdModels = false;
const pendingModels: (() => void)[] = [];
const initRequests: string[] = [];
const makeModel = (model: string, efforts = ["none", "high", "future-effort"]) => ({ id: model, model, displayName: "GPT Test", isDefault: model === "first", defaultReasoningEffort: "high", supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort })) });
let models = [makeModel("first"), makeModel("second"), makeModel("no-reasoning", [])];
const conversation = (status = "ready", threadId = "thread-1") => ({ revision: ++revision, conversationId: threadId, threadId, status, mcpStatuses: {} });
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
class FixtureEvents extends EventTarget {
    onerror = null;
    constructor() {
        super();
        source = this;
        setTimeout(() => this.emit("hello", { protocolVersion: 6, conversation: conversation(), codex: { busy: false, threadId: "thread-1" } }), 0);
    }
    emit(type: string, data: unknown) { this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) })); }
    close() {}
}
Object.assign(window, { EventSource: FixtureEvents, __infiniteCanvasAgentClientIdPromise: Promise.resolve("chat-test-client") });
window.fetch = async (input, init) => {
    const url = new URL(String(input), location.href);
    const path = url.pathname;
    if (path === "/agent/codex/threads") {
        const cursor = url.searchParams.get("cursor");
        if (cursor) {
            pageRequests.push(cursor);
            if (holdPage) await new Promise<void>((resolve) => { releasePage = resolve; });
            return json({ ok: true, data: [{ id: "thread-1", preview: "updated" }, { id: "older-thread", preview: "older" }], nextCursor: null });
        }
        const snapshot = { ok: true, conversation: useAgentStore.getState().conversation, workspace: { activeThreadId: "thread-1" }, data: [{ id: "thread-1", preview: "current" }], nextCursor: "page/2+" };
        if (holdHistory) await new Promise<void>((resolve) => pendingHistory.push(resolve));
        return json(snapshot);
    }
    if (path.endsWith("/resume") || path === "/agent/codex/threads/reset") {
        initRequests.push(path);
        const next = conversation();
        source.emit("conversation_changed", next);
        return json({ ok: true, conversation: next });
    }
    if (path.startsWith("/agent/codex/threads/")) return json({ ok: true, messages: [], settledTurnIds: [], historyReady: true });
    if (path === "/agent/codex/turn") {
        turns.push(JSON.parse(String(init?.body)));
        if (rejectNextTurn) {
            rejectNextTurn = false;
            await new Promise<void>((resolve) => { failTurn = resolve; });
            return new Response(JSON.stringify({ error: "fixture rejected" }), { status: 503 });
        }
        source.emit("conversation_changed", conversation("running"));
        source.emit("codex_state", { busy: true, threadId: "thread-1", turnId: `turn-${turns.length}` });
        return json({ ok: true, threadId: "thread-1" });
    }
    if (path === "/agent/codex/models") {
        modelRequests++;
        if (failModels) { failModels = false; return new Response(JSON.stringify({ error: "fixture model discovery failed" }), { status: 503 }); }
        const data = models;
        if (holdModels) await new Promise<void>((resolve) => pendingModels.push(resolve));
        return json({ ok: true, data });
    }
    if (path === "/agent/codex/skills") return json({ ok: true, data: [] });
    if (["/canvas/state", "/canvas/activate", "/agent/codex/history/ack"].includes(path)) return json({ ok: true });
    throw new Error(`Unexpected fixture request: ${path}`);
};
useAgentStore.setState({ enabled: true, url: "http://fixture.test", token: "fixture-token", activeThreadId: "thread-1", activeTab: "chat", model: "saved-unavailable", reasoningEffort: "future-effort" });
Object.assign(window, { chatTest: {
    state: () => {
        const { prompt, sending, waiting, loadingThreads, conversation, modelsStatus, model, reasoningEffort } = useAgentStore.getState();
        const { threads, loadingMoreThreads, nextThreadCursor } = useAgentStore.getState();
        return { prompt, sending, waiting, loadingThreads, loadingMoreThreads, nextThreadCursor, threadIds: threads.map((item) => item.id), pageRequests, modelsStatus, model, reasoningEffort, modelRequests, modelIds: useAgentStore.getState().models.map((item) => item.model), pendingModels: pendingModels.length, initRequests, status: conversation.status, threadId: conversation.threadId, turns, pendingHistory: pendingHistory.length };
    },
    historyTab: () => useAgentStore.setState({ activeTab: "history" }),
    holdPage: () => { holdPage = true; },
    releasePage: () => { holdPage = false; releasePage?.(); },
    holdModels: () => { holdModels = true; },
    allowModels: () => { holdModels = false; },
    releaseModels: () => { holdModels = false; pendingModels.splice(0).forEach((resolve) => resolve()); },
    connection: (connected: boolean) => useAgentStore.setState({ connected }),
    modelCatalog: (empty: boolean) => { models = empty ? [] : [makeModel("first"), makeModel("second"), makeModel("no-reasoning", [])]; },
    initialization: (status: string) => source.emit("conversation_changed", conversation(status)),
    holdHistory: () => { holdHistory = true; },
    releaseHistory: () => { holdHistory = false; pendingHistory.splice(0).forEach((resolve) => resolve()); },
    complete: () => {
        const turnId = `turn-${turns.length}`;
        source.emit("agent_event", { type: "turn.completed", threadId: "thread-1", turnId });
        source.emit("codex_state", { busy: false, threadId: "thread-1", turnId });
        source.emit("conversation_changed", conversation());
    },
    changeThread: () => source.emit("conversation_changed", conversation("ready", "thread-2")),
    refreshHistory: () => source.emit("workspace_changed", { activeThreadId: "thread-1" }),
    rejectNext: () => { rejectNextTurn = true; },
    failTurn: () => failTurn?.(),
} });
createRoot(document.getElementById("root")!).render(<MemoryRouter><App><LocalAgentPanel embedded /></App></MemoryRouter>);
