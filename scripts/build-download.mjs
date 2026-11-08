// Resolve public release files through GitHub's asset API during builds.
// The caller still verifies the pinned checksum or OTA signature before use.
export function createBuildDownloader({ request = fetch, token = process.env.GITHUB_TOKEN } = {}) {
    const releases = new Map();
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'OneYes-Canvas-Build', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const checked = async response => {
        const result = await response;
        if (!result.ok) throw Error(`Build resource download failed (${result.status})`);
        return result;
    };
    return async resource => {
        const url = new URL(resource), match = url.origin === 'https://github.com' && url.pathname.match(/^\/([^/]+)\/([^/]+)\/releases\/(?:(latest)\/download|download\/([^/]+))\/([^/]+)$/);
        if (!match) return checked(request(url.href, { headers: url.origin === 'https://api.github.com' ? { ...headers, Accept: 'application/vnd.github.raw+json' } : undefined }));
        const [, owner, repo, latest, tag, file] = match;
        const root = `https://api.github.com/repos/${owner}/${repo}/releases`, endpoint = `${root}/${latest ? 'latest' : `tags/${encodeURIComponent(decodeURIComponent(tag))}`}`;
        if (!releases.has(endpoint)) releases.set(endpoint, checked(request(endpoint, { headers })).then(response => response.json()));
        const release = await releases.get(endpoint), asset = release.assets?.find(item => item.name === decodeURIComponent(file));
        if (!asset || !Number.isSafeInteger(asset.id) || asset.id <= 0 || asset.state !== 'uploaded') throw Error(`Build release asset is unavailable: ${decodeURIComponent(file)}`);
        const response = await request(`${root}/assets/${asset.id}`, { headers: { ...headers, Accept: 'application/octet-stream' }, redirect: 'manual' });
        if (response.status !== 302) return checked(response);
        const location = response.headers.get('location'), target = location && new URL(location);
        if (!target || target.protocol !== 'https:' || !['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(target.hostname)) throw Error('Invalid GitHub build asset redirect');
        // The short-lived public download URL receives no GitHub credentials.
        return checked(request(target.href));
    };
}
