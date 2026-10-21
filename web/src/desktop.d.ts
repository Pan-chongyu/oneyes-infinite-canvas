export {};
declare global {
    interface Window {
        oneYesDesktop?: {
            agent: { call(operation: 'status' | 'setup' | 'restore'): Promise<{ data?: { configured: boolean; url?: string; token?: string }; error?: string }> };
            storage: { getItem(name: string): Promise<string | null>; setItem(name: string, value: string): Promise<void>; removeItem(name: string): Promise<void> };
            account: { call(operation: string, args?: Record<string, unknown>): Promise<{ data?: unknown; error?: string }> };
        };
    }
}
