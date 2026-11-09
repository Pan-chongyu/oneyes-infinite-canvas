import { queryClient } from "@/lib/query-client";
import { useConfigStore, type AiConfig, type ModelChannel } from "@/stores/use-config-store";
import { fetchChannelModels } from "./image";

// Credentials stay in memory, never in query keys, results or diagnostics.
const connections = new Map<string, { identity: string; revision: number }>();
let revision = 0;
export function modelCatalogIdentity(channel: ModelChannel, config: AiConfig) {
    return JSON.stringify([channel.baseUrl, channel.apiKey.trim(), channel.apiFormat, channel.oneYes, config.proxyEnabled, config.proxyMode, config.proxyUrl, config.upstreamProxyUrl, config.upstreamProxyUsername, config.upstreamProxyPassword]);
}
export function fetchModelCatalog(channel: ModelChannel, force = false) {
    const identity = modelCatalogIdentity(channel, useConfigStore.getState().config);
    let connection = connections.get(channel.id);
    if (connection?.identity !== identity) { connection = { identity, revision: ++revision }; connections.set(channel.id, connection); }
    return queryClient.fetchQuery({
        queryKey: ["oneyes-model-catalog", channel.id, connection.revision],
        queryFn: async () => {
            const names = await fetchChannelModels(channel);
            if (!Array.isArray(names) || !names.length || names.some(name => typeof name !== "string" || !name.trim())) throw new Error("上游未返回有效模型，已保留本地配置");
            return [...new Set(names.map(name => name.trim()))];
        },
        ...(force ? { staleTime: 0 } : {}),
    });
}
