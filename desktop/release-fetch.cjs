// Resolve release files through the official API; callers verify signatures and hashes.
function createReleaseFetcher({ request = fetch, token } = {}) {
    const releases = new Map(), destinations = new Map();
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'OneYes-Canvas', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const checked = async response => {
        const result = await response;
        if (!result.ok) { await result.body?.cancel(); throw Object.assign(Error(`GitHub release request failed (${result.status})`), { status: result.status }); }
        return result;
    };
    const transient = status => [401, 403, 408, 429].includes(status) || status >= 500;
    const targetUrl = location => {
        const target = location && new URL(location);
        if (!target || target.username || target.password || !['https://release-assets.githubusercontent.com', 'https://objects.githubusercontent.com'].includes(target.origin)) throw Error('Invalid GitHub build asset redirect');
        return target.href;
    };
    const download = async (resource, init = {}) => {
        const url = new URL(resource), match = url.origin === 'https://github.com' && url.pathname.match(/^\/([^/]+)\/([^/]+)\/releases\/(?:(latest)\/download|download\/([^/]+))\/([^/]+)$/);
        if (!match) return request(url.href, { ...init, headers: url.origin === 'https://api.github.com' ? { ...headers, Accept: 'application/vnd.github.raw+json' } : init.headers });
        init.signal?.throwIfAborted();
        const [, owner, repo, latest, tag, file] = match;
        const root = `https://api.github.com/repos/${owner}/${repo}/releases`, endpoint = `${root}/${latest ? 'latest' : `tags/${encodeURIComponent(decodeURIComponent(tag))}`}`;
        const forwarded = new Headers();
        for (const key of ['Range', 'If-Range']) { const value = new Headers(init.headers).get(key); if (value) forwarded.set(key, value); }
        const direct = address => request(address, { ...init, credentials: 'omit', headers: forwarded });
        // Hundreds of byte ranges belong to one immutable asset. Resolve its
        // signed download address once, rather than spending an API call per range.
        const cached = destinations.get(url.href);
        if (cached) {
            const result = await direct(cached);
            if (![401, 403, 404, 410].includes(result.status)) return result;
            await result.body?.cancel(); destinations.delete(url.href);
        }
        let release, response;
        try {
            if (!releases.has(endpoint)) releases.set(endpoint, checked(request(endpoint, { headers, signal: init.signal, cache: 'no-store', credentials: 'omit' })).then(response => response.json()));
            release = await releases.get(endpoint);
            const asset = release.assets?.find(item => item.name === decodeURIComponent(file));
            if (!asset || !Number.isSafeInteger(asset.id) || asset.id <= 0 || asset.state !== 'uploaded') throw Error(`GitHub release asset is unavailable: ${decodeURIComponent(file)}`);
            const endpointUrl = new URL(asset.url || `${root}/assets/${asset.id}`);
            if (endpointUrl.origin !== 'https://api.github.com' || endpointUrl.username || endpointUrl.password || endpointUrl.search || endpointUrl.hash || !new RegExp(`^/(?:repos/[^/]+/[^/]+|repositories/[0-9]+)/releases/assets/${asset.id}$`).test(endpointUrl.pathname)) throw Error('Invalid GitHub asset API address');
            response = await request(endpointUrl.href, { headers: { ...headers, ...Object.fromEntries(forwarded), Accept: 'application/octet-stream', 'Cache-Control': 'no-cache' }, cache: 'no-store', credentials: 'omit', redirect: 'manual', signal: init.signal });
            if (transient(response.status)) { await response.body?.cancel(); throw Object.assign(Error('GitHub asset API unavailable'), { status: response.status }); }
        } catch (error) {
            init.signal?.throwIfAborted();
            // A metadata/rate-limit failure can use the official download entry.
            // Pin latest to the same tag once a release snapshot is available.
            if (error.name === 'AbortError' || error.status && !transient(error.status) || /Invalid GitHub|asset is unavailable/.test(error.message)) throw error;
            const fallback = latest && release?.tag_name ? `https://github.com/${owner}/${repo}/releases/download/${encodeURIComponent(release.tag_name)}/${file}` : url.href;
            const options = { ...init, credentials: 'omit', headers: { ...Object.fromEntries(forwarded), 'Cache-Control': 'no-cache' }, redirect: 'manual', cache: 'no-store' };
            response = await request(fallback, options);
            if (latest && !release?.tag_name && response.status === 302) {
                // /latest/download first pins to a tag on github.com. Follow
                // only that exact repository/file hop before validating the CDN.
                const pinned = new URL(response.headers.get('location') || '', fallback);
                const path = pinned.pathname.match(/^\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/([^/]+)$/);
                if (pinned.origin === url.origin && !pinned.username && !pinned.password && !pinned.search && !pinned.hash && path?.[1] === owner && path[2] === repo && path[4] === file) {
                    await response.body?.cancel(); response = await request(pinned.href, options);
                }
            }
        }
        if (response.status !== 302) return response;
        const address = targetUrl(response.headers.get('location'));
        await response.body?.cancel();
        destinations.set(url.href, address);
        // The short-lived public download URL receives no GitHub credentials.
        return direct(address);
    };
    download.reset = () => { releases.clear(); destinations.clear(); };
    return download;
}
module.exports = { createReleaseFetcher };
