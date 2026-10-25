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
const turns: Record<string, unknown>[] = [];
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
    const path = new URL(String(input), location.href).pathname;
    if (path === "/agent/codex/threads") {
        const snapshot = { ok: true, conversation: useAgentStore.getState().conversation, workspace: { activeThreadId: "thread-1" }, data: [] };
        if (holdHistory) await new Promise<void>((resolve) => pendingHistory.push(resolve));
        return json(snapshot);
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
    if (path === "/agent/codex/models") return json({ ok: true, data: [] });
    if (path === "/agent/codex/skills") return json({ ok: true, data: [] });
    if (["/canvas/state", "/canvas/activate", "/agent/codex/history/ack"].includes(path)) return json({ ok: true });
    throw new Error(`Unexpected fixture request: ${path}`);
};
useAgentStore.setState({ enabled: true, url: "http://fixture.test", token: "fixture-token", activeThreadId: "thread-1", activeTab: "chat" });
Object.assign(window, { chatTest: {
    state: () => {
        const { prompt, sending, waiting, loadingThreads, conversation } = useAgentStore.getState();
        return { prompt, sending, waiting, loadingThreads, status: conversation.status, threadId: conversation.threadId, turns, pendingHistory: pendingHistory.length };
    },
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
