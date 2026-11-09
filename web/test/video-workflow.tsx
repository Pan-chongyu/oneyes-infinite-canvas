import React from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/i18n";
import "@/styles/globals.css";
import CanvasProject from "@/pages/canvas/project";
import { defaultConfig, useConfigStore } from "@/stores/use-config-store";
import { flushCanvasStorage, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { getAntThemeConfig } from "@/lib/app-theme";
import { createCanvasNode, videoMetadata } from "@/lib/canvas/canvas-node-factory";
import { createVideoNodeWorkflow } from "@/lib/canvas/video-node-workflow";
import { buildNodeGenerationContext, buildNodeResponseMessages, prepareNodeTextContext } from "@/components/canvas/canvas-node-generation";
import { uploadMediaFile, getMediaBlob } from "@/services/file-storage";
import { CanvasNodeType } from "@/types/canvas";

await useConfigStore.persist.rehydrate();
await useCanvasStore.persist.rehydrate();
useConfigStore.setState({ config: { ...defaultConfig, textModel: "default::gpt-5.4", videoModel: "default::grok-imagine-video", channels: [{ ...defaultConfig.channels[0], apiKey: "fixture-key", models: [{ name: "gpt-5.4", capability: "text" }, { name: "grok-imagine-video", capability: "video" }] }] } });
let projectId = localStorage.getItem("video-workflow-project");
if (!projectId) {
    const file = await uploadMediaFile(await (await fetch("/sample.mp4")).blob(), "video");
    const source = createCanvasNode(CanvasNodeType.Video, { x: 300, y: 300 }, { ...videoMetadata(file), prompt: "雨夜的城市，车辆缓慢驶过，镜头推进", model: "default::grok-imagine-video", size: "16:9", seconds: "5", vquality: "1080p", generateAudio: "true", watermark: "false", videoMode: "auto" });
    source.id = "source-video";
    projectId = useCanvasStore.getState().createProject("视频工作流回归");
    useCanvasStore.getState().updateProject(projectId, { nodes: [source], viewport: { x: 0, y: 0, k: 0.5 } });
    localStorage.setItem("video-workflow-project", projectId);
}
const state = () => useCanvasStore.getState().projects.find(project => project.id === projectId)!;
const originalFetch = window.fetch.bind(window);
const calls: unknown[] = [], errors: string[] = [];
let mode = "success";
window.addEventListener("error", event => errors.push(event.message));
window.addEventListener("unhandledrejection", event => errors.push(String(event.reason)));
window.fetch = async (input, options) => {
    if (String(input).includes("/responses")) {
        calls.push(JSON.parse(String(options?.body)));
        if (mode === "error") return Response.json({ error: { message: "fixture vision unsupported" } }, { status: 400 });
        if (mode === "hold") return new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true }));
        return new Response('data: {"type":"response.output_text.delta","delta":"雨夜城市，镜头缓慢推进，车辆驶过，冷色电影光影。"}\n\ndata: {"type":"response.completed","response":{"status":"completed","output":[]}}\n\ndata: [DONE]\n\n', { headers: { "Content-Type": "text/event-stream" } });
    }
    if (/^https?:/.test(String(input))) throw Error("External requests disabled in fixture");
    return originalFetch(input, options);
};
Object.assign(window, { videoWorkflowTest: {
    state, flush: flushCanvasStorage, calls: () => calls, errors: () => errors, mode: (value: string) => { mode = value; },
    original: async () => { const source = state().nodes.find(node => node.id === "source-video")!; return { node: source, bytes: (await getMediaBlob(source.metadata!.storageKey!))!.size }; },
    theme: (dark: boolean) => useThemeStore.getState().setTheme(dark ? "dark" : "light"),
    service: async (kind: "cancel" | "invalid" | "missing" | "mixed" | "existing" | "ordinary") => {
        const source = state().nodes.find(node => node.id === "source-video")!, flow = createVideoNodeWorkflow(source, useConfigStore.getState().config, "reverse");
        const context = buildNodeGenerationContext(flow.configNode.id, [source, ...flow.nodes], flow.connections, flow.configNode.metadata!.composerContent!);
        const controller = new AbortController(); let stages = 0;
        if (kind === "invalid") context.referenceVideos[0] = { ...context.referenceVideos[0], storageKey: undefined, url: URL.createObjectURL(new Blob(["bad video"])) };
        if (kind === "missing") context.referenceVideos = [];
        if (kind === "mixed") { context.referenceImages.push({ id: "cover", name: "cover.png", type: "image/png", dataUrl: "data:image/png;base64,Y292ZXI=" }); context.referenceVideos.push({ ...context.referenceVideos[0], id: "second" }); }
        if (kind === "existing" || kind === "ordinary") context.prompt = "自定义重点：仔细描述衣服与镜头运动。";
        const prepared = await prepareNodeTextContext(context, 3, controller.signal, () => { if (kind === "cancel" && ++stages > 1) controller.abort(); }, kind === "ordinary" ? undefined : source.id);
        return { prepared, messages: buildNodeResponseMessages(prepared) };
    },
    missingRecipe: () => { try { createVideoNodeWorkflow({ ...state().nodes[0], metadata: { ...state().nodes[0].metadata, references: ["image:missing"] } }, useConfigStore.getState().config, "generate"); return ""; } catch (error) { return (error as Error).message; } },
    recipeWithRefs: () => {
        const image = createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { content: "data:image/png;base64,Y292ZXI=", storageKey: "image:cover" });
        const source = { ...state().nodes[0], metadata: { ...state().nodes[0].metadata, references: ["image:cover"] } };
        const flow = createVideoNodeWorkflow(source, useConfigStore.getState().config, "generate", [image]);
        return buildNodeGenerationContext(flow.configNode.id, [image, ...flow.nodes], flow.connections, flow.configNode.metadata!.composerContent!);
    },
} });
function Fixture() {
    const theme = useThemeStore(store => store.theme);
    return <ConfigProvider theme={getAntThemeConfig(theme === "dark")}><App><CanvasProject /></App></ConfigProvider>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[`/canvas/${projectId}`]}><Routes><Route path="/canvas/:id" element={<Fixture />} /></Routes></MemoryRouter></QueryClientProvider></React.StrictMode>);
