import { create } from "zustand";
import i18n from "@/i18n";
import { desktopCodexConnection } from "@/services/api/canvas-agent";

import type { CanvasAgentOp, CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

export type AgentChatRole = "user" | "assistant" | "system" | "tool" | "error";
export type AgentAttachment = { id: string; name: string; type: string; size: number; width: number; height: number; url: string; dataUrl: string };
export type AgentMessageAttachment = Pick<AgentAttachment, "id" | "name" | "url"> & Partial<Pick<AgentAttachment, "type" | "size" | "width" | "height" | "dataUrl">>;
export type AgentCanvasReference = Pick<CanvasResourceReference, "nodeId" | "label" | "title" | "kind" | "previewUrl" | "text">;
export type AgentSkillReference = { name: string; path: string; displayName?: string };
export type AgentChatItem = { id: string; itemId?: string; clientMessageId?: string; threadId?: string; turnId?: string; role: AgentChatRole; title?: string; text: string; meta?: string; detail?: unknown; attachments?: AgentMessageAttachment[]; canvasReferences?: AgentCanvasReference[]; skill?: AgentSkillReference; streamId?: string; activityItems?: Record<string, string> };
export type AgentEventLog = { id: string; time: string; title: string; text: string; raw?: unknown };
export type AgentPendingToolCall = { requestId: string; name: string; input?: { ops?: CanvasAgentOp[]; path?: string } & Record<string, unknown> };
export type AgentPermissionMode = "request" | "automatic" | "full";
export type AgentReasoningEffort = string;
export type AgentModel = {
    id: string;
    model: string;
    displayName: string;
    description?: string;
    hidden?: boolean;
    defaultReasoningEffort: AgentReasoningEffort;
    supportedReasoningEfforts: Array<{ reasoningEffort: AgentReasoningEffort; description?: string }>;
    isDefault?: boolean;
};
export type AgentApprovalDecision = "accept" | "acceptForSession" | "decline";
export type AgentPendingApproval = { requestId: string; method: string; threadId?: string; turnId?: string; itemId?: string; reason?: string; command?: unknown; cwd?: string; grantRoot?: string; networkApprovalContext?: unknown; permissions?: unknown; deciding?: AgentApprovalDecision };
export type AgentCanvasContext = { snapshot: CanvasAgentSnapshot; applyOps: (ops?: CanvasAgentOp[]) => CanvasAgentSnapshot; undoOps: () => CanvasAgentSnapshot | null; canUndo: boolean };
export type AgentThreadSummary = { id: string; preview: string; name?: string | null; cwd?: string; status?: string; source?: unknown; createdAt?: number; updatedAt?: number };
export type AgentTokenUsage = { input: number; cached: number; output: number };
export type AgentBootstrapStatus = { key: string; text: string; detail: string; status: "running" | "ready" | "error"; failureReason?: string | null; cancelled?: boolean; recovery?: "installing" | "retrying" | "recovered" | "failed" };
export type AgentConversationState = {
    revision: number;
    conversationId: string;
    threadId: string;
    status: "idle" | "preparing" | "ready" | "warning" | "running" | "failed";
    mcpStatuses: Record<string, { status: "starting" | "ready" | "failed" | "cancelled"; error?: string | null; failureReason?: string | null; recovery?: "installing" | "retrying" | "recovered" | "failed" }>;
    sourceClientId?: string;
    error?: string;
};
export type AgentPanelTab = "chat" | "setup" | "history" | "skills" | "log";

const CONNECT_TIMEOUT_MS = 6000;
let agentSource: EventSource | null = null;
let connectTimer: ReturnType<typeof setTimeout> | null = null;

type AgentStore = {
    width: number;
    panelOpen: boolean;
    panelMounted: boolean;
    panelClosing: boolean;
    canvasContext: AgentCanvasContext | null;
    url: string;
    token: string;
    connected: boolean;
    enabled: boolean;
    silentConnect: boolean;
    fragmentBootstrap: boolean;
    prompt: string;
    attachments: AgentAttachment[];
    canvasReferences: CanvasResourceReference[];
    sending: boolean;
    waiting: boolean;
    messages: AgentChatItem[];
    tokenUsage: AgentTokenUsage | null;
    eventLogs: AgentEventLog[];
    threads: AgentThreadSummary[];
    activeThreadId: string;
    activeTurnId: string;
    workspacePath: string;
    loadingThreads: boolean;
    activeTab: AgentPanelTab;
    confirmTools: boolean;
    permissionMode: AgentPermissionMode;
    models: AgentModel[];
    modelsStatus: "idle" | "loading" | "ready" | "error";
    model: string;
    reasoningEffort: AgentReasoningEffort | "";
    activity: string;
    conversation: AgentConversationState;
    bootstrapStatus: AgentBootstrapStatus | null;
    mcpStartupStatuses: Record<string, AgentBootstrapStatus>;
    connectError: string;
    pendingTool: AgentPendingToolCall | null;
    pendingApprovals: AgentPendingApproval[];
    setAgentState: (patch: Partial<Omit<AgentStore, "setAgentState" | "connectAgent" | "disconnectAgent" | "addMessage" | "addEventLog" | "clearEventLogs" | "openPanel" | "closePanel" | "togglePanel" | "setCanvasContext">>) => void;
    openPanel: () => void;
    closePanel: () => void;
    togglePanel: () => void;
    setCanvasContext: (context: AgentCanvasContext | null) => void;
    codexConfigured: boolean;
    codexSetupBusy: boolean;
    setupDesktopCodex: (restore?: boolean) => Promise<void>;
    connectAgent: (options?: { silent?: boolean }) => void;
    disconnectAgent: (patch?: Partial<Omit<AgentStore, "setAgentState" | "connectAgent" | "disconnectAgent" | "addMessage" | "addEventLog" | "clearEventLogs" | "openPanel" | "closePanel" | "togglePanel" | "setCanvasContext">>) => void;
    addMessage: (item: AgentChatItem) => void;
    addEventLog: (item: AgentEventLog) => void;
    clearEventLogs: () => void;
};

export const CANVAS_AGENT_PANEL_MOTION_MS = 500;

export const useAgentStore = create<AgentStore>((set, get) => ({
    width: typeof window === "undefined" ? 440 : Number(localStorage.getItem("canvas-agent-panel-width")) || 440,
    panelOpen: false,
    panelMounted: true,
    panelClosing: false,
    canvasContext: null,
    url: typeof window === "undefined" ? "http://127.0.0.1:17371" : localStorage.getItem("canvas-agent-url") || "http://127.0.0.1:17371",
    token: typeof window === "undefined" ? "" : localStorage.getItem("canvas-agent-token") || "",
    connected: false,
    enabled: false,
    codexConfigured: false,
    codexSetupBusy: false,
    setupDesktopCodex: async (restore = false) => {
        if (get().codexSetupBusy) return;
        set({ codexSetupBusy: true, connectError: '' });
        try {
            const connection = await desktopCodexConnection(restore ? 'restore' : 'setup');
            set({ codexConfigured: connection.configured });
            if (connection.configured && connection.url && connection.token) {
                set({ url: connection.url, token: connection.token });
                get().connectAgent();
            }
        } catch (error) {
            set({ connectError: error instanceof Error ? error.message : i18n.t('agent.connect.setupFailed'), activeTab: 'setup' });
        } finally { set({ codexSetupBusy: false }); }
    },
    silentConnect: false,
    fragmentBootstrap: false,
    prompt: "",
    attachments: [],
    canvasReferences: [],
    sending: false,
    waiting: false,
    messages: [],
    tokenUsage: null,
    eventLogs: [],
    threads: [],
    activeThreadId: "",
    activeTurnId: "",
    workspacePath: "",
    loadingThreads: false,
    activeTab: "setup",
    confirmTools: false,
    permissionMode: typeof window === "undefined" ? "request" : (localStorage.getItem("canvas-agent-permission-mode") as AgentPermissionMode) || "request",
    models: [],
    modelsStatus: "idle",
    model: typeof window === "undefined" ? "" : localStorage.getItem("canvas-agent-model") || "",
    reasoningEffort: typeof window === "undefined" ? "" : (localStorage.getItem("canvas-agent-reasoning-effort") as AgentReasoningEffort) || "",
    activity: i18n.t("agent.state.ready"),
    conversation: { revision: 0, conversationId: "", threadId: "", status: "idle", mcpStatuses: {} },
    bootstrapStatus: null,
    mcpStartupStatuses: {},
    connectError: "",
    pendingTool: null,
    pendingApprovals: [],
    setAgentState: (patch) => set(patch),
    openPanel: () => set({ panelOpen: true, panelMounted: true, panelClosing: false }),
    closePanel: () => {
        if (!get().panelMounted || get().panelClosing) return;
        set({ panelOpen: false, panelClosing: true });
        setTimeout(() => {
            if (get().panelClosing) set({ panelClosing: false });
        }, CANVAS_AGENT_PANEL_MOTION_MS);
    },
    togglePanel: () => (get().panelOpen ? get().closePanel() : get().openPanel()),
    setCanvasContext: (canvasContext) => set({ canvasContext }),
    connectAgent: (options) => {
        const silent = options?.silent ?? false;
        const endpoint = get().url.trim().replace(/\/$/, "");
        const token = get().token.trim();
        if (!endpoint || !token) return set({ connectError: silent ? "" : i18n.t("agent.state.connectionRequired") });
        try {
            const parsed = new URL(endpoint);
            if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
        } catch {
            return set({ connectError: silent ? "" : i18n.t("agent.state.invalidUrl") });
        }
        if (!window.oneYesDesktop?.agent) {
            localStorage.setItem("canvas-agent-url", endpoint);
            localStorage.setItem("canvas-agent-token", token);
        }
        // Only set enabled here; LocalAgentPanel's effect owns SSE initialization.
        set({ url: endpoint, token, enabled: true, silentConnect: silent, fragmentBootstrap: false, activity: i18n.t("agent.status.connecting"), connectError: "" });
    },
    disconnectAgent: (patch = {}) => {
        agentSource?.close();
        agentSource = null;
        if (connectTimer) clearTimeout(connectTimer);
        connectTimer = null;
        set({ enabled: false, connected: false, silentConnect: false, fragmentBootstrap: false, activity: i18n.t("agent.state.offline"), conversation: { revision: 0, conversationId: "", threadId: "", status: "idle", mcpStatuses: {} }, bootstrapStatus: null, mcpStartupStatuses: {}, ...patch });
    },
    addMessage: (item) => set((state) => ({ messages: [...state.messages, item] })),
    addEventLog: (item) => set((state) => ({ eventLogs: [...state.eventLogs.slice(-160), item] })),
    clearEventLogs: () => set({ eventLogs: [] }),
}));
