import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { App, ConfigProvider } from "antd";
import localforage from "localforage";
import "@/i18n";
import "@/styles/globals.css";
import { studioPlugin } from "@/components/canvas/studio-plugin";
import { creatorToolsPlugin } from "@/components/canvas/creator-tools-plugin";
import { NodeLibrary } from "@/components/canvas/node-library";
import { createWorkflowOps } from "@/lib/canvas/node-library";
import { useThemeStore } from "@/stores/use-theme-store";
import { registerBuiltinNodes } from "@/components/canvas/nodes/builtin-nodes";
import { registerNodeDefinitions } from "@/lib/canvas/node-registry";
import { buildNodeContext } from "@/lib/canvas/plugin-node-context";
import { applyCanvasAgentOps } from "@/lib/canvas/canvas-agent-ops";
import { buildNodeGenerationContext } from "@/components/canvas/canvas-node-generation";
import { useBatchProcessing } from "@/pages/canvas/hooks/use-batch-processing";
import { useCreatorProcessing } from "@/pages/canvas/hooks/use-creator-processing";
import { uploadImage, getImageBlob } from "@/services/image-storage";
import { imageMetadata } from "@/lib/canvas/canvas-node-factory";
import { exportStudioSources } from "@/services/studio-export";
import { unzipSync, strFromU8 } from "fflate";
import { canvasThemes } from "@/lib/canvas-theme";
import { getAntThemeConfig } from "@/lib/app-theme";
import { defaultConfig, useConfigStore } from "@/stores/use-config-store";
import type { CanvasNodeData, CanvasConnection } from "@/types/canvas";
import type { CanvasPluginHost, CanvasPluginAi } from "@/types/canvas-plugin";
registerBuiltinNodes();
registerNodeDefinitions(studioPlugin.nodes, "studio");
registerNodeDefinitions(creatorToolsPlugin.nodes, "creator-tools");
useThemeStore.setState({ theme: "light" });
const seeds: CanvasNodeData[] = [];
for (const [index, color] of ["red", "blue"].entries()) {
    const canvas = new OffscreenCanvas(9 + index, 7 + index),
        ctx = canvas.getContext("2d")!;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const file = await uploadImage(await canvas.convertToBlob({ type: "image/png" }));
    seeds.push({ id: "source" + index, type: "image", title: "原图 " + index, position: { x: 0, y: 0 }, width: 9, height: 7, metadata: imageMetadata(file) });
}
const restored = await localforage.getItem<{ nodes: CanvasNodeData[]; connections: CanvasConnection[] }>("studio-state");
function Fixture() {
    const ref = useRef(restored || { nodes: seeds, connections: [] });
    const [, render] = useState(0);
    const [library, setLibrary] = useState(false);
    const [dark, setDark] = useState(false),
        [project, setProject] = useState("A");
    const settings = useRef({ failSave: false, failGenerate: false, hold: false, release: () => {}, aiReply: null as string | null, holdAi: false, releaseAi: () => {} });
    const calls = useRef<string[]>([]),
        requests = useRef<any[]>([]),
        opened = useRef("");
    const set = (value: typeof ref.current) => {
        ref.current = value;
        flushSync(() => render((n) => n + 1));
    };
    const applyOps: CanvasPluginHost["applyOps"] = (ops) => {
        const next = applyCanvasAgentOps({ ...ref.current, projectId: project, title: "test", selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } }, ops);
        set({ nodes: next.nodes, connections: next.connections });
    };
    const updateMetadata: CanvasPluginHost["updateMetadata"] = (id, metadata) => applyOps([{ type: "update_node", id, metadata }]);
    const batch = useBatchProcessing({
        projectId: project,
        ...ref.current,
        readNodes: () => ref.current.nodes,
        applyAgentOps: applyOps,
        flush: async () => {
            if (settings.current.failSave) throw Error("fixture save failure");
            await localforage.setItem("studio-state", ref.current);
        },
        runGeneration: async (id, prompt) => {
            calls.current.push(prompt);
            if (settings.current.failGenerate) {
                updateMetadata(id, { status: "error" });
                return;
            }
            updateMetadata(id, { status: "loading", imageTaskId: "receipt-" + id });
            if (settings.current.hold)
                await new Promise<void>((resolve) => {
                    settings.current.release = resolve;
                });
            updateMetadata(id, { ...seeds[0].metadata, status: "success" });
        },
    });
    const processing = useCreatorProcessing({ projectId: project, ...ref.current, applyOps, updateMetadata });
    const ai: CanvasPluginAi = {
        generateText: async (prompt, options) => {
            requests.current.push({ prompt, references: options?.references, system: options?.system, model: options?.model });
            if (settings.current.holdAi) await new Promise<void>((resolve, reject) => {
                settings.current.releaseAi = resolve;
                options?.signal?.addEventListener("abort", () => reject(options.signal!.reason), { once: true });
            });
            options?.signal?.throwIfAborted();
            if (settings.current.aiReply !== null) return { text: settings.current.aiReply };
            if (options?.system?.includes("角色设计师")) return { text: JSON.stringify({ role: "白衣少女阿宁", outfit: "银簪与青靴", style: "国风水墨" }) };
            if (options?.system?.includes("审片师")) return { text: JSON.stringify({ index: 2, reason: "主体完整，构图清晰" }) };
            if (options?.system?.includes("画面策划")) return { text: JSON.stringify({ prompts: ["白衣阿宁站在山门", "同一白衣阿宁穿过山门"] }) };
            if (options?.system?.includes("中文字幕校对")) return { text: JSON.stringify({ texts: ["校对后的字幕。"] }) };
            return { text: options?.system?.includes("总编剧") ? JSON.stringify({ logline: "山海异闻", style: "国风水墨", characters: [{ name: "阿宁", appearance: "白衣少女，银簪", personality: "沉着", voice: "清亮" }], episodes: [{ title: "第一集", synopsis: "入山", script: "阿宁踏入雨雾。", cliffhanger: "山门无声合上。" }, { title: "第二集", synopsis: "问路", script: "阿宁望向山门。", cliffhanger: "门后传来脚步声。" }] }) : options?.system ? JSON.stringify([{ title: "镜头 1", picture: "雨夜跑车", dialogue: "出发", seconds: 5, camera: "低机位" }]) : "识别文字" };
        },
        generateImage: async () => ({ images: [] }),
        generateVideo: async () => ({ url: "", mimeType: "" }),
        listModels: () => [{ value: "test", label: "测试模型" }, { value: "group-b/model", label: "另一分组／同名模型" }],
        defaultModel: () => "test",
        isModelReady: model => model === "test" || model === "group-b/model",
    };
    const host: CanvasPluginHost = {
        projectId: project,
        batch,
        processing,
        ai,
        getNode: (id) => ref.current.nodes.find((n) => n.id === id) || null,
        getNodes: () => ref.current.nodes,
        getConnections: () => ref.current.connections,
        getUpstream: () => [],
        getDownstream: () => [],
        applyOps,
        updateMetadata,
        updateNode: () => {},
        openPanel: id => { opened.current = id; },
        closePanel: () => {},
    };
    const node = ref.current.nodes.find((n) => n.id === "tool"),
        definition = [...studioPlugin.nodes, ...creatorToolsPlugin.nodes].find((n) => n.type === node?.type),
        ctx = node ? buildNodeContext(host, node, canvasThemes[dark ? "dark" : "light"], 1) : null,
        Panel = definition?.Panel,
        Content = definition?.Content;
    Object.assign(window, {
        studioTest: {
            assistant: (value: Partial<typeof settings.current>) => { Object.assign(settings.current, value); },
            releaseAi: () => settings.current.releaseAi(),
            configureJev: () => {
                window.oneYesDesktop = {} as NonNullable<Window["oneYesDesktop"]>;
                useConfigStore.getState().replaceConfig({ ...defaultConfig, channels: [...defaultConfig.channels, { id: "oneyes-typesafe", name: "JEV", baseUrl: "https://oneyes.ai", apiKey: "fixture-jev-key", apiFormat: "openai", models: [{ name: "jev-latest", capability: "decision" }] }] });
            },
            saveJev: () => localforage.setItem("jev-result", ref.current.nodes.find(n => n.id === "tool")),
            restoredJev: () => localforage.getItem("jev-result"),
            state: () => ref.current,
            openedPanel: () => opened.current,
            calls: () => calls.current,
            requests: () => requests.current,
            tool: (name: string, sourceIds: string[], extra = {}) => {
                set({
                    nodes: [
                        ...seeds,
                        {
                            id: "tool",
                            type: name.includes(":") ? name : "studio:" + name,
                            title: "测试工具",
                            position: { x: 50, y: 50 },
                            width: 320,
                            height: 190,
                            metadata: { status: "idle", ...(name.startsWith("creator-tools:") ? { creatorSettings: { sourceIds, ...extra } } : { studio: { sourceIds, ...extra } }) },
                        },
                    ],
                    connections: [],
                });
            },
            patch: (value: any) => updateMetadata("tool", value),
            apply: applyOps,
            library: () => setLibrary(true),
            textSource: (text: string) => applyOps([{ type: "add_node", id: "words", nodeType: "text", metadata: { content: text } }]),
            batch: () => batch.start("tool").catch(() => {}),
            pause: () => batch.pause("tool"),
            active: () => batch.active("tool"),
            fail: (key: "failSave" | "failGenerate" | "hold", value: boolean) => {
                settings.current[key] = value;
            },
            release: () => settings.current.release(),
            theme: (value: boolean) => {
                document.documentElement.classList.toggle("dark", value);
                useThemeStore.setState({ theme: value ? "dark" : "light" });
                setDark(value);
            },
            switch: () => flushSync(() => setProject("B")),
            export: async () => {
                const input = { ...seeds[0], title: "../../原图", metadata: { ...seeds[0].metadata, apiKey: "fixture-private-secret" } };
                const blob = await exportStudioSources([input], new AbortController().signal),
                    files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
                const original = new Uint8Array(await (await getImageBlob(seeds[0].metadata!.storageKey!))!.arrayBuffer()),
                    bytes = Object.entries(files).find(([name]) => name !== "素材参数.json")![1];
                return { names: Object.keys(files), params: strFromU8(files["素材参数.json"]), identical: bytes.length === original.length && bytes.every((v, i) => v === original[i]) };
            },
            reference: () => {
                const target = { ...seeds[0], id: "target", metadata: {} };
                return buildNodeGenerationContext("target", [...ref.current.nodes, target], [...ref.current.connections, { id: "ref", fromNodeId: "tool", toNodeId: "target" }], "画面");
            },
            persist: () => localforage.setItem("studio-state", ref.current),
            image: async () => {
                const output = ref.current.nodes.filter((n) => n.type === "image" && !n.id.startsWith("source")).at(-1);
                const blob = await getImageBlob(output!.metadata!.storageKey!);
                const bitmap = await createImageBitmap(blob!);
                const result = { width: bitmap.width, height: bitmap.height, bytes: blob!.size };
                bitmap.close();
                return result;
            },
        },
    });
    return (
        <ConfigProvider theme={getAntThemeConfig(dark)}>
            <App>
                <main style={{ background: canvasThemes[dark ? "dark" : "light"].canvas.background, minHeight: "100vh", padding: 20 }}>
                    {library && <div style={{ width: 320, background: canvasThemes[dark ? "dark" : "light"].toolbar.panel, color: canvasThemes[dark ? "dark" : "light"].node.text, padding: 8 }}><NodeLibrary onCreate={nodeType => applyOps([{ type: "add_node", nodeType }])} onTemplate={id => applyOps(createWorkflowOps(id, { x: 100, y: 100 }))} onClose={() => setLibrary(false)} /></div>}
                    <div style={{ width: 320, height: 190 }}>{ctx && Content && <Content ctx={ctx} />}</div>
                    <div style={{ maxWidth: 600 }}>{ctx && Panel && <Panel key={`${project}:${node!.type}`} ctx={ctx} onClose={() => {}} />}</div>
                </main>
            </App>
        </ConfigProvider>
    );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
