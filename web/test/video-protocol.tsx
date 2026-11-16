import { defaultConfig, modelOptionLabel, useConfigStore } from '@/stores/use-config-store';
import { videoDisplayText } from '@/lib/video-display-text';
import { initializeDesktopTransport } from '@/services/api/desktop-transport';
import { createVideoGenerationTask, pollVideoGenerationTask, waitForVideoGenerationTask } from '@/services/api/video';
import { uploadImage } from '@/services/image-storage';
import type { ReferenceImage } from '@/types/image';
import '@/i18n';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { CanvasVideoSettingsPopover } from '@/components/canvas/canvas-video-settings-popover';
import type { AiConfig } from '@/stores/use-config-store';
import type { VideoReferenceSummary } from '@/lib/video-capabilities';
import { videoModelCatalog } from '@/lib/video-model-catalog';
Object.assign(window, { videoAvailableModels: [...videoModelCatalog.flatMap(model => [model.id, ...model.aliases]), 'seedance-2.5'] });

Object.assign(window, { oneYesDesktop: { models: { list: async (apiKey: string) => {
    const response = await fetch('oneyes-canvas://app/proxy?url=' + encodeURIComponent('https://oneyes.ai/v1/models'), { headers: { Authorization: 'Bearer ' + apiKey } });
    return { data: (await response.json()).data };
} } } });
initializeDesktopTransport();
const config = { ...defaultConfig, channels: [{ ...defaultConfig.channels[0], apiKey: 'fixture-key' }], model: 'default::grok-imagine-video', size: '1:1', vquality: '480', videoSeconds: '5', proxyEnabled: true, proxyMode: 'upstream' as const };
useConfigStore.setState({ config });
const check = (value: unknown, message: string) => { if (!value) throw Error(message); };
Object.assign(window, { videoTest: async () => {
    check(videoDisplayText('智赢：HTTP 422，88API 不支持 1080p；https://api.zhiyingai.org/v1/videos?id=1') === '视频服务：HTTP 422，视频服务 不支持 1080p；视频服务', 'supplier details hidden while actionable error remains');
    check(videoDisplayText('grok-imagine-video-1.5 · 1080p · 5s') === 'grok-imagine-video-1.5 · 1080p · 5s', 'model version and generation settings remain intact');
    const namedChannelConfig = { ...config, channels: [{ ...config.channels[0], name: '88API', models: [{ name: 'grok-imagine-video-1.5', capability: 'video' as const }] }] };
    check(modelOptionLabel(namedChannelConfig, 'default::grok-imagine-video-1.5') === 'grok-imagine-video-1.5', 'video model label omits supplier channel suffix');
    check(namedChannelConfig.channels[0].name === '88API' && namedChannelConfig.channels[0].models[0].name === 'grok-imagine-video-1.5', 'display formatting must not mutate routing or exact model ID');
    const aborted = new DOMException('Aborted', 'AbortError');
    Object.assign(window.oneYesDesktop!, { videoTasks: { call: async (operation: string) => operation === 'prepare' ? 'fixture-cancelled' : undefined } });
    let cancellation: unknown;
    try { await createVideoGenerationTask(config, 'cancelled fixture', [], { onPrepared: async () => { throw aborted; } }); }
    catch (error) { cancellation = error; }
    finally { delete window.oneYesDesktop!.videoTasks; }
    check(cancellation === aborted, 'message formatting must preserve cancellation identity and AbortError classification');
    const canvas = document.createElement('canvas'); canvas.width = 3; canvas.height = 2;
    canvas.getContext('2d')!.fillRect(0, 0, 2, 1);
    const stored = await uploadImage(canvas.toDataURL('image/png'));
    const image: ReferenceImage = { id: 'reference', name: '误标.jpg', type: 'image/jpeg', dataUrl: stored.url, storageKey: stored.storageKey };
    const tasks = [];
    tasks.push(await createVideoGenerationTask(config, '服装模特'));
    tasks.push(await createVideoGenerationTask(config, 'first-frame', [image]));
    tasks.push(await createVideoGenerationTask(config, 'first-last', [image, image]));
    tasks.push(await createVideoGenerationTask({ ...config, videoMode: 'reference' }, 'references', [image, image, image]));
    tasks.push(await createVideoGenerationTask(config, 'audio', [image], { audios: [{ id: 'audio', name: 'ref.mp3', type: 'audio/mpeg', url: 'data:audio/mpeg;base64,YXVkaW8=' }] }));
    tasks.push(await createVideoGenerationTask(config, 'edit', [], { videos: [{ id: 'video', name: 'ref.mp4', type: 'video/mp4', url: 'data:video/mp4;base64,dmlkZW8=' }] }));
    tasks.push(await createVideoGenerationTask({ ...config, vquality: '1080' }, 'full-hd-text'));
    tasks.push(await createVideoGenerationTask({ ...config, vquality: '1080' }, 'full-hd-frames', [image, image]));
    for (const [overrides, images, audios] of [
        [{ model: 'default::grok-imagine-video-1.5', videoMode: 'reference' }, [image], []],
        [{}, [image, image, image], []],
        [{}, [image], [{ id: 'audio', name: 'ref.mp3', type: 'audio/mpeg', url: 'data:audio/mpeg;base64,YXVkaW8=' }]],
    ] as const) {
        const fullHd = { ...config, ...overrides, vquality: '1080', size: '1920x1080' };
        let blocked = false;
        try { await createVideoGenerationTask(fullHd, 'unsupported-full-hd', [...images], { audios: [...audios] }); } catch (error) { blocked = /1080p.*保留/.test(String(error)); }
        check(blocked && fullHd.vquality === '1080' && fullHd.size === '1920x1080', 'unsupported requests must preserve resolution and never submit');
    }
    tasks.push(await createVideoGenerationTask({ ...config, videoMode: 'reference', vquality: '720' }, 'manually-selected-720p', [image]));
    const seedance = { ...config, channels: [...config.channels, { ...config.channels[0], id: 'oneyes-minimax' }], model: 'oneyes-minimax::seedance-2.5', vquality: '720', size: 'auto' };
    tasks.push(await createVideoGenerationTask(seedance, 'seedance-frame', [image]));
    tasks.push(await createVideoGenerationTask({ ...seedance, videoWatermark: 'true', videoGenerateAudio: 'false' }, 'seedance-frames', [image, image]));
    tasks.push(await createVideoGenerationTask({ ...seedance, videoMode: 'reference', vquality: '1080', size: '1920x1080' }, 'seedance-references', [image, image, image], { audios: [{ id: 'audio', name: 'ref.mp3', type: 'audio/mpeg', url: 'data:audio/mpeg;base64,YXVkaW8=' }] }));
    check(seedance.size === 'auto' && seedance.vquality === '720', 'Seedance parameters must remain unchanged');
    const pending = await pollVideoGenerationTask(config, tasks[0]);
    check(pending.status === 'pending', 'empty HTTP 202 must remain pending');
    const completed = await pollVideoGenerationTask(config, tasks[0]);
    check(completed.status === 'completed' && completed.result.blob?.size === 5, 'native authenticated relay must produce video bytes');
    let invalid = false;
    try { await createVideoGenerationTask(config, 'invalid', [{ ...image, storageKey: 'missing-image' }]); } catch { invalid = true; }
    check(invalid, 'missing image must fail before submitting');
    invalid = false;
    try { await createVideoGenerationTask(config, 'invalid-edit', [image], { videos: [{ id: 'v', name: 'ref.mp4', type: 'video/mp4', url: 'data:video/mp4;base64,dmlkZW8=' }] }); } catch { invalid = true; }
    check(invalid, 'unsupported edit combinations must not silently discard references');
    return tasks.map(task => task.id);
} });

