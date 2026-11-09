import { useEffect } from "react";
import { modelCatalogIdentity } from "@/services/api/model-catalog";
import { useConfigStore } from "@/stores/use-config-store";
import { useModelCatalogStore } from "@/stores/use-model-catalog-store";
import { useOneYesAccountStore } from "@/stores/use-oneyes-account-store";

/** Event-driven discovery reuses the app's existing query cache; no polling or paid requests. */
export function useModelCatalogSync() {
    const identity = useConfigStore(state => JSON.stringify(state.config.channels.map(channel => modelCatalogIdentity(channel, state.config))));
    const ready = useOneYesAccountStore(state => state.ready);
    const busy = useOneYesAccountStore(state => state.busy);
    const accountId = useOneYesAccountStore(state => state.user?.id);
    useEffect(() => {
        const sync = () => {
            if (document.visibilityState !== "hidden" && navigator.onLine !== false) void useModelCatalogStore.getState().sync();
        };
        sync();
        window.addEventListener("focus", sync);
        window.addEventListener("online", sync);
        document.addEventListener("visibilitychange", sync);
        return () => { window.removeEventListener("focus", sync); window.removeEventListener("online", sync); document.removeEventListener("visibilitychange", sync); };
    }, [identity, ready, busy, accountId]);
}
