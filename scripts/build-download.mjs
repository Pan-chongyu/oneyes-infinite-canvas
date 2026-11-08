import { createRequire } from 'node:module';
const { createReleaseFetcher } = createRequire(import.meta.url)('../desktop/release-fetch.cjs');
export const createBuildDownloader = (options = {}) => {
    const download = createReleaseFetcher({ token: process.env.GITHUB_TOKEN, ...options });
    return async (...args) => { const response = await download(...args); if (!response.ok) { await response.body?.cancel(); throw Error(`Build resource download failed (${response.status})`); } return response; };
};
