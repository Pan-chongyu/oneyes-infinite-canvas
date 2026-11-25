import { useEffect, useMemo, useRef, useState } from 'react';
import { App, Button, Modal, theme } from 'antd';
import { ArrowUpRight, ChevronRight, Copy, Download, Film, ListVideo, RefreshCw, ShieldCheck } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { saveAs } from 'file-saver';
import { adoptVideoTask, applyVideoRecovery, refreshVideoRecovery, useVideoRecoveryStore, type VideoRecoveryJob } from '@/services/video-recovery';
import { modelOptionName, useConfigStore } from '@/stores/use-config-store';
import { flushCanvasStorage, useCanvasStore } from '@/stores/canvas/use-canvas-store';
import { buildGenerationConfig } from '@/lib/canvas/canvas-generation-helpers';
import { splitModelInformation } from '@/lib/model-information';
import { videoDisplayText, videoErrorText } from '@/lib/video-display-text';
import { useCopyText } from '@/hooks/use-copy-text';

const filters = [
    { value: 'all', label: '全部' },
    { value: 'active', label: '进行中' },
    { value: 'attention', label: '待处理' },
    { value: 'saved', label: '已保存' },
] as const;
type TaskFilter = typeof filters[number]['value'];
type TaskStatus = { label: string; group: Exclude<TaskFilter, 'all'>; color: 'processing' | 'warning' | 'error' | 'success' | 'default' };

const states: Record<string, TaskStatus> = {
    prepared: { label: '准备提交', group: 'active', color: 'processing' },
    submitting: { label: '正在提交', group: 'active', color: 'processing' },
    throttled: { label: '素材排队中', group: 'active', color: 'processing' },
    pending: { label: '正在生成', group: 'active', color: 'processing' },
    querying: { label: '查询原任务', group: 'active', color: 'processing' },
    downloading: { label: '正在下载', group: 'active', color: 'processing' },
    saving: { label: '验证并保存', group: 'active', color: 'processing' },
    saved: { label: '已保存', group: 'saved', color: 'success' },
    unknown: { label: '提交待核实', group: 'attention', color: 'warning' },
    confirmation: { label: '待确认原账号', group: 'attention', color: 'warning' },
    credentials: { label: '等待恢复凭据', group: 'attention', color: 'warning' },
    waiting: { label: '等待网络恢复', group: 'attention', color: 'warning' },
    not_submitted: { label: '未提交生成', group: 'attention', color: 'default' },
    save_error: { label: '保存失败', group: 'attention', color: 'error' },
    download_error: { label: '等待重新取回', group: 'attention', color: 'warning' },
    failed: { label: '任务失败', group: 'attention', color: 'error' },
    cancelled: { label: '任务已取消', group: 'attention', color: 'default' },
    missing: { label: '任务暂不可用', group: 'attention', color: 'warning' },
    expired: { label: '任务已过期', group: 'attention', color: 'default' },
};
const dateFormat = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function taskStatus(state: string): TaskStatus {
    return Object.hasOwn(states, state) ? states[state] : { label: '待确认', group: 'attention', color: 'warning' };
}

