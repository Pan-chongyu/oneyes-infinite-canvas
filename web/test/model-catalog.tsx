import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { App, Button, ConfigProvider } from "antd";
import "antd/dist/reset.css";
import "@/styles/globals.css";
import "@/i18n";
import { ChannelEditorDrawer } from "@/components/layout/channel-editor-drawer";
import { ModelPicker } from "@/components/model-picker";
import { useModelCatalogSync } from "@/hooks/use-model-catalog-sync";
import { queryClient } from "@/lib/query-client";
import { getAntThemeConfig } from "@/lib/app-theme";
import { defaultConfig, GROK_VIDEO_CHANNEL_ID, resolveModelRequestConfig, useConfigStore } from "@/stores/use-config-store";
import { useModelCatalogStore } from "@/stores/use-model-catalog-store";
import { CanvasConfigNodePanel } from "@/components/canvas/canvas-config-node-panel";
import { CanvasNode } from "@/components/canvas/canvas-node";
import { InfiniteCanvas } from "@/components/canvas/infinite-canvas";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { AppConfigPanel } from "@/components/layout/app-config-modal";
import { CanvasConfigComposer } from "@/components/canvas/canvas-config-composer";
import { CanvasPromptChipInput } from "@/components/canvas/canvas-prompt-chip-input";
import { buildNodeGenerationContext, buildNodeGenerationInputs } from "@/components/canvas/canvas-node-generation";
import { buildNodeMentionReferences } from "@/lib/canvas/canvas-resource-references";

await useConfigStore.persist.rehydrate();
useConfigStore.getState().replaceConfig({ ...defaultConfig, channels: [{ ...defaultConfig.channels[0], apiKey: "fixture-model-key", models: [] }] });
Object.assign(window, { modelTest: {
    state: () => ({ ...useModelCatalogStore.getState(), config: useConfigStore.getState().config }),
    expire: () => queryClient.invalidateQueries({ queryKey: ["oneyes-model-catalog"], refetchType: "none" }),
    sync: () => useModelCatalogStore.getState().sync(),
    video: () => useConfigStore.getState().replaceConfig({ ...useConfigStore.getState().config, channels: [
        { ...defaultConfig.channels[0], apiKey: "fixture-model-key", models: [] },
        { ...defaultConfig.channels[0], id: GROK_VIDEO_CHANNEL_ID, apiKey: "fixture-model-key", models: [] },
    ], videoModel: `${GROK_VIDEO_CHANNEL_ID}::grok-imagine-video` }),
    request: () => {
        const config = useConfigStore.getState().config;
        return resolveModelRequestConfig(config, config.videoModel);
    },
    restore: () => useConfigStore.persist.rehydrate(),
    checked: (name: string) => (Array.from(document.querySelectorAll("label.ant-checkbox-wrapper")).find(label => label.textContent?.trim() === name)?.querySelector("input") as HTMLInputElement)?.checked,
    toggle: (name: string) => (Array.from(document.querySelectorAll("label.ant-checkbox-wrapper")).find(label => label.textContent?.trim() === name)?.querySelector("input") as HTMLInputElement)?.click(),
} });
function Probe() {
    useModelCatalogSync();
    const config = useConfigStore(state => state.config);
    const [open, setOpen] = useState(false);
    const [canvas, setCanvas] = useState(false);
    const [mentions, setMentions] = useState(false);
    const [clipboard, setClipboard] = useState<React.ReactNode>(null);
    Object.assign(window, { showClipboardCanvas: async () => { const fixture = await import("./canvas-clipboard"); await fixture.prepareClipboardCanvas(); flushSync(() => setClipboard(<fixture.ClipboardCanvas />)); } });
    if (clipboard) return clipboard;
    Object.assign(window, { showModelCanvas: () => flushSync(() => setCanvas(true)), showMentionPreferences: () => flushSync(() => setMentions(true)) });
    if (mentions) return <MentionPreferences />;
    if (canvas) return <ConfigCanvas />;
    return <div className="p-6">
        <ModelPicker config={config} value={config.textModel} capability="text" onChange={value => useConfigStore.getState().updateConfig("textModel", value)} />
        <div data-testid="video-picker"><ModelPicker config={config} value={config.videoModel} capability="video" onChange={value => useConfigStore.getState().updateConfig("videoModel", value)} /></div>
        <Button data-testid="open-models" onClick={() => setOpen(true)}>管理模型</Button>
        <ChannelEditorDrawer open={open} channel={config.channels[0]} onClose={() => setOpen(false)} onSave={channel => useConfigStore.getState().replaceConfig({ ...useConfigStore.getState().config, channels: [channel] })} />
    </div>;
}

