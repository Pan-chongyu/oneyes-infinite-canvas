import type { AiConfig } from '@/stores/use-config-store';
import { VIDEO_SECONDS_MIN } from './media-size';
import { getVideoModelInfo } from './video-model-info';

export type VideoModelDefaults = Pick<AiConfig, 'vquality' | 'size' | 'videoSeconds' | 'videoMode' | 'videoGenerateAudio' | 'videoWatermark'>;

/** Applied on explicit selection only; never a fallback for a rejected paid request. */
export function minimumVideoModelDefaults(config: AiConfig, model: string): VideoModelDefaults {
    const info = getVideoModelInfo(config, model);
    const resolutions = info?.resolutions || [/^minimax-h/i.test(model.split('::').at(-1) || '') ? '768' : '480'];
    const rank = (value: string) => parseFloat(value) * (/k$/i.test(value) ? 1000 : 1);
    const durations = info?.duration.values?.filter(value => value > 0);
    return {
        vquality: [...resolutions].sort((a, b) => rank(a) - rank(b))[0],
        videoSeconds: String(durations?.length ? Math.min(...durations) : Math.max(1, info?.duration.min ?? VIDEO_SECONDS_MIN)),
        size: !info || info.ratios.includes('auto') ? 'auto' : info.ratios.includes('16:9') ? '16:9' : info.ratios[0],
        videoMode: !info || info.modes.includes('frames') ? 'frames' : 'reference',
        videoGenerateAudio: info?.audio === 'required' ? 'true' : 'false',
        videoWatermark: 'false',
    };
}

export function videoModelDefaults(config: AiConfig, model: string): VideoModelDefaults {
    return { ...minimumVideoModelDefaults(config, model), ...config.videoModelDefaults?.[videoModelDefaultsKey(config, model)] };
}

export function videoModelDefaultsKey(config: AiConfig, model: string) {
    const info = getVideoModelInfo(config, model);
    return info ? model.slice(0, model.includes('::') ? model.indexOf('::') + 2 : 0) + info.id : model;
}

export function videoModelNodePatch(config: AiConfig, model: string) {
    const defaults = videoModelDefaults(config, model);
    return { model, vquality: defaults.vquality, size: defaults.size, seconds: defaults.videoSeconds,
        videoMode: defaults.videoMode, generateAudio: defaults.videoGenerateAudio, watermark: defaults.videoWatermark };
}
