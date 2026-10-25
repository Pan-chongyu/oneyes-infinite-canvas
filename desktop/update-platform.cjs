const os = require('node:os');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

async function updateTarget({ platform = process.platform, machine = os.machine(), execPath = process.execPath, env = process.env, command = run } = {}) {
    // os.machine uses GetNativeSystemInfo on Windows and uname on Linux. Rosetta needs the native CPU flag.
    if (platform === 'darwin') {
        const { stdout } = await command('/usr/sbin/sysctl', ['-n', 'hw.optional.arm64']);
        if (stdout.trim() === '1') machine = 'arm64';
    }
    const arch = /^(arm64|aarch64)$/i.test(machine) ? 'arm64' : /^(x86_64|amd64|x64)$/i.test(machine) ? 'x64' : '';
    if (!arch) throw new Error('无法识别原生芯片，请从应用中心选择安装包');
    if (platform === 'win32') return { platform, arch, format: 'nsis', destination: path.dirname(execPath), executable: execPath };
    if (platform === 'darwin') {
        const destination = path.resolve(execPath, '../../..');
        if (!destination.endsWith('.app')) throw new Error('请将 OneYes Canvas 移到“应用程序”后再更新');
        await fs.access(path.dirname(destination), fs.constants.W_OK);
        return { platform, arch, format: 'zip', destination, executable: execPath };
    }
    if (platform === 'linux') {
        if (env.APPIMAGE) return { platform, arch, format: 'AppImage', destination: await fs.realpath(env.APPIMAGE), executable: env.APPIMAGE };
        const real = await fs.realpath(execPath);
        for (const [format, bin, args] of [['deb', 'dpkg-query', ['-S', real]], ['rpm', 'rpm', ['-qf', real]]]) {
            try {
                const { stdout } = await command(bin, args);
                if (stdout.trim()) return { platform, arch, format, destination: real, executable: real };
            } catch {}
        }
        throw new Error('当前为解压运行版本，请从应用中心安装 AppImage、DEB 或 RPM 后使用自动更新');
    }
    throw new Error('当前系统暂不支持自动更新');
}
module.exports = { updateTarget };
