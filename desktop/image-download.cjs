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
    return new Response(response.body, { headers: { 'Content-Type': type, 'Cache-Control': 'no-store' } });
}
module.exports = { downloadImage };
