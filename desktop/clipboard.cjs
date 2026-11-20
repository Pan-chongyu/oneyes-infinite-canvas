const { readFile, stat } = require('node:fs/promises');
const { basename, extname } = require('node:path');
const { fileURLToPath } = require('node:url');
const imageTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jfif': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };

async function readClipboard(clipboard) {
    const items = await clipboard.read();
    // Electron maps Explorer/Finder/Linux copied files to this native URI list.
    const fileItems = items.filter(item => item.types.includes('text/uri-list'));
    if (fileItems.length) {
        const files = [], seen = new Set();
        let hasLocalFiles = false;
        for (const item of fileItems) for (const line of (await (await item.getType('text/uri-list')).text()).split(/\r?\n/)) {
            let path;
            try {
                const url = new URL(line.trim());
                if (url.protocol !== 'file:' || (url.hostname && url.hostname !== 'localhost') || url.search || url.hash) continue;
                path = fileURLToPath(url);
            } catch { continue; }
            hasLocalFiles = true;
            const type = imageTypes[extname(path).toLowerCase()];
            const key = process.platform === 'win32' ? path.toLowerCase() : path;
            if (!type || seen.has(key)) continue;
            seen.add(key);
            try {
                if (!(await stat(path)).isFile()) continue;
                files.push({ name: basename(path), image: new Uint8Array(await readFile(path)), type });
            } catch { throw new Error('无法读取剪贴板中的图片文件，请确认文件仍在本机且可访问'); }
        }
        if (hasLocalFiles) return files.length ? { files } : {};
    }
    for (const item of items) {
        const type = item.types.includes('image/png') ? 'image/png' : item.types.find(type => type.startsWith('image/'));
        if (type) return { image: new Uint8Array(await (await item.getType(type)).arrayBuffer()), type };
    }
    for (const item of items) {
        if (item.types.includes('text/plain')) return { text: await (await item.getType('text/plain')).text() };
    }
    return {};
}
module.exports = { readClipboard };
