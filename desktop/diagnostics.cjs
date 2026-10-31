const { randomBytes, randomUUID, createHash } = require('node:crypto');
const { normalize } = require('./diagnostic-format.cjs');
const BASE = 'https://admin.oneyes.ai/api/canvas';
const INTERVAL = 60000, MAX_PENDING = 1000;
async function createDiagnostics({ vault, fetcher, metadata, enabled = true, clock = Date.now }) {
    if (!enabled) return { report: async () => {}, flush: async () => {}, close: async () => {} };
    const saved = await vault.read();
    const state = saved ? JSON.parse(saved) : { id: randomBytes(16).toString('hex'), secret: randomBytes(32).toString('base64url'), pending: [] };
    if (!/^[a-f0-9]{32}$/.test(state.id) || !/^[A-Za-z0-9_-]{43}$/.test(state.secret) || !Array.isArray(state.pending)) throw new Error('诊断存储损坏');
    const save = () => vault.write(JSON.stringify(state));
    await save();
    let serial = Promise.resolve(), uploading, closed = false;
    const sending = new Set();
    const controller = new AbortController();
    function write(action) { const next = serial.then(action); serial = next.catch(() => {}); return next; }
    async function post(path, body) {
        const response = await fetcher(`${BASE}/${path}`, { method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store',
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(INTERVAL)]), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.id}.${state.secret}` }, body: JSON.stringify(body) });
        // Responses are acknowledgements only; no remote instructions or settings.
        await response.body?.cancel();
        return response.status;
    }
    function report(input) {
        if (closed) return Promise.resolve();
        return write(async () => {
            const event = normalize(input);
            if (event.reason === 'cancelled') return;
            const fingerprint = createHash('sha256').update(JSON.stringify({ ...metadata, ...event })).digest('hex');
            const existing = state.pending.find(item => item.fingerprint === fingerprint && !sending.has(item.id));
            if (existing) { existing.count++; existing.last_at = clock(); }
            else state.pending.push({ ...event, ...metadata, fingerprint, id: randomUUID(), count: 1, first_at: clock(), last_at: clock() });
            state.pending = state.pending.slice(-MAX_PENDING);
            await save();
        }).catch(() => {}); // Diagnostics must never break the operation being diagnosed.
    }
    function flush() {
        if (closed) return Promise.resolve();
        if (uploading) return uploading;
        uploading = (async () => {
            const batch = await write(() => {
                const events = [];
                // Reuse the management service's existing 8 KiB request envelope.
                for (const item of state.pending) {
                    if (Buffer.byteLength(JSON.stringify({ events: [...events, item] })) > 8192) break;
                    events.push(structuredClone(item)); sending.add(item.id);
                }
                return events;
            });
            if (!batch.length) return;
            let status = await post('errors', { events: batch });
            if (status === 401) {
                const registered = await post('register', { installation_id: state.id });
                if (![200, 201].includes(registered)) return;
                status = await post('errors', { events: batch });
            }
            if (status !== 200) return;
            await write(async () => { const ids = new Set(batch.map(item => item.id)); state.pending = state.pending.filter(item => !ids.has(item.id)); await save(); });
        })().catch(() => {}).finally(() => { sending.clear(); uploading = undefined; });
        return uploading;
    }
    const timer = setInterval(flush, INTERVAL); timer.unref?.();
    void flush(); // Retry encrypted pending reports after a process restart.
    return { report, flush, async close() { closed = true; clearInterval(timer); controller.abort(); await uploading; await serial; } };
}
module.exports = { createDiagnostics, INTERVAL, MAX_PENDING };
