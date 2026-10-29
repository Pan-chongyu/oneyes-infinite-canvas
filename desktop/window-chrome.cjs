const height = 36;

function windowChromeOptions(platform = process.platform) {
    return platform === 'darwin'
        ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 12 } }
        : { titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: '#fafafa', height } };
}

function syncWindowTheme(window, nativeTheme, theme, platform = process.platform) {
    if (theme !== 'light' && theme !== 'dark') throw new Error('不支持的窗口主题');
    nativeTheme.themeSource = theme;
    if (platform !== 'darwin') window.setTitleBarOverlay({ color: '#00000000', symbolColor: theme === 'dark' ? '#fafafa' : '#262626', height });
}

module.exports = { windowChromeOptions, syncWindowTheme };
