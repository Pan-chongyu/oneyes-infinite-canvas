import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { AGENT_PROMPT } from "../config.js";
import { codexEnvironment, createAgentLogWriter } from "../utils/agent-runtime.js";
import { errorMessage } from "../utils/value.js";
import type { AgentEmit } from "./types.js";

type ClaudeOptions = { cwd?: string; signal?: AbortSignal; mcpConfig?: unknown; env?: NodeJS.ProcessEnv };

/** Windows 原生安装与 npm 安装均直接启动可执行文件，不解释 shell shim。 */
export async function claudeCommand(env: NodeJS.ProcessEnv = process.env, platform = process.platform) {
    if (platform !== "win32") return { command: "claude", args: [] as string[] };
    for (const entry of (env.PATH || env.Path || "").split(path.delimiter).filter(Boolean)) {
        const directory = entry.replace(/^"|"$/g, "");
        const executable = path.join(directory, "claude.exe");
        if (await isFile(executable)) return { command: executable, args: [] as string[] };
        for (const cli of [path.join(directory, "node_modules/@anthropic-ai/claude-code/cli.js"), path.resolve(directory, "../node_modules/@anthropic-ai/claude-code/cli.js"), path.resolve(directory, "../lib/node_modules/@anthropic-ai/claude-code/cli.js")]) {
            if (await isFile(cli)) return { command: process.execPath, args: [cli] };
        }
    }
    throw new Error("未找到 Claude Code，请安装官方原生版或 npm 版，并确认安装目录已加入 PATH");
}

async function isFile(file: string) {
    try { return (await fs.stat(file)).isFile(); }
    catch (error) { if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code || "")) return false; throw error; }
}

/** 提示词走标准输入；临时 MCP 凭证只写入私有文件并在任务结束后清理。 */
export async function runClaudeTurn(prompt: string, emit: AgentEmit, options: ClaudeOptions = {}) {
    let directory = "";
    let code: number | null = null;
    try {
        if (!prompt.trim()) throw new Error("请输入任务内容");
        if (options.signal?.aborted) return;
        const env = codexEnvironment(options.env);
        const executable = await claudeCommand(env);
        const args = [...executable.args, "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--allowedTools", "mcp__infinite-canvas__*"];
        if (options.mcpConfig) {
            directory = await fs.mkdtemp(path.join(os.tmpdir(), "oneyes-claude-"));
            const file = path.join(directory, "mcp.json");
            await fs.writeFile(file, JSON.stringify(options.mcpConfig), { mode: 0o600, flag: "wx" });
            args.push("--mcp-config", file);
        }
        if (options.signal?.aborted) return;
        code = await new Promise<number | null>((resolve) => {
            const child = spawn(executable.command, args, { cwd: options.cwd, env, stdio: ["pipe", "pipe", "pipe"], shell: false, windowsHide: true });
            let buffer = "";
            let failed = false;
            const line = (text: string) => {
                if (!text.trim()) return;
                try { emit("agent_event", { ...JSON.parse(text), agent: "claude" }); }
                catch { emit("agent_event", { agent: "claude", type: "raw", text }); }
            };
            const stderr = createAgentLogWriter((text) => emit("agent_log", { text }));
            const fail = (error: Error) => {
                failed = true;
                if (!options.signal?.aborted) emit("agent_error", { message: error.message });
            };
            const stop = () => { child.kill(); };
            options.signal?.addEventListener("abort", stop, { once: true });
            child.stdout.setEncoding("utf8").on("data", (text: string) => {
                buffer += text;
                const lines = buffer.split(/\r?\n/);
                buffer = lines.pop() || "";
                lines.forEach(line);
            });
            child.stderr.setEncoding("utf8").on("data", (text: string) => stderr.write(text));
            child.on("error", fail);
            child.stdin.on("error", (error) => { fail(error); child.kill(); });
            child.on("close", (exitCode) => {
                options.signal?.removeEventListener("abort", stop);
                line(buffer);
                stderr.flush();
                if (exitCode && !failed && !options.signal?.aborted) emit("agent_error", { message: `Claude Code 运行失败（退出码 ${exitCode}），请检查登录状态与配置` });
                resolve(exitCode);
            });
            if (options.signal?.aborted) stop();
            else child.stdin.end(`${AGENT_PROMPT}\n\n用户请求：${prompt}`);
        });
    } catch (error) {
        if (!options.signal?.aborted) emit("agent_error", { message: errorMessage(error) });
    } finally {
        if (directory) {
            await fs.unlink(path.join(directory, "mcp.json")).catch(() => undefined);
            await fs.rmdir(directory).catch(() => undefined);
        }
        emit("agent_done", { agent: "claude", code, cancelled: Boolean(options.signal?.aborted) });
    }
}
