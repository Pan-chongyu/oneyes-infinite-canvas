const { Readable } = require('node:stream');

// Chromium fetch cancels manual redirects instead of exposing the 3xx response.
// Use Electron's request event for GET redirects, retaining system proxy support.
function createNativeFetch(net) {
    return (url, init = {}) => {
        if (init.redirect !== 'manual' || init.body || init.method && init.method !== 'GET') return net.fetch(url, init);
        return new Promise((resolve, reject) => {
            init.signal?.throwIfAborted();
            const request = net.request({ url: String(url), method: 'GET', redirect: 'manual', credentials: init.credentials || 'omit' });
            const headers = values => { const result = new Headers(); for (const [key, value] of Object.entries(values)) for (const item of Array.isArray(value) ? value : [value]) result.append(key, item); return result; };
            const cleanup = () => init.signal?.removeEventListener('abort', abort);
            const abort = () => { cleanup(); reject(init.signal.reason); request.abort(); };
            init.signal?.addEventListener('abort', abort, { once: true });
            request.on('error', error => { cleanup(); reject(error); });
            request.once('redirect', (status, _method, location, values) => {
                cleanup(); const responseHeaders = headers(values); responseHeaders.set('location', location);
                resolve(new Response(null, { status, headers: responseHeaders })); request.abort();
            });
            request.once('response', response => {
                // Request 'close' can precede the response; track the response lifecycle.
                for (const event of ['end', 'close', 'error']) response.once(event, cleanup);
                const body = [204, 205, 304].includes(response.statusCode) ? null : Readable.toWeb(response);
                resolve(new Response(body, { status: response.statusCode, headers: headers(response.headers) }));
            });
            for (const [key, value] of new Headers(init.headers)) request.setHeader(key, value);
            request.end();
        });
    };
}
module.exports = { createNativeFetch };
