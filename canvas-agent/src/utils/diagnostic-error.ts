// These primitives cross local IPC only. The parent performs the upload allowlist.
export function diagnosticError(input: unknown, seen = new Set<unknown>()): Record<string, unknown> | undefined {
    if (input == null || seen.has(input)) return;
    seen.add(input);
    const value = input as Error & { code?: string; status?: number; diagnosticOperation?: string };
    return {
        name: typeof value.name === 'string' ? value.name : 'Error',
        message: typeof input === 'string' ? input : typeof value.message === 'string' ? value.message : '',
        stack: typeof value.stack === 'string' ? value.stack : '',
        code: typeof value.code === 'string' ? value.code : '',
        status: typeof value.status === 'number' ? value.status : 0,
        diagnosticOperation: value.diagnosticOperation,
        ...(value.cause != null ? { cause: diagnosticError(value.cause, seen) } : {}),
    };
}
