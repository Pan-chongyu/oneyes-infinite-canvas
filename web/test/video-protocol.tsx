import { defaultConfig, useConfigStore } from '@/stores/use-config-store';
import { initializeDesktopTransport } from '@/services/api/desktop-transport';
import { createVideoGenerationTask, pollVideoGenerationTask } from '@/services/api/video';
import { uploadImage } from '@/services/image-storage';
import type { ReferenceImage } from '@/types/image';
import '@/i18n';

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
