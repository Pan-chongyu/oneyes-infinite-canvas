// Diagnostic data is an allowlist, never a serialized Error/request/response.
const components = ['app', 'image', 'video', 'webdav', 'agent', 'update', 'account', 'models', 'storage', 'network', 'plugins', 'media'];
const stages = ['startup', 'request', 'submit', 'poll', 'save', 'restore', 'sync', 'connect', 'install', 'download', 'renderer', 'crash', 'load', 'setup', 'check'];
const reasons = ['unknown', 'network', 'timeout', 'authentication', 'permission', 'not-found', 'rate-limit', 'server', 'invalid-image', 'invalid-data', 'storage', 'integrity', 'configuration', 'cancelled', 'runtime'];
const operations = ['agent-initialize', 'agent-models', 'agent-thread', 'agent-turn', 'agent-skills', 'agent-mcp', 'video-openai', 'video-grok', 'video-gemini', 'video-reference', 'video-content', 'media-analyze', 'media-render', 'media-process', 'update-feed', 'update-package', 'update-delta', 'update-installer'];
const errorTypes = ['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'DOMException', 'AgentApiError', 'ImageTaskHttpError', 'AxiosError', 'AbortError', 'TimeoutError', 'CodexReportedError', 'VideoTaskFailed'];
const codes = ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOSPC', 'EACCES', 'EPERM', 'ENOENT', 'EADDRINUSE', 'ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'ERR_AGENT_CONFIG', 'ERR_AGENT_STARTUP', 'ERR_AGENT_EXIT', 'ERR_NETWORK', 'ERR_CANCELED', 'ERR_CONNECTION_CLOSED', 'ERR_FAILED', 'ERR_INTERNET_DISCONNECTED'];
codes.push('ERR_AGENT_RPC', 'ERR_AGENT_RPC_PARSE', 'ERR_AGENT_RPC_PARAMS', 'ERR_AGENT_RPC_METHOD', 'ERR_MEDIA_PROCESS');
function classify(text, status, code) {
    if (/TimeoutError|timeout|timed out|超时/i.test(text) || code === 'ETIMEDOUT') return 'timeout';
    if (/abort|cancel|取消/i.test(text) || code === 'ERR_CANCELED') return 'cancelled';
    if (['ERR_AGENT_CONFIG', 'EADDRINUSE'].includes(code)) return 'configuration';
    if (['ERR_AGENT_RPC_PARSE', 'ERR_AGENT_RPC_PARAMS', 'ERR_AGENT_RPC_METHOD'].includes(code)) return 'configuration';
    if (code === 'ERR_MEDIA_PROCESS') return 'invalid-data';
    if (['ERR_AGENT_STARTUP', 'ERR_AGENT_EXIT', 'ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(code)) return 'runtime';
    if (['EACCES', 'EPERM'].includes(code)) return 'permission';
    if (status === 401 || /unauthor|api.?key.*(?:invalid|无效)|认证/i.test(text)) return 'authentication';
    if (status === 403 || /permission|权限/i.test(text)) return 'permission';
    if (status === 404 || status === 410 || /not found|不存在|已过期|缺失/i.test(text)) return 'not-found';
    if (status === 429) return 'rate-limit';
    if (status >= 500) return 'server';
    if (/sha.?256|checksum|signature|校验|签名/i.test(text)) return 'integrity';
    if (/invalid image|图片.*(?:损坏|无效)|无法解码/i.test(text)) return 'invalid-image';
    if (/network|fetch|socket|连接|网络/i.test(text) || /^E(CONN|NOTFOUND|AI_)/.test(code)) return 'network';
    if (/quota|indexeddb|存储|磁盘/i.test(text) || ['ENOSPC', 'EACCES'].includes(code)) return 'storage';
    if (/config|配置|模型.*不可用/i.test(text)) return 'configuration';
    if (/json|parse|format|格式/i.test(text)) return 'invalid-data';
    if (status === 422) return 'invalid-data';
    return 'unknown';
}
function normalize(input = {}) {
    const raw = input.error ?? input, chain = [], seen = new Set();
    for (let item = raw; item != null && !seen.has(item); item = item?.cause) { seen.add(item); chain.push(item); }
    const status = chain.map(item => Number(item?.status ?? item?.response?.status)).find(value => value >= 400 && value <= 599) || Number(input.status) || 0;
    const code = chain.map(item => item?.code).find(value => codes.includes(value)) || (codes.includes(input.code) ? input.code : '');
    const operation = [input.operation, ...chain.map(item => item?.diagnosticOperation)].find(value => operations.includes(value));
    // Keep only source file + line/column. Drop message lines, function arguments,
    // full paths, query strings, URLs and arbitrary context (including prompts).
    const stack = (Array.isArray(input.stack) ? input.stack : chain.flatMap(item => typeof item?.stack === 'string' ? item.stack.split('\n').slice(1) : []))
        .flatMap(line => {
            const match = String(line).match(/(?:^|[\s/\\(])([A-Za-z0-9_.-]{1,100}\.(?:cjs|mjs|js|ts|tsx):\d{1,8}(?::\d{1,8})?)(?:\)?\s*)$/);
            return match && !/sk-|secret|token|password/i.test(match[1]) ? [match[1]] : [];
        }).slice(0, 12);
    const reason = reasons.includes(input.reason) ? input.reason : classify(chain.map(item => typeof item === 'string' ? item : String(item?.message || item?.name || '')).join('\n'), status, code);
    return {
        component: components.includes(input.component) ? input.component : 'app',
        stage: stages.includes(input.stage) ? input.stage : 'request',
        error_type: errorTypes.includes(raw?.name || input.error_type) ? raw?.name || input.error_type : 'Error',
        reason, code, status: status >= 400 && status <= 599 ? Math.floor(status) : 0, stack,
        ...(operation ? { operation } : {}),
    };
}
module.exports = { normalize, components, stages, reasons, operations };
