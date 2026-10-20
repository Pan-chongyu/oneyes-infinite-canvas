import { create } from "zustand";
import { accountCall, configureOneYes, diagnoseOneYes, type Diagnosis, type OneYesSession } from "@/services/api/oneyes-account";
import { useConfigStore } from "./use-config-store";

type State = OneYesSession & {
    ready: boolean; busy: boolean; error: string; report: Diagnosis[];
    restore: () => Promise<void>;
    connect: (operation: "reuse" | "login" | "login_2fa", args?: Record<string, unknown>) => Promise<void>;
    logout: () => Promise<void>;
    configure: () => Promise<void>;
    diagnose: () => Promise<void>;
};
let restoring: Promise<void> | undefined;
function disconnectManagedKeys(accountId?: number) {
    const store = useConfigStore.getState();
    store.replaceConfig({ ...store.config, channels: store.config.channels.map(channel => channel.oneYes && channel.oneYes.accountId !== accountId ? { ...channel, apiKey: "" } : channel) });
}
export const useOneYesAccountStore = create<State>((set, get) => ({
    user: null, ready: false, busy: false, error: "", report: [],
    restore: async () => {
        if (get().ready) return;
        if (restoring) return restoring;
        restoring = (async () => {
            try {
                const result = await accountCall<OneYesSession>("restore");
                if (result.user) disconnectManagedKeys(result.user.id);
                set({ ...result, error: "" });
            }
            catch (error) { set({ error: error instanceof Error ? error.message : "连接 OneYes 失败" }); }
            finally { set({ ready: true }); }
        })();
        try { await restoring; } finally { restoring = undefined; }
    },
    connect: async (operation, args) => {
        if (get().busy) return;
        set({ busy: true, error: "" });
        try {
            const result = await accountCall<OneYesSession>(operation, args);
            if (result.user) disconnectManagedKeys(result.user.id);
            set(result.requires_2fa ? { requires_2fa: true } : { ...result, requires_2fa: false, report: [], ready: true });
        } catch (error) { set({ error: error instanceof Error ? error.message : "登录失败" }); }
        finally { set({ busy: false }); }
    },
    logout: async () => {
        if (get().busy) return;
        set({ busy: true, error: "" });
        try { await accountCall("logout"); disconnectManagedKeys(); set({ user: null, source: undefined, requires_2fa: false, report: [] }); }
        catch (error) { set({ error: String(error instanceof Error ? error.message : error) }); }
        finally { set({ busy: false }); }
    },
    configure: async () => {
        const user = get().user;
        if (!user || get().busy) return;
        set({ busy: true, error: "", report: [] });
        try {
            const result = await configureOneYes(useConfigStore.getState().config, user);
            if (result.configured) useConfigStore.getState().replaceConfig(result.config);
            const report = await diagnoseOneYes(useConfigStore.getState().config, user);
            set({ report: [...report.filter(item => !result.issues.some(issue => issue.id === item.id)), ...result.issues] });
        } catch (error) { set({ error: error instanceof Error ? error.message : "配置失败" }); }
        finally { set({ busy: false }); }
    },
    diagnose: async () => {
        if (get().busy) return;
        set({ busy: true, error: "" });
        try { set({ report: await diagnoseOneYes(useConfigStore.getState().config, get().user) }); }
        catch (error) { set({ error: error instanceof Error ? error.message : "诊断失败" }); }
        finally { set({ busy: false }); }
    },
}));
