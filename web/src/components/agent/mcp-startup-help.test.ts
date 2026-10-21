import assert from "node:assert/strict";
import { test } from "node:test";
import { mcpStartupHelp } from "./mcp-startup-help";

test("explains the reported Windows handshake error without blaming Canvas or claiming an exact cause", () => {
    assert.deepEqual(mcpStartupHelp("windows-mcp", "MCP client for `windows-mcp` failed to start: MCP startup failed: handshaking with MCP server failed: connection closed: initialize response"), { reason: "handshake", service: "windows" });
    assert.deepEqual(mcpStartupHelp("infinite-canvas", "connection refused"), { reason: "connection", service: "canvas" });
});
test("uses actionable inner errors before the generic handshake wrapper", () => {
    for (const error of ["spawn uvx ENOENT", "handshaking failed: ModuleNotFoundError: No module named windows_mcp", "uvx 不是内部或外部命令"]) assert.equal(mcpStartupHelp("windows-mcp", error).reason, "dependency");
    assert.equal(mcpStartupHelp("notion", "handshaking failed: 401 Unauthorized").reason, "auth");
    assert.equal(mcpStartupHelp("notion", "connection closed", "reauthenticationRequired").reason, "auth");
    assert.equal(mcpStartupHelp("other", "handshaking timed out").reason, "timeout");
});
test("cancellation and unknown errors get honest, separate guidance", () => {
    assert.equal(mcpStartupHelp("windows-mcp", "", null, true).reason, "cancelled");
    assert.deepEqual(mcpStartupHelp("unknown-server", "unexpected exit"), { reason: "unknown", service: "other" });
    assert.equal(mcpStartupHelp("a-windows-mcp-proxy", "").service, "other");
});
