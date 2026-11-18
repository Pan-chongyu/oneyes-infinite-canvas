import type { AiConfig } from '@/stores/use-config-store';
import type { VideoCatalog } from '@/stores/use-video-catalog-store';
import { videoCatalogExpired, videoModelStatuses } from '../../../desktop/video-catalog.mjs';

export function videoModelMetadata(config: AiConfig, value: string, catalog?: VideoCatalog) {
    const index = value.indexOf('::'), name = index < 0 ? value : value.slice(index + 2);
    const channel = index < 0 ? config.channels.find(channel => channel.models.some(model => model.name === name)) : config.channels.find(channel => channel.id === value.slice(0, index));
    if (channel?.models.find(model => model.name === name)?.script?.trim()) return;
    try { if (!['https://oneyes.ai', 'https://api.oneyes.ai'].includes(new URL(channel?.baseUrl || config.baseUrl).origin)) return; } catch { return; }
    // Exact aliases only; a public feed cannot authorize or rewrite a request ID.
    return catalog?.data.find(model => model.request_ids.includes(name));
}

export function videoModelState(config: AiConfig, value: string, catalog?: VideoCatalog) {
    const metadata = videoModelMetadata(config, value, catalog);
    const index = value.indexOf('::'), name = index < 0 ? value : value.slice(index + 2);
    const channel = index < 0 ? config.channels.find(channel => channel.models.some(model => model.name === name)) : config.channels.find(channel => channel.id === value.slice(0, index));
    const unavailable = channel?.models.find(model => model.name === name)?.unavailable === true;
    const status: keyof typeof videoModelStatuses = metadata?.status || 'unknown';
    return { status, label: status !== 'retired' && status !== 'unavailable' && metadata?.new_tasks_enabled === false ? '暂停新建' : videoModelStatuses[status], disabled: unavailable || status === 'retired' || status === 'unavailable' || metadata?.new_tasks_enabled === false, stale: !catalog || videoCatalogExpired(catalog) || (metadata?.stale ?? true), priceStale: metadata?.price_stale ?? false, parametersStale: metadata?.parameters_stale ?? false, newTasksEnabled: metadata?.new_tasks_enabled };
}
