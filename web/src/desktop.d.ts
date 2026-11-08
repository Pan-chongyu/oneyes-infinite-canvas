export {};
declare global {
    interface Window {
        oneYesDesktop?: {
            editor?: { open(key: string): Promise<void> };
            media?: {
                create(operation: 'analyze' | 'sample' | 'concat' | 'mix' | 'extract' | 'subtitles' | 'editAnalyze' | 'editRender' | 'videoSuperResolution', count: number, options: Record<string, unknown> | undefined): Promise<string>;
                start(id: string): Promise<{ data?: Array<{ name: string; kind: 'image' | 'video' | 'audio' | 'text'; bytes: number; time?: number }>; error?: string }>;
                finish(id: string): Promise<{ data?: Array<{ name: string; kind: 'image' | 'video' | 'audio' | 'text'; bytes: number }>; error?: string }>;
                release(id: string): Promise<void>;
                subscribe(callback: (state: { id: string; stage: string; progress?: number }) => void): () => void;
            };
            diagnostics?: {
                report(input: { component: string; stage: string; operation?: string; error?: Record<string, unknown> }): Promise<void>;
                recover(input: { component: string; stage: string; operation: string }): Promise<void>;
            };
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
            collaboration: {
                call(operation: 'state' | 'host' | 'join' | 'update' | 'snapshot' | 'leave' | 'presence', args?: { invite?: string; data?: string; projectId?: string;presence?:import('./stores/canvas/use-collaboration-store').CollaborationPresence }): Promise<import('./stores/canvas/use-collaboration-store').CollaborationState & { data?: string }>;
                subscribe(callback: (event: { kind: 'state' | 'update' | 'ended' | 'presence'; data?: string;peers?:import('./stores/canvas/use-collaboration-store').CollaborationPeer[] } & import('./stores/canvas/use-collaboration-store').CollaborationState) => void): () => void;
            };
            models: { list(apiKey: string): Promise<{ data?: string[]; error?: string }> };
            proxy: { test(config: import('./services/api/local-proxy').ProxySettings): Promise<{ data?: { status: number }; error?: string }> };
            agent: { call(operation: 'status' | 'setup' | 'restore'): Promise<{ data?: { configured: boolean; url?: string; token?: string }; error?: string }> };
            storage: { getItem(name: string): Promise<string | null>; setItem(name: string, value: string): Promise<void>; removeItem(name: string): Promise<void> };
            account: { call(operation: string, args?: Record<string, unknown>): Promise<{ data?: unknown; error?: string }> };
        };
    }
}
