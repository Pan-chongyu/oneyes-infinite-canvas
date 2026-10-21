#!/usr/bin/env node
import { startHttpServer } from "./server/http.js";
import { startMcpServer } from "./server/mcp.js";

if (process.argv[2] === "mcp") await startMcpServer();
else {
    startHttpServer().on("error", () => process.exit(1));
    // Desktop owns the bridge. Losing the IPC parent must not leave a listener behind.
    if (process.env.ONEYES_DESKTOP_AGENT === "1") process.once("disconnect", () => process.exit(0));
}
