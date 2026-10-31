#!/usr/bin/env node
const desktop = process.env.ONEYES_DESKTOP_AGENT === "1";
// Desktop owns the bridge, including while modules and config are loading.
if (desktop) process.once("disconnect", () => process.exit(0));

function fail(error: unknown) {
    const value = error instanceof Error ? error as NodeJS.ErrnoException : new Error("Agent startup failed");
    if (desktop && process.connected && process.send) {
        try {
            // No raw message or stderr reaches the UI or diagnostics. The parent
            // maps codes to fixed instructions and strips stack paths locally.
            process.send({ type: "startup-error", error: { code: (value as NodeJS.ErrnoException).code, stack: value.stack } }, () => process.exit(1));
            return;
        } catch {}
    }
    if (!desktop) console.error(value);
    process.exit(1);
}

try {
    if (process.argv[2] === "mcp") await (await import("./server/mcp.js")).startMcpServer();
    else (await import("./server/http.js")).startHttpServer().once("error", fail);
} catch (error) { fail(error); }
