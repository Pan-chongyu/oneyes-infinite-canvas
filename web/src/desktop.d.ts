export {};
declare global {
    interface Window {
        oneYesDesktop?: {
            models: { list(apiKey: string): Promise<{ data?: string[]; error?: string }> };
            proxy: { test(config: import('./services/api/local-proxy').ProxySettings): Promise<{ data?: { status: number }; error?: string }> };
            agent: { call(operation: 'status' | 'setup' | 'restore'): Promise<{ data?: { configured: boolean; url?: string; token?: string }; error?: string }> };
            storage: { getItem(name: string): Promise<string | null>; setItem(name: string, value: string): Promise<void>; removeItem(name: string): Promise<void> };
            account: { call(operation: string, args?: Record<string, unknown>): Promise<{ data?: unknown; error?: string }> };
        };
    }
}
