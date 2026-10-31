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
    const script = "process.stdin.resume(); process.stdin.on('end', () => process.stdout.write(JSON.stringify({type:'result', text:'ok'})));\n";
    await fs.writeFile(cli, script, { mode: 0o600 });
    if (process.platform !== "win32") {
        const executable = path.join(bin, "claude");
        await fs.writeFile(executable, `#!/usr/bin/env node\n${script}`, { mode: 0o700 });
    }
    try {
        const command = await claudeCommand({ PATH: bin }, "win32");
        assert.equal(command.command, process.execPath);
        assert.deepEqual(command.args, [cli]);
        const events: Array<{ type: string; payload: unknown }> = [];
        await runClaudeTurn("含有 & 和引号的提示词", (type, payload) => events.push({ type, payload }), { env: { PATH: bin }, signal: new AbortController().signal });
        assert.deepEqual(events.find((event) => event.type === "agent_event")?.payload, { agent: "claude", type: "result", text: "ok" });
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
    const script = "setInterval(() => {}, 1000);\n";
    await fs.writeFile(cli, script, { mode: 0o600 });
    if (process.platform !== "win32") await fs.writeFile(path.join(bin, "claude"), `#!/usr/bin/env node\n${script}`, { mode: 0o700 });
    const controller = new AbortController();
    const run = runClaudeTurn("stop", () => undefined, { env: { PATH: bin }, signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort();
    await run;
    await fs.rm(root, { recursive: true, force: true });
});
