import { useEffect, useState } from "react";
import { Download, RefreshCw, RotateCw, X } from "lucide-react";
import { App } from "antd";
import { desktopUpdate, useDesktopUpdateStore } from "@/stores/use-desktop-update-store";
import { useAgentStore } from "@/stores/use-agent-store";
import { flushCanvasStorage } from "@/stores/canvas/use-canvas-store";

export function DesktopUpdate() {
    const state = useDesktopUpdateStore();
    const [open, setOpen] = useState(false);
    const { message } = App.useApp();
    useEffect(() => {
        const api = window.oneYesDesktop?.updates;
        if (!api) return;
        const unsubscribe = api.subscribe(next => useDesktopUpdateStore.setState(next));
        void api.call('state').then(next => useDesktopUpdateStore.setState(next)).catch(() => useDesktopUpdateStore.setState({ status: 'error', error: '无法读取更新状态，请重试' }));
        return unsubscribe;
    }, []);
    if (!window.oneYesDesktop?.updates) return null;
    const busy = ['checking', 'downloading', 'installing'].includes(state.status);
    const ready = state.status === 'ready';
    const Icon = busy ? RotateCw : ready ? Download : RefreshCw;
    const label = ready ? `v${state.version} 已就绪` : state.status === 'downloading' ? `下载更新 ${state.progress}%` : state.status === 'checking' ? '检查更新中' : state.status === 'installing' ? '正在安装更新' : state.status === 'error' ? '更新遇到问题' : `v${state.currentVersion}`;
    const install = async () => {
        const agent = useAgentStore.getState();
        if (agent.sending || agent.waiting) { message.info('请等待当前对话任务结束后再更新'); return; }
        try { await flushCanvasStorage(); }
        catch { message.error('画布尚未保存成功，请重试后再更新'); return; }
        await desktopUpdate('install');
    };
    return <div className="fixed bottom-3 left-3 z-[1300] max-w-[calc(100vw-24px)] text-foreground" data-canvas-no-zoom>
        {open ? <section aria-label="软件更新" className="mb-2 w-[320px] max-w-full rounded-xl border border-border bg-popover p-4 shadow-lg">
            <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">软件更新</span><button onClick={() => setOpen(false)} className="rounded p-1 text-muted-foreground hover:text-foreground" aria-label="关闭更新面板"><X className="size-4" /></button></div>
            <p className="mb-0 mt-3 text-sm font-medium" aria-live="polite">{ready ? `新版本 v${state.version} 已下载完成` : label}</p>
            <p className="mb-0 mt-1 text-xs text-muted-foreground">当前版本 v{state.currentVersion}</p>
            {state.notes && ready ? <p className="mb-0 mt-3 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{state.notes}</p> : null}
            {state.error ? <p role="alert" className="mb-0 mt-3 text-xs leading-5 text-muted-foreground">{state.error}</p> : null}
            {state.status === 'downloading' ? <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={state.progress} aria-valuemin={0} aria-valuemax={100} aria-label="更新下载进度"><div className="h-full bg-foreground transition-[width] motion-reduce:transition-none" style={{ width: `${state.progress}%` }} /></div> : null}
            {ready ? <p className="mb-0 mt-3 text-xs text-muted-foreground">点击后安装并重新打开应用；请先结束正在运行的生成任务。</p> : null}
            <button disabled={busy || !state.supported} onClick={() => ready ? void install() : void desktopUpdate('check')} className="mt-4 flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary text-xs font-medium text-primary-foreground disabled:cursor-default disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Icon className={`size-3.5 ${busy ? 'animate-spin motion-reduce:animate-none' : ''}`} />{ready ? '更新并重启' : state.status === 'error' ? '重试更新' : busy ? label : '检查更新'}</button>
        </section> : null}
        <button onClick={() => setOpen(!open)} aria-expanded={open} title={ready ? `v${state.version} 已就绪，点击更新` : '软件更新'} className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${ready ? 'bg-popover text-foreground shadow-sm' : 'text-muted-foreground'}`}>
            <Icon className={`size-3 ${busy ? 'animate-spin motion-reduce:animate-none' : ''}`} /><span aria-live="polite">{label}</span>{ready ? <span className="size-1.5 rounded-full bg-emerald-500" /> : null}
        </button>
    </div>;
}
