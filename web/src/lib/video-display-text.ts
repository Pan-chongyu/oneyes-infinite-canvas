/** Keep supplier details in diagnostics, not in user-facing video messages. */
export function videoDisplayText(value: string): string {
    return value
        .replace(/(?:https?:\/\/)?(?:[a-z0-9-]+\.)*(?:88api\.ai|zhiyingai\.org)(?:[^\s<>"'，。；）)]*)/gi, '视频服务')
        .replace(/智赢(?:协议桥|桥|通道|渠道)?|zhiying(?:ai)?|88[\s-]*api(?:\s*(?:通道|渠道))?/gi, '视频服务');
}
