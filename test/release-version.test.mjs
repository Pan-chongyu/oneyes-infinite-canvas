import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('release version, source lockfile and VERSION tag identify the same desktop build', async () => {
    const root = new URL('../', import.meta.url);
    const [source, lock, tag] = await Promise.all(['package.json', 'package-lock.json', 'VERSION'].map(file => readFile(new URL(file, root), 'utf8')));
    const { version } = JSON.parse(source), locked = JSON.parse(lock);
    assert.match(version, /^\d+\.\d+\.\d+$/);
    assert.equal(locked.version, version);
    assert.equal(locked.packages[''].version, version);
    assert.equal(tag.trim(), `v${version}`, 'VERSION must contain the complete v-prefixed release tag');
});
