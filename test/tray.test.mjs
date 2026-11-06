import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createTray, closeToTray } = require('../desktop/tray.cjs');

test('closing the main window hides it without quitting; explicit quit still closes it', () => {
    const window = { hidden: false, minimized: false, isDestroyed: () => false, hide() { this.hidden = true; }, minimize() { this.minimized = true; } };
    let quitting = false, prevented = false;
    closeToTray(() => window, () => quitting)({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(window.hidden, true);
    window.hidden = false;
    closeToTray(() => window, () => false, () => false)({ preventDefault() { prevented = true; } });
    assert.equal(window.minimized, true); assert.equal(window.hidden, false);
    prevented = false; quitting = true;
    closeToTray(() => window, () => quitting)({ preventDefault() { prevented = true; } });
    assert.equal(prevented, false);
});

test('tray click and Show restore the window; Quit is an explicit menu action', () => {
    class FakeTray extends EventEmitter {
        constructor(image) { super(); this.image = image; }
        setToolTip(value) { this.tooltip = value; }
        setContextMenu(value) { this.menu = value; }
    }
    const items = [];
    class FakeMenu { static buildFromTemplate(value) { items.push(...value); return value; } }
    const image = { resize: size => ({ size }) }, nativeImage = { createFromPath: path => ({ path, isEmpty: () => false, resize: image.resize }) };
    const window = { minimized: true, isDestroyed: () => false, isMinimized() { return this.minimized; }, restore() { this.minimized = false; }, show() { this.visible = true; }, focus() { this.focused = true; } };
    let quits = 0;
    const tray = createTray({ Tray: FakeTray, Menu: FakeMenu, nativeImage, iconPath: 'icon.png', getWindow: () => window, quit: () => quits++, platform: 'win32' });
    tray.instance.emit('click');
    assert.equal(window.visible, true); assert.equal(window.focused, true); assert.equal(window.minimized, false);
    items[0].click(); assert.equal(window.visible, true);
    items[2].click(); assert.equal(quits, 1);
    assert.equal(tray.instance.tooltip, 'OneYes Canvas'); assert.deepEqual(tray.instance.image.size, { width: 16, height: 16 });
});
