import { useEffect, useRef, useState } from "react";
import { Check, Download, RefreshCw, RotateCw, X } from "lucide-react";
import { App } from "antd";
import { desktopUpdate, useDesktopUpdateStore } from "@/stores/use-desktop-update-store";
import { useAgentStore } from "@/stores/use-agent-store";
import { flushCanvasStorage } from "@/stores/canvas/use-canvas-store";

export function DesktopUpdate() {
    const state = useDesktopUpdateStore();
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false), installing = useRef(false);
    const { message } = App.useApp();
    useEffect(() => {
        const api = window.oneYesDesktop?.updates;
        if (!api) return;
        const unsubscribe = api.subscribe(next => useDesktopUpdateStore.setState(next));
        void api.call('state').then(next => useDesktopUpdateStore.setState(next)).catch(() => useDesktopUpdateStore.setState({ status: 'error', error: '无法读取更新状态，请重试' }));
        return unsubscribe;
    }, []);
    if (!window.oneYesDesktop?.updates) return null;
    const busy = saving || ['checking', 'downloading', 'installing'].includes(state.status);
    const ready = state.status === 'ready';
    const Icon = busy ? RotateCw : ready ? Download : RefreshCw;
    const phaseLabel = state.phase ? { planning: '正在分析增量更新', reconstructing: '正在合成更新包', verifying: '正在校验更新包', saving: '正在保存剪辑项目', preparing: '正在准备安装', handoff: '正在转入安装窗口' }[state.phase] : '';
    const determinate = !saving && (state.status === 'downloading' && !state.phase || state.status === 'installing' && state.phase === 'verifying');
    const label = saving ? '正在保存画布…' : ready ? `v${state.version} 已就绪` : state.status === 'downloading' ? phaseLabel || `下载更新 ${state.progress}%` : state.status === 'checking' ? '检查更新中' : state.status === 'installing' ? phaseLabel || '正在安装更新' : state.status === 'error' ? '更新遇到问题' : `v${state.currentVersion}`;
    const step = saving || state.phase === 'saving' ? 1 : state.status === 'installing' ? 2 : ready ? 1 : 0;
    const install = async () => {
        if (installing.current) return;
        const agent = useAgentStore.getState();
        if (agent.sending || agent.waiting) { message.info('请等待当前对话任务结束后再更新'); return; }
        installing.current = true; setOpen(true); setSaving(true);
        try {
            try { await flushCanvasStorage(); }
            catch { message.error('画布尚未保存成功，请重试后再更新'); return; }
            setSaving(false);
            await desktopUpdate('install');
        } finally { installing.current = false; setSaving(false); }
    };
    return <div className="fixed bottom-3 left-3 z-[1300] max-w-[calc(100vw-24px)] text-foreground" data-canvas-no-zoom>
        {open ? <section aria-label="软件更新" className="mb-2 w-[280px] max-w-full rounded-xl border border-border bg-popover p-3 shadow-lg">
            <div className="flex items-center justify-between gap-3"><span className="text-xs font-medium">软件更新</span><button onClick={() => setOpen(false)} className="rounded p-1 text-muted-foreground hover:text-foreground" aria-label="关闭更新面板"><X className="size-3.5" /></button></div>
            <p className="mb-0 mt-2 text-[13px] font-medium" aria-live="polite">{ready ? `新版本 v${state.version} 已下载完成` : label}</p>
            <p className="mb-0 mt-1 text-[11px] text-muted-foreground">当前 v{state.currentVersion}{state.version && (busy || ready) ? ` → v${state.version}` : ''}</p>
            {busy || ready ? <ol aria-label="更新步骤" className="mb-0 mt-3 flex list-none items-center justify-between gap-1 p-0 text-[10px] text-muted-foreground">{['下载', '保存', '安装', '重启'].map((text, index) => <li key={text} aria-current={index === step ? 'step' : undefined} className={`flex items-center gap-1 ${index === step ? 'text-foreground' : ''}`}><span className="inline-flex size-3.5 items-center justify-center">{index < step ? <Check className="size-3" /> : <span className={`size-1.5 rounded-full ${index === step ? 'bg-current' : 'bg-muted-foreground/30'}`} />}</span>{text}</li>)}</ol> : null}
            {state.status === 'downloading' ? <p className="mb-0 mt-3 text-[11px] leading-5 text-muted-foreground">{state.phase ? '更新包正在准备中，可以继续创作。' : `${state.mode === 'delta' ? '增量下载' : '完整包下载'}${state.total ? ` ${(state.downloaded / 1048576).toFixed(1)} / ${(state.total / 1048576).toFixed(1)} MB` : ''}${state.reused ? `，节省 ${Math.round(state.reused / (state.reused + state.total) * 100)}% 下载量` : ''}`}</p> : null}
            {saving || state.status === 'installing' ? <p className="mb-0 mt-3 text-[11px] leading-5 text-muted-foreground">{state.phase === 'handoff' ? '接下来由独立更新窗口显示安装和重启进度。' : '保存和校验完成后开始安装，新版就绪后自动打开。'}</p> : null}
            {state.notes && ready ? <p className="mb-0 mt-3 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{state.notes}</p> : null}
            {state.error ? <p role="alert" className="mb-0 mt-3 text-xs leading-5 text-muted-foreground">{state.error}</p> : null}
            {busy ? <div className="mt-3 flex items-center gap-2"><div className="h-1 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={determinate ? state.progress : undefined} aria-valuemin={0} aria-valuemax={100} aria-valuetext={determinate ? `${label} ${state.progress}%` : label} aria-label={state.status === 'downloading' ? '更新下载进度' : '更新准备进度'}><div className={`h-full bg-foreground ${determinate ? 'transition-[width] motion-reduce:transition-none' : 'animate-pulse motion-reduce:animate-none'}`} style={{ width: determinate ? `${state.progress}%` : '100%', opacity: determinate ? 1 : 0.4 }} /></div>{determinate ? <span className="text-[10px] tabular-nums text-muted-foreground">{state.progress}%</span> : null}</div> : null}
            {ready ? <p className="mb-0 mt-3 text-xs text-muted-foreground">点击后安装并重新打开应用；请先结束正在运行的生成任务。</p> : null}
            <button type="button" disabled={busy || !state.supported} aria-busy={busy || undefined} onClick={() => ready ? void install() : void desktopUpdate('check')} style={{ color: 'var(--primary-foreground)' }} className="mt-3 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-primary text-xs font-medium disabled:cursor-default disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Icon className={`size-3 ${busy ? 'animate-spin motion-reduce:animate-none' : ''}`} />{busy ? label : ready ? '更新并重启' : state.status === 'error' ? '重试更新' : '检查更新'}</button>
        </section> : null}
        <button onClick={() => setOpen(!open)} aria-expanded={open} title={ready ? `v${state.version} 已就绪，点击更新` : '软件更新'} className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${ready ? 'bg-popover text-foreground shadow-sm' : 'text-muted-foreground'}`}>
            <Icon className={`size-3 ${busy ? 'animate-spin motion-reduce:animate-none' : ''}`} /><span aria-live="polite">{label}</span>{ready ? <span className="size-1.5 rounded-full bg-emerald-500" /> : null}
        </button>
    </div>;
}
