import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { configurePermissions } = createRequire(import.meta.url)('../desktop/permissions.cjs');

test('fullscreen is limited to the app main frame; automatic fullscreen and other privileges stay denied', () => {
    let request, check;
    configurePermissions({ setPermissionRequestHandler: fn => { request = fn; }, setPermissionCheckHandler: fn => { check = fn; } });
    const url = 'oneyes-canvas://app/canvas/local';
    const contents = { isDestroyed: () => false, mainFrame: { url } };
    const details = { isMainFrame: true, requestingUrl: url };
    const verify = (contents, permission, details, expected) => {
        request(contents, permission, allowed => assert.equal(allowed, expected), details);
        assert.equal(check(contents, permission, 'oneyes-canvas://app/', details), expected);
    };
    verify(contents, 'fullscreen', details, true);
    for (const permission of ['automatic-fullscreen', 'media', 'camera', 'microphone', 'notifications', 'clipboard-read', 'geolocation']) verify(contents, permission, details, false);
    verify(null, 'fullscreen', details, false);
    verify({ ...contents, isDestroyed: () => true }, 'fullscreen', details, false);
    verify(contents, 'fullscreen', { ...details, isMainFrame: false }, false);
    verify(contents, 'fullscreen', { ...details, requestingUrl: url + '/other' }, false);
    for (const url of ['https://example.com/', 'oneyes-canvas://app.evil/', 'file:///tmp/index.html']) verify({ ...contents, mainFrame: { url } }, 'fullscreen', { ...details, requestingUrl: url }, false);
});
