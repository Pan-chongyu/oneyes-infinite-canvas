import React from 'react';
import { createRoot } from 'react-dom/client';
import { App, ConfigProvider } from 'antd';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import localforage from 'localforage';
import '@/i18n';
import '@/styles/globals.css';
import CanvasProject from '@/pages/canvas/project';
import { defaultConfig, useConfigStore } from '@/stores/use-config-store';
import { imageTasks, initializeImageTasks, useImageTaskStore, useImageTransferStore } from '@/stores/use-image-task-store';
import { useThemeStore } from '@/stores/use-theme-store';
import { useCanvasStore, flushCanvasStorage } from '@/stores/canvas/use-canvas-store';
import { getImageBlob, uploadImage } from '@/services/image-storage';
import { CanvasNodeType, type CanvasNodeData } from '@/types/canvas';
import { imageCredentialFingerprint, type ImageTask } from '@/services/api/image-tasks';

await useConfigStore.persist.rehydrate();
await useCanvasStore.persist.rehydrate();
const config = { ...defaultConfig, model: 'default::gpt-image-2', imageModel: 'default::gpt-image-2', channels: [{ ...defaultConfig.channels[0], apiKey: 'fixture-private-key' }] };
useConfigStore.setState({ config });
const projectId = useCanvasStore.getState().createProject('逐张取回回归');
const ids = ['unreadable', 'slow', 'fast'];
const nodes: CanvasNodeData[] = ids.map((id, index) => ({ id, type: CanvasNodeType.Image, title: id, position: { x: 40 + index * 330, y: 100 }, width: 280, height: 280, metadata: { imageTaskId: id, status: 'loading' } }));
useCanvasStore.getState().updateProject(projectId, { nodes });
await flushCanvasStorage();
const tasks = localforage.createInstance({ name: 'infinite-canvas', storeName: 'image_tasks' });
for (const id of ids.slice(0, 2)) await tasks.setItem<ImageTask>(id, {
    id, remoteId: `imgtask_${id}`, credential: '', model: config.model, prompt: '', logId: id, createdAt: Date.now(), pollMs: 2500,
    config: { model: config.model, imageModel: config.imageModel, size: config.size, quality: config.quality, count: '1' },
    target: { projectId, nodeId: id }, expectedImages: 1, status: 'completed',
    images: [{ id, storageKey: `image:${id}`, width: 1, height: 1, bytes: 1, mimeType: 'image/png', resultIndex: 0 }],
});

// Block only this missing original's read at the IndexedDB boundary. Other
// reads still use real IDB, decoding and object URLs; no renderer fetch mocks.
let releaseSlow!: () => void, slowReads = 0;
const slowGate = new Promise<void>(resolve => { releaseSlow = resolve; });
const originalGet = IDBObjectStore.prototype.get;
IDBObjectStore.prototype.get = function (key) {
    const request = originalGet.call(this, key);
    if (this.name !== 'image_files' || key !== 'image:slow') return request;
    slowReads++;
    let onSuccess: ((event: Event) => void) | null = null;
    request.addEventListener('success', event => { void slowGate.then(() => onSuccess?.call(request, event)); });
    Object.defineProperty(request, 'onsuccess', { configurable: true, get: () => onSuccess, set: handler => { onSuccess = handler; } });
    return request;
};
initializeImageTasks();
let releaseMetadata!: () => void, releaseWrite!: () => void, metadataBlocked = false, writeSettled = false;
const metadataGate = new Promise<void>(resolve => { releaseMetadata = resolve; });
const writeGate = new Promise<void>(resolve => { releaseWrite = resolve; });
const NativeImage = window.Image, nativePut = IDBObjectStore.prototype.put;
Object.assign(window, { deliveryTest: {
    state: () => useImageTaskStore.getState().tasks,
    progress: () => useImageTransferStore.getState().transfers.fast?.[0],
    blocked: () => ({ metadataBlocked, writeSettled }),
    theme: (theme: 'light' | 'dark') => useThemeStore.setState({ theme }),
    slowReads: () => slowReads,
    start: () => {
        window.Image = new Proxy(NativeImage, { construct(target, args) {
            const image = Reflect.construct(target, args) as HTMLImageElement;
            let onLoad: ((event: Event) => void) | null = null;
            image.addEventListener('load', event => { metadataBlocked = true; void metadataGate.then(() => onLoad?.call(image, event)); });
            Object.defineProperty(image, 'onload', { configurable: true, get: () => onLoad, set: callback => { onLoad = callback; } });
            return image;
        } });
        IDBObjectStore.prototype.put = function (value, key) {
            const request = nativePut.call(this, value, key);
            if (this.name !== 'image_files' || key !== 'image:task-fast-0') return request;
            const transaction = this.transaction;
            let onSuccess: ((event: Event) => void) | null = null;
            transaction.addEventListener('complete', event => { writeSettled = true; void writeGate.then(() => onSuccess?.call(transaction, event)); });
            Object.defineProperty(transaction, 'oncomplete', { configurable: true, get: () => onSuccess, set: callback => { onSuccess = callback; } });
            return request;
        };
        void imageCredentialFingerprint('fixture-private-key').then(credential => imageTasks.submit({
            id: 'fast', credential, model: config.model, prompt: '快速取图', logId: 'fast', createdAt: Date.now(), target: { projectId, nodeId: 'fast' },
            config: { model: config.model, imageModel: config.imageModel, size: config.size, quality: config.quality, count: '1' },
        }, '/images/generations/async', { model: 'gpt-image-2', prompt: '快速取图' }, 'fixture-private-key')).catch(error => console.error(error));
    },
    releaseMetadata: () => { window.Image = NativeImage; releaseMetadata(); },
    releaseWrite: () => { IDBObjectStore.prototype.put = nativePut; releaseWrite(); },
    pendingOriginal: async () => Array.from(new Uint8Array(await (await getImageBlob('image:task-fast-0'))!.arrayBuffer())),
    invalidOriginal: async () => {
        let displayed = false, failed = false;
        try { await uploadImage(new Blob(['not an image'], { type: 'image/png' }), { storageKey: 'image:invalid-delivery', onProgress: value => { displayed ||= !!value.image; } }); }
        catch { failed = true; }
        return { failed, displayed, stored: !!await getImageBlob('image:invalid-delivery') };
    },
    bytes: async () => {
        const task = useImageTaskStore.getState().tasks.find(task => task.target?.nodeId === 'fast');
        const blob = task?.images[0] && await getImageBlob(task.images[0].storageKey);
        return blob ? Array.from(new Uint8Array(await blob.arrayBuffer())) : [];
    },
    releaseSlow: () => { IDBObjectStore.prototype.get = originalGet; releaseSlow(); },
    warmCache: async () => {
        const task = useImageTaskStore.getState().tasks.find(task => task.target?.nodeId === 'fast')!;
        const native = IDBObjectStore.prototype.get;
        let reads = 0;
        IDBObjectStore.prototype.get = function (key) { if (this.name === 'image_files' && key === task.images[0].storageKey) reads++; return native.call(this, key); };
        try {
            const images = await Promise.all(Array.from({ length: 20 }, () => uploadImage('https://images.example.test/never-refetch.png', { storageKey: task.images[0].storageKey })));
            return { reads, dimensions: images.map(image => [image.width, image.height]) };
        } finally { IDBObjectStore.prototype.get = native; }
    },
} });
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[`/canvas/${projectId}`]}><ConfigProvider><App><Routes><Route path="/canvas/:id" element={<CanvasProject />} /></Routes></App></ConfigProvider></MemoryRouter></QueryClientProvider>);
