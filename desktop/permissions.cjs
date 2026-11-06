function configurePermissions(session) {
    // Chromium still requires a user gesture; automatic-fullscreen stays denied.
    const allowed = (contents, permission, details) => permission === 'fullscreen'
        && contents && !contents.isDestroyed() && details.isMainFrame === true
        && details.requestingUrl?.startsWith('oneyes-canvas://app/')
        && details.requestingUrl === contents.mainFrame.url;
    session.setPermissionRequestHandler((contents, permission, callback, details) => callback(Boolean(allowed(contents, permission, details))));
    session.setPermissionCheckHandler((contents, permission, _origin, details) => Boolean(allowed(contents, permission, details)));
}
module.exports = { configurePermissions };
