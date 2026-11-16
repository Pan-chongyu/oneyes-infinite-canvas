export type ReferenceFileMaxBytes = number | Partial<Record<'image' | 'video' | 'audio', number>>;
export const VIDEO_BRIDGE_BODY_MAX_BYTES = 128 * 1024 * 1024;
export const VIDEO_BRIDGE_TEXT_MAX_BYTES = 32 * 1024 * 1024;
export const MINIMAX_INLINE_MAX_BYTES = 32_000_000;

export function referenceFileMaxBytes(value: unknown): ReferenceFileMaxBytes | undefined {
    const valid = (item: unknown): item is number => typeof item === 'number' && Number.isSafeInteger(item) && item > 0;
    if (valid(value)) return value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const limits = Object.fromEntries(['image', 'video', 'audio'].flatMap(key => {
        const item = (value as Record<string, unknown>)[key]; return valid(item) ? [[key, item]] : [];
    }));
    if (Object.keys(limits).length) return limits;
}

export function videoReferenceFileLimit(model: { id: string; provider: string; referenceFileMaxBytes?: ReferenceFileMaxBytes }, kind: 'image' | 'video' | 'audio') {
    const live = model.referenceFileMaxBytes;
    if (typeof live === 'number') return live;
    if (live?.[kind] !== undefined) return live[kind];
    if (model.provider === 'zhiying') {
        if (model.id === 'sd-2.5-fullblood-line3') return 32 * 1024 * 1024;
        if (['seedance-2.0-official', 'seedance-2.0-fast-official', 'seedance-2.5-official'].includes(model.id)) return (kind === 'image' ? 16 : 64) * 1024 * 1024;
        if (kind === 'image') return 20 * 1024 * 1024 - 1;
    }
    if (kind === 'image' && (model.id.startsWith('wan3.0-video') || /^(veo-|gemini-omni-)/.test(model.id))) return 20 * 1024 * 1024;
}
