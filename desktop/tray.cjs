function showWindow(getWindow) {
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
}

function createTray({ Tray, Menu, nativeImage, iconPath, getWindow, quit, platform = process.platform }) {
    const source = platform === 'darwin' ? require('node:path').join(__dirname, 'resources/trayTemplate.png') : iconPath;
    let image = nativeImage.createFromPath(source);
    if (image.isEmpty()) throw new Error('无法读取系统托盘图标');
    if (platform === 'darwin') image.setTemplateImage(true);
    else image = image.resize({ width: 16, height: 16 });
    const tray = new Tray(image);
    tray.setToolTip('OneYes Canvas');
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: '显示 OneYes Canvas', click: () => showWindow(getWindow) },
        { type: 'separator' },
        { label: '退出 OneYes Canvas', click: quit },
    ]));
    const restore = () => showWindow(getWindow);
    tray.on('click', restore);
    tray.on('double-click', restore);
    return { instance: tray, image, restore, destroy: () => tray.destroy() };
}

function closeToTray(getWindow, isQuitting, hasTray = () => true) {
    return event => {
        if (isQuitting()) return;
        event.preventDefault();
        const window = getWindow();
        if (hasTray()) window?.hide(); else window?.minimize();
    };
}

module.exports = { createTray, closeToTray };
