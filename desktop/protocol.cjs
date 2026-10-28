const { resolve, sep, extname } = require('node:path');
const { pathToFileURL } = require('node:url');
function route(input, root) {
    const url = new URL(input);
    if (url.protocol !== 'oneyes-canvas:' || url.host !== 'app') throw new Error('拒绝访问');
    if (url.pathname === '/image-download') {
        const target = new URL(url.searchParams.get('url'));
        if (target.protocol !== 'https:' || target.username || target.password) throw new Error('无效图片地址');
        return { image: target.href };
    }
    if (url.pathname === '/proxy') {
        const target = new URL(url.searchParams.get('url'));
        if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error('无效代理目标');
        return { api: target.href, proxy: true };
    }
    if (url.pathname.startsWith('/oneyes-api/')) {
        const path = url.pathname.slice('/oneyes-api'.length);
        if (!/^\/v1\//.test(path)) throw new Error('无效接口');
        return { apis: ['https://oneyes.ai', 'https://api.oneyes.ai'].map(base => base + path + url.search) };
    }
    const path = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (path !== root && !path.startsWith(root + sep)) throw new Error('无效路径');
    return { file: pathToFileURL(extname(path) ? path : resolve(root, 'index.html')).href };
}
module.exports = { route };