Object.assign(window, { videoSettingsTest: async () => {
    let current: AiConfig;
    let change: (patch: Partial<AiConfig>, inputs?: VideoReferenceSummary) => void;
    function Settings() {
        const [value, setValue] = useState({ ...config, vquality: '1080', size: '1920x1080', videoMode: 'frames' });
        const [inputs, setInputs] = useState({ imageCount: 1, audioCount: 0, videoCount: 0 });
        current = value;
        change = (patch, references) => { setValue(previous => ({ ...previous, ...patch })); if (references) setInputs(references); };
        return <CanvasVideoSettingsPopover config={value} inputs={inputs} onConfigChange={(key, field) => setValue(previous => ({ ...previous, [key]: field }))} />;
    }
    const root = createRoot(document.getElementById('root')!);
    const settled = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    try {
        flushSync(() => root.render(<Settings />));
        check(document.getElementById('root')!.textContent?.includes('1080p'), 'frame mode retains 1080p');
        flushSync(() => document.querySelector<HTMLButtonElement>('#root button')!.click());
        await settled();
        const fullHd = () => [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '1080p')!;
        check(fullHd() && !fullHd().disabled, '1080p enabled for frames');
        flushSync(() => change({ videoMode: 'reference' }));
        await settled();
        check(current!.vquality === '1080' && current!.size === '1920x1080', 'reference mode must preserve the selected resolution and dimensions');
        check(fullHd().disabled && document.querySelector('[role="status"]')?.textContent?.includes('不会自动降低'), 'reference mode explains the restriction without degrading resolution');
        flushSync(() => fullHd().click());
        check(current!.vquality === '1080', 'disabled resolution never changes the stored selection');
        flushSync(() => [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '720p')!.click());
        check(current!.vquality === '720' && current!.size === '1280x720', 'only an explicit user selection may change resolution');
        flushSync(() => change({ videoMode: 'frames', vquality: '1080' }));
        await settled();
        check(current!.vquality === '1080' && !fullHd().disabled, 'returning to frames allows choosing 1080p');
        flushSync(() => change({}, { imageCount: 3, audioCount: 0, videoCount: 0 }));
        await settled();
        check(current!.vquality === '1080' && fullHd().disabled, 'adding a third image must not lower resolution');
        flushSync(() => change({ vquality: '1080', videoMode: 'reference' }, { imageCount: 0, audioCount: 0, videoCount: 0 }));
        await settled();
        check(current!.vquality === '1080' && !fullHd().disabled, 'text-only generation keeps full HD even with reference mode selected');
        return 'GROK_VIDEO_SETTINGS_OK';
    } finally { flushSync(() => root.unmount()); }
} });

