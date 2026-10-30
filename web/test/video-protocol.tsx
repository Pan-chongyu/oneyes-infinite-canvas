import { defaultConfig, useConfigStore } from '@/stores/use-config-store';
import { initializeDesktopTransport } from '@/services/api/desktop-transport';
import { createVideoGenerationTask, pollVideoGenerationTask } from '@/services/api/video';
import { uploadImage } from '@/services/image-storage';
import type { ReferenceImage } from '@/types/image';
import '@/i18n';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { CanvasVideoSettingsPopover } from '@/components/canvas/canvas-video-settings-popover';
import type { AiConfig } from '@/stores/use-config-store';
import type { VideoReferenceSummary } from '@/lib/video-capabilities';

Object.assign(window, { oneYesDesktop: {} });
initializeDesktopTransport();
const config = { ...defaultConfig, channels: [{ ...defaultConfig.channels[0], apiKey: 'fixture-key' }], model: 'default::grok-imagine-video', size: '1:1', vquality: '480', videoSeconds: '5', proxyEnabled: true, proxyMode: 'upstream' as const };
useConfigStore.setState({ config });
const check = (value: unknown, message: string) => { if (!value) throw Error(message); };
Object.assign(window, { videoTest: async () => {
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
