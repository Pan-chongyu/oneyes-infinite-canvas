const { resolve, sep, extname } = require('node:path');
const { pathToFileURL } = require('node:url');
function route(input, root) {
    const url = new URL(input);
    if (url.protocol !== 'oneyes-canvas:' || url.host !== 'app') throw new Error('拒绝访问');
    if (url.pathname.startsWith('/oneyes-api/')) {
        const path = url.pathname.slice('/oneyes-api'.length);
        if (!/^\/v1\//.test(path)) throw new Error('无效接口');
        return { api: 'https://api.oneyes.ai' + path + url.search };
    }
    const path = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (path !== root && !path.startsWith(root + sep)) throw new Error('无效路径');
    return { file: pathToFileURL(extname(path) ? path : resolve(root, 'index.html')).href };
}
module.exports = { route };
