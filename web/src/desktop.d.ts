export {};
declare global {
    interface Window {
        oneYesDesktop?: {
            windowChrome?: {
                platform: string;
                theme(theme: 'light' | 'dark'): Promise<void>;
                fullscreen(): Promise<boolean>;
                subscribe(callback: (fullscreen: boolean) => void): () => void;
            };
            updates: {
                call(operation: 'state' | 'check' | 'install'): Promise<import('./stores/use-desktop-update-store').DesktopUpdateState>;
                subscribe(callback: (state: import('./stores/use-desktop-update-store').DesktopUpdateState) => void): () => void;
            };
            models: { list(apiKey: string): Promise<{ data?: string[]; error?: string }> };
            proxy: { test(config: import('./services/api/local-proxy').ProxySettings): Promise<{ data?: { status: number }; error?: string }> };
            agent: { call(operation: 'status' | 'setup' | 'restore'): Promise<{ data?: { configured: boolean; url?: string; token?: string }; error?: string }> };
            storage: { getItem(name: string): Promise<string | null>; setItem(name: string, value: string): Promise<void>; removeItem(name: string): Promise<void> };
            account: { call(operation: string, args?: Record<string, unknown>): Promise<{ data?: unknown; error?: string }> };
        };
    }
}
