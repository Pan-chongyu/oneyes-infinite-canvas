// Keep model discovery out of renderer Fetch/Axios custom-scheme handling.
// The destination is fixed; this bridge cannot forward a key to another host.
function createModelCatalog(fetcher) {
    return async apiKey => {
        if (typeof apiKey !== 'string' || !apiKey.trim() || /[\r\n]/.test(apiKey)) throw new Error('请先填写有效的 OneYes API Key');
        let response;
        try {
            response = await fetcher('https://api.oneyes.ai/v1/models', {
                method: 'GET', redirect: 'manual', headers: { Authorization: 'Bearer ' + apiKey.trim(), Accept: 'application/json' },
            });
        } catch (error) {
            if (/^(代理|请填写代理)/.test(error.message)) throw error;
            throw new Error('无法读取 OneYes 模型，请检查网络；如使用代理，请在配置中保存正确的代理地址后重新检查');
        }
        if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new Error('OneYes 模型接口发生重定向，已停止请求以保护 API Key'); }
        let body;
        try { body = await response.json(); } catch { /* Report status or invalid catalog below, never an HTML page. */ }
        if (!response.ok || body?.error || (body?.code !== undefined && body.code !== 0)) {
            const hint = response.status === 401 || response.status === 403 ? '请检查 Key 是否被删除、停用或无分组权限，再重新配置'
                : response.status === 429 ? '请求受限，请检查余额或稍后重新检查' : '服务暂时不可用，请稍后重新检查';
            throw new Error(`读取 OneYes 模型失败（HTTP ${response.status}），${hint}`);
        }
        if (!Array.isArray(body?.data) || body.data.some(item => typeof item?.id !== 'string' || !item.id.trim())) throw new Error('OneYes 模型列表格式无效，请稍后重新检查');
        const names = [...new Set(body.data.map(item => item.id))].sort((a, b) => a.localeCompare(b));
        if (!names.length) throw new Error('该 Key 没有可用模型，请检查官网分组权限后重新配置');
        return names;
    };
}
module.exports = { createModelCatalog };
