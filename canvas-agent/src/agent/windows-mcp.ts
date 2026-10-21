import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, machine } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import toml from "@iarna/toml";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CONFIG_DIR } from "../config.js";
import type { JsonRecord } from "../utils/value.js";

const run = promisify(execFile);
const UV_VERSION = "0.13.4", MCP_VERSION = "0.8.8";
const UV_ASSETS = {
    x64: { target: "x86_64", sha256: "ccec7508a07d9933d7cb1261880633efcf1f30d6e6eddab21823f1dae6f23225" },
    arm64: { target: "aarch64", sha256: "c4bc5a9534b2bb6a12fe29ea748445e1a6f9cb7bb275211c4fb74c52ecf317a5" },
};
export type WindowsMcpSettings = JsonRecord & { command: string; args?: string[]; env?: Record<string, string>; startup_timeout_sec?: number };
const pending = new Map<string, Promise<WindowsMcpSettings | undefined>>();

/** Only manage the official stdio invocation; leave disabled, remote and custom servers alone. */
export function managedWindowsMcp(value: unknown): value is WindowsMcpSettings {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const v = value as JsonRecord, args = v.args;
    if (v.enabled === false || v.url || typeof v.command !== "string" || !Array.isArray(args) || args.some(arg => typeof arg !== "string")) return false;
    const command = path.win32.basename(v.command).toLowerCase();
    const tail = command === "uvx" || command === "uvx.exe" ? args[0] === "windows-mcp" ? args.slice(1) : null
        : command === "windows-mcp" || command === "windows-mcp.exe" ? args : null;
    return !!tail && (tail.length === 1 && tail[0] === "serve" || tail.length === 3 && tail[0] === "serve" && tail[1] === "--transport" && tail[2] === "stdio");
}

/** Handshake and list tools only; never invoke a desktop action or a model. */
export async function probeWindowsMcp(settings: WindowsMcpSettings) {
    const transport = new StdioClientTransport({ command: settings.command, args: settings.args, stderr: "pipe", env: { ...process.env, ...settings.env, ANONYMIZED_TELEMETRY: "false" } as Record<string, string> });
    transport.stderr?.on("data", () => {});
    const client = new Client({ name: "oneyes-dependency-check", version: "1" });
    const timeout = (settings.startup_timeout_sec || 10) * 1000;
    try {
        await client.connect(transport, { timeout });
        const result = await client.listTools({}, { timeout });
        if (!result.tools.length) throw new Error("Windows-MCP 没有返回可用工具");
        return { server: client.getServerVersion(), tools: result.tools.length };
    } finally { await client.close(); }
}

/** Install into the app's private directory; no PATH, registry, global Python or Codex config changes. */
export async function installWindowsMcp(root: string) {
    const chip = machine().toLowerCase();
    const arch = chip === "arm64" || chip === "aarch64" ? "arm64" : "x64";
    const asset = UV_ASSETS[arch], uvDirectory = path.join(root, `uv-${UV_VERSION}-${arch}`), uv = path.join(uvDirectory, "uv.exe");
    const env = { ...process.env, UV_PYTHON_INSTALL_DIR: path.join(root, "python"), UV_CACHE_DIR: path.join(root, "cache"), UV_NO_PROGRESS: "1", UV_NO_CONFIG: "1" };
    await mkdir(root, { recursive: true });
    try { await run(uv, ["--version"], { env, windowsHide: true }); }
    catch {
        const staging = path.join(root, `download-${randomBytes(8).toString("hex")}`), zip = `${staging}.zip`;
        try {
            const response = await fetch(`https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${asset.target}-pc-windows-msvc.zip`);
            if (!response.ok) throw new Error(`uv 下载失败（HTTP ${response.status}）`);
            const bytes = Buffer.from(await response.arrayBuffer());
            if (createHash("sha256").update(bytes).digest("hex") !== asset.sha256) throw new Error("uv 下载校验失败，已停止安装");
            await writeFile(zip, bytes, { flag: "wx" });
            await run(path.join(process.env.SystemRoot || "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath $env:ONEYES_UV_ZIP -DestinationPath $env:ONEYES_UV_STAGE"], { env: { ...env, ONEYES_UV_ZIP: zip, ONEYES_UV_STAGE: staging }, windowsHide: true });
            await rm(uvDirectory, { recursive: true, force: true });
            await rename(staging, uvDirectory);
        } finally { await rm(zip, { force: true }); await rm(staging, { recursive: true, force: true }); }
    }
    // dxcam publishes x64 Windows wheels only. ARM64 Windows runs this isolated Python under x64 emulation.
    const venv = path.join(root, `windows-mcp-${MCP_VERSION}-x64`), python = path.join(venv, "Scripts/python.exe");
    await run(uv, ["--no-config", "venv", "--python", "cpython-3.14-windows-x86_64-none", "--managed-python", "--allow-existing", venv], { env, windowsHide: true });
    await run(uv, ["--no-config", "pip", "install", "--python", python, "--index-url", "https://pypi.org/simple", "--only-binary", ":all:", "--reinstall", `windows-mcp==${MCP_VERSION}`], { env, windowsHide: true });
    return path.join(venv, "Scripts/windows-mcp.exe");
}

export type WindowsMcpPreparation = {
    codexHome?: string; root?: string; platform?: NodeJS.Platform;
    installing?: () => void;
    probe?: typeof probeWindowsMcp; install?: typeof installWindowsMcp;
};

/** Coalesce concurrent preparation, then reuse an already verified installation without downloading again. */
export async function prepareWindowsMcp(options: WindowsMcpPreparation = {}): Promise<WindowsMcpSettings | undefined> {
    if ((options.platform || process.platform) !== "win32") return;
    const file = path.join(options.codexHome || process.env.CODEX_HOME || path.join(homedir(), ".codex"), "config.toml");
    const root = options.root || path.join(CONFIG_DIR, "dependencies/windows-mcp"), key = `${root}\0${file}`;
    if (pending.has(key)) return pending.get(key);
    const preparation = (async () => {
        let text;
        try { text = await readFile(file, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
        let config;
        try { config = toml.parse(text); } catch { throw new Error("Codex 配置格式有误，已保留原文件，请修复 config.toml 后重新连接"); }
        const configured = (config.mcp_servers as JsonRecord | undefined)?.["windows-mcp"];
        if (!managedWindowsMcp(configured)) return;
        const unchanged = async (settings: WindowsMcpSettings) => await readFile(file, "utf8") === text ? settings : undefined;
        const probe = options.probe || probeWindowsMcp;
        const cached: WindowsMcpSettings = { ...configured, command: path.join(root, `windows-mcp-${MCP_VERSION}-x64/Scripts/windows-mcp.exe`), args: ["serve", "--transport", "stdio"], env: { ...configured.env, ANONYMIZED_TELEMETRY: "false" } };
        try { await probe(cached); return unchanged(cached); } catch { /* Missing or broken cache: check the user's existing runtime first. */ }
        try { await probe(configured); return unchanged(configured); } catch { /* The native server will still report failures if provisioning fails. */ }
        options.installing?.();
        cached.command = await (options.install || installWindowsMcp)(root);
        await probe(cached);
        return unchanged(cached);
    })();
    pending.set(key, preparation);
    try { return await preparation; } finally { pending.delete(key); }
}
