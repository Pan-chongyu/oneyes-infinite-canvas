// Diagnostic data is an allowlist, never a serialized Error/request/response.
const components = ['app', 'image', 'video', 'webdav', 'agent', 'update', 'account', 'models', 'storage', 'network', 'plugins'];
const stages = ['startup', 'request', 'submit', 'poll', 'save', 'restore', 'sync', 'connect', 'install', 'download', 'renderer', 'crash', 'load', 'setup', 'check'];
const reasons = ['unknown', 'network', 'timeout', 'authentication', 'permission', 'not-found', 'rate-limit', 'server', 'invalid-image', 'invalid-data', 'storage', 'integrity', 'configuration', 'cancelled', 'runtime'];
const errorTypes = ['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'DOMException', 'AgentApiError', 'ImageTaskHttpError', 'AxiosError'];
const codes = ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOSPC', 'EACCES', 'EPERM', 'ENOENT', 'ERR_NETWORK', 'ERR_CANCELED', 'ERR_CONNECTION_CLOSED', 'ERR_FAILED', 'ERR_INTERNET_DISCONNECTED'];
function classify(text, status, code) {
    if (/abort|cancel|取消/i.test(text) || code === 'ERR_CANCELED') return 'cancelled';
    if (status === 401 || /unauthor|api.?key.*(?:invalid|无效)|认证/i.test(text)) return 'authentication';
    if (status === 403 || /permission|权限/i.test(text)) return 'permission';
    if (status === 404 || status === 410 || /not found|不存在|已过期|缺失/i.test(text)) return 'not-found';
    if (status === 429) return 'rate-limit';
    if (status >= 500) return 'server';
    if (/timeout|timed out|超时/i.test(text) || code === 'ETIMEDOUT') return 'timeout';
    if (/sha.?256|checksum|signature|校验|签名/i.test(text)) return 'integrity';
    if (/invalid image|图片.*(?:损坏|无效)|无法解码/i.test(text)) return 'invalid-image';
    if (/network|fetch|socket|连接|网络/i.test(text) || /^E(CONN|NOTFOUND|AI_)/.test(code)) return 'network';
    if (/quota|indexeddb|存储|磁盘/i.test(text) || ['ENOSPC', 'EACCES'].includes(code)) return 'storage';
    if (/config|配置|模型.*不可用/i.test(text)) return 'configuration';
    if (/json|parse|format|格式/i.test(text)) return 'invalid-data';
    return 'unknown';
}
function normalize(input = {}) {
    const raw = input.error || input;
    const status = Number(raw.status ?? raw.response?.status ?? input.status) || 0;
    const code = codes.includes(raw.code) ? raw.code : '';
    // Keep only source file + line/column. Drop message lines, function arguments,
    // full paths, query strings, URLs and arbitrary context (including prompts).
    const stack = (Array.isArray(input.stack) ? input.stack : String(raw.stack || '').split('\n').slice(1))
        .flatMap(line => {
            const match = String(line).match(/(?:^|[\s/\\(])([A-Za-z0-9_.-]{1,100}\.(?:cjs|mjs|js|ts|tsx):\d{1,8}(?::\d{1,8})?)(?:\)?\s*)$/);
            return match && !/sk-|secret|token|password/i.test(match[1]) ? [match[1]] : [];
        }).slice(0, 12);
    const reason = reasons.includes(input.reason) ? input.reason : classify(String(raw.message || ''), status, code);
    return {
        component: components.includes(input.component) ? input.component : 'app',
        stage: stages.includes(input.stage) ? input.stage : 'request',
        error_type: errorTypes.includes(raw.name || input.error_type) ? raw.name || input.error_type : 'Error',
        reason, code, status: status >= 400 && status <= 599 ? Math.floor(status) : 0, stack,
    };
}
module.exports = { normalize, components, stages, reasons };