Object.assign(window, { videoWaitTest: async () => {
    const setTimer = window.setTimeout;
    // Accelerate the unchanged production cadence; no real model is called.
    window.setTimeout = ((handler: TimerHandler, ms?: number, ...args: unknown[]) => setTimer(handler, ms === 2500 ? 0 : ms, ...args)) as typeof window.setTimeout;
    try {
        const result = await waitForVideoGenerationTask(config, { id: 'long-running', provider: 'openai', model: config.model });
        check(result.blob?.size === 5, 'pending tasks past 120 queries must still download their result');
        const controller = new AbortController();
        const waiting = waitForVideoGenerationTask(config, { id: 'cancel-wait', provider: 'openai', model: config.model }, { signal: controller.signal });
        const canceled = waiting.then(() => false, () => controller.signal.aborted);
        controller.abort();
        check(await canceled, 'unbounded polling remains cancelable');
        return 'VIDEO_LONG_WAIT_OK';
    } finally { window.setTimeout = setTimer; }
} });

Object.assign(window, { videoBridgeTest: async () => {
    const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 3;
    canvas.getContext('2d')!.fillRect(0, 0, 4, 3);
    const stored = await uploadImage(canvas.toDataURL('image/png'));
    const image = { id: 'bridge-reference', name: 'fixture.png', type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey };
    for (const info of videoModelCatalog) {
        const model = 'oneyes-minimax::' + (info.id.startsWith('grok-') ? info.aliases[0] : info.id);
        const selected = { ...config, channels: [{ ...config.channels[0], id: 'oneyes-minimax' }], model, vquality: info.defaultResolution, videoSeconds: String(info.defaultSeconds), videoMode: info.modes[0], size: info.ratios.includes('16:9') ? '16:9' : info.ratios[0] };
        const motion = info.id === 'kling-3.0-motion-control';
        const images = motion ? [image] : info.id === 'grok-imagine-video-1.5' ? [{ ...image, storageKey: undefined, dataUrl: 'https://cdn.example.com/image.png', url: 'https://cdn.example.com/image.png' }] : [];
        await createVideoGenerationTask(selected, 'offline bridge fixture', images, motion ? { videos: [{ id: 'motion', name: 'motion.mp4', url: 'https://cdn.example.com/motion.mp4', durationMs: 5000 }] } : undefined);
    }
    // The same material coming from local, @ and a connection is submitted once.
    const wan = { ...config, model: 'default::wan3.0-video', size: '16:9', vquality: '1080', videoMode: 'reference' };
    await createVideoGenerationTask(wan, 'deduplicated references', [image, { ...image, id: 'mention' }, { ...image, id: 'connection' }]);
    let conflict = false;
    try { await createVideoGenerationTask(wan, 'conflict', [image, { ...image, storageKey: 'different' }]); } catch (error) { conflict = /同一参考素材 ID/.test(String(error)); }
    check(conflict, 'conflicting references must stop before POST');
    return 'VIDEO_BRIDGE_NATIVE_OK';
} });

Object.assign(window, { videoBusyTest: async () => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 4;
    const stored = await uploadImage(canvas.toDataURL('image/png'));
    const image = { id: 'busy-image', name: 'fixture.png', type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey };
    Object.assign(window.oneYesDesktop!, { videoTasks: { call: async (operation: string, args: unknown) => {
        const response = await fetch('oneyes-canvas://app/test-video-tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation, args }) });
        if (!response.ok) throw Error('Fixture task bridge failed');
        return (await response.json()).data;
    } } });
    const task = await createVideoGenerationTask({ ...config, model: 'default::wan3.0-video', size: '16:9', vquality: '720', videoMode: 'reference' }, 'busy fixture', [image]);
    check(task.id === 'busy-one-task', 'busy retry must create exactly one upstream task'); return task.nativeJobKey;
} });
