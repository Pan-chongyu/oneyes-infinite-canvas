import { create } from "zustand";
import { fetchModelCatalog, modelCatalogIdentity } from "@/services/api/model-catalog";
import { reportError } from "@/services/diagnostics";
import { configureModelDefaults, syncChannelModels, useConfigStore } from "./use-config-store";
import { useOneYesAccountStore } from "./use-oneyes-account-store";

let revision = 0;
export const useModelCatalogStore = create<{
    syncing: boolean; updatedAt: number; errors: Record<string, string>; checked: string[];
    sync: (force?: boolean) => Promise<void>;
}>((set) => ({
    syncing: false, updatedAt: 0, errors: {}, checked: [],
    sync: async (force = false) => {
        const config = useConfigStore.getState().config, account = useOneYesAccountStore.getState();
        const channels = config.channels.filter(channel => channel.apiKey.trim() && (!channel.oneYes || account.ready && !account.busy && channel.oneYes.accountId === account.user?.id));
        const current = ++revision;
        if (!channels.length) { set({ syncing: false, errors: {}, checked: [], updatedAt: 0 }); return; }
        set({ syncing: true });
        const results = await Promise.allSettled(channels.map(channel => fetchModelCatalog(channel, force)));
        if (current !== revision) return;
        const store = useConfigStore.getState(), errors: Record<string, string> = {}, checked: string[] = [];
        let updated = false;
        const synced = store.config.channels.map(channel => {
            const index = channels.findIndex(snapshot => snapshot.id === channel.id);
            if (index < 0 || modelCatalogIdentity(channel, store.config) !== modelCatalogIdentity(channels[index], config)) return channel;
            const result = results[index];
            if (result.status === "rejected") {
                errors[channel.id] = result.reason instanceof Error ? result.reason.message : "模型同步失败，已保留本地配置";
                reportError("models", "sync", result.reason);
                return channel;
            }
            updated = true;
            checked.push(channel.id);
            return syncChannelModels(channel, result.value);
        });
        if (updated) {
            const next = configureModelDefaults({ ...store.config, channels: synced });
            if (JSON.stringify(next) !== JSON.stringify(store.config)) store.replaceConfig(next);
        }
        if (current === revision) set({ syncing: false, errors, checked, ...(updated ? { updatedAt: Date.now() } : {}) });
    },
}));
