import { useEffect } from 'react';
import { App, Button, Empty, Modal, Tag } from 'antd';
import { Download, RefreshCw } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { saveAs } from 'file-saver';
import { adoptVideoTask, applyVideoRecovery, refreshVideoRecovery, useVideoRecoveryStore } from '@/services/video-recovery';
import { useConfigStore } from '@/stores/use-config-store';
import { flushCanvasStorage, useCanvasStore } from '@/stores/canvas/use-canvas-store';
import { buildGenerationConfig } from '@/lib/canvas/canvas-generation-helpers';

const labels: Record<string, string> = { prepared: '准备提交', submitting: '正在提交', unknown: '提交待核实', confirmation: '待确认原账号',
    pending: '上游生成中', querying: '查询原任务', downloading: '正在下载', saving: '验证并保存', saved: '已保存',
    credentials: '等待恢复凭据', waiting: '等待网络恢复', save_error: '保存失败', download_error: '等待重新取回', failed: '任务失败', missing: '上游找不到任务', expired: '任务已过期' };

export function VideoRecovery() {
    const api = window.oneYesDesktop?.videoTasks;
    const { message, modal } = App.useApp(), navigate = useNavigate(), { pathname } = useLocation();
    const { jobs, error, open } = useVideoRecoveryStore();
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
    return <Modal open={open} onCancel={close} title="视频任务" footer={null} width={640}>
        <p className="mb-4 text-xs leading-relaxed text-muted-foreground">退出或重启后继续取回原任务。重试只查询或下载，不会重新生成、重复付费。</p>
        {error ? <p role="alert" className="mb-3 text-sm text-destructive">{error}</p> : null}
        <div className="max-h-[65vh] overflow-auto">
            {!jobs.length ? <Empty description="暂无视频恢复任务" /> : [...jobs].reverse().map(job => <section key={job.key} className="border-b border-border py-3 last:border-0">
                <div className="flex items-center justify-between gap-3"><span className="min-w-0 truncate text-sm font-medium" title={job.model}>{job.model.split('::').at(-1)}</span><Tag className="shrink-0">{labels[job.state] || job.state}</Tag></div>
                <p className="mt-1 break-all text-xs text-muted-foreground">{job.site}{job.accountId ? ` · 账号 ${job.accountId}` : ''} · {new Date(job.createdAt).toLocaleString()}</p>
                <p className="mt-1 break-all text-xs text-muted-foreground">任务：{job.taskId || '尚未获得可靠任务 ID'} · {job.parameters.vquality} · {job.parameters.videoSeconds} 秒 · {job.parameters.size}</p>
                {job.reason ? <p role="status" className="mt-2 text-sm leading-relaxed">{job.reason}</p> : null}
                <div className="mt-2 flex flex-wrap gap-1">
                    {job.state === 'saved' && job.result ? <Button type="text" size="small" icon={<Download size={14} />} onClick={() => void fetch(job.result!.url).then(async response => { if (!response.ok) throw Error('读取视频失败'); saveAs(await response.blob(), `OneYes-Video-${job.key}.${job.result!.mimeType === 'video/webm' ? 'webm' : 'mp4'}`); }).catch(error => message.error(String(error)))}>保存视频</Button> : job.taskId ? <Button type="text" size="small" icon={<RefreshCw size={14} />} onClick={() => {
                        const retry = () => void api.call('retry', job.key).then(jobs => useVideoRecoveryStore.setState({ jobs })).catch(error => message.error(String(error)));
                        if (job.state === 'confirmation') modal.confirm({ title: '确认原提交账号', content: `请确认 ${job.site} 的当前渠道仍属于原提交账号。仅查询任务 ${job.taskId}，不会重新生成。`, okText: '确认原账号并恢复', cancelText: '暂不恢复', onOk: retry }); else retry();
                    }}>{job.state === 'confirmation' ? '确认原账号并恢复' : '重试查询／下载'}</Button> : null}
                    {job.target && projects.some(project => project.id === job.target!.projectId && project.nodes.some(node => node.id === job.target!.nodeId)) ? <Button type="text" size="small" onClick={() => { close(); navigate('/canvas/' + job.target!.projectId); }}>返回画布</Button> : <span className="self-center text-xs text-muted-foreground">{job.target ? '原画布或节点已删除，仍可保存视频' : '独立生成任务'}</span>}
                </div>
            </section>)}
        </div>
    </Modal>;
}