export function VideoRecovery() {
    const api = window.oneYesDesktop?.videoTasks;
    const navigate = useNavigate(), { pathname } = useLocation();
    const { token } = theme.useToken();
    const { jobs, open } = useVideoRecoveryStore();
    const projects = useCanvasStore(state => state.projects), hydrated = useCanvasStore(state => state.hydrated);
    const config = useConfigStore(state => state.config);
    useEffect(() => {
        if (!api) return;
        const stop = api.subscribe(jobs => useVideoRecoveryStore.setState({ jobs, error: undefined }));
        void refreshVideoRecovery().catch(error => useVideoRecoveryStore.setState({ error: String(error) }));
        return stop;
    }, [api]);
    useEffect(() => {
        if (!api || !hydrated) return;
        let active = true;
        void (async () => {
            for (const project of projects) for (const node of project.nodes) {
                if (!active) return;
                if (!node.metadata?.videoTaskId || node.metadata.content || node.metadata.videoJobKey) continue;
                const model = node.metadata.model;
                if (!model) continue; // A missing model is never silently substituted.
                const key = await adoptVideoTask(buildGenerationConfig(config, node, 'video'), { id: node.metadata.videoTaskId, model, provider: node.metadata.videoTaskProvider || 'openai' }, { projectId: project.id, nodeId: node.id });
                if (!active || !key) continue;
                const current = useCanvasStore.getState().projects.find(item => item.id === project.id);
                if (current) useCanvasStore.getState().updateProject(project.id, { nodes: current.nodes.map(item => item.id === node.id ? { ...item, metadata: { ...item.metadata, videoJobKey: key } } : item) });
            }
        })().catch(error => useVideoRecoveryStore.setState({ error: `历史任务已保留：${String(error)}` }));
        return () => { active = false; };
    }, [api, config, hydrated, projects]);
    useEffect(() => {
        if (!hydrated) return;
        let changed = false;
        for (const project of useCanvasStore.getState().projects) {
            if (pathname === '/canvas/' + project.id) continue; // The open canvas updates its own live nodes.
            const nodes = project.nodes.map(node => {
                const job = [...jobs].reverse().find(job => job.target?.projectId === project.id && job.target.nodeId === node.id && (!node.metadata?.videoJobKey || job.key === node.metadata.videoJobKey));
                return job ? applyVideoRecovery(node, job) : node;
            });
            if (nodes.some((node, index) => node !== project.nodes[index])) { useCanvasStore.getState().updateProject(project.id, { nodes }); changed = true; }
        }
        if (changed) void flushCanvasStorage().catch(error => useVideoRecoveryStore.setState({ error: '画布回填保存失败，视频仍在任务队列中：' + String(error) }));
    }, [jobs, hydrated, pathname, projects]);

    if (!api) return null;
    const close = () => useVideoRecoveryStore.setState({ open: false });
    return (
        <Modal
            open={open}
            centered
            destroyOnHidden
            onCancel={close}
            width={696}
            footer={null}
            classNames={{ header: 'px-4! py-3.5! sm:px-5!' }}
            styles={{
                container: {
                    display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden',
                    height: jobs.length ? 'min(580px, calc(100dvh - 32px))' : undefined,
                    maxHeight: 'calc(100dvh - 32px)', borderRadius: 16,
                    border: `1px solid ${token.colorBorderSecondary}`,
                },
                header: { flex: 'none', margin: 0 },
                body: { display: 'flex', flexDirection: 'column', flex: '1 1 0', minHeight: 0 },
                close: { color: token.colorTextSecondary },
            }}
            title={<span className="flex min-h-8 items-center gap-2.5 pe-8 text-lg font-semibold tracking-tight">
                <ListVideo size={21} aria-hidden /> 视频任务
            </span>}
        >
            <VideoTaskList onReturn={projectId => { close(); navigate('/canvas/' + projectId); }} />
        </Modal>
    );
}

