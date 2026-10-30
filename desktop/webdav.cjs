// Native DAV requests work without browser CORS headers. Credentials never
// follow a redirect to another origin or get replaced by browser cookies.
async function requestWebdav(request, target, fetcher) {
    if (!['GET', 'HEAD', 'PROPFIND', 'MKCOL', 'PUT'].includes(request.method)) return new Response(null, { status: 405 });
    const headers = new Headers();
    for (const name of ['authorization', 'content-type', 'depth', 'if-match', 'if-none-match', 'if-unmodified-since']) {
        if (request.headers.has(name)) headers.set(name, request.headers.get(name));
    }
    const body = ['PUT', 'PROPFIND'].includes(request.method) ? await request.arrayBuffer() : undefined;
    const origin = new URL(target).origin, visited = new Set();
    while (!visited.has(target)) {
        visited.add(target);
        const response = await fetcher(target, { method: request.method, headers, body, signal: request.signal, redirect: 'manual', credentials: 'omit', cache: 'no-store' }).catch(error => {
            if (request.signal.aborted) throw error;
            throw new Error(/^(代理|请填写代理)/.test(error.message) ? error.message : 'WebDAV 无法连接，请检查服务地址、HTTPS 证书、网络和已保存的代理设置');
        });
        if ([301, 302, 307, 308].includes(response.status)) {
            const location = response.headers.get('location');
            await response.body?.cancel();
            const next = new URL(location || '', target);
            if (!location || next.origin !== origin || next.username || next.password || next.hash) throw new Error('WebDAV 重定向地址不安全，请填写服务商提供的最终 WebDAV 地址');
            target = next.href;
            continue;
        }
        if (response.status >= 300 && response.status < 400 && response.status !== 304) {
            await response.body?.cancel();
            throw new Error('WebDAV 重定向不受支持，请填写最终 WebDAV 地址');
        }
        const responseHeaders = new Headers(response.headers);
        for (const name of ['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'set-cookie']) responseHeaders.delete(name);
        return new Response(response.body, { status: response.status, headers: responseHeaders });
    }
    throw new Error('WebDAV 地址循环重定向，请检查服务地址');
}
module.exports = { requestWebdav };
