import axios from 'axios';

export function videoBridgeErrorCode(value: unknown): string | undefined {
    if (!value || typeof value !== 'object') return;
    const data = value as { code?: unknown; error?: { code?: unknown } };
    const code = data.error?.code ?? data.code;
    return typeof code === 'string' ? code : undefined;
}
function wait(milliseconds: number, signal?: AbortSignal) {
    signal?.throwIfAborted();
    return new Promise<void>((resolve, reject) => {
        const cleanup = () => signal?.removeEventListener('abort', abort);
        const timer = setTimeout(() => { cleanup(); resolve(); }, milliseconds);
        const abort = () => { clearTimeout(timer); cleanup(); reject(signal?.reason); };
        signal?.addEventListener('abort', abort, { once: true });
    });
}

// Only this explicit bridge rejection guarantees no upstream submission.
// Reuse the already serialized Blob, exact boundary and durable idempotency key.
export async function submitVideoBridge<T>(url: string, body: Blob, headers: Record<string, string | undefined>, signal?: AbortSignal) {
    for (;;) {
        signal?.throwIfAborted();
        try { return await axios.post<T>(url, body, { headers, signal, timeout: 0 }); }
        catch (error) {
            if (signal?.aborted || !axios.isAxiosError(error) || error.response?.status !== 429 || videoBridgeErrorCode(error.response.data) !== 'large_material_busy' || !headers['Idempotency-Key']) throw error;
            const retry = String(error.response.headers['retry-after'] ?? '5');
            const milliseconds = /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now();
            await wait(Number.isFinite(milliseconds) && milliseconds >= 0 ? milliseconds : 5000, signal);
        }
    }
}
