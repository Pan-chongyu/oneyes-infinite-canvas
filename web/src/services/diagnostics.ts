// Pass only Error primitives across local IPC. The native allowlist removes
// messages, URLs, paths and user data before encrypting or uploading anything.
export function diagnosticError(error: unknown, seen = new Set<unknown>()): Record<string, unknown> | undefined {
    if (error == null || seen.has(error)) return;
    seen.add(error);
    const value = error as { name?: string; message?: string; stack?: string; code?: string; status?: number; response?: { status?: number }; cause?: unknown; diagnosticOperation?: string };
    return {
        name: typeof value.name === 'string' ? value.name : 'Error',
        message: typeof error === 'string' ? error : typeof value.message === 'string' ? value.message : '',
        stack: typeof value.stack === 'string' ? value.stack : '',
        code: typeof value.code === 'string' ? value.code : '',
        status: Number(value.status || value.response?.status) || 0,
        diagnosticOperation: value.diagnosticOperation,
        ...(value.cause != null ? { cause: diagnosticError(value.cause, seen) } : {}),
    };
}
export function reportError(component: string, stage: string, error: unknown, operation?: string) {
    if (typeof window === 'undefined' || !window.oneYesDesktop?.diagnostics) return;
    try {
        void window.oneYesDesktop.diagnostics.report({ component, stage, error: diagnosticError(error), operation }).catch(() => {});
    } catch { /* Reporting never interrupts the user's operation. */ }
}
export function initializeDiagnostics() {
    if (!window.oneYesDesktop?.diagnostics) return;
    window.addEventListener('error', event => reportError('app', 'renderer', event.error || { message: event.message }));
    window.addEventListener('unhandledrejection', event => reportError('app', 'renderer', event.reason));
}
export function reportRecovery(component: string, stage: string, operation: string) {
    try { void window.oneYesDesktop?.diagnostics?.recover({ component, stage, operation }).catch(() => {}); }
    catch { /* Older desktop bridges may not expose recovery receipts. */ }
}