function VideoTaskList({ onReturn }: { onReturn: (projectId: string) => void }) {
    const { token } = theme.useToken();
    const { jobs, error } = useVideoRecoveryStore();
    const projects = useCanvasStore(state => state.projects);
    const hydrated = useCanvasStore(state => state.hydrated);
    const [filter, setFilter] = useState<TaskFilter>('all');
    const scroll = useRef<HTMLDivElement>(null);
    const groups = useMemo(() => {
        const all = [...jobs].reverse();
        const groups: Record<TaskFilter, VideoRecoveryJob[]> = { all, active: [], attention: [], saved: [] };
        for (const job of all) groups[taskStatus(job.state).group].push(job);
        return groups;
    }, [jobs]);
    const changeFilter = (value: TaskFilter) => {
        setFilter(value);
        if (scroll.current) scroll.current.scrollTop = 0;
    };

    return (
        <>
            {jobs.length > 0 && <div role="group" aria-label="按状态筛选视频任务" className="grid shrink-0 grid-cols-4 border-b px-4 sm:px-5">
                {filters.map(({ label, value }) => <button key={value} type="button" aria-pressed={filter === value}
                    onClick={() => changeFilter(value)}
                    style={{ color: filter === value ? token.colorText : token.colorTextSecondary }}
                    className="flex min-h-9 min-w-0 cursor-pointer flex-wrap items-center justify-center gap-x-1.5 border-b-2 border-transparent px-1 text-xs hover:bg-muted/30 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:-outline-offset-2 aria-pressed:border-current aria-pressed:font-semibold motion-safe:transition-colors sm:text-sm">
                    {label}<span className="text-xs text-muted-foreground tabular-nums">{groups[value].length}</span>
                </button>)}
            </div>}
            <div ref={scroll} aria-label="视频任务列表" role="region" tabIndex={0}
                className="min-h-0 flex-auto overflow-y-auto overscroll-contain [scrollbar-gutter:stable] [scrollbar-width:thin] focus-visible:outline-2 focus-visible:-outline-offset-2">
                {error && <div role="alert" className="mx-4 my-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive sm:mx-5">{videoErrorText(error)}</div>}
                {groups[filter].length > 0 ? <ul className="m-0! list-none divide-y divide-border px-4 sm:px-5">
                    {groups[filter].map(job => {
                        const target = job.target;
                        const projectId = target && projects.some(project => project.id === target.projectId && project.nodes.some(node => node.id === target.nodeId))
                            ? target.projectId : undefined;
                        const source = target ? hydrated && !projectId ? '原画布或节点已删除' : undefined : '独立生成任务';
                        return <VideoTaskRow key={job.key} job={job} source={source} onReturn={projectId ? () => onReturn(projectId) : undefined} />;
                    })}
                </ul> : <div className="flex min-h-44 flex-col items-center justify-center gap-2 px-4 py-7 text-center">
                    <Film size={28} className="text-muted-foreground" aria-hidden />
                    <span className="text-sm font-medium">{jobs.length ? '此状态暂无任务' : '暂无视频任务'}</span>
                    {jobs.length > 0 && <Button type="text" size="small" onClick={() => changeFilter('all')}>查看全部</Button>}
                </div>}
            </div>
            <div className="flex shrink-0 items-start gap-2 border-t bg-muted/25 px-4 py-2.5 text-xs leading-5 text-muted-foreground sm:px-5">
                <ShieldCheck className="mt-0.5 shrink-0" size={15} aria-hidden />
                <span>重启后可继续取回。重试仅查询或下载原任务。</span>
            </div>
        </>
    );
}

