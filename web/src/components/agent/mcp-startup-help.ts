export function mcpStartupHelp(name: string, error = "", failureReason?: string | null, cancelled = false) {
    const reason = cancelled ? "cancelled"
        : failureReason === "reauthenticationRequired" || /\b(401|403|unauthorized|forbidden)\b|reauthenticat|credentials? expired/i.test(error) ? "auth"
        : /ENOENT|command not found|not recognized|no module named|ModuleNotFoundError|executable.*not found|找不到.*(?:文件|命令)|不是内部或外部命令/i.test(error) ? "dependency"
        : /timed?\s*out|timeout|超时/i.test(error) ? "timeout"
        : /handshak|initialize response|initialization.*(?:closed|failed)/i.test(error) ? "handshake"
        : /ECONNREFUSED|connection refused|failed to connect|连接被拒绝/i.test(error) ? "connection"
        : "unknown";
    const service = name.toLowerCase() === "windows-mcp" ? "windows" : name === "infinite-canvas" ? "canvas" : "other";
    return { reason, service } as const;
}
