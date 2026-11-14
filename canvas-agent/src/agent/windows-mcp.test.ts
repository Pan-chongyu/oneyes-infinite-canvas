import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractWindowsMcpArchive, managedWindowsMcp, prepareWindowsMcp } from "./windows-mcp.js";

test("Windows extraction handles Unicode paths without depending on the installed Archive module", { skip: process.platform !== "win32" }, async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "canvas-mcp-解压 空格-"));
    const modulePath = process.env.PSModulePath;
    try {
        const source = path.join(dir, "source"), zip = path.join(dir, "依赖.zip"), stage = path.join(dir, "解压 目录");
        await mkdir(source); await writeFile(path.join(source, "uv.exe"), "fixture executable");
        const modules = path.join(dir, "modules"), archiveModule = path.join(modules, "Microsoft.PowerShell.Archive");
        await mkdir(archiveModule, { recursive: true });
        await writeFile(path.join(archiveModule, "Microsoft.PowerShell.Archive.psm1"), "function Expand-Archive { throw 'Incompatible Archive module' }; Export-ModuleMember -Function Expand-Archive");
        await promisify(execFile)(path.join(process.env.SystemRoot || "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($env:ONEYES_TEST_SOURCE, $env:ONEYES_TEST_ZIP)"], { env: { ...process.env, ONEYES_TEST_SOURCE: source, ONEYES_TEST_ZIP: zip }, windowsHide: true });
        process.env.PSModulePath = modules;
        await extractWindowsMcpArchive(zip, stage);
        assert.equal(await readFile(path.join(stage, "uv.exe"), "utf8"), "fixture executable");
        await writeFile(zip, "corrupt archive");
        await assert.rejects(extractWindowsMcpArchive(zip, path.join(dir, "corrupt")));
        assert.equal(await readFile(path.join(stage, "uv.exe"), "utf8"), "fixture executable");
    } finally {
        if (modulePath === undefined) delete process.env.PSModulePath; else process.env.PSModulePath = modulePath;
        assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep));
        await rm(dir, { recursive: true, force: true });
    }
});

test("only the official enabled Windows-MCP stdio command qualifies for provisioning", () => {
    for (const command of ["uvx", "C:\\tools\\uvx.exe"]) assert.equal(managedWindowsMcp({ command, args: ["windows-mcp", "serve"] }), true);
    assert.equal(managedWindowsMcp({ command: "windows-mcp.exe", args: ["serve", "--transport", "stdio"] }), true);
    for (const value of [null, { command: "uvx", args: ["other", "serve"] }, { command: "windows-mcp", args: ["serve"], enabled: false }, { command: "windows-mcp", args: ["serve"], url: "https://example.com" }, { command: "powershell", args: ["windows-mcp", "serve"] }, { command: "windows-mcp", args: ["serve", "--transport", "sse"] }, { command: "uvx", args: ["--from", "custom", "windows-mcp", "serve"] }]) assert.equal(managedWindowsMcp(value), false);
});

for (const scenario of ["healthy", "cached", "missing", "offline"] as const) test(`Windows dependencies: ${scenario}, coalesced setup preserves config and permissions`, async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "canvas-mcp-deps-"));
    try {
        const original = '# User config\nmodel="keep"\n[mcp_servers.windows-mcp]\ncommand="uvx"\nargs=["windows-mcp","serve"]\nstartup_timeout_sec=120\ndefault_tools_approval_mode="prompt"\n[mcp_servers.windows-mcp.env]\nCUSTOM_VALUE="keep"\n[mcp_servers.other]\ncommand="untouched"\n';
        await writeFile(path.join(dir, "config.toml"), original);
        let installs = 0, progress = 0, installed = false;
        const options = { platform: "win32" as const, codexHome: dir, root: path.join(dir, "dependencies"), installing: () => { progress++; },
            probe: async (settings: { command: string }) => {
                if (scenario === "healthy" && settings.command === "uvx" || settings.command !== "uvx" && (scenario === "cached" || installed)) return { tools: 21, server: undefined };
                throw new Error("missing dependency");
            }, install: async (root: string) => { installs++; await new Promise(resolve => setImmediate(resolve)); if (scenario === "offline") throw new Error("network unavailable"); installed = true; return path.join(root, "installed.exe"); },
        };
        if (scenario === "offline") await assert.rejects(prepareWindowsMcp(options), /network unavailable/);
        else {
            const [result, duplicate] = await Promise.all([prepareWindowsMcp(options), prepareWindowsMcp(options)]);
            assert.deepEqual(result, duplicate);
            assert.equal(result?.default_tools_approval_mode, "prompt");
            assert.equal(result?.startup_timeout_sec, 120);
            assert.equal(result?.env?.CUSTOM_VALUE, "keep");
            assert.equal(result?.command === "uvx", scenario === "healthy");
        }
        assert.equal(installs, scenario === "missing" || scenario === "offline" ? 1 : 0);
        assert.equal(progress, scenario === "healthy" || scenario === "cached" ? 0 : 1);
        assert.equal(await readFile(path.join(dir, "config.toml"), "utf8"), original);
    } finally { await rm(dir, { recursive: true, force: true }); }
});

test("non-Windows, disabled, absent and malformed config never install dependencies", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "canvas-mcp-skipped-"));
    try {
        const options = { codexHome: dir, install: async () => { throw new Error("must not install"); } };
        assert.equal(await prepareWindowsMcp({ ...options, platform: "linux" }), undefined);
        assert.equal(await prepareWindowsMcp({ ...options, platform: "win32" }), undefined);
        await writeFile(path.join(dir, "config.toml"), '[mcp_servers.windows-mcp]\ncommand="uvx"\nargs=["windows-mcp","serve"]\nenabled=false\n');
        assert.equal(await prepareWindowsMcp({ ...options, platform: "win32" }), undefined);
        await writeFile(path.join(dir, "config.toml"), "[broken");
        await assert.rejects(prepareWindowsMcp({ ...options, platform: "win32" }));
        assert.equal(await readFile(path.join(dir, "config.toml"), "utf8"), "[broken");
    } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a service disabled while dependencies are downloading is never re-enabled by a stale override", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "canvas-mcp-concurrent-"));
    try {
        const file = path.join(dir, "config.toml"), initial = '[mcp_servers.windows-mcp]\ncommand="uvx"\nargs=["windows-mcp","serve"]\n';
        await writeFile(file, initial);
        let installed = false;
        const result = await prepareWindowsMcp({ codexHome: dir, root: path.join(dir, "deps"), platform: "win32",
            probe: async () => { if (!installed) throw new Error("missing"); return { server: undefined, tools: 21 }; },
            install: async () => { await writeFile(file, initial + 'enabled=false\n'); installed = true; return path.join(dir, "installed.exe"); },
        });
        assert.equal(result, undefined);
        assert.equal(await readFile(file, "utf8"), initial + 'enabled=false\n');
    } finally { await rm(dir, { recursive: true, force: true }); }
});
