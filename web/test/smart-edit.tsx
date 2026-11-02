import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { App, ConfigProvider } from "antd";
import localforage from "localforage";
import "@/i18n";
import "@/styles/globals.css";
import { smartEditPlugin, SmartEditPanel } from "@/components/canvas/smart-edit-plugin";
import { registerBuiltinNodes } from "@/components/canvas/nodes/builtin-nodes";
import { registerNodeDefinitions } from "@/lib/canvas/node-registry";
import { buildNodeContext } from "@/lib/canvas/plugin-node-context";
import { applyCanvasAgentOps } from "@/lib/canvas/canvas-agent-ops";
import { uploadMediaFile, getMediaBlob } from "@/services/file-storage";
import { videoMetadata } from "@/lib/canvas/canvas-node-factory";
import { canvasThemes } from "@/lib/canvas-theme";
import { getAntThemeConfig } from "@/lib/app-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData, CanvasConnection } from "@/types/canvas";
import type { CanvasPluginHost, CanvasPluginAi, ModelOption } from "@/types/canvas-plugin";
import type { SmartEditSettings } from "@/types/smart-edit";
registerBuiltinNodes();
registerNodeDefinitions(smartEditPlugin.nodes, smartEditPlugin.id);
const seed =
    (await localforage.getItem<CanvasNodeData[]>("edit-seeds")) ||
    (await Promise.all(
        ["red", "blue"].map(async (color, i) => {
            const blob = await (await fetch(`oneyes-canvas://app/fixture-media/${color}`)).blob(),
                file = await uploadMediaFile(blob, "video");
            return { id: "v" + i, type: "video", title: i ? "第二镜头" : "口播原片", position: { x: 0, y: 0 }, width: 300, height: 200, metadata: videoMetadata(file) } as CanvasNodeData;
        }),
    ));
