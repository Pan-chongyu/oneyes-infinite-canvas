const { Readable } = require('node:stream');

async function createNetwork(directFetch) {
    const { createTransport, proxyFailure } = await import('../canvas-proxy/transport.js');
    let settings = {};
    const inflight = new Set();
    const options = config => ({ url: config.upstreamProxyUrl, username: config.upstreamProxyUsername, password: config.upstreamProxyPassword });
    const active = config => config.proxyEnabled && config.proxyMode !== 'forwarder';
    function configure(config = {}) { settings = { ...config, proxyMode: config.proxyMode || 'forwarder' }; }
    async function request(url, init, config) {
        if (!active(config)) return directFetch(url, init);
        let current, streaming = false;
        const release = () => { current?.close(); inflight.delete(current); };
        try {
            current = createTransport(options(config));
            inflight.add(current);
            const response = await current.fetch(url, init);
            if (response.status === 407) { response.body?.destroy(); throw new Error('407 proxy authentication failed'); }
            const hasBody = response.body && init?.method !== 'HEAD' && ![204, 205, 304].includes(response.status);
            if (hasBody) { streaming = true; response.body.once('close', release); }
            const body = hasBody ? Readable.toWeb(response.body) : null;
            return new Response(body, { status: response.status, headers: Object.fromEntries([...response.headers].filter(([name]) => !['content-encoding', 'content-length', 'transfer-encoding'].includes(name))) });
        } catch (error) {
            if (init?.signal?.aborted) throw error;
            throw new Error(error.message?.startsWith('请填写代理') || error.message?.startsWith('代理地址无效') ? error.message : proxyFailure(error));
        } finally { if (!streaming) release(); }
    }
    return {
        configure,
        close() { for (const transport of inflight) transport.close(); inflight.clear(); },
        fetch(url, init = {}, requireProxy = false) {
            if (requireProxy && !active(settings)) return Promise.reject(new Error('代理配置尚未生效，请保存后重试'));
            return request(url, init, settings);
        },
        async test(config) {
            // Probe reachability without API keys, model invocation, or generated media.
            const response = await request('https://api.oneyes.ai/v1/models', { method: 'HEAD', redirect: 'manual' }, { ...config, proxyEnabled: true, proxyMode: 'upstream' });
            await response.body?.cancel();
            if (response.status === 407) throw new Error('代理认证失败，请检查用户名和密码');
            if (response.status >= 500) throw new Error(`目标服务暂时不可用（${response.status}），请稍后重试`);
            return { status: response.status };
        },
    };
}
module.exports = { createNetwork };