function MentionPreferences() {
    const makeImage = (color: string) => {
        const canvas = document.createElement("canvas"); canvas.width = canvas.height = 8;
        const context = canvas.getContext("2d")!; context.fillStyle = color; context.fillRect(0, 0, 8, 8);
        return canvas.toDataURL();
    };
    const [image, setImage] = useState(() => makeImage("red"));
    const [composer, setComposer] = useState("参考 @[node:image] 和 @[node:image] 继续写");
    const [prompt, setPrompt] = useState("参考 图片1 和 图片1 继续写");
    const edits = useRef(0);
    const nodes: CanvasNodeData[] = [
        { id: "image", type: CanvasNodeType.Image, title: "参考图", position: { x: 0, y: 0 }, width: 8, height: 8, metadata: { content: image } },
        { id: "config", type: CanvasNodeType.Config, title: "配置", position: { x: 0, y: 0 }, width: 300, height: 200, metadata: { composerContent: composer } },
    ];
    const connections = [{ id: "reference", fromNodeId: "image", toNodeId: "config" }];
    Object.assign(window, { mentionTest: {
        replace: (color: string) => flushSync(() => setImage(makeImage(color))),
        state: () => ({ image, composer, prompt, edits: edits.current, context: buildNodeGenerationContext("config", nodes, connections, composer) }),
    } });
    return <main className="p-4">
        <div className="grid grid-cols-2 gap-4">
            <div data-testid="mention-composer"><CanvasConfigComposer nodeId="config" nodes={nodes} value={composer} inputs={buildNodeGenerationInputs("config", nodes, connections)} onChange={value => { edits.current++; setComposer(value); }} onClose={() => {}} /></div>
            <div data-testid="mention-prompt"><CanvasPromptChipInput value={prompt} references={buildNodeMentionReferences(nodes[1], nodes, connections)} onChange={value => { edits.current++; setPrompt(value); }} className="min-h-28 p-3" /></div>
        </div>
        <AppConfigPanel initialTab="preferences" />
    </main>;
}

function ConfigCanvas() {
    const container = useRef<HTMLDivElement>(null), events = useRef({ drag: 0, background: 0, viewport: 0 });
    const [frame, setFrame] = useState({ scale: 1, x: 40, y: 40 });
    const [node, setNode] = useState<CanvasNodeData>({ id: "config", type: CanvasNodeType.Config, title: "生成配置", position: { x: 0, y: 0 }, width: 600, height: 250, metadata: { generationMode: "video", model: `${GROK_VIDEO_CHANNEL_ID}::grok-imagine-video` } });
    Object.assign(window, { modelNodeTest: {
        state: () => node,
        events: () => events.current,
        configure: (scale: number, x: number, y: number, dark: boolean) => flushSync(() => { setFrame({ scale, x, y }); setNode(previous => ({ ...previous, metadata: { ...previous.metadata, model: "default::sd-2.5-fullblood" } })); useThemeStore.getState().setTheme(dark ? "dark" : "light"); events.current = { drag: 0, background: 0, viewport: 0 }; }),
    } });
    const props = { scale: frame.scale, isSelected: true, isRelated: false, isFocusRelated: false, isConnectionTarget: false, isConnecting: false, showPanel: false, showImageInfo: false,
        onMouseDown: (event: React.MouseEvent) => { event.stopPropagation(); events.current.drag++; }, onHoverStart: () => {}, onHoverEnd: () => {}, onConnectStart: () => {}, onResizeStart: () => {}, onResize: () => {}, onResizeEnd: () => {}, onContentChange: () => {}, onTitleChange: () => {}, onContextMenu: () => {} };
    return <main style={{ height: "100vh" }}><InfiniteCanvas containerRef={container} viewport={{ x: frame.x, y: frame.y, k: frame.scale }} tool="select" onViewportChange={() => { events.current.viewport++; }} onCanvasMouseDown={() => { events.current.background++; }}>
        <CanvasNode {...props} data={node} renderNodeContent={current => <CanvasConfigNodePanel node={current} isRunning={false} inputSummary={{ textCount: 0, imageCount: 0, videoCount: 0, audioCount: 0 }} videoInputs={{ imageCount: 0, videoCount: 0, audioCount: 0 }} onConfigChange={(_id, patch) => setNode(previous => ({ ...previous, metadata: { ...previous.metadata, ...patch } }))} onGenerate={() => {}} onStop={() => {}} onComposerToggle={() => {}} />} />
        <CanvasNode {...props} data={{ id: "overlap", type: CanvasNodeType.Text, title: "相邻节点", position: { x: 0, y: 245 }, width: 600, height: 120, metadata: { content: "下拉菜单应在相邻节点之上" } }} />
    </InfiniteCanvas></main>;
}
function Providers() {
    const theme = useThemeStore(state => state.theme);
    useEffect(() => { document.documentElement.classList.toggle("dark", theme === "dark"); document.documentElement.style.colorScheme = theme; }, [theme]);
    return <ConfigProvider theme={getAntThemeConfig(theme === "dark")}><App><Probe /></App></ConfigProvider>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><Providers /></React.StrictMode>);
