import { queryClient } from "@/lib/query-client";
import { useConfigStore, type AiConfig, type ModelChannel } from "@/stores/use-config-store";
import { fetchChannelModelEntries } from "./image";

// Credentials stay in memory, never in query keys, results or diagnostics.
const connections = new Map<string, { identity: string; revision: number }>();
let revision = 0;
export function modelCatalogIdentity(channel: ModelChannel, config: AiConfig) {
    return JSON.stringify([channel.baseUrl, channel.apiKey.trim(), channel.apiFormat, channel.oneYes, config.proxyEnabled, config.proxyMode, config.proxyUrl, config.upstreamProxyUrl, config.upstreamProxyUsername, config.upstreamProxyPassword]);
}
export function fetchModelCatalogEntries(channel: ModelChannel, force = false) {
    const identity = modelCatalogIdentity(channel, useConfigStore.getState().config);
    let connection = connections.get(channel.id);
    if (connection?.identity !== identity) { connection = { identity, revision: ++revision }; connections.set(channel.id, connection); }
    return queryClient.fetchQuery({
        queryKey: ["oneyes-model-catalog", channel.id, connection.revision],
        queryFn: async () => {
            const entries = await fetchChannelModelEntries(channel);
            if (!entries.length) throw new Error("上游未返回有效模型，已保留本地配置");
            return entries.filter((entry, index) => entries.findIndex(item => item.id === entry.id) === index);
        },
        ...(force ? { staleTime: 0 } : {}),
    });
}
export async function fetchModelCatalog(channel: ModelChannel, force = false) { return (await fetchModelCatalogEntries(channel, force)).map(entry => entry.id); }
