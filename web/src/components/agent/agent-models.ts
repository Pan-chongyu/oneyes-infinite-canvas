import type { AgentModel } from "@/stores/use-agent-store";

/** Keep distinct model IDs, including non-reasoning models and newly advertised effort values. */
export function availableAgentModels(data: AgentModel[]) {
    const seen = new Set<string>();
    return data.flatMap((item) => {
        if (!item.model || item.hidden || item.model === "codex-auto-review" || seen.has(item.model)) return [];
        seen.add(item.model);
        const efforts = item.supportedReasoningEfforts.filter(({ reasoningEffort }, index, all) =>
            typeof reasoningEffort === "string" && reasoningEffort.trim() && all.findIndex((effort) => effort.reasoningEffort === reasoningEffort) === index);
        return [{ ...item, supportedReasoningEfforts: efforts, defaultReasoningEffort: agentModelEffort({ ...item, supportedReasoningEfforts: efforts }) }];
    });
}

export function agentModelEffort(model: AgentModel, preferred = "") {
    const supports = (value: string) => model.supportedReasoningEfforts.some((item) => item.reasoningEffort === value);
    return supports(preferred) ? preferred : supports(model.defaultReasoningEffort) ? model.defaultReasoningEffort : model.supportedReasoningEfforts[0]?.reasoningEffort || "";
}
