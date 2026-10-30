import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App, ConfigProvider } from 'antd';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import 'antd/dist/reset.css';
import 'streamdown/styles.css';
import '@/i18n';
import '@/styles/globals.css';
import CanvasProject from '@/pages/canvas/project';
import { CanvasPluginManagerModal } from '@/components/canvas/canvas-plugin-manager-modal';
import { ensurePluginsLoaded, installPluginFromFile, setPluginEnabled, uninstallPlugin, builtinPlugins } from '@/lib/canvas/plugin-loader';
import { getNodeDefinition, getNodePluginId } from '@/lib/canvas/node-registry';
import { usePluginStore } from '@/stores/canvas/use-plugin-store';
import { useCanvasStore, flushCanvasStorage } from '@/stores/canvas/use-canvas-store';
import { useThemeStore } from '@/stores/use-theme-store';
import { localForageStorage } from '@/lib/localforage-storage';
import { getAntThemeConfig } from '@/lib/app-theme';
import sample from '../public/plugin-examples/quick-note.mjs?raw';

await useCanvasStore.persist.rehydrate();
if (!useCanvasStore.getState().projects.length) useCanvasStore.getState().createProject('插件安装回归');
await ensurePluginsLoaded();
const projectId = useCanvasStore.getState().projects[0].id;
const record = () => usePluginStore.getState().plugins.find(p => p.id === 'my-quick-note');
Object.assign(window, { pluginTest: {
    sample,
    state: () => usePluginStore.getState().plugins.map(({ source: _source, ...p }) => p),
    owner: (type = 'my-quick-note:note') => getNodePluginId(type),
    registered: () => !!getNodeDefinition('my-quick-note:note'),
    saved: async () => JSON.parse(await localForageStorage.getItem('infinite-canvas:plugin_store') || '{}').state?.plugins,
    install: async (source: string, name = 'test.mjs') => {
        try { await installPluginFromFile(new File([source], name)); return ''; } catch (error) { return (error as Error).message; }
    },
    builtinId: builtinPlugins[0].id,
    builtinType: builtinPlugins[0].nodes[0].type,
    toggle: (enabled: boolean) => setPluginEnabled(record()!, enabled),
    uninstall: (id = 'my-quick-note') => uninstallPlugin(id),
    seedNode: async () => {
        useCanvasStore.getState().updateProject(projectId, { nodes: [{ id: 'plugin-node', type: 'my-quick-note:note', title: '我的笔记', position: { x: 80, y: 100 }, width: 280, height: 200, metadata: { content: '离线重启后保留的笔记' } }] });
        await flushCanvasStorage();
    },
    theme: (dark: boolean) => { document.documentElement.classList.toggle('dark', dark); useThemeStore.getState().setTheme(dark ? 'dark' : 'light'); },
} });
function Fixture() {
    const [open, setOpen] = useState(false);
    const theme = useThemeStore(s => s.theme);
    return <ConfigProvider theme={getAntThemeConfig(theme === 'dark')}><App>
        <button onClick={() => setOpen(true)} data-test-plugins style={{ position: 'fixed', zIndex: 100, bottom: 8, right: 8 }}>插件安装测试</button>
        <CanvasPluginManagerModal open={open} onClose={() => setOpen(false)} />
        <Routes><Route path="/canvas/:id" element={<CanvasProject />} /></Routes>
    </App></ConfigProvider>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[`/canvas/${projectId}`]}><Fixture /></MemoryRouter></QueryClientProvider>);
