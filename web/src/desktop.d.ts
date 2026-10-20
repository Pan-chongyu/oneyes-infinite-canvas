export {};
declare global {
    interface Window {
        oneYesDesktop?: { storage: { getItem(name: string): Promise<string | null>; setItem(name: string, value: string): Promise<void>; removeItem(name: string): Promise<void> } };
    }
}
