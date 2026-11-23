import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import "@/i18n";
import "@/styles/globals.css";
import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { defaultConfig, type AiConfig } from "@/stores/use-config-store";
import { requestEdit, requestGeneration } from "@/services/api/image";
import { storeGeneratedImage } from "@/stores/use-image-task-store";

const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const requests: Array<{ size?: string; gemini?: unknown; edit: boolean }> = [];
// Capture the real axios request builder; no request may leave this fixture.
axios.defaults.adapter = async request => {
    const edit = request.data instanceof FormData;
    const body = edit ? undefined : typeof request.data === "string" ? JSON.parse(request.data) : request.data;
    requests.push({ size: edit ? request.data.get("size") : body?.size, gemini: body?.generationConfig?.imageConfig, edit });
    return { data: body?.contents ? { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: pixel } }] } }] } : { data: [{ b64_json: pixel }] }, status: 200, statusText: "OK", config: request, headers: {} };
};
const base = { ...defaultConfig, size: "1k@16:9", count: "1", model: "fixture::gpt-image-2", imageModel: "fixture::gpt-image-2", channels: [{ ...defaultConfig.channels[0], id: "fixture", apiKey: "fixture-only-key", baseUrl: "https://fixture.invalid/v1" }] };
const referenceCanvas = document.createElement("canvas");
referenceCanvas.width = 12; referenceCanvas.height = 8;
referenceCanvas.getContext("2d")!.fillRect(0, 0, 12, 8);
const reference = { id: "ref", name: "reference.png", type: "image/png", dataUrl: referenceCanvas.toDataURL("image/png") };
function Fixture() {
    const [config, setConfig] = useState<AiConfig>(base);
    const [dark, setDark] = useState(true);
    Object.assign(window, { resolutionTest: {
        size: () => config.size,
        requests: () => requests,
        theme: (value: boolean) => { setDark(value); document.documentElement.classList.toggle("dark", value); },
        reset: () => setConfig(base),
        gemini: () => setConfig({ ...config, model: "fixture::gemini-3-pro-image-preview", channels: [{ ...base.channels[0], apiFormat: "gemini" }] }),
        generate: async (edit: boolean) => {
            const result = edit ? await requestEdit(config, "fixture", [reference]) : await requestGeneration(config, "fixture");
            const stored = await storeGeneratedImage(result[0]);
            return { width: stored.width, height: stored.height, warning: stored.resolutionWarning };
        },
        reject: async () => { try { await requestGeneration(config, "must not submit"); return "unexpected success"; } catch (error) { return (error as Error).message; } },
    } });
    return <main><ImageSettingsPanel config={config} onConfigChange={(key, value) => setConfig(previous => ({ ...previous, [key]: value }))} theme={canvasThemes[dark ? "dark" : "light"]} /></main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
