import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import "antd/dist/reset.css";
import "streamdown/styles.css";
import "@/i18n";
import "@/styles/globals.css";
import { DesktopUpdate } from "@/components/layout/desktop-update";
import { CanvasTopBar } from "@/components/canvas/canvas-top-bar";
import { useThemeStore } from "@/stores/use-theme-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { useDesktopUpdateStore, type DesktopUpdateState } from "@/stores/use-desktop-update-store";
import { useAgentStore } from "@/stores/use-agent-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { localForageStorage } from "@/lib/localforage-storage";
import { getAntThemeConfig } from "@/lib/app-theme";
let subscriber: (state: DesktopUpdateState) => void;
const operations: string[] = [];
let saveGate: Promise<void> | undefined, releaseSave: (() => void) | undefined;
let showCanvas: (value: boolean) => void;
const setItem = localForageStorage.setItem;
localForageStorage.setItem = async (key, value) => { if (key === 'infinite-canvas:canvas_store') await saveGate; return setItem(key, value); };
const state: DesktopUpdateState = { status: 'ready', currentVersion: '0.20.20', version: '0.20.21', progress: 100, downloaded: 100, total: 100, notes: '支持签名 OTA，后台下载后点击即可更新。', error: '', supported: true, mode: 'full' };
Object.assign(window, { oneYesDesktop: { updates: { call: async (op: string) => { operations.push(op); return state; }, subscribe: (next: typeof subscriber) => { subscriber = next; return () => {}; } } }, updateTest: {
    status: (status: DesktopUpdateState['status'], supported = true, phase: DesktopUpdateState['phase'] = '') => { state.status = status; state.phase = phase; state.supported = supported; state.progress = status === 'downloading' ? 36 : 100; subscriber({ ...state }); },
    state: () => ({ ...useDesktopUpdateStore.getState(), operations }),
    agentBusy: (busy: boolean) => useAgentStore.setState({ waiting: busy }),
    pauseSave: () => { saveGate = new Promise(resolve => { releaseSave = resolve; }); },
    resumeSave: () => { releaseSave?.(); saveGate = undefined; },
    saved: async () => JSON.parse(await localForageStorage.getItem('infinite-canvas:canvas_store') || '{}').state?.projects?.[0]?.title,
    theme: (dark: boolean) => { document.documentElement.classList.toggle('dark', dark); useThemeStore.setState({ theme: dark ? 'dark' : 'light' }); },
    canvas: () => showCanvas(true),
} });
useCanvasStore.setState({ hydrated: true, projects: [{ id: 'ota-fixture', title: 'OTA 未落盘画布', createdAt: '', updatedAt: '', nodes: [], connections: [], chatSessions: [], activeChatId: null, backgroundMode: 'lines', showImageInfo: false, viewport: { x: 0, y: 0, k: 1 } }] });
function Fixture() {
    const [canvas, setCanvas] = useState(false); showCanvas = setCanvas;
    const dark = useThemeStore(state => state.theme) === 'dark', theme = canvasThemes[dark ? 'dark' : 'light'];
    const noop = () => {};
    return <ConfigProvider theme={getAntThemeConfig(dark)}><App>{canvas ? <main className="relative h-screen overflow-hidden" style={{ background: theme.canvas.background, color: theme.node.text }}>
        <CanvasTopBar title="创作画布 · 很长的项目标题用于检查顶部布局" titleDraft="" isTitleEditing={false} onTitleDraftChange={noop} onStartTitleEditing={noop} onFinishTitleEditing={noop} onCancelTitleEditing={noop} canUndo={false} canRedo={false} onHome={noop} onProjects={noop} onCreateProject={noop} onDeleteProject={noop} onExportProject={noop} onImportImage={noop} onOpenPlugins={noop} onUndo={noop} onRedo={noop} agentOpen={false} compactAgentStatus={{ connected: false, enabled: false, activity: '' }} onToggleAgent={noop} />
        <p data-update-outside className="absolute bottom-8 left-8">画布工作区</p>
    </main> : <div className="min-h-screen bg-background p-8 text-foreground"><h1 className="text-xl font-medium">OneYes Canvas</h1><p className="mt-2 text-sm text-muted-foreground">更新在后台准备，继续完成手头的创作。</p><DesktopUpdate /></div>}</App></ConfigProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
