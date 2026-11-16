import { videoErrorText } from '../../../desktop/video-errors.mjs';
export { videoErrorText };

/** Preserve cancellation and the original cause used by GET-only recovery. */
export function videoUserError(error: unknown, context?: Parameters<typeof videoErrorText>[1]): Error {
    const text = videoErrorText(error, context);
    if (error instanceof Error && error.message === text) return error;
    const safe = new Error(text, { cause: error });
    if (error instanceof Error) safe.name = error.name;
    return safe;
}

/** Model labels only. Errors must use videoErrorText's fixed whitelist. */
export function videoDisplayText(value: string): string {
    return value
        .replace(/(?:https?:\/\/)?(?:[a-z0-9-]+\.)*(?:88api\.ai|zhiyingai\.org)(?:[^\s<>"'，。；）)]*)/gi, '视频服务')
        .replace(/智赢(?:协议桥|桥|通道|渠道)?|zhiying(?:ai)?|88[\s-]*api(?:\s*(?:通道|渠道))?/gi, '视频服务');
}
