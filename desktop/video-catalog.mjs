export const videoModelStatuses = { active: '可用', retired: '已下架', unavailable: '暂不可用', unknown: '状态待确认' };

/** The feed allows one missed refresh plus a user-approved 60-second clock grace. */
export function videoCatalogExpired(catalog, now = Date.now()) {
    const generated = Date.parse(catalog.generated_at);
    return !Number.isFinite(generated) || generated > now + 60_000 || now - generated > (catalog.refresh_after_seconds * 2 + 60) * 1000;
}

/** Keep public display data only; labels and generation permissions are local policy. */
/** @param {unknown} input */
export function parseVideoCatalog(input, now = Date.now()) {
    const value = /** @type {any} */ (input);
    if (value?.schema_version !== 1 || !Array.isArray(value.data) || !value.data.length || typeof value.generated_at !== 'string' || !Number.isFinite(Date.parse(value.generated_at)) || Date.parse(value.generated_at) > now + 60_000 || typeof value.check?.stale !== 'boolean') throw Error('模型状态信息更新延迟');
    const seen = new Set();
    const data = /** @type {any[]} */ (value.data).map(item => {
        if (typeof item?.id !== 'string' || !item.id.trim() || seen.has(item.id) || !Array.isArray(item.request_ids) || !item.request_ids.length || item.request_ids.some(id => typeof id !== 'string' || !id.trim())) throw Error('模型状态信息更新延迟');
        seen.add(item.id);
        const status = Object.hasOwn(videoModelStatuses, item.status) ? item.status : 'unknown';
        return { id: item.id, request_ids: [...new Set(item.request_ids)], recommended_request_id: item.request_ids.includes(item.recommended_request_id) ? item.recommended_request_id : undefined,
            model_name: typeof item.model_name === 'string' && item.model_name.trim() ? item.model_name : item.id,
            model_info: typeof item.model_info === 'string' ? item.model_info : '', status,
            stale: value.check.stale || item.stale !== false, price_stale: item.price_stale !== false,
            parameters_stale: item.parameters_stale !== false, new_tasks_enabled: typeof item.new_tasks_enabled === 'boolean' ? item.new_tasks_enabled : undefined,
            has_price: typeof item.has_price === 'boolean' ? item.has_price : undefined,
            checked_at: typeof item.checked_at === 'string' ? item.checked_at : '', status_updated_at: typeof item.status_updated_at === 'string' ? item.status_updated_at : '',
        };
    });
    const ids = data.flatMap(item => item.request_ids);
    if (new Set(ids).size !== ids.length) throw Error('模型状态信息更新延迟');
    return { schema_version: 1, generated_at: value.generated_at, refresh_after_seconds: Number.isFinite(value.refresh_after_seconds) && value.refresh_after_seconds > 0 ? value.refresh_after_seconds : 300, check: { checked_at: typeof value.check.checked_at === 'string' ? value.check.checked_at : '', stale: value.check.stale }, data };
}

export function createVideoCatalog(fetcher) {
    return async () => {
        const response = await fetcher('https://oneyes.ai/video-models/catalog.json', { method: 'GET', headers: { Accept: 'application/json' }, credentials: 'omit', redirect: 'error' });
        if (!response.ok) { await response.body?.cancel(); throw Error('模型状态信息更新延迟'); }
        return parseVideoCatalog(await response.json());
    };
}
