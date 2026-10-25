import { create } from "zustand";
export type DesktopUpdateState = {
    status: 'idle' | 'checking' | 'current' | 'downloading' | 'ready' | 'installing' | 'error';
    currentVersion: string; version: string; progress: number; downloaded: number; total: number; notes: string; error: string; supported: boolean;
};
export const useDesktopUpdateStore = create<DesktopUpdateState>(() => ({ status: 'idle', currentVersion: __APP_VERSION__.replace(/^v/, ''), version: '', progress: 0, downloaded: 0, total: 0, notes: '', error: '', supported: true }));
export async function desktopUpdate(operation: 'check' | 'install') {
    const updates = window.oneYesDesktop?.updates;
    if (!updates) return;
    try { useDesktopUpdateStore.setState(await updates.call(operation)); }
    catch { useDesktopUpdateStore.setState({ status: 'error', error: '无法连接更新服务，请重试' }); }
}
