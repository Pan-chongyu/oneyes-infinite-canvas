import { fetchChannelModels } from "./image";
import { encodeChannelModel, guessCapability, GROK_VIDEO_CHANNEL_ID, modelOptionsFromChannels, normalizeOneYesConfig, OPENAI_BASE_URL, type AiConfig, type ModelChannel } from "@/stores/use-config-store";

export type OneYesUser = { id: number; email: string; username?: string; balance?: number };
export type OneYesSession = { user: OneYesUser | null; source?: "desktop" | "login"; requires_2fa?: boolean };
export type Group = { id: number; name: string; platform: string };
type Key = { id: number; name: string; key?: string; status: string; group_id: number; group?: Group; expires_at?: string; quota?: number; quota_used?: number };
export type Diagnosis = { id: string; name: string; status: "ok" | "error" | "warning"; code: string; detail?: string };
type AccountCall = <T>(operation: string, args?: Record<string, unknown>) => Promise<T>;
export const CANVAS_KEY_NAME = "Canvas_无限画布";
export const platforms = ["openai", "deepseek", "grok"] as const;
export type Platform = typeof platforms[number];
export function channelIdForPlatform(platform: Platform, openAiChannelId = "default") {
    if (platform === "openai") return openAiChannelId;
    return platform === "grok" ? GROK_VIDEO_CHANNEL_ID : `oneyes-${platform}`;
}
export async function accountCall<T>(operation: string, args?: Record<string, unknown>): Promise<T> {
    if (!window.oneYesDesktop?.account) throw new Error("请在 OneYes Canvas 桌面版使用账户登录；浏览器预览可手动填写 Key");
    const result = await window.oneYesDesktop.account.call(operation, args);
    if (result.error) throw new Error(result.error);
    return result.data as T;
}
export function selectGroup(groups: Group[], platform: Platform) {
    const names = platform === "openai" ? ["svip", "vip"] : [platform === "grok" ? "video" : "deepseek"];
    for (const name of names) {
        const matches = groups.filter(group => group.platform?.trim().toLowerCase() === platform && group.name.trim().toLowerCase() === name);
        if (matches.length > 1) throw new Error(`${platform} / ${name} 存在多个同名分组，请在官网确认`);
        if (matches.length === 1) return matches[0];
    }
    throw new Error(`${platform} / ${names.join("、")} 分组不可用，请检查官网分组权限`);
}
async function listKeys(user: OneYesUser, call: AccountCall) {
    const items: Key[] = [], ids = new Set<number>();
    for (let page = 1; ; page++) {
        const data = await call<{ items: Key[]; total: number }>("keys", { account_id: user.id, page });
        if (!Array.isArray(data.items) || !Number.isSafeInteger(data.total) || data.total < 0) throw new Error("Key 列表格式无效，请刷新后重试");
        for (const key of data.items) {
            if (ids.has(key.id)) throw new Error("Key 列表已变化，请重新操作");
            ids.add(key.id); items.push(key);
        }
        if (items.length >= data.total) return items;
        if (!data.items.length) throw new Error("Key 列表未读取完整，请重新操作");
    }
}
function usable(key: Key) {
    return key.status === "active" && !(key.expires_at && Date.parse(key.expires_at) <= Date.now()) && !(Number(key.quota) > 0 && Number(key.quota_used) >= Number(key.quota));
}
function platformModels(names: string[], platform: Platform) {
    return names.map(name => ({ name, capability: guessCapability(name) })).filter(model => platform === "openai" ? ["image", "text", "video"].includes(model.capability) : model.capability === (platform === "deepseek" ? "text" : "video"));
}
export async function configureManual(config: AiConfig, credentials: Record<Platform, string>, fetchModels = fetchChannelModels) {
    const channels: ModelChannel[] = [];
    for (const platform of platforms) {
        const id = channelIdForPlatform(platform, config.channels[0].id);
        const old = config.channels.find(channel => channel.id === id);
        const apiKey = credentials[platform].trim();
        if (!apiKey && !old) continue;
        const channel: ModelChannel = { id, name: platform === "openai" ? "OneYes" : `OneYes ${platform === "deepseek" ? "DeepSeek" : "Grok"}`, apiKey, baseUrl: OPENAI_BASE_URL, apiFormat: "openai", models: old?.models || [], ...(apiKey === old?.apiKey ? { oneYes: old.oneYes } : {}) };
        if (apiKey && apiKey !== old?.apiKey) {
            channel.models = platformModels(await fetchModels(channel), platform);
            if (!channel.models.length) throw new Error(`${channel.name} 未返回匹配的模型，请检查 Key 分组或在下方编辑模型`);
        }
        channels.push(channel);
    }
    const next = normalizeOneYesConfig({ ...config, channels });
    for (const [capability, setting] of [["image", "imageModel"], ["text", "textModel"], ["video", "videoModel"]] as const) {
        const candidates = channels.flatMap(channel => channel.models.filter(model => model.capability === capability).map(model => encodeChannelModel(channel.id, model.name)));
        if (candidates.length && !candidates.includes(next[setting])) next[setting] = candidates[0];
    }
    next.model = next.imageModel;
    return next;
}
export async function configureOneYes(config: AiConfig, user: OneYesUser, call: AccountCall = accountCall, fetchModels = fetchChannelModels) {
    const groups = await call<Group[]>("groups", { account_id: user.id });
    if (!Array.isArray(groups)) throw new Error("分组列表格式无效");
    const keys = await listKeys(user, call), channels: ModelChannel[] = [], issues: Diagnosis[] = [];
    for (const platform of platforms) {
        const id = channelIdForPlatform(platform, config.channels[0].id);
        try {
            let group = selectGroup(groups, platform);
            // Reuse an existing eligible VIP key before creating an SVIP key.
            if (platform === "openai" && group.name.trim().toLowerCase() === "svip" && !keys.some(key => key.name === CANVAS_KEY_NAME && key.group_id === group.id)) {
                const vip = groups.filter(item => item.platform?.trim().toLowerCase() === "openai" && item.name.trim().toLowerCase() === "vip");
                if (vip.length === 1 && keys.some(key => key.name === CANVAS_KEY_NAME && key.group_id === vip[0].id)) group = vip[0];
            }
            const matches = keys.filter(key => key.name === CANVAS_KEY_NAME && key.group_id === group.id).sort((a, b) => a.id - b.id);
            // An inactive/quota-exhausted key must not be bypassed by creating a new one.
            const existing = matches.find(usable) || matches[0];
            if (existing && !usable(existing)) throw new Error(`${CANVAS_KEY_NAME} 已停用、过期或额度耗尽，请先在官网处理`);
            const key = existing
                ? await call<Key>("key", { account_id: user.id, id: existing.id })
                : await call<Key>("create_key", { account_id: user.id, group_id: group.id });
            if (!Number.isSafeInteger(key.id) || key.id <= 0 || key.name !== CANVAS_KEY_NAME || !usable(key) || key.group_id !== group.id || !key.key || (key.group?.platform && key.group.platform.toLowerCase() !== platform)) throw new Error("Key 的状态或所属分组已变化，请重新操作");
            const channel: ModelChannel = { id, name: `OneYes ${platform === "openai" ? "OpenAI" : platform === "deepseek" ? "DeepSeek" : "Grok"}`, baseUrl: OPENAI_BASE_URL, apiFormat: "openai", apiKey: key.key,
                models: [], oneYes: { platform, groupId: group.id, groupName: group.name, keyId: key.id, accountId: user.id } };
            const available = await fetchModels(channel);
            channel.models = platformModels(available, platform);
            if (!channel.models.length) throw new Error("该分组未返回匹配的可用模型，请检查分组或手动配置模型");
            channels.push(channel);
        } catch (error) {
            issues.push({ id, name: platform, status: "error", code: "setupFailed", detail: error instanceof Error ? error.message : "配置失败" });
        }
    }
    // Preserve project model IDs and custom scripts only for models still available.
    for (const channel of channels) {
        const old = config.channels.find(item => item.id === channel.id);
        channel.models = channel.models.map(model => ({ ...model, script: old?.models.find(item => item.name === model.name)?.script }));
    }
    const merged = config.channels.map(old => channels.find(channel => channel.id === old.id) || old);
    channels.forEach(channel => { if (!merged.some(old => old.id === channel.id)) merged.push(channel); });
    const next = normalizeOneYesConfig({ ...config, channels: merged });
    for (const [capability, setting] of [["image", "imageModel"], ["text", "textModel"], ["video", "videoModel"]] as const) {
        const candidates = channels.flatMap(channel => channel.models.filter(model => model.capability === capability).map(model => encodeChannelModel(channel.id, model.name)));
        // Defaults can change; saved canvas nodes retain their explicit selection.
        if (candidates.length && !candidates.includes(next[setting])) next[setting] = candidates[0];
    }
    next.model = next.imageModel;
    next.models = modelOptionsFromChannels(next.channels);
    return { config: next, issues, configured: channels.length };
}
export async function diagnoseOneYes(config: AiConfig, user: OneYesUser | null, call: AccountCall = accountCall, fetchModels = fetchChannelModels): Promise<Diagnosis[]> {
    let keys: Key[] | undefined, accountError = "";
    if (user && config.channels.some(channel => channel.oneYes)) {
        try { keys = await listKeys(user, call); } catch (error) { accountError = error instanceof Error ? error.message : "账户检查失败"; }
    }
    const report: Diagnosis[] = [];
    for (const channel of config.channels) {
        const base = { id: channel.id, name: channel.name };
        const meta = channel.oneYes;
        if (!channel.apiKey.trim()) { report.push({ ...base, status: "warning", code: "unconfigured" }); continue; }
        if (meta) {
            if (!user || user.id !== meta.accountId) { report.push({ ...base, status: "warning", code: "account" }); continue; }
            if (accountError) { report.push({ ...base, status: "warning", code: "accountUnavailable", detail: accountError }); continue; }
            const remote = keys?.find(key => key.id === meta.keyId);
            if (!remote) { report.push({ ...base, status: "error", code: "deleted" }); continue; }
            if (!usable(remote)) { report.push({ ...base, status: "error", code: "inactive" }); continue; }
            if (remote.group_id !== meta.groupId || (remote.group?.platform && remote.group.platform.toLowerCase() !== meta.platform)) { report.push({ ...base, status: "error", code: "groupChanged" }); continue; }
            if (meta.platform === "minimax") { report.push({ ...base, status: "warning", code: "legacyPlatform", detail: "此 Key 仍属于旧 MiniMax 分组，请重新配置以接入 Grok 视频分组" }); continue; }
        }
        try {
            const names = await fetchModels(channel);
            const missing = channel.models.filter(model => !names.includes(model.name));
            report.push({ ...base, status: missing.length ? "warning" : "ok", code: missing.length ? "modelsChanged" : "ok", detail: missing.map(model => model.name).join(", ") || undefined });
        } catch (error) {
            report.push({ ...base, status: "error", code: "unavailable", detail: error instanceof Error ? error.message : undefined });
        }
    }
    return report;
}
