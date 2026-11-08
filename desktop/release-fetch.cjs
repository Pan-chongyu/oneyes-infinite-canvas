// Resolve release files through the official API; callers verify signatures and hashes.
function createReleaseFetcher({ request = fetch, token } = {}) {
    const releases = new Map();
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'OneYes-Canvas', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const checked = async response => {
        const result = await response;
        if (!result.ok) { await result.body?.cancel(); throw Error(`GitHub release request failed (${result.status})`); }
        return result;
    };
    const download = async (resource, init = {}) => {
        const url = new URL(resource), match = url.origin === 'https://github.com' && url.pathname.match(/^\/([^/]+)\/([^/]+)\/releases\/(?:(latest)\/download|download\/([^/]+))\/([^/]+)$/);
        if (!match) return request(url.href, { ...init, headers: url.origin === 'https://api.github.com' ? { ...headers, Accept: 'application/vnd.github.raw+json' } : init.headers });
        const [, owner, repo, latest, tag, file] = match;
        const root = `https://api.github.com/repos/${owner}/${repo}/releases`, endpoint = `${root}/${latest ? 'latest' : `tags/${encodeURIComponent(decodeURIComponent(tag))}`}`;
        if (!releases.has(endpoint)) releases.set(endpoint, checked(request(endpoint, { headers, signal: init.signal })).then(response => response.json()));
        const release = await releases.get(endpoint), asset = release.assets?.find(item => item.name === decodeURIComponent(file));
        if (!asset || !Number.isSafeInteger(asset.id) || asset.id <= 0 || asset.state !== 'uploaded') throw Error(`GitHub release asset is unavailable: ${decodeURIComponent(file)}`);
        const forwarded = new Headers();
        for (const key of ['Range', 'If-Range']) { const value = new Headers(init.headers).get(key); if (value) forwarded.set(key, value); }
        const response = await request(`${root}/assets/${asset.id}`, { headers: { ...headers, ...Object.fromEntries(forwarded), Accept: 'application/octet-stream' }, redirect: 'manual', signal: init.signal });
        if (response.status !== 302) return response;
        const location = response.headers.get('location'), target = location && new URL(location);
        if (!target || target.protocol !== 'https:' || !['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(target.hostname)) throw Error('Invalid GitHub build asset redirect');
        // The short-lived public download URL receives no GitHub credentials.
        return request(target.href, { ...init, headers: forwarded });
    };
    download.reset = () => releases.clear();
    return download;
}
module.exports = { createReleaseFetcher };
