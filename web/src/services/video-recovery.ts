import { create } from 'zustand';
import { resolveModelChannel, resolveModelRequestConfig, type AiConfig } from '@/stores/use-config-store';
import type { UploadedFile } from './file-storage';
import type { CanvasNodeData } from '@/types/canvas';
import { videoErrorText } from '@/lib/video-display-text';

export type VideoRecoveryJob = {
    key: string; taskId?: string; provider: 'openai' | 'gemini'; model: string; site: string; channelId: string; accountId?: number;
    parameters: Record<string, string>; target?: { projectId: string; nodeId: string }; createdAt: number; updatedAt?: number;
    state: string; reason?: string; legacy?: boolean; result?: UploadedFile & { sha256: string };
};
export const useVideoRecoveryStore = create<{ jobs: VideoRecoveryJob[]; error?: string; open: boolean }>(() => ({ jobs: [], open: false }));
export async function refreshVideoRecovery() {
    const api = window.oneYesDesktop?.videoTasks;
    if (api) useVideoRecoveryStore.setState({ jobs: await api.call('list'), error: undefined });
}
export function videoRecoveryInput(config: AiConfig, prompt: string, target?: VideoRecoveryJob['target']) {
    const id = config.model.includes('::') ? config.model.split('::')[0] : undefined;
    if (id && !config.channels.some(channel => channel.id === id)) throw Error('原视频渠道已删除，请恢复原站点和 API Key 后继续取回；不会使用其他渠道');
    const channel = resolveModelChannel(config, config.model), request = resolveModelRequestConfig(config, config.model);
    return { site: request.baseUrl, apiKey: request.apiKey, channelId: channel.id, accountId: channel.oneYes?.accountId,
        model: config.model, provider: request.apiFormat === 'gemini' ? 'gemini' as const : 'openai' as const,
        parameters: Object.fromEntries(['size', 'vquality', 'videoSeconds', 'videoMode', 'videoGenerateAudio', 'videoWatermark'].map(key => [key, config[key as keyof AiConfig]]).concat([['prompt', prompt]])), target };
}
export async function adoptVideoTask(config: AiConfig, task: { id: string; provider: string; model: string }, target?: VideoRecoveryJob['target']) {
    const api = window.oneYesDesktop?.videoTasks;
    if (!api || task.provider === 'plugin') return;
    const key = await api.call('adopt', { ...videoRecoveryInput({ ...config, model: task.model }, '', target), provider: task.provider, taskId: task.id });
    await refreshVideoRecovery(); return key;
}
export function applyVideoRecovery(node: CanvasNodeData, job: VideoRecoveryJob): CanvasNodeData {
    const reason = job.reason ? videoErrorText(job.reason, { state: job.state }) : undefined;
    if (node.metadata?.videoJobKey && node.metadata.videoJobKey !== job.key || node.metadata?.videoTaskId && node.metadata.videoTaskId !== job.taskId) return node;
    if (node.metadata?.storageKey === job.result?.storageKey && job.result) return node;
    if (node.metadata?.content) return node;
    const metadata = { ...node.metadata, videoJobKey: job.key, videoTaskId: job.taskId, videoTaskProvider: job.provider,
        model: job.model, videoRecoveryState: job.state, errorDetails: reason };
    if (job.state === 'saved' && job.result) return { ...node, metadata: { ...metadata, status: 'success', content: job.result.url,
        naturalWidth: job.result.width, naturalHeight: job.result.height, storageKey: job.result.storageKey, bytes: job.result.bytes, mimeType: job.result.mimeType, durationMs: job.result.durationMs } };
    const error = ['failed', 'expired', 'missing', 'unknown', 'not_submitted', 'confirmation', 'credentials', 'save_error', 'download_error'].includes(job.state);
    if (node.metadata?.videoRecoveryState === job.state && node.metadata?.errorDetails === reason && node.metadata?.videoJobKey === job.key) return node;
    return { ...node, metadata: { ...metadata, status: error ? 'error' : 'loading' } };
}