function VideoTaskRow({ job, source, onReturn }: { job: VideoRecoveryJob; source?: string; onReturn?: () => void }) {
    const { message, modal } = App.useApp();
    const { token } = theme.useToken();
    const copyText = useCopyText();
    const [busy, setBusy] = useState(false);
    const status = taskStatus(job.state);
    const dotColor = {
        processing: token.colorText, warning: token.colorWarning, error: token.colorError,
        success: token.colorSuccess, default: token.colorTextTertiary,
    }[status.color];
    const name = videoDisplayText(splitModelInformation(modelOptionName(job.model)).name).replace(/https?:\/\/\S+/gi, '').trim() || '视频任务';
    const created = new Date(job.createdAt);
    const validDate = Number.isFinite(created.getTime());
    const { vquality = '', videoSeconds = '', size = '' } = job.parameters;
    const specs = [
        /^\d+p?$/i.test(vquality) ? vquality.replace(/p$/i, '') + 'p' : /^[24]kp?$/i.test(vquality) ? vquality.slice(0, 2).toUpperCase() : undefined,
        videoSeconds === '-1' ? '智能时长' : /^\d+(?:\.\d+)?$/.test(videoSeconds) ? `${videoSeconds} 秒` : undefined,
        size === 'auto' ? '自适应' : /^\d+[:x×]\d+$/i.test(size) ? size.replace(/x/i, '×') : undefined,
    ].filter(Boolean);
    const number = job.diagnosticId;
    const diagnosticId = number && number !== job.key && number !== job.taskId && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(number) ? number : undefined;
    const [statusMessage, requestId] = job.reason ? videoErrorText(job.reason, { state: job.state }).split('\n本站请求编号：') : [];
    const reason = job.state === 'unknown' ? '请先到官网核对原任务和用量。' : statusMessage;
    const result = job.state === 'saved' ? job.result : undefined;
    const canRetry = Boolean(job.taskId && job.state !== 'unknown' && job.state !== 'not_submitted');
    const confirmAccount = job.state === 'confirmation';

    async function runAction() {
        const api = window.oneYesDesktop?.videoTasks;
        if (busy || (!result && (!api || !canRetry))) return;
        setBusy(true);
        try {
            if (result) {
                const response = await fetch(result.url);
                if (!response.ok) throw Error('读取视频失败');
                saveAs(await response.blob(), `OneYes-Video-${diagnosticId || job.createdAt}.${result.mimeType === 'video/webm' ? 'webm' : 'mp4'}`);
            } else if (api) {
                useVideoRecoveryStore.setState({ jobs: await api.call('retry', job.key) });
            }
        } catch (error) {
            message.error(videoErrorText(error, result ? { stage: 'download' } : undefined));
        } finally {
            setBusy(false);
        }
    }

    function handleAction() {
        if (confirmAccount && !result) {
            modal.confirm({
                title: '确认原提交账号',
                content: '请确认当前登录账号就是提交此任务的账号。确认后将查询原任务。',
                okText: '确认原账号并恢复', cancelText: '暂不恢复', onOk: runAction,
            });
        } else {
            void runAction();
        }
    }

    return (
        <li className="flex flex-col gap-1 py-3">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <h3 className="m-0! min-w-0 flex-1 text-sm font-semibold! leading-6 [overflow-wrap:anywhere]">{name}</h3>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs leading-5 text-muted-foreground" style={{ background: token.colorFillQuaternary }}>
                    <span className="size-1.5 rounded-full" style={{ background: dotColor }} aria-hidden />{status.label}
                </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-5 text-muted-foreground tabular-nums">
                {validDate && <time dateTime={created.toISOString()} title={created.toLocaleString('zh-CN')}>{dateFormat.format(created)}</time>}
                {specs.length > 0 && <span className="flex flex-wrap gap-1.5">{specs.map(spec =>
                    <span key={spec} className="rounded border px-1.5 leading-[18px]">{spec}</span>
                )}</span>}
            </div>
            {reason && <p className="m-0! pt-0.5 text-[13px] leading-5 whitespace-pre-line [overflow-wrap:anywhere]">{reason}</p>}
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                {(diagnosticId || requestId || source) && <details className="group min-w-0 flex-1 basis-24">
                    <summary style={{ display: 'inline-flex' }} className="min-h-7 cursor-pointer list-none items-center gap-1 rounded-md text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 [&::-webkit-details-marker]:hidden">
                        <ChevronRight size={14} className="motion-safe:transition-transform group-open:rotate-90" aria-hidden /> 任务详情
                    </summary>
                    <div className="mt-1 space-y-1 rounded-md border bg-muted/25 px-2.5 py-1.5 text-xs leading-5 text-muted-foreground">
                        {diagnosticId && <div className="flex flex-wrap items-center justify-between gap-x-2">
                            <div className="min-w-0">
                                <span className="me-2">记录编号</span>
                                <span className="select-all text-foreground [overflow-wrap:anywhere]">{diagnosticId}</span>
                            </div>
                            <Button type="text" size="small" icon={<Copy size={13} />} onClick={() => copyText(diagnosticId, '已复制记录编号')}>复制编号</Button>
                        </div>}
                        {requestId && <div>
                            <span className="me-2">本站请求编号</span>
                            <span className="select-all text-foreground [overflow-wrap:anywhere]">{requestId}</span>
                        </div>}
                        {source && <div>{source}</div>}
                    </div>
                </details>}
                {(onReturn || result || canRetry) && <div className="ms-auto flex max-w-full flex-wrap justify-end gap-1">
                    {onReturn && <Button type="text" size="small" icon={<ArrowUpRight size={14} />} onClick={onReturn}>返回画布</Button>}
                    {(result || canRetry) && <Button type="text" size="small" loading={busy} onClick={handleAction}
                        icon={result ? <Download size={14} /> : <RefreshCw size={14} />}>
                        {result ? '保存视频' : confirmAccount ? '确认原账号并恢复' : '重试查询／下载'}
                    </Button>}
                </div>}
            </div>
        </li>
    );
}
