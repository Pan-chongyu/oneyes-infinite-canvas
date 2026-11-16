const { randomUUID, createHash } = require('node:crypto');
const { join } = require('node:path');
const { mkdir, open, rename, stat, unlink } = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { Readable } = require('node:stream');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const fingerprint = value => createHash('sha256').update(value).digest('hex');
const site = value => {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error('视频站点地址无效');
    return url.href.replace(/\/+$/, '');
};
const sameSite = (a, b) => site(a) === site(b) || /^https:\/\/(?:api\.)?oneyes\.ai(?:\/v1)?$/.test(site(a)) && /^https:\/\/(?:api\.)?oneyes\.ai(?:\/v1)?$/.test(site(b));
const api = base => /\/v1$/.test(base) ? base : base + '/v1';
const terminal = new Set(['failed', 'missing', 'expired', 'unknown', 'not_submitted', 'confirmation']);
const message = value => typeof value === 'string' ? value : value?.message || value?.error?.message || value?.msg || '';
function unwrap(value) {
    if (value?.code !== undefined) {
        if (![0, '0'].includes(value.code)) throw Error(message(value) || '站点返回视频错误');
        return value.data;
    }
    return value;
}
async function hashFile(path) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest('hex');
}
async function syncDirectory(directory) {
    // Windows does not expose directory fsync; file FlushFileBuffers still runs.
    if (process.platform === 'win32') return;
    const handle = await open(directory, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
}
function probeVideo(binary) {
    return async path => {
        const { stdout } = await promisify(execFile)(binary, ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_streams', '-show_format', '-of', 'json', path], { windowsHide: true });
        const data = JSON.parse(stdout), video = data.streams?.find(stream => stream.codec_type === 'video');
        if (!video?.width || !video.height || !(Number(data.format?.duration) > 0)) throw Error('视频文件无法完整读取，已保留任务，请重试取回');
        return { width: video.width, height: video.height, durationMs: Number(data.format.duration) * 1000, mimeType: /webm/.test(data.format.format_name) ? 'video/webm' : 'video/mp4' };
    };
}

// The journal contains receipts and an irreversible credential identity, never
// API keys or expiring download URLs. Workers can only GET an existing receipt.
function createVideoTasks({ directory, vault, credentials, fetcher, probe, changed = () => {}, report = () => {}, interval = 2500 }) {
    let jobs = [], queue = Promise.resolve(), closed = false;
    const active = new Map(), transientCredentials = new Map();
    const serial = action => { const next = queue.then(action); queue = next.catch(() => {}); return next; };
    const files = join(directory, 'video-results');
    const ready = (async () => {
        const stored = await vault.read();
        if (stored) {
            const data = JSON.parse(stored);
            if (data.version !== 1 || !Array.isArray(data.jobs) || data.jobs.some(job => !/^[a-f0-9-]{36}$/.test(job.key))) throw Error('视频任务清单损坏，已保留原文件');
            jobs = data.jobs;
            for (const job of jobs) if (!job.taskId && ['prepared', 'submitting'].includes(job.state)) { job.state = 'unknown'; job.reason = '上次提交未取得可靠回执，请先核对官网任务和用量；不会自动重新生成'; }
            for (const job of jobs) if (!job.taskId && job.state === 'throttled') { job.state = 'not_submitted'; job.reason = '上次请求因大素材繁忙未提交上游，等待已被退出中断。原幂等键与参数已保留；不会自动重建或重新生成'; }
        }
        await mkdir(files, { recursive: true, mode: 0o700 });
    })();
    ready.catch(error => report('load', error));
    const view = () => jobs.map(job => ({ ...job, parameters: { ...job.parameters } }));
    async function save() { await vault.write(JSON.stringify({ version: 1, jobs })); changed(view()); }
    const get = key => { const job = jobs.find(item => item.key === key); if (!job) throw Error('视频任务不存在'); return job; };
    async function patch(job, values) { await serial(async () => { Object.assign(job, values, { updatedAt: Date.now() }); await save(); }); }
    const resultPath = (job, temporary = false) => join(files, job.key + (temporary ? '.part' : '.video'));
    async function credential(job) {
        const available = await credentials();
        return available.find(item => item.id === job.channelId && sameSite(item.baseUrl, job.site) && fingerprint(item.apiKey || '') === job.credential && (!job.accountId || item.oneYes?.accountId === job.accountId))
            || transientCredentials.get(job.key);
    }
    async function readJson(url, headers, signal) {
        const response = await fetcher(url, { method: 'GET', headers, signal, redirect: 'manual', credentials: 'omit' });
        if (!response.ok) {
            const retry = response.headers.get('retry-after');
            const retryAt = retry ? (/^\d+(?:\.\d+)?$/.test(retry) ? Date.now() + Number(retry) * 1000 : Date.parse(retry)) : undefined;
            await response.body?.cancel(); throw Object.assign(Error(`查询视频失败（HTTP ${response.status}）`), { status: response.status, phase: 'query', retryAt });
        }
        return unwrap(await response.json());
    }
    async function resultSource(job, current, signal) {
        const base = job.site;
        if (job.provider === 'gemini') {
            const root = /\/v1(?:beta)?$/.test(base) ? base : base + '/v1beta';
            // Operation names are paths below this exact site, never full URLs.
            if (!/^(?:[A-Za-z0-9._~-]+\/)*operations\/[A-Za-z0-9._~-]+$/.test(job.taskId) || job.taskId.split('/').some(part => part === '.' || part === '..')) throw Error('Gemini 任务回执路径无效');
            const data = await readJson(root + '/' + job.taskId, { 'x-goog-api-key': current.apiKey }, signal);
            if (data.error) return { error: message(data.error), state: 'failed' };
            if (!data.done) return null;
            const uri = data.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
            if (!uri) throw Error('原任务已结束，但上游尚未提供视频下载入口，请重试查询');
            const url = new URL(uri);
            // Native Gemini media endpoints use the same Google API host. Never
            // forward the key to a third-party URI supplied in a response.
            const trusted = url.origin === new URL(base).origin && url.pathname.startsWith('/v1');
            url.searchParams.delete('key');
            return { url: url.href, headers: trusted ? { 'x-goog-api-key': current.apiKey } : {} };
        }
        const path = '/videos/' + encodeURIComponent(job.taskId), headers = { Authorization: 'Bearer ' + current.apiKey };
        const data = await readJson(api(base) + path, headers, signal);
        if (['failed', 'cancelled', 'canceled', 'expired'].includes(data.status)) return { error: message(data.error) || `上游任务已${data.status === 'expired' ? '过期' : '结束失败'}，不会重新生成`, state: data.status === 'expired' ? 'expired' : 'failed' };
        if (data.video?.respect_moderation === false) return { error: '素材未通过上游审核，不会自动重新生成或绕过审核', state: 'failed' };
        const source = [data.video?.url, data.video_url, data.result_url, data.url, data.content?.video_url, data.content?.url].find(value => typeof value === 'string' && /^(?:https?:\/\/|\/v1\/videos\/)/.test(value));
        if (!source && !['completed', 'done', 'succeeded', 'success'].includes(data.status)) return null;
        const relay = api(base) + path + '/content';
        if (!source) return { url: relay, headers };
        const url = new URL(source, base), original = new URL(base);
        const isRelay = (url.origin === original.origin || /^https:\/\/(?:api\.)?oneyes\.ai$/.test(url.origin) && /^https:\/\/(?:api\.)?oneyes\.ai$/.test(original.origin)) && url.pathname === new URL(relay).pathname;
        return isRelay ? { url: relay, headers } : { url: url.href, headers: {} };
    }
    async function verified(job, path) {
        const data = await probe(path), metadata = await stat(path);
        if (!metadata.size) throw Error('视频文件为空');
        return { ...data, bytes: metadata.size, sha256: await hashFile(path), storageKey: 'video-job:' + job.key, url: 'oneyes-canvas://app/video-tasks/' + job.key + '/content' };
    }
    async function download(job, source, signal) {
        const url = new URL(source.url);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('视频下载地址无效');
        let offset = 0;
        try { offset = (await stat(resultPath(job, true))).size; } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (!job.etag || job.etag.startsWith('W/')) offset = 0;
        const response = await fetcher(url.href, { method: 'GET', redirect: Object.keys(source.headers).length ? 'manual' : 'follow', credentials: 'omit', headers: { ...source.headers, ...(offset ? { Range: `bytes=${offset}-`, 'If-Range': job.etag } : {}) }, signal });
        if (!response.ok || !response.body) { await response.body?.cancel(); throw Object.assign(Error(`视频下载失败（HTTP ${response.status}），将重新查询原任务获取有效下载入口`), { status: response.status, phase: 'download' }); }
        const range = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/), etag = response.headers.get('etag');
        if (response.status === 206 && (!offset || !range || Number(range[1]) !== offset || etag !== job.etag)) {
            await response.body.cancel(); await unlink(resultPath(job, true)).catch(error => { if (error.code !== 'ENOENT') throw error; });
            throw Error('续传校验不一致，已保留原任务，下次重新下载同一结果');
        }
        const append = offset > 0 && response.status === 206;
        const expected = range ? Number(range[3]) : Number(response.headers.get('content-length')) || undefined;
        await patch(job, { state: 'downloading', reason: undefined, etag: etag || undefined });
        const handle = await open(resultPath(job, true), append ? 'a' : 'w', 0o600);
        try {
            for await (const chunk of response.body) { signal.throwIfAborted(); await handle.writeFile(chunk); }
            await handle.sync();
        } finally { await handle.close(); }
        if (expected && (await stat(resultPath(job, true))).size !== expected) throw Error('视频下载不完整，已保留原任务等待恢复');
        await patch(job, { state: 'saving' });
        const result = await verified(job, resultPath(job, true));
        await rename(resultPath(job, true), resultPath(job)); await syncDirectory(files);
        await patch(job, { state: 'saved', result, reason: undefined, etag: undefined });
    }
    async function run(job) {
        if (closed || active.has(job.key) || !job.taskId || job.state === 'saved' || terminal.has(job.state) || job.retryAt > Date.now()) return;
        const controller = new AbortController(); let finish;
        controller.done = new Promise(resolve => { finish = resolve; }); active.set(job.key, controller);
        try {
            // Crash after rename but before saving the final journal record.
            try {
                await stat(resultPath(job));
                await patch(job, { state: 'saved', result: await verified(job, resultPath(job)), reason: undefined }); return;
            } catch (error) { if (error.code !== 'ENOENT') throw error; }
            const current = await credential(job);
            if (!current) { if (job.state !== 'credentials') await patch(job, { state: 'credentials', reason: '请恢复提交时的站点、账号和 API Key；不会切换账号查询此任务' }); return; }
            if (job.authRejected) return;
            await patch(job, { state: 'querying', reason: undefined, retryAt: undefined });
            const source = await resultSource(job, current, controller.signal);
            if (!source) { await patch(job, { state: 'pending' }); return; }
            if (source.error) { await patch(job, { state: source.state, reason: source.error }); return; }
            await download(job, source, controller.signal);
        } catch (error) {
            if (closed) return;
            const state = error.phase === 'query' && [404, 410].includes(error.status) ? (error.status === 404 ? 'missing' : 'expired')
                : [401, 403].includes(error.status) && error.phase === 'query' ? 'credentials'
                : error.phase === 'query' && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status) ? 'failed'
                : ['ENOSPC', 'EACCES', 'EPERM', 'EIO', 'EROFS'].includes(error.code) ? 'save_error'
                : error.phase === 'download' ? 'download_error' : 'waiting';
            const reason = state === 'missing' ? '上游找不到原任务（404），请核对提交账号和站点任务保留期；任务记录已保留，不会重新生成'
                : state === 'expired' ? '上游任务已过期（410），请联系站点确认保留期；不会重新生成'
                : state === 'credentials' ? '原任务凭据失效，请重新登录或恢复原 API Key 后重试'
                : state === 'save_error' ? '视频保存失败，请检查磁盘空间和目录权限后重试；原任务已保留' : error.message || '网络不可用，等待恢复后继续查询原任务';
            report(state, error);
            await patch(job, { state, reason, retryAt: Number.isFinite(error.retryAt) ? error.retryAt : undefined, ...(state === 'credentials' ? { authRejected: true } : {}) }).catch(error => { changed(view()); report('save', error); });
        } finally { active.delete(job.key); finish(); }
    }
    const tick = async () => { await ready; if (!closed) for (const job of jobs) void run(job); };
    const timer = setInterval(() => { void tick().catch(error => report('load', error)); }, interval); timer.unref?.();
    void tick().catch(() => {});
    return {
        async list() { await ready; return view(); },
        async prepare(input) {
            await ready;
            const base = site(input.site);
            if (!input.apiKey || !input.channelId || !['openai', 'gemini'].includes(input.provider) || typeof input.model !== 'string') throw Error('视频恢复信息无效');
            const key = randomUUID();
            const job = { key, idempotencyKey: key, retryLargeMaterial: input.retryLargeMaterial === true, model: input.model, site: base, channelId: input.channelId, accountId: input.accountId, credential: fingerprint(input.apiKey), provider: input.provider,
                parameters: Object.fromEntries(['prompt', 'size', 'vquality', 'videoSeconds', 'videoMode', 'videoGenerateAudio', 'videoWatermark'].map(key => [key, String(input.parameters?.[key] ?? '')])),
                references: (input.references || []).map(item => ({ id: item.id, storageKey: item.storageKey })),
                target: input.target && { projectId: String(input.target.projectId), nodeId: String(input.target.nodeId) }, createdAt: Date.now(), state: 'prepared' };
            // Transient credentials support a just-entered manual key. A cold
            // start still requires the user's existing secure config vault.
            transientCredentials.set(job.key, { apiKey: input.apiKey });
            await serial(async () => { jobs.push(job); await save(); }); return job.key;
        },
        async beforeSubmit(key, url, headers, body) {
            await ready; const job = get(key), parsed = new URL(url);
            if (!['prepared', 'throttled'].includes(job.state) || !sameSite(parsed.origin + new URL(job.site).pathname.replace(/\/$/, ''), job.site)
                || fingerprint(headers.Authorization?.replace(/^Bearer /, '') || headers.authorization?.replace(/^Bearer /, '') || headers['x-goog-api-key'] || '') !== job.credential) throw Error('视频提交关联校验失败，已停止重复提交');
            const idempotency = headers['Idempotency-Key'] || headers['idempotency-key'];
            const contentType = headers['Content-Type'] || headers['content-type'];
            if (idempotency && idempotency !== job.idempotencyKey) throw Error('原视频幂等键不一致，已停止提交');
            const root = new URL(job.site).pathname.replace(/\/$/, '');
            if (!parsed.pathname.startsWith(root + '/') || !/(?:\/videos(?:\/generations|\/edits)?|:predictLongRunning)$/.test(parsed.pathname)) throw Error('视频提交路径无效');
            let sent;
            if (body) {
                const request = new Response(body, { headers });
                const data = /multipart\/form-data/i.test(request.headers.get('content-type') || '') ? Object.fromEntries(await request.formData()) : await request.json();
                sent = Object.fromEntries(['model', 'duration', 'seconds', 'resolution', 'size', 'aspect_ratio', 'ratio', 'parameters'].filter(key => data[key] !== undefined).map(key => [key, data[key]]));
            }
            await serial(async () => {
                const hash = body ? fingerprint(Buffer.from(body)) : undefined;
                if (job.state !== 'prepared' && !(job.state === 'throttled' && job.retryLargeMaterial && idempotency === job.idempotencyKey && job.requestHash === hash && job.requestUrl === parsed.href && job.requestContentType === contentType && job.retryAt <= Date.now())) throw Error('此视频已提交、原请求发生变化或尚未到重试时间，已停止重复提交');
                Object.assign(job, { state: 'submitting', submittedAt: Date.now(), updatedAt: Date.now(), sentParameters: sent, requestHash: hash, requestUrl: parsed.href, requestContentType: contentType });
                await save();
            });
        },
        async receipt(key, response) {
            const job = get(key);
            let data;
            try { data = await response.clone().json(); } catch { /* Preserve uncertain submission, never replay. */ }
            if (job.retryLargeMaterial && response.status === 429 && (data?.error?.code || data?.code) === 'large_material_busy') {
                const retry = response.headers.get('retry-after') || '5';
                const at = /^\d+(?:\.\d+)?$/.test(retry) ? Date.now() + Number(retry) * 1000 : Date.parse(retry);
                await patch(job, { state: 'throttled', retryAt: Number.isFinite(at) ? at : Date.now() + 5000, reason: '大素材通道繁忙，尚未提交上游；按服务器要求等待，随后使用同一幂等键提交原请求' }); return;
            }
            try { data = unwrap(data); } catch { /* Retain uncertain response without replaying it. */ }
            const id = data?.request_id || data?.id || data?.name;
            if (response.ok && typeof id === 'string' && id) {
                await patch(job, { taskId: id, state: 'pending' }); void run(job); return;
            }
            await patch(job, { state: response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status) ? 'failed' : 'unknown', reason: message(data) || '未取得可靠任务 ID，请先核对官网任务和用量；不会自动重新提交' });
        },
        async submissionError(key, reason) {
            await ready; const job = get(key);
            if (job.taskId || terminal.has(job.state)) return;
            if (job.state === 'throttled') { await patch(job, { state: 'not_submitted', reason: '大素材繁忙等待已中断，尚未提交上游；原幂等键与参数保留，不会自动重新生成' }); return; }
            await patch(job, { state: job.state === 'prepared' ? 'failed' : 'unknown', reason: job.state === 'prepared' ? reason : '提交结果不确定，请先核对官网任务与用量；不会自动重新生成' });
        },
        async adopt(input) {
            await ready;
            if (!input.taskId) throw Error('缺少历史任务 ID，无法安全恢复');
            const existing = jobs.find(job => job.taskId === input.taskId && job.provider === input.provider && job.credential === fingerprint(input.apiKey) && sameSite(job.site, input.site));
            if (existing) {
                if (!existing.target && input.target) await patch(existing, { target: input.target }); return existing.key;
            }
            const key = await this.prepare(input), job = get(key);
            await patch(job, { taskId: String(input.taskId), state: 'confirmation', legacy: true, reason: '历史任务未记录原账号身份。请先确认当前渠道属于原提交账号，再点击“确认原账号并恢复”；不会重新生成' }); return key;
        },
        async retry(key) {
            await ready; const job = get(key);
            if (!job.taskId) throw Error('没有任务 ID，不能自动重建付费任务；请先核对官网任务与用量');
            if (job.state !== 'saved') await patch(job, { state: 'pending', reason: undefined, authRejected: undefined });
            void run(job); return view();
        },
        async request(request) {
            await ready;
            const match = new URL(request.url).pathname.match(/^\/video-tasks\/([a-f0-9-]{36})\/content$/);
            if (!match || !['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 404 });
            const job = get(match[1]);
            if (job.state !== 'saved') return new Response(null, { status: 409 });
            const path = resultPath(job), size = (await stat(path)).size;
            if (size !== job.result.bytes) throw Error('已保存的视频文件大小不一致，请重新取回');
            const range = request.headers.get('range')?.match(/^bytes=(\d+)-(\d*)$/), start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
            if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
            return new Response(request.method === 'HEAD' ? null : Readable.toWeb(createReadStream(path, { start, end })), { status: range ? 206 : 200,
                headers: { 'Content-Type': job.result.mimeType, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) } });
        },
        async wake() {
            transientCredentials.clear(); await ready;
            for (const controller of active.values()) controller.abort();
            await serial(async () => { for (const job of jobs) delete job.authRejected; });
            return tick();
        },
        async close() {
            closed = true; clearInterval(timer);
            const workers = [...active.values()]; for (const controller of workers) controller.abort();
            await Promise.allSettled(workers.map(controller => controller.done)); await queue;
        },
    };
}
module.exports = { createVideoTasks, probeVideo };
