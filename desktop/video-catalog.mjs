export const videoModelStatuses = { active: '可用', retired: '已下架', unavailable: '暂不可用', unknown: '状态待确认' };

/**
 * Only the published, reviewed constraint schema may drive a new request.
 * @returns {{resolutions: Record<string, {durations: number[]}>, default_resolution: string, default_duration: number, aspect_ratios: string[], default_aspect_ratio?: string, prompt_max: number, reference_limits: {images: number, videos: number, audios: number, total?: number}, reference_file_max_bytes?: Partial<Record<'image'|'video'|'audio', number>>, reference_image_input_types?: string[], reference_modes?: string[], reference_image_processing?: string[], cancel_supported?: boolean} | undefined}
 */
export function parseVideoParameters(value) {
    if (value === undefined) return;
    const fail = () => { throw Error('模型参数信息更新延迟'); };
    const object = value => value && typeof value === 'object' && !Array.isArray(value);
    const integer = value => Number.isSafeInteger(value) && value >= 0;
    const strings = (value, valid) => Array.isArray(value) && value.length && value.every(valid) && new Set(value).size === value.length;
    if (!object(value) || !object(value.resolutions) || !Object.keys(value.resolutions).length) fail();
    const resolutions = Object.fromEntries(Object.entries(value.resolutions).map(([key, entry]) => {
        if (!/^(?:[1-9]\d*p|[1-9]\d*k)$/.test(key) || !object(entry) || !strings(entry.durations, seconds => integer(seconds) && seconds > 0)) fail();
        return [key, { durations: [...entry.durations].sort((a, b) => a - b) }];
    }));
    if (!Object.hasOwn(resolutions, value.default_resolution) || !resolutions[value.default_resolution].durations.includes(value.default_duration) ||
        !strings(value.aspect_ratios, ratio => typeof ratio === 'string' && /^(?:auto|[1-9]\d*:[1-9]\d*)$/.test(ratio)) ||
        value.default_aspect_ratio !== undefined && !value.aspect_ratios.includes(value.default_aspect_ratio) ||
        !integer(value.prompt_max) || !value.prompt_max || !object(value.reference_limits) ||
        !['images', 'videos', 'audios'].every(key => integer(value.reference_limits[key])) || value.reference_limits.total !== undefined && !integer(value.reference_limits.total)) fail();
    const limits = Object.fromEntries(['images', 'videos', 'audios', 'total'].filter(key => value.reference_limits[key] !== undefined).map(key => [key, value.reference_limits[key]]));
    let fileLimits;
    if (value.reference_file_max_bytes !== undefined) {
        if (!object(value.reference_file_max_bytes) || Object.keys(value.reference_file_max_bytes).some(key => !['image', 'video', 'audio'].includes(key) || !integer(value.reference_file_max_bytes[key]))) fail();
        fileLimits = { ...value.reference_file_max_bytes };
    }
    for (const [key, allowed] of [['reference_image_input_types', ['file_id', 'https_url']], ['reference_modes', ['multi_reference']], ['reference_image_processing', ['direct']]]) {
        if (value[key] !== undefined && !strings(value[key], item => allowed.includes(item))) fail();
    }
    if (value.cancel_supported !== undefined && typeof value.cancel_supported !== 'boolean') fail();
    return { resolutions, default_resolution: value.default_resolution, default_duration: value.default_duration,
        aspect_ratios: [...value.aspect_ratios], ...(value.default_aspect_ratio === undefined ? {} : { default_aspect_ratio: value.default_aspect_ratio }),
        prompt_max: value.prompt_max, reference_limits: limits,
        ...(fileLimits === undefined ? {} : { reference_file_max_bytes: fileLimits }),
        ...(value.reference_image_input_types === undefined ? {} : { reference_image_input_types: [...value.reference_image_input_types] }),
        ...(value.reference_modes === undefined ? {} : { reference_modes: [...value.reference_modes] }),
        ...(value.reference_image_processing === undefined ? {} : { reference_image_processing: [...value.reference_image_processing] }),
        ...(value.cancel_supported === undefined ? {} : { cancel_supported: value.cancel_supported }) };
}

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
            parameters: parseVideoParameters(item.parameters),
            prices: Array.isArray(item.prices) ? item.prices.filter(price => typeof price?.amount_cny === 'string' && /^\d+(?:\.\d+)?$/.test(price.amount_cny) && ['per_second', 'per_generation', 'per_million_tokens'].includes(price.unit)).map(price => ({ amount_cny: price.amount_cny, unit: price.unit, ...(typeof price.resolution === 'string' && /^(?:\d+p|\d+k)$/i.test(price.resolution) ? { resolution: price.resolution } : {}) })) : [],
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
