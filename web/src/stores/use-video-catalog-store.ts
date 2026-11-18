import { create } from 'zustand';
import localforage from 'localforage';
import { parseVideoCatalog, videoCatalogExpired } from '../../../desktop/video-catalog.mjs';
import { fetchVideoCatalog } from '@/services/api/video-catalog';

export type VideoCatalog = ReturnType<typeof parseVideoCatalog>;
const cacheKey = 'oneyes-video-model-metadata-v1';
let restoring: Promise<void> | undefined;
export const useVideoCatalogStore = create<{
    catalog?: VideoCatalog; delayed: boolean;
    restore: () => Promise<void>; sync: (force?: boolean) => Promise<void>;
}>((set, get) => ({
    delayed: true,
    restore: () => restoring ||= (async () => {
        try { const cached = await localforage.getItem(cacheKey); if (cached && !get().catalog) set({ catalog: parseVideoCatalog(cached), delayed: true }); } catch { /* A bad display cache never changes model rights. */ }
    })(),
    sync: async force => {
        await get().restore();
        try {
            const fresh = await fetchVideoCatalog(force);
            if (videoCatalogExpired(fresh) || get().catalog && Date.parse(fresh.generated_at) < Date.parse(get().catalog!.generated_at)) throw Error('模型状态信息更新延迟');
            // Unknown is not evidence that the last confirmed availability changed.
            const catalog = { ...fresh, data: [...fresh.data.map(model => {
                const previous = get().catalog?.data.find(item => item.id === model.id);
                return { ...model,
                    ...(!model.model_info.trim() && previous ? { model_info: previous.model_info } : {}),
                    ...(model.status === 'unknown' && previous && previous.status !== 'unknown' ? { status: previous.status, stale: true, new_tasks_enabled: model.new_tasks_enabled === false ? false : previous.new_tasks_enabled } : {}),
                };
            }), ...get().catalog?.data.filter(previous => !fresh.data.some(model => model.id === previous.id)).map(previous => ({ ...previous, stale: true })) || []] };
            set({ catalog, delayed: false });
            await localforage.setItem(cacheKey, catalog).catch(() => {});
        } catch { set({ delayed: true }); }
    },
}));
