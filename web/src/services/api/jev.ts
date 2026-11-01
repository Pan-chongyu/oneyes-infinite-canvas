import { buildApiUrl, modelCapabilityOf, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { reportError } from "../diagnostics";

export type JevQuestion = { type: "noul"; instructions: string } | { type: "choice"; instructions: string; criteria: Record<string, string> } | { type: "score"; instructions: string; criteria: string[] };
export type JevAnswer =
    | { type: "noul"; noul: number }
    | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
    | { type: "score"; score: number; confidence: number; probabilities: Record<string, number>; legend: Record<string, string> };
export type JevResult = { model: string; answer: JevAnswer; usage?: { input_tokens: number; output_tokens: number } };

export function jevQuestion(type: JevQuestion["type"], instructions: string, criteria = ""): JevQuestion {
    if (!["noul", "choice", "score"].includes(type)) throw Error("请选择是非判断、选择方案或标准评分");
    if (!instructions.trim()) throw Error("请填写要判断的问题");
    if (type === "noul") return { type, instructions: instructions.trim() };
    const lines = criteria
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    if (lines.length < 2) throw Error(type === "choice" ? "请填写至少两个选项，每行一个" : "请按由低到高填写至少两个评分等级，每行一个");
    if (new Set(lines).size !== lines.length) throw Error("选项或评分等级不能重复");
    return type === "choice" ? { type, instructions: instructions.trim(), criteria: Object.fromEntries(lines.map((line) => [line, line])) } : { type, instructions: instructions.trim(), criteria: lines };
}
const probability = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));

export function readJevResult(value: unknown, question: JevQuestion): JevResult {
    const invalid = () => {
        throw Error("JEV 返回的决策结果不完整，请检查模型与分组；不会自动重发请求");
    };
    if (!object(value) || typeof value.model !== "string" || !value.model.trim() || !object(value.answers) || !object(value.answers.decision)) return invalid();
    const answer = value.answers.decision;
    if (answer.type !== question.type) return invalid();
    let result: JevAnswer;
    if (question.type === "noul") {
        if (!probability(answer.noul)) return invalid();
        result = { type: "noul", noul: answer.noul };
    } else {
        const keys = question.type === "choice" ? Object.keys(question.criteria) : question.criteria.map((_, i) => String(i));
        if (!probability(answer.confidence) || !object(answer.probabilities) || Object.keys(answer.probabilities).length !== keys.length || keys.some((key) => !probability((answer.probabilities as Record<string, unknown>)[key]))) return invalid();
        const probabilities = Object.fromEntries(keys.map((key) => [key, (answer.probabilities as Record<string, number>)[key]]));
        if (question.type === "choice") {
            if (typeof answer.choice !== "string" || !keys.includes(answer.choice)) return invalid();
            result = { type: "choice", choice: answer.choice, confidence: answer.confidence, probabilities };
        } else {
            if (typeof answer.score !== "number" || !Number.isFinite(answer.score) || answer.score < 0 || answer.score > question.criteria.length - 1) return invalid();
            if (!object(answer.legend) || Object.keys(answer.legend).length !== keys.length || keys.some((key) => (answer.legend as Record<string, unknown>)[key] !== question.criteria[Number(key)])) return invalid();
            result = { type: "score", score: answer.score, confidence: answer.confidence, probabilities, legend: Object.fromEntries(keys.map((key) => [key, question.criteria[Number(key)]])) };
        }
    }
    const usage =
        object(value.usage) && Number.isSafeInteger(value.usage.input_tokens) && Number(value.usage.input_tokens) >= 0 && Number.isSafeInteger(value.usage.output_tokens) && Number(value.usage.output_tokens) >= 0
            ? { input_tokens: Number(value.usage.input_tokens), output_tokens: Number(value.usage.output_tokens) }
            : undefined;
    return { model: value.model, answer: result, ...(usage ? { usage } : {}) };
}

export async function requestJevDecision(config: AiConfig, model: string, state: string, question: JevQuestion, signal?: AbortSignal): Promise<JevResult> {
    if (!state.trim()) throw Error("请填写待判断的内容或连接文本节点");
    if (modelCapabilityOf(config, model) !== "decision") throw Error("请先配置 TypeSafe / Jev 平台的 JEV 分组并选择决策模型");
    const target = resolveModelRequestConfig(config, model);
    if (!target.apiKey.trim()) throw Error("JEV Key 尚未配置，请到模型服务一键配置或填写 JEV 分组的 Key");
    // Jev returns typed decisions. Never route it to Responses or Messages,
    // enable experimental image/long-context headers, or retry a paid request.
    try {
        const response = await fetch(buildApiUrl(target.baseUrl, "/systemone"), {
            method: "POST",
            headers: { Authorization: `Bearer ${target.apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: target.model, state, questions: { decision: question } }),
            signal,
        });
        if (!response.ok)
            throw Object.assign(
                Error(
                    response.status === 401 || response.status === 403
                        ? "JEV 未获授权，请在模型服务中诊断 Key 和 JEV 分组权限"
                        : response.status === 404
                          ? "当前线路尚未提供 JEV 决策接口，请联系站点管理员"
                          : response.status === 429
                            ? "JEV 额度不足或请求频繁，请核对余额与用量后手动重试"
                            : `JEV 决策失败（HTTP ${response.status}），请核对模型、用量或网络后手动重试`,
                ),
                { status: response.status },
            );
        return readJevResult(await response.json().catch(() => null), question);
    } catch (error) {
        if (!signal?.aborted) reportError("models", "request", error);
        throw error;
    }
}
export function jevSummary(result: JevResult) {
    const answer = result.answer;
    return answer.type === "choice" ? `选择：${answer.choice}` : answer.type === "score" ? `评分：${Number(answer.score.toFixed(3))} / ${Object.keys(answer.legend).length - 1}` : `“是”的概率：${(answer.noul * 100).toFixed(1)}%`;
}