await localforage.setItem("edit-seeds", seed);
const restored = await localforage.getItem<{ nodes: CanvasNodeData[]; connections: CanvasConnection[] }>("edit-state");
const initial = () => ({
    nodes: [...seed, { id: "tool", type: "smart-edit:editor", title: "智能剪辑", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { smartEdit: { sourceIds: ["v0", "v1"], mode: "scenes", speechModel: "fixture-speech" } } } as CanvasNodeData],
    connections: [] as CanvasConnection[],
});
function Fixture() {
    const ref = useRef(restored || initial()),
        [, rerender] = useState(0),
        [dark, setDark] = useState(false),
        [project, setProject] = useState("A"),
        [open, setOpen] = useState(true);
    const calls = useRef(0),
        requestedModels = useRef<string[]>([]),
        models = useRef<ModelOption[]>([
            { value: "fixture", label: "隔离测试模型" },
            { value: "second::fixture", label: "另一渠道 / 隔离测试模型" },
        ]),
        ready = useRef(true),
        transcriptions = useRef(0),
        failure = useRef(false),
        hold = useRef(false);
    const set = (value: typeof ref.current) => {
        ref.current = value;
        flushSync(() => rerender((n) => n + 1));
    };
    const applyOps: CanvasPluginHost["applyOps"] = (ops) => {
        const next = applyCanvasAgentOps({ ...ref.current, projectId: project, title: "fixture", selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } }, ops);
        set({ nodes: next.nodes, connections: next.connections });
    };
    const updateMetadata: CanvasPluginHost["updateMetadata"] = (id, metadata) => applyOps([{ type: "update_node", id, metadata }]);
    const ai: CanvasPluginAi = {
        generateText: async (_prompt, options) => {
            calls.current++;
            requestedModels.current.push(options?.model || "");
            if (_prompt.includes("blob:") || _prompt.includes("data:")) throw Error("AI 编排不得上传原始视频或图片");
            if (failure.current) throw Error("模型连接失败，请手动重试");
            if (hold.current)
                await new Promise<void>((resolve, reject) => {
                    options?.signal?.addEventListener("abort", () => reject(options.signal!.reason), { once: true });
                });
            return { text: '{"rationale":"按字幕先介绍再结尾","clips":[{"sourceId":"v1","start":0,"end":1,"label":"结尾"},{"sourceId":"v0","start":0,"end":1,"label":"介绍"}]}' };
        },
        transcribe: async () => {
            transcriptions.current++;
            return [{ start: 0, end: 1, text: "产品介绍" }];
        },
        generateImage: async () => ({ images: [] }),
        generateVideo: async () => ({ url: "", mimeType: "" }),
        listModels: () => models.current,
        defaultModel: () => "fixture",
        isModelReady: () => ready.current,
    };
    const host: CanvasPluginHost = {
        projectId: project,
        getNode: (id) => ref.current.nodes.find((n) => n.id === id) || null,
        getNodes: () => ref.current.nodes,
        getConnections: () => ref.current.connections,
        getUpstream: () => [],
        getDownstream: () => [],
        updateNode: () => {},
        updateMetadata,
        applyOps,
        ai,
        openPanel: () => setOpen(true),
        closePanel: () => setOpen(false),
    };
    const node = host.getNode("tool"),
        ctx = node ? buildNodeContext(host, node, canvasThemes[dark ? "dark" : "light"], 1) : null,
        Content = smartEditPlugin.nodes[0].Content!;
    Object.assign(window, {
        editTest: {
            state: () => ref.current,
            calls: () => calls.current,
            requestedModels: () => requestedModels.current,
            models: (value: ModelOption[]) => {
                models.current = value;
                set({ ...ref.current });
            },
            ready: (value: boolean) => {
                ready.current = value;
                set({ ...ref.current });
            },
            transcriptions: () => transcriptions.current,
            patch: (value: Partial<SmartEditSettings>) => updateMetadata("tool", { smartEdit: { ...host.getNode("tool")?.metadata?.smartEdit, ...value } }),
            reset: () => {
                setProject("A");
                setOpen(true);
                failure.current = false;
                hold.current = false;
                models.current = [
                    { value: "fixture", label: "隔离测试模型" },
                    { value: "second::fixture", label: "另一渠道 / 隔离测试模型" },
                ];
                ready.current = true;
                set(initial());
            },
            fail: () => {
                failure.current = true;
            },
            hold: () => {
                hold.current = true;
            },
            remove: () => applyOps([{ type: "delete_node", id: "tool" }]),
            switch: () => {
                setProject("B");
                set({ nodes: seed, connections: [] });
            },
            move: () => applyOps([{ type: "update_node", id: "v0", patch: { position: { x: 100, y: 100 } } }]),
            theme: (value: boolean) => {
                useThemeStore.setState({ theme: value ? "dark" : "light" });
                setDark(value);
            },
            save: () => localforage.setItem("edit-state", { ...ref.current, nodes: ref.current.nodes.map((n) => (n.id === "tool" ? { ...n, metadata: { ...n.metadata, status: "loading", loadingMessage: "未完成任务" } } : n)) }),
            output: async () => {
                const n = ref.current.nodes.find((n) => n.type === "video" && !seed.some((s) => s.id === n.id));
                return n ? (await getMediaBlob(n.metadata!.storageKey!))?.size : 0;
            },
        },
    });
    return (
        <ConfigProvider theme={getAntThemeConfig(dark)}>
            <App>
                <main className={dark ? "dark" : ""} style={{ background: canvasThemes[dark ? "dark" : "light"].canvas.background, minHeight: "100vh", padding: 20 }}>
                    {ctx && (
                        <div style={{ width: 420, maxWidth: "100%", margin: "0 auto" }}>
                            <div style={{ height: 156 }}>
                                <Content ctx={ctx} />
                            </div>
                            {open && <SmartEditPanel ctx={ctx} onClose={() => setOpen(false)} />}
                        </div>
                    )}
                </main>
            </App>
        </ConfigProvider>
    );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
