import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_PORT = 17371;
export const CONFIG_DIR = process.env.ONEYES_CANVAS_AGENT_HOME || path.join(os.homedir(), ".infinite-canvas");
export const CONFIG_FILE = path.join(CONFIG_DIR, "canvas-agent.json");
export const VERSION = readPackageVersion();
export const AGENT_PROMPT = fs.readFileSync(new URL("../agent-instructions.md", import.meta.url), "utf8");
const initializedWorkspaces = new Set<string>();

export type SiteWorkspaceConfig = { workspacePath: string; activeThreadId?: string; pinnedThreadIds?: string[] };
export type CanvasAgentConfig = { url: string; token: string; origins?: string[]; workspace?: SiteWorkspaceConfig };

/** 读取本地 Canvas Agent 配置，不存在时生成默认配置。 */
export function loadConfig(create = false): CanvasAgentConfig {
    try {
        return parseConfig(JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Canvas Agent 配置无法读取，已保留原文件，请检查配置后重试");
        const config = { url: `http://127.0.0.1:${Number(process.env.PORT) || DEFAULT_PORT}`, token: crypto.randomBytes(18).toString("hex") };
        if (create) saveConfig(config);
        return config;
    }
}

/** 将 Canvas Agent 配置写入用户配置目录。 */
export function saveConfig(config: CanvasAgentConfig) {
    writeConfigFile(CONFIG_DIR, CONFIG_FILE, parseConfig(config));
}

/** 写入配置并强制目录 0700、文件 0600，包括纠正已有宽松权限。 */
export function writeConfigFile(dir: string, file: string, config: CanvasAgentConfig) {
    const validated = parseConfig(config);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify(validated, null, 2), { mode: 0o600 });
    fs.chmodSync(dir, 0o700);
    fs.chmodSync(file, 0o600);
}

/** 严格校验 standalone Agent 配置，避免绕过桌面桥接接受不安全的监听地址或畸形状态。 */
export function parseConfig(value: unknown): CanvasAgentConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Canvas Agent 配置格式无效");
    const source = value as Record<string, unknown>;
    let parsedUrl: URL;
    try { parsedUrl = new URL(String(source.url || "")); } catch { throw new Error("Canvas Agent 配置地址无效"); }
    const port = Number(parsedUrl.port || DEFAULT_PORT);
    if (parsedUrl.protocol !== "http:" || parsedUrl.hostname !== "127.0.0.1" || parsedUrl.username || parsedUrl.password || parsedUrl.pathname !== "/" || parsedUrl.search || parsedUrl.hash || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Canvas Agent 必须只监听 127.0.0.1 的有效 HTTP 地址");
    const token = source.token;
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{24,256}$/.test(token)) throw new Error("Canvas Agent token 格式无效");
    const origins = source.origins === undefined ? undefined : source.origins;
    if (origins !== undefined && (!Array.isArray(origins) || origins.some((origin) => !validOrigin(origin)))) throw new Error("Canvas Agent origins 配置无效");
    const workspace = source.workspace;
    if (workspace !== undefined) {
        if (!workspace || typeof workspace !== "object" || Array.isArray(workspace)) throw new Error("Canvas Agent workspace 配置无效");
        const item = workspace as Record<string, unknown>;
        if (typeof item.workspacePath !== "string" || !item.workspacePath.trim() || (item.activeThreadId !== undefined && typeof item.activeThreadId !== "string") || (item.pinnedThreadIds !== undefined && (!Array.isArray(item.pinnedThreadIds) || item.pinnedThreadIds.some((id) => typeof id !== "string")))) throw new Error("Canvas Agent workspace 配置无效");
    }
    return {
        url: `http://127.0.0.1:${port}`,
        token,
        ...(origins === undefined ? {} : { origins: [...new Set(origins as string[])] }),
        ...(workspace === undefined ? {} : { workspace: workspace as SiteWorkspaceConfig }),
    };
}

function validOrigin(value: unknown) {
    if (typeof value !== "string" || !value.trim()) return false;
    try {
        const origin = new URL(value);
        return ["http:", "https:"].includes(origin.protocol) && origin.origin === value && !origin.username && !origin.password;
    } catch {
        return false;
    }
}

/** 确保站点级 Codex 工作空间存在并已初始化。 */
export function ensureSiteWorkspace(config: CanvasAgentConfig) {
    const current = config.workspace;
    if (current?.workspacePath) {
        const workspacePath = resolveWorkspacePath(current.workspacePath);
        initializeWorkspace(workspacePath);
        return { ...current, workspacePath };
    }
    const workspacePath = path.join(CONFIG_DIR, "codex-workspaces", "site");
    config.workspace = { workspacePath };
    initializeWorkspace(workspacePath);
    saveConfig(config);
    return { workspacePath };
}

/** 更新站点级 Codex 工作空间配置。 */
export function updateSiteWorkspace(config: CanvasAgentConfig, patch: Partial<SiteWorkspaceConfig>) {
    const current = ensureSiteWorkspace(config);
    const workspacePath = patch.workspacePath ? resolveWorkspacePath(patch.workspacePath) : current.workspacePath;
    const next = { ...current, ...patch, workspacePath };
    config.workspace = { workspacePath: next.workspacePath, activeThreadId: next.activeThreadId, pinnedThreadIds: next.pinnedThreadIds };
    initializeWorkspace(workspacePath);
    saveConfig(config);
    return config.workspace;
}

/** 创建工作空间目录并写入默认 AGENTS.md。 */
function initializeWorkspace(workspacePath: string) {
    if (initializedWorkspaces.has(workspacePath)) return;
    fs.mkdirSync(workspacePath, { recursive: true });
    const instructionsFile = path.join(workspacePath, "AGENTS.md");
    const current = fs.existsSync(instructionsFile) ? fs.readFileSync(instructionsFile, "utf8") : "";
    if (!current || current.startsWith("# Infinite Canvas Agent")) fs.writeFileSync(instructionsFile, AGENT_PROMPT);
    initializedWorkspaces.add(workspacePath);
}

/** 将用户输入的工作空间路径解析为绝对路径。 */
function resolveWorkspacePath(value: string) {
    if (value === "~") return os.homedir();
    if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
    return path.resolve(value);
}

/** 从当前包信息中读取 Canvas Agent 版本号。 */
function readPackageVersion() {
    try {
        const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
        return pkg.version || "0.0.0";
    } catch {
        return "0.0.0";
    }
}
