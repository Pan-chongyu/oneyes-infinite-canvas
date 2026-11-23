import { hasConfiguredModels, type AiConfig } from "./use-config-store";
import type { Diagnosis } from "@/services/api/oneyes-account";

export function shouldOpenSetup(state: { setupStatus: string; setupMode?: string | null; isConfigOpen: boolean; config: AiConfig }) {
    return state.setupStatus === "pending" && !state.isConfigOpen && (state.setupMode === "beginner" || !hasConfiguredModels(state.config));
}

/** Only a successful check of a configured service can complete the guide. */
export function getVerifiedSetupIds(config: AiConfig, report: Diagnosis[], error: string) {
    if (error) return [];
    return config.channels.filter(channel => channel.apiKey.trim() && channel.models.some(model => !model.unavailable) && report.some(item => item.id === channel.id && item.code === "ok" && item.status === "ok")).map(channel => channel.id);
}
