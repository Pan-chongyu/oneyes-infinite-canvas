import { queryClient } from '@/lib/query-client';
import { parseVideoCatalog } from '../../../../desktop/video-catalog.mjs';

export const VIDEO_CATALOG_REFRESH_MS = 300_000;
export async function fetchVideoCatalog(force = false) {
    return queryClient.fetchQuery({
        queryKey: ['oneyes-video-model-metadata'], staleTime: force ? 0 : VIDEO_CATALOG_REFRESH_MS,
        queryFn: async () => {
            if (window.oneYesDesktop) {
                if (!window.oneYesDesktop.models.videoCatalog) throw Error('模型状态信息更新延迟');
                const result = await window.oneYesDesktop.models.videoCatalog();
                if (result.error) throw Error('模型状态信息更新延迟');
                return parseVideoCatalog(result.data);
            }
            const response = await fetch('https://oneyes.ai/video-models/catalog.json', { credentials: 'omit', redirect: 'error', headers: { Accept: 'application/json' } });
            if (!response.ok) throw Error('模型状态信息更新延迟');
            return parseVideoCatalog(await response.json());
        },
    });
}
