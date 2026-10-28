import React from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/i18n";
import "@/styles/globals.css";
import CanvasProject from "@/pages/canvas/project";
import { requestEdit } from "@/services/api/image";
import { prepareReferenceFiles } from "@/services/api/image-references";
import { defaultConfig, useConfigStore } from "@/stores/use-config-store";
import { imageTasks, initializeImageTasks, useImageTaskStore } from "@/stores/use-image-task-store";
import { getImageBlob, uploadImage } from "@/services/image-storage";
import { useCanvasStore, flushCanvasStorage } from "@/stores/canvas/use-canvas-store";
import { markCanvasImageTask } from "@/lib/canvas/canvas-image-task";
import { CanvasNodeType } from "@/types/canvas";
import decodeWebP, { init as initWebPDecoder } from "@jsquash/webp/decode";
import decoderWasm from "@jsquash/webp/codec/dec/webp_dec.wasm?url";

// No renderer fetch mocks: the fixture serves the actual native API and image
// download routes, including an image server with no CORS permission.
await useConfigStore.persist.rehydrate();
await useCanvasStore.persist.rehydrate();
const submit = new URLSearchParams(location.search).has("submit");
const expectedReferences: Array<{ hash: string; width: number; height: number; bytes: number }> = [];
async function imagePixels(blob: Blob, losslessUpload = false) {
    const digest = async (bytes: Uint8ClampedArray) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
    if (losslessUpload) {
        // Compare raw RGBA to avoid the browser's format-dependent rounding when
        // it premultiplies transparent WebP pixels for display a second time.
        await initWebPDecoder({ locateFile: () => decoderWasm });
        const pixels = await decodeWebP(await blob.arrayBuffer());
        return { hash: await digest(pixels.data), width: pixels.width, height: pixels.height };
    }
    const bitmap = await createImageBitmap(blob);
    try {
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d")!;
        context.drawImage(bitmap, 0, 0);
        const bytes = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
        const hash = await digest(bytes);
        return { hash, width: bitmap.width, height: bitmap.height };
    } finally { bitmap.close(); }
}
const invalidReferenceErrors: string[] = [];
let canceled = false;
if (submit) {
    const config = { ...defaultConfig, model: "default::gpt-image-2", imageModel: "default::gpt-image-2", channels: [{ ...defaultConfig.channels[0], apiKey: "fixture-private-key" }] };
    useConfigStore.setState({ config });
    // Wait for the real encrypted IPC storage, as the next process must restore it.
    await window.oneYesDesktop!.storage.setItem("infinite-canvas:ai_config_store", JSON.stringify({ state: { config }, version: 0 }));
    const projectId = useCanvasStore.getState().createProject("重启恢复画布");
    useCanvasStore.getState().updateProject(projectId, { nodes: [{ id: "restart-node", type: CanvasNodeType.Image, title: "重启恢复", position: { x: 100, y: 100 }, width: 320, height: 320, metadata: { status: "loading", images: [{ id: "slot", status: "loading", content: "", naturalWidth: 0, naturalHeight: 0, bytes: 0, mimeType: "" }] } }] });
    await flushCanvasStorage();
    const target = { projectId, nodeId: "restart-node", imageId: "slot" };
    const source = document.createElement("canvas");
    source.width = 12; source.height = 8;
    const context = source.getContext("2d")!;
    context.fillStyle = "#6e93ff"; context.fillRect(0, 0, 6, 8);
    context.fillStyle = "rgba(204,100,20,0.5)"; context.fillRect(6, 0, 3, 8);
    const references = [];
    for (const [index, type] of ["image/png", "image/jpeg", "image/webp"].entries()) {
        let original = await (await fetch(source.toDataURL(type))).blob();
        if (type === "image/jpeg") {
            // Valid EXIF orientation=6 and an APP2 MPF extension, with synthetic pixels.
            const bytes = new Uint8Array(await original.arrayBuffer());
            const metadata = Uint8Array.from([255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0,255,226,0,10,77,80,70,0,0,0,0,0]);
            original = new Blob([bytes.slice(0, 2), metadata, bytes.slice(2)], { type });
        }
        // An object-store result may be labelled as binary, and canvas node names
        // may all have a .png extension despite the actual image format.
        const stored = await uploadImage(new Blob([original], { type: index === 0 ? "application/octet-stream" : "image/png" }));
        references.push({ id: `ref-${index}`, name: "同名图片.png", type: "image/png", dataUrl: stored.url, storageKey: stored.storageKey });
    }
    const gif = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    references.push({ id: "ref-gif", name: "同名图片.png", type: "image/png", dataUrl: gif });
    if (new URLSearchParams(location.search).has("realReferences")) {
        references.length = 0;
        const count = await (await fetch("/fixture-references")).json();
        for (let index = 0; index < count; index++) {
            const stored = await uploadImage(await (await fetch(`/fixture-references/${index}`)).blob());
            references.push({ id: `real-${index}`, name: "实际参考图.png", type: "image/png", dataUrl: stored.url, storageKey: stored.storageKey });
        }
    }
    for (const reference of references) {
        const blob = reference.storageKey ? (await getImageBlob(reference.storageKey))! : await (await fetch(reference.dataUrl)).blob();
        expectedReferences.push({ ...await imagePixels(blob), bytes: blob.size });
    }
    for (const bad of [
        { id: "bad", name: "损坏的图.png", type: "image/png", dataUrl: "data:image/png;base64,bm90IGFuIGltYWdl" },
        { ...references[0], name: "缓存丢失.png", storageKey: "image:missing" },
    ]) {
        try { await requestEdit(config, "不应提交损坏图片", [references[0], bad]); }
        catch (error) { invalidReferenceErrors.push((error as Error).message); }
    }
    const controller = new AbortController();
    const preparing = prepareReferenceFiles([references[0]], controller.signal);
    controller.abort();
    try { await preparing; } catch (error) { canceled = (error as Error).name === "AbortError"; }
    void requestEdit(config, "重启恢复", references, { taskTarget: target, onTask: async id => {
        const store = useCanvasStore.getState();
        store.updateProject(projectId, { nodes: markCanvasImageTask(store.openProject(projectId)!.nodes, target, id) });
        await flushCanvasStorage();
    } }).catch(() => {});
}
initializeImageTasks();
Object.assign(window, { restartTest: {
    state: () => useImageTaskStore.getState(),
    node: () => useCanvasStore.getState().projects[0].nodes[0],
    keyRestored: () => useConfigStore.getState().config.channels[0].apiKey === "fixture-private-key",
    flush: flushCanvasStorage,
    blob: async () => { const image = useImageTaskStore.getState().tasks[0]?.images[0]; return image && (await getImageBlob(image.storageKey))?.size; },
    refresh: () => imageTasks.refresh(useImageTaskStore.getState().tasks[0].id),
    validateUploads: async () => {
        const actual = [];
        for (let index = 0; index < expectedReferences.length; index++) {
            const blob = await (await fetch(`/fixture-uploads/${index}`)).blob();
            actual.push({ ...await imagePixels(blob, true), bytes: blob.size });
        }
        return { actual, expected: expectedReferences };
    },
    invalidReferenceErrors: () => invalidReferenceErrors,
    canceled: () => canceled,
} });
const projectId = useCanvasStore.getState().projects[0].id;
createRoot(document.getElementById("root")!).render(<React.StrictMode><QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[`/canvas/${projectId}`]}><ConfigProvider><App><Routes><Route path="/canvas/:id" element={submit ? <main>提交测试任务</main> : <CanvasProject />} /></Routes></App></ConfigProvider></MemoryRouter></QueryClientProvider></React.StrictMode>);
