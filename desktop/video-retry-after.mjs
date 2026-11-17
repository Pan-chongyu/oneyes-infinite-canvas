/** Retry-After is a server instruction, not a deadline for the video task.
 * @param {unknown} value @param {number} [now] */
export function videoRetryAt(value, now = Date.now()) {
    if (typeof value !== 'string' || !value.trim()) return;
    const text = value.trim();
    const at = /^\d+(?:\.\d+)?$/.test(text) ? now + Number(text) * 1000 : /[A-Za-z]/.test(text) ? Date.parse(text) : NaN;
    return Number.isFinite(at) ? Math.max(now, at) : undefined;
}
