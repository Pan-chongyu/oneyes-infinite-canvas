const { verify } = require('node:crypto');
const semver = require('semver');
const PUBLIC_KEY = require('./update-key.cjs');
const RELEASE_ROOT = 'https://github.com/Pan-chongyu/oneyes-infinite-canvas/releases';
const FEED = `${RELEASE_ROOT}/latest/download/canvas-latest.json`;
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;

function filename(version, platform, arch, format) {
    const os = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[platform];
    const packageArch = platform === 'linux' ? { AppImage: { x64: 'x86_64', arm64: 'arm64' }, deb: { x64: 'amd64', arm64: 'arm64' }, rpm: { x64: 'x86_64', arm64: 'aarch64' } }[format]?.[arch] : arch;
    if (!os || !['x64', 'arm64'].includes(arch) || !packageArch) throw new Error('当前系统或芯片暂不支持自动更新');
    return `OneYes-Canvas-${version}-${os}-${packageArch}${platform === 'win32' ? '-Setup' : ''}.${format === 'nsis' ? 'exe' : format}`;
}
function platformKey({ platform, arch, format }) { return `${platform}-${arch}-${format}`; }
function deltaFilename(version, from, platform, arch, format) { return `${filename(version, platform, arch, format)}.from-${from}.delta`; }
function readManifest(text, signature, target, publicKey = PUBLIC_KEY, currentVersion = '') {
    if (typeof signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(signature.trim()) || !verify(null, Buffer.from(text), publicKey, Buffer.from(signature.trim(), 'base64'))) throw new Error('更新清单签名无效，已停止更新。请重新检查更新');
    const data = JSON.parse(text);
    if (data.schema !== 1 || !semver.valid(data.version) || semver.prerelease(data.version) || typeof data.notes !== 'string') throw new Error('更新清单格式无效，请稍后重试');
    const entry = data.platforms?.[platformKey(target)];
    const name = filename(data.version, target.platform, target.arch, target.format);
    if (!entry || entry.file !== name || entry.url !== `${RELEASE_ROOT}/download/v${data.version}/${name}` || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.size) || entry.size <= 0) throw new Error('未找到适合当前系统、芯片和安装格式的更新包');
    let delta;
    const candidate = currentVersion && data.deltas?.[platformKey(target)]?.[currentVersion];
    if (candidate) {
        const baseName = filename(currentVersion, target.platform, target.arch, target.format);
        const expectedDelta = deltaFilename(data.version, currentVersion, target.platform, target.arch, target.format);
        if (candidate.from === currentVersion && candidate.file === expectedDelta && candidate.baseFile === baseName && candidate.url === `${RELEASE_ROOT}/download/v${data.version}/${expectedDelta}` && /^[a-f0-9]{64}$/.test(candidate.sha256) && /^[a-f0-9]{64}$/.test(candidate.baseSha256) && candidate.targetSha256 === entry.sha256 && candidate.targetSize === entry.size && Number.isSafeInteger(candidate.size) && candidate.size > 0 && Number.isSafeInteger(candidate.baseSize) && candidate.baseSize > 0) {
            delta = { from: candidate.from, file: candidate.file, url: candidate.url, size: candidate.size, sha256: candidate.sha256, baseFile: candidate.baseFile, baseSize: candidate.baseSize, baseSha256: candidate.baseSha256, targetSha256: candidate.targetSha256, targetSize: candidate.targetSize };
        }
    }
    return { version: data.version, notes: data.notes, file: entry.file, url: entry.url, size: entry.size, sha256: entry.sha256, ...(delta ? { delta } : {}) };
}
function newer(version, current) { return Boolean(semver.valid(version) && semver.valid(current) && semver.gt(version, current)); }
module.exports = { FEED, CHECK_INTERVAL, RELEASE_ROOT, filename, deltaFilename, platformKey, readManifest, newer };
