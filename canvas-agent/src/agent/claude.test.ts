import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { claudeCommand, runClaudeTurn } from "./claude.js";

test("Claude Windows resolver uses the installed CLI without a shell", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "oneyes-claude-test-"));
    const bin = path.join(root, "bin");
    const cli = path.join(bin, "node_modules", "@anthropic-ai", "claude-code", "cli.js");
    await fs.mkdir(path.dirname(cli), { recursive: true });
    const script = `
const fs = require('node:fs');
let input = '';
process.stdin.setEncoding('utf8').on('data', chunk => input += chunk);
process.stdin.on('end', () => {
    const args = process.argv.slice(2);
    const file = args[args.indexOf('--mcp-config') + 1];
    const mcp = JSON.parse(fs.readFileSync(file, 'utf8'));
    process.stdout.write(JSON.stringify({type:'result', input, args, file, mcp}));
});
`;
    await fs.writeFile(cli, script, { mode: 0o600 });
    if (process.platform !== "win32") {
        const executable = path.join(bin, "claude");
        await fs.writeFile(executable, `#!${process.execPath}\n${script}`, { mode: 0o700 });
    }
    try {
        const command = await claudeCommand({ PATH: bin }, "win32");
        assert.equal(command.command, process.execPath);
        assert.deepEqual(command.args, [cli]);
        const events: Array<{ type: string; payload: unknown }> = [];
        const prompt = '含有 & 和引号 " $(echo literal) 的提示词';
        const mcpConfig = { mcpServers: { canvas: { url: "http://127.0.0.1/mcp", headers: { token: "fixture-only" } } } };
        await runClaudeTurn(prompt, (type, payload) => events.push({ type, payload }), { env: { PATH: bin }, mcpConfig });
        const result = events.find((event) => event.type === "agent_event")?.payload as { agent: string; type: string; input: string; args: string[]; file: string; mcp: unknown };
        assert.equal(result.agent, "claude");
        assert.equal(result.type, "result");
        assert.ok(result.input.endsWith(`用户请求：${prompt}`));
        assert.ok(!result.args.join(" ").includes(prompt));
        assert.ok(!result.args.join(" ").includes("fixture-only"));
        assert.deepEqual(result.mcp, mcpConfig);
        await assert.rejects(fs.stat(result.file), { code: "ENOENT" });
        await assert.rejects(fs.stat(path.dirname(result.file)), { code: "ENOENT" });
        assert.equal(events.some((event) => event.type === "agent_error"), false);
        assert.equal(events.at(-1)?.type, "agent_done");
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("Claude abort stops the child and reports cancellation", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "oneyes-claude-abort-"));
    const bin = path.join(root, "bin");
    const cli = path.join(bin, "node_modules", "@anthropic-ai", "claude-code", "cli.js");
    await fs.mkdir(path.dirname(cli), { recursive: true });
    const script = "setInterval(() => {}, 1000); process.stdout.write(JSON.stringify({type:'ready'}) + '\\n');\n";
    await fs.writeFile(cli, script, { mode: 0o600 });
    if (process.platform !== "win32") await fs.writeFile(path.join(bin, "claude"), `#!${process.execPath}\n${script}`, { mode: 0o700 });
    const controller = new AbortController();
    const events: Array<{ type: string; payload: unknown }> = [];
    try {
        await runClaudeTurn("stop", (type, payload) => {
            events.push({ type, payload });
            if (type === "agent_event" && (payload as { type: string }).type === "ready") controller.abort();
        }, { env: { PATH: bin }, signal: controller.signal });
        assert.ok(controller.signal.aborted);
        assert.equal(events.some((event) => event.type === "agent_error"), false);
        assert.equal(events.at(-1)?.type, "agent_done");
        assert.equal((events.at(-1)?.payload as { cancelled: boolean }).cancelled, true);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});
