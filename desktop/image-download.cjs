// Object-storage results often omit CORS headers. Fetch anonymously in the main
// process, then expose only image bytes through the app's same-origin protocol.
async function downloadImage(request, url, fetcher) {
    if (request.method !== 'GET') return new Response(null, { status: 405 });
    const response = await fetcher(url, { method: 'GET', headers: { Accept: 'image/*' }, credentials: 'omit', redirect: 'error', cache: 'no-store', signal: request.signal });
    const type = response.headers.get('content-type') || 'application/octet-stream';
    if (!response.ok || !/^(image\/|application\/octet-stream(?:;|$))/i.test(type)) {
        await response.body?.cancel();
        return new Response(null, { status: response.ok ? 502 : response.status });
    }
    const headers = { 'Content-Type': type, 'Cache-Control': 'no-store' };
    // net.fetch may already have decompressed the body; only report the length
    // when it describes the bytes actually forwarded to the renderer.
    const length = response.headers.get('content-length');
    if (!response.headers.get('content-encoding') && /^\d+$/.test(length || '') && Number.isSafeInteger(Number(length)) && Number(length) > 0) headers['Content-Length'] = length;
    return new Response(response.body, { headers });
}
module.exports = { downloadImage };
