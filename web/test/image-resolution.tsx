import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import "@/i18n";
import "@/styles/globals.css";
import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { defaultConfig, useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { requestEdit, requestGeneration } from "@/services/api/image";
import { storeGeneratedImage } from "@/stores/use-image-task-store";
import { CanvasConfigNodePanel } from "@/components/canvas/canvas-config-node-panel";
import { buildGenerationConfig, generationModePatch } from "@/lib/canvas/node-generation-config";
import { applyNodeConfigPatch } from "@/lib/canvas/canvas-node-factory";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const requests: Array<{ size?: string; gemini?: unknown; edit: boolean }> = [];
// Capture the real axios request builder; no request may leave this fixture.
axios.defaults.adapter = async request => {
    const edit = request.data instanceof FormData;
    const body = edit ? undefined : typeof request.data === "string" ? JSON.parse(request.data) : request.data;
    requests.push({ size: edit ? request.data.get("size") : body?.size, gemini: body?.generationConfig?.imageConfig, edit });
    return { data: body?.contents ? { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: pixel } }] } }] } : { data: [{ b64_json: pixel }] }, status: 200, statusText: "OK", config: request, headers: {} };
};
const base: AiConfig = { ...defaultConfig, size: "1k@16:9", count: "1", model: "fixture::gpt-image-2", imageModel: "fixture::gpt-image-2", videoModel: "fixture::grok-imagine-video", channels: [{ ...defaultConfig.channels[0], id: "fixture", apiKey: "fixture-only-key", baseUrl: "https://fixture.invalid/v1", models: [{ name: "gpt-image-2", capability: "image" }, { name: "grok-imagine-video", capability: "video" }] }] };
const referenceCanvas = document.createElement("canvas");
referenceCanvas.width = 12; referenceCanvas.height = 8;
referenceCanvas.getContext("2d")!.fillRect(0, 0, 12, 8);
const reference = { id: "ref", name: "reference.png", type: "image/png", dataUrl: referenceCanvas.toDataURL("image/png") };
function Fixture() {
    const [config, setConfig] = useState<AiConfig>(base);
    const [dark, setDark] = useState(true);
    const [showNode, setShowNode] = useState(false);
    const [node, setNode] = useState<CanvasNodeData>({ id: "resolution-node", type: CanvasNodeType.Config, title: "生成配置", position: { x: 0, y: 0 }, width: 400, height: 260, metadata: { generationMode: "image", size: "4k@16:9", prompt: "fixture" } });
    const active = showNode ? buildGenerationConfig(config, node, node.metadata?.generationMode || "image") : config;
    Object.assign(window, { resolutionTest: {
        size: () => active.size,
        node: () => node,
        showNode: () => { useConfigStore.setState({ config: base }); setConfig(base); setShowNode(true); },
        videoSize: () => setNode(previous => applyNodeConfigPatch(previous, { size: "9:16", vquality: "720" })),
        copyNode: () => setNode(previous => ({ ...JSON.parse(JSON.stringify(previous)), id: "copy" })),
        mode: (mode: "image" | "video" | "text" | "audio") => setNode(previous => applyNodeConfigPatch(previous, generationModePatch(config, previous, mode))),
        custom: () => { setShowNode(false); setConfig({ ...base, size: "1600x1008" }); },
        requests: () => requests,
        theme: (value: boolean) => { setDark(value); document.documentElement.classList.toggle("dark", value); },
        reset: () => setConfig(base),
        gemini: () => setConfig({ ...config, model: "fixture::gemini-3-pro-image-preview", channels: [{ ...base.channels[0], apiFormat: "gemini" }] }),
        generate: async (edit: boolean) => {
            const result = edit ? await requestEdit(active, "fixture", [reference]) : await requestGeneration(active, "fixture");
            const stored = await storeGeneratedImage(result[0]);
            return { width: stored.width, height: stored.height, warning: stored.resolutionWarning };
        },
        reject: async () => { try { await requestGeneration(config, "must not submit"); return "unexpected success"; } catch (error) { return (error as Error).message; } },
    } });
    return <main>{showNode ? <div style={{ width: 450, height: 320 }}><CanvasConfigNodePanel node={node} isRunning={false} inputSummary={{ textCount: 1, imageCount: 0, videoCount: 0, audioCount: 0 }} videoInputs={{ imageCount: 0, videoCount: 0, audioCount: 0 }} onConfigChange={(_id, patch) => setNode(previous => applyNodeConfigPatch(previous, patch))} onGenerate={() => {}} onStop={() => {}} onComposerToggle={() => {}} /></div> : <ImageSettingsPanel config={config} onConfigChange={(key, value) => setConfig(previous => ({ ...previous, [key]: value }))} theme={canvasThemes[dark ? "dark" : "light"]} />}</main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
