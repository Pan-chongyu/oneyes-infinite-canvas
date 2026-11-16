const { createVideoTasks, probeVideo } = require('../../desktop/video-tasks.cjs');
const { createVault } = require('../../desktop/vault.cjs');
const { join } = require('node:path');
const directory = process.env.VIDEO_TEST_DIRECTORY, base = process.env.VIDEO_TEST_BASE;
let available = process.env.VIDEO_TEST_CREDENTIALS !== 'none';
const key = 'fixture-key', channel = { id: 'fixture', apiKey: key, baseUrl: base };
const probe = probeVideo(join(__dirname, '../../desktop/media-bin/ffprobe' + (process.platform === 'win32' ? '.exe' : '')));
const manager = createVideoTasks({ directory, vault: createVault(directory, 'video-tasks'), fetcher: fetch,
    credentials: async () => available ? [channel] : [], interval: 30,
    probe: async path => {
        if (process.env.VIDEO_TEST_DISK === 'full') throw Object.assign(Error('disk full'), { code: 'ENOSPC' });
        return probe(path);
    },
    changed: jobs => process.send?.({ jobs }), report: (stage, error) => process.send?.({ stage, error: error.message }) });
process.on('message', async input => {
    try {
        if (input === 'credentials') { available = true; await manager.wake(); }
        if (input === 'retry') await manager.retry((await manager.list())[0].key);
        if (input === 'list') process.send({ jobs: await manager.list() });
    } catch (error) { process.send({ fatal: error.stack }); }
});
(async () => {
    const input = { site: base, apiKey: key, channelId: 'fixture', model: 'fixture::offline-video', provider: process.env.VIDEO_TEST_PROVIDER || 'openai', retryLargeMaterial: process.env.VIDEO_TEST_RETRY_LARGE === '1',
        parameters: { prompt: 'offline fixture', size: '16:9', vquality: '1080', videoSeconds: '5' }, target: { projectId: 'persisted-project', nodeId: 'original-video' } };
    if (process.env.VIDEO_TEST_MODE === 'submit') {
        const id = await manager.prepare(input), url = base + (input.provider === 'gemini' ? '/v1beta/models/offline-video:predictLongRunning' : '/v1/videos'), headers = { ...(input.provider === 'gemini' ? { 'x-goog-api-key': key } : { Authorization: 'Bearer ' + key }), 'Content-Type': 'application/json' };
        headers['Idempotency-Key'] = id;
        const body = JSON.stringify({ model: 'offline-video', prompt: 'fixture', resolution: '1080p', duration: 5 });
        await manager.beforeSubmit(id, url, headers, body);
        await manager.receipt(id, await fetch(url, { method: 'POST', headers, body }));
        process.send({ submitted: id });
    } else if (process.env.VIDEO_TEST_MODE === 'adopt') {
        await manager.adopt({ ...input, taskId: 'receipt-1' });
    } else process.send({ loaded: true, jobs: await manager.list() });
})().catch(error => process.send({ fatal: error.stack }));
