import React from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import "@/i18n";
import "@/styles/globals.css";
import { DesktopUpdate } from "@/components/layout/desktop-update";
import { useDesktopUpdateStore, type DesktopUpdateState } from "@/stores/use-desktop-update-store";
import { useAgentStore } from "@/stores/use-agent-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { localForageStorage } from "@/lib/localforage-storage";
import { getAntThemeConfig } from "@/lib/app-theme";
let subscriber: (state: DesktopUpdateState) => void;
const operations: string[] = [];
const state: DesktopUpdateState = { status: 'ready', currentVersion: '0.20.20', version: '0.20.21', progress: 100, downloaded: 100, total: 100, notes: '支持签名 OTA，后台下载后点击即可更新。', error: '', supported: true, mode: 'full' };
Object.assign(window, { oneYesDesktop: { updates: { call: async (op: string) => { operations.push(op); return state; }, subscribe: (next: typeof subscriber) => { subscriber = next; return () => {}; } } }, updateTest: {
    status: (status: DesktopUpdateState['status']) => { state.status = status; state.progress = status === 'downloading' ? 36 : 100; subscriber({ ...state }); },
    state: () => ({ ...useDesktopUpdateStore.getState(), operations }),
    agentBusy: (busy: boolean) => useAgentStore.setState({ waiting: busy }),
    saved: async () => JSON.parse(await localForageStorage.getItem('infinite-canvas:canvas_store') || '{}').state?.projects?.[0]?.title,
    theme: (dark: boolean) => { document.documentElement.classList.toggle('dark', dark); },
} });
useCanvasStore.setState({ hydrated: true, projects: [{ id: 'ota-fixture', title: 'OTA 未落盘画布', createdAt: '', updatedAt: '', nodes: [], connections: [], chatSessions: [], activeChatId: null, backgroundMode: 'lines', showImageInfo: false, viewport: { x: 0, y: 0, k: 1 } }] });
createRoot(document.getElementById('root')!).render(<ConfigProvider theme={getAntThemeConfig(false)}><App><div className="min-h-screen bg-background p-8 text-foreground"><h1 className="text-xl font-medium">OneYes Canvas</h1><p className="mt-2 text-sm text-muted-foreground">更新在后台准备，继续完成手头的创作。</p><DesktopUpdate /></div></App></ConfigProvider>);
