import { useEffect } from "react";
import { modelCatalogIdentity } from "@/services/api/model-catalog";
import { useConfigStore } from "@/stores/use-config-store";
import { useModelCatalogStore } from "@/stores/use-model-catalog-store";
import { useOneYesAccountStore } from "@/stores/use-oneyes-account-store";
import { VIDEO_CATALOG_REFRESH_MS } from '@/services/api/video-catalog';
import { useVideoCatalogStore } from '@/stores/use-video-catalog-store';

/** Public metadata and authorized discovery share foreground events and caches. */
export function useModelCatalogSync() {
    const catalog = useVideoCatalogStore(state => state.catalog);
    const identity = useConfigStore(state => JSON.stringify(state.config.channels.map(channel => modelCatalogIdentity(channel, state.config))));
    const ready = useOneYesAccountStore(state => state.ready);
    const busy = useOneYesAccountStore(state => state.busy);
    const accountId = useOneYesAccountStore(state => state.user?.id);
    useEffect(() => {
        if (!catalog) return;
        const expires = Date.parse(catalog.generated_at) + (catalog.refresh_after_seconds * 2 + 60) * 1000;
        const timer = window.setTimeout(() => useVideoCatalogStore.setState({ delayed: true }), Math.max(0, expires - Date.now() + 1));
        return () => window.clearTimeout(timer);
    }, [catalog]);
    useEffect(() => {
        const sync = () => {
            if (navigator.onLine === false) useVideoCatalogStore.setState({ delayed: true });
            else if (document.visibilityState !== "hidden") void useModelCatalogStore.getState().sync();
        };
        sync();
        const timer = window.setInterval(sync, VIDEO_CATALOG_REFRESH_MS);
        window.addEventListener("focus", sync);
        window.addEventListener("online", sync);
        window.addEventListener("offline", sync);
        document.addEventListener("visibilitychange", sync);
        return () => { window.clearInterval(timer); window.removeEventListener("focus", sync); window.removeEventListener("online", sync); window.removeEventListener("offline", sync); document.removeEventListener("visibilitychange", sync); };
    }, [identity, ready, busy, accountId]);
}
