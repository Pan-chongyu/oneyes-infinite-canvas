// Pass only Error primitives across local IPC. The native allowlist removes
// messages, URLs, paths and user data before encrypting or uploading anything.
export function reportError(component: string, stage: string, error: unknown) {
    if (typeof window === 'undefined' || !window.oneYesDesktop?.diagnostics) return;
    try {
        const value = error as { name?: string; message?: string; stack?: string; code?: string; status?: number; response?: { status?: number } } | null;
        const primitive = {
            name: typeof value?.name === 'string' ? value.name : 'Error',
            message: typeof value?.message === 'string' ? value.message : '',
            stack: typeof value?.stack === 'string' ? value.stack : '',
            code: typeof value?.code === 'string' ? value.code : '',
            status: Number(value?.status || value?.response?.status) || 0,
        };
        void window.oneYesDesktop.diagnostics.report({ component, stage, error: primitive }).catch(() => {});
    } catch { /* Reporting never interrupts the user's operation. */ }
}
export function initializeDiagnostics() {
    if (!window.oneYesDesktop?.diagnostics) return;
    window.addEventListener('error', event => reportError('app', 'renderer', event.error || { message: event.message }));
    window.addEventListener('unhandledrejection', event => reportError('app', 'renderer', event.reason));
}
