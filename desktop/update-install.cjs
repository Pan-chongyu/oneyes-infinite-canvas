const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

async function launch(command, args) {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
}
async function prepareInstall(plan, { parentPid = process.pid, command = run, start = launch } = {}) {
    const { platform, format, destination, executable, file, folder, root, version } = plan;
    const errorFile = path.join(root, 'install-error.txt');
    await fs.rm(path.join(root, `installed-${version}.ok`), { force: true });
    if (platform === 'win32') {
        const config = path.join(folder, 'install-plan.json'), helper = path.join(folder, 'install.ps1');
        await fs.writeFile(config, JSON.stringify({ parentPid, destination, executable, file, errorFile }), { mode: 0o600 });
        await fs.copyFile(path.join(__dirname, 'update-windows.ps1'), helper);
        return () => start('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-PlanPath', config]);
    }
    const helper = path.join(folder, 'install.sh');
    await fs.copyFile(path.join(__dirname, 'update-unix.sh'), helper);
    if (platform === 'darwin') {
        const stage = path.join(path.dirname(destination), `.oneyes-canvas-${version}-${parentPid}`);
        await fs.rm(stage, { recursive: true, force: true });
        await fs.mkdir(stage, { mode: 0o700 });
        try {
            await command('/usr/bin/ditto', ['-x', '-k', file, stage]);
            const bundle = path.join(stage, 'OneYes Canvas.app'), plist = path.join(bundle, 'Contents/Info.plist');
            const value = async key => (await command('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist])).stdout.trim();
            if (await value('CFBundleIdentifier') !== 'ai.oneyes.canvas' || await value('CFBundleShortVersionString') !== version || await value('CFBundleExecutable') !== 'OneYes Canvas') throw new Error('更新应用身份校验失败，请重新下载');
            await command('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
            await fs.access(path.join(bundle, 'Contents/MacOS/OneYes Canvas'), fs.constants.X_OK);
            return () => start('/bin/sh', [helper, 'mac', String(parentPid), destination, bundle, errorFile, executable, path.join(root, `installed-${version}.ok`)]);
        } catch (error) { await fs.rm(stage, { recursive: true, force: true }); throw new Error(/^(更新)/.test(error.message) ? error.message : '无法准备 macOS 更新。请将应用移到“应用程序”并确认目录可写后重试'); }
    }
    if (platform === 'linux' && format === 'AppImage') {
        await fs.access(path.dirname(destination), fs.constants.W_OK);
        const stage = destination + '.oneyes-new';
        await fs.copyFile(file, stage); await fs.chmod(stage, 0o755);
        return () => start('/bin/sh', [helper, 'AppImage', String(parentPid), destination, stage, errorFile, executable, path.join(root, `installed-${version}.ok`)]);
    }
    if (platform === 'linux' && ['deb', 'rpm'].includes(format)) {
        await command('which', ['pkexec']);
        return () => start('/bin/sh', [helper, format, String(parentPid), destination, file, errorFile, executable, path.join(root, `installed-${version}.ok`)]);
    }
    throw new Error('当前安装格式不支持自动更新，请从应用中心安装新版');
}
module.exports = { prepareInstall };
