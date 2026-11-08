import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, chmod, readdir, copyFile, rm, rename } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join, resolve, basename } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createBuildDownloader } from './build-download.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const download = createBuildDownloader();
const target = join(root, 'desktop', 'media-bin');
const manifest = JSON.parse(await readFile(join(root, 'desktop/media-binaries.json'), 'utf8'));
const fonts = JSON.parse(await readFile(join(root, 'desktop/media-fonts.json'), 'utf8'));
const platform = `${process.platform}-${process.arch}`;
if (!manifest[platform]) throw new Error(`Unsupported media runtime: ${platform}`);
await mkdir(target, { recursive: true });
for (const asset of [...manifest[platform], ...fonts]) {
    const destination = join(target, asset.name);
    const checksum = async file => { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); };
    if (await checksum(destination).catch(() => '') !== asset.sha256) {
        console.log(`Downloading ${asset.name}`);
        const response = await download(asset.url);
        const partial = destination + '.part';
        let received = 0, last = -1;
        const total = Number(response.headers.get('content-length'));
        try {
            await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, encoding, callback) {
                received += chunk.length;
                const percent = total ? Math.floor(received / total * 10) : 0;
                if (percent !== last) { last = percent; console.log(`  ${asset.name}: ${received} / ${total || '?'} bytes`); }
                callback(null, chunk);
            } }), createWriteStream(partial));
            if (await checksum(partial) !== asset.sha256) throw new Error('Media runtime checksum mismatch');
            await rename(partial, destination);
        } finally { await rm(partial, { force: true }); }
    }
    if (asset.name.endsWith('.zip')) {
        const extract = createRequire(import.meta.url)('extract-zip');
        const unpack = join(target, 'unpack');
        try {
            await extract(destination, { dir: unpack });
            const visit = async directory => {
                for (const entry of await readdir(directory, { withFileTypes: true })) {
                    const file = join(directory, entry.name);
                    if (entry.isDirectory()) await visit(file);
                    else if (['ffmpeg.exe', 'ffprobe.exe', 'LICENSE.txt'].includes(basename(file))) await copyFile(file, join(target, basename(file)));
                }
            };
            await visit(unpack);
        } finally { await rm(unpack, { recursive: true, force: true }); }
    } else if (/^ff(mpeg|probe)-/.test(asset.name)) {
        const file = join(target, `${asset.name.split('-')[0]}${process.platform === 'win32' ? '.exe' : ''}`);
        await copyFile(destination, file);
        await chmod(file, 0o755);
    }
    await rm(destination + '.part', { force: true });
}
await writeFile(join(target, 'SOURCES.txt'), 'FFmpeg runs as a separate local process.\n' + [...manifest[platform], ...fonts].map(asset => asset.url).join('\n') + '\nBuild sources: https://github.com/eugeneware/ffmpeg-static and https://github.com/BtbN/FFmpeg-Builds\nFFmpeg sources: https://git.ffmpeg.org/ffmpeg.git\nNoto Sans CJK SC: https://github.com/notofonts/noto-cjk (SIL Open Font License 1.1)\n');
await createRequire(import.meta.url)('../desktop/media-smoke.cjs').smokeMedia(target);
console.log(`Media runtime verified: ${platform}`);
