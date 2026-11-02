const { randomBytes, randomUUID, createHash } = require('node:crypto');
const { normalize } = require('./diagnostic-format.cjs');
const BASE = 'https://admin.oneyes.ai/api/canvas';
const INTERVAL = 60000, MAX_PENDING = 1000;
async function createDiagnostics({ vault, fetcher, metadata, enabled = true, clock = Date.now }) {
    if (!enabled) return { report: async () => {}, recover: async () => {}, flush: async () => {}, close: async () => {} };
    const saved = await vault.read();
    const state = saved ? JSON.parse(saved) : { id: randomBytes(16).toString('hex'), secret: randomBytes(32).toString('base64url'), pending: [] };
    if (!/^[a-f0-9]{32}$/.test(state.id) || !/^[A-Za-z0-9_-]{43}$/.test(state.secret) || !Array.isArray(state.pending)) throw new Error('诊断存储损坏');
    state.active ||= [];
    state.resolved ||= [];
    if (!Array.isArray(state.active) || !Array.isArray(state.resolved)) throw new Error('诊断存储损坏');
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
            if (event.operation) {
                const item = state.pending.at(-1);
                const reported = existing || item;
                if (!state.active.some(value => value.id === reported.id)) state.active.push({ id: reported.id, component: event.component, stage: event.stage, operation: event.operation });
                state.active = state.active.slice(-MAX_PENDING);
            }
            await save();
        }).catch(() => {}); // Diagnostics must never break the operation being diagnosed.
    }
    function recover(input) {
        if (closed) return Promise.resolve();
        return write(async () => {
            const scope = normalize(input);
            if (!scope.operation) return;
            const ids = new Set(state.active.filter(item => item.component === scope.component && item.stage === scope.stage && item.operation === scope.operation).map(item => item.id));
            if (!ids.size) return;
            // Keep receipts in the same encrypted queue and the existing 1000-entry bound.
            // In-flight reports may still arrive; the server tombstones these exact IDs.
            state.resolved = [...new Set([...state.resolved, ...ids])].slice(-MAX_PENDING);
            state.active = state.active.filter(item => !ids.has(item.id));
            state.pending = state.pending.filter(item => !ids.has(item.id));
            await save();
        }).catch(() => {});
    }
    function flush() {
        if (closed) return Promise.resolve();
        if (uploading) return uploading;
        uploading = (async () => {
            const batch = await write(() => {
                const events = [], resolved = [];
                for (const id of state.resolved) {
                    if (Buffer.byteLength(JSON.stringify({ events, resolved: [...resolved, id] })) > 8192) break;
                    resolved.push(id);
                }
                // Reuse the management service's existing 8 KiB request envelope.
                for (const item of state.pending) {
                    if (Buffer.byteLength(JSON.stringify({ events: [...events, item], ...(resolved.length ? { resolved } : {}) })) > 8192) break;
                    events.push(structuredClone(item)); sending.add(item.id);
                }
                return { events, ...(resolved.length ? { resolved } : {}) };
            });
            if (!batch.events.length && !batch.resolved?.length) return;
            let status = await post('errors', batch);
            if (status === 401) {
                const registered = await post('register', { installation_id: state.id });
                if (![200, 201].includes(registered)) return;
                status = await post('errors', batch);
            }
            if (status !== 200) return;
            await write(async () => {
                const ids = new Set(batch.events.map(item => item.id)), resolved = new Set(batch.resolved || []);
                state.pending = state.pending.filter(item => !ids.has(item.id));
                state.resolved = state.resolved.filter(id => !resolved.has(id));
                await save();
            });
        })().catch(() => {}).finally(() => { sending.clear(); uploading = undefined; });
        return uploading;
    }
    const timer = setInterval(flush, INTERVAL); timer.unref?.();
    void flush(); // Retry encrypted pending reports after a process restart.
    return { report, recover, flush, async close() { closed = true; clearInterval(timer); controller.abort(); await uploading; await serial; } };
}
module.exports = { createDiagnostics, INTERVAL, MAX_PENDING };
