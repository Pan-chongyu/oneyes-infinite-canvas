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
import { imageTasks, initializeImageTasks, useImageTaskStore } from '@/stores/use-image-task-store';
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
Object.assign(window, { deliveryTest: {
    state: () => useImageTaskStore.getState().tasks,
    slowReads: () => slowReads,
    start: () => {
        void imageCredentialFingerprint('fixture-private-key').then(credential => imageTasks.submit({
            id: 'fast', credential, model: config.model, prompt: '快速取图', logId: 'fast', createdAt: Date.now(), target: { projectId, nodeId: 'fast' },
            config: { model: config.model, imageModel: config.imageModel, size: config.size, quality: config.quality, count: '1' },
        }, '/images/generations/async', { model: 'gpt-image-2', prompt: '快速取图' }, 'fixture-private-key')).catch(error => console.error(error));
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
