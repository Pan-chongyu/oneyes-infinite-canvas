import { videoErrorCode, videoErrorMessages, videoErrorText, videoSiteRequestId } from './video-errors.mjs';

const phases = ['submit', 'poll', 'download'];
const bridgeId = value => typeof value === 'string' && /^br_[a-f0-9]{32}$/.test(value) ? value : undefined;
const gatewayId = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value) ? value : undefined;
const publicCode = value => typeof value === 'string' && Object.hasOwn(videoErrorMessages, value) ? value : undefined;
const privateIdentifier = value => /\b(?:sk[-_]|Bearer\s|api[-_ ]?key|access[_-]?token)/i.test(value);
const time = value => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
const localTime = value => time(value) && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : undefined;
function json(value) { if (typeof value !== 'string') return value; try { return JSON.parse(value); } catch { return undefined; } }

/** Keep only the latest response per phase; never retain request/response bodies.
 * @param {string} url @param {any} data @param {any} headers @param {number} status */
export function videoRequestDiagnostic(url, data, headers, status) {
    data = json(data);
    const trusted = /^https:\/\/(?:api\.)?oneyes\.ai(?:\/|$)|^oneyes-canvas:\/\/app\/oneyes-api(?:\/|$)/i.test(url);
    const header = headers?.get?.('x-request-id') ?? headers?.['x-request-id'] ?? headers?.['X-Request-Id'];
    const failed = status >= 400 || ['failed', 'error', 'expired', 'cancelled', 'canceled'].includes(data?.status || data?.data?.status);
    return {
        at: Date.now(),
        bridgeRequestId: trusted ? bridgeId(data?.bridge_request_id) || bridgeId(header) : undefined,
        gatewayRequestId: trusted ? videoSiteRequestId(url, headers || {}) : undefined,
        errorCode: failed ? publicCode(videoErrorCode(data)) : undefined,
        message: failed ? videoErrorText(data, { status }) : undefined,
    };
}

/** Revalidate persisted/IPC data before copying it into a project or clipboard. @param {any} value */
export function safeVideoDiagnostics(value) {
    /** @type {Record<string, ReturnType<typeof videoRequestDiagnostic>>} */
    const output = {};
    for (const phase of phases) {
        const item = value?.[phase];
        if (!time(item?.at)) continue;
        output[phase] = { at: item.at, bridgeRequestId: bridgeId(item.bridgeRequestId), gatewayRequestId: gatewayId(item.gatewayRequestId),
            errorCode: publicCode(item.errorCode), message: item.message ? videoErrorText(item.message) : undefined };
    }
    return output;
}

/** A deliberately separate whitelist from ordinary node/project JSON. @param {any} job */
export function videoDiagnosticReport(job) {
    const model = typeof job.model === 'string' ? job.model.split('::').at(-1) : '';
    const modelId = !privateIdentifier(model) && /^[\p{L}\p{N}_. -]+(?: [\[【][\p{L}\p{N} ._:¥￥$\/;；×–—-]+[\]】])?$/u.test(model) ? model : undefined;
    return JSON.stringify({
        jobId: typeof job.diagnosticId === 'string' && /^[a-f0-9-]{36}$/.test(job.diagnosticId) && job.diagnosticId !== job.key && job.diagnosticId !== job.idempotencyKey ? job.diagnosticId : undefined,
        taskId: typeof job.taskId === 'string' && !privateIdentifier(job.taskId) && /^[A-Za-z0-9_-]+$/.test(job.taskId) ? job.taskId : undefined,
        modelId, createdAt: time(job.createdAt), updatedAt: time(job.updatedAt), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        errorCode: publicCode(job.errorCode), message: job.reason ? videoErrorText(job.reason, { state: job.state }) : undefined,
        requests: Object.fromEntries(Object.entries(safeVideoDiagnostics(job.diagnostics)).map(([stage, item]) => [stage, { ...item, stage, localTime: localTime(item.at) }])),
    }, null, 2);
}
