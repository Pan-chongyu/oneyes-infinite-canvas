const { app, shell } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { promisify } = require('node:util');
const run = promisify(require('node:child_process').execFile);
const { createHash } = require('node:crypto');
const root = process.argv[2];
app.setPath('userData', join(root, 'isolated-electron'));
app.whenReady().then(async () => {
    const executable = join(root, 'OneYes Canvas.exe'), source = resolve('desktop/resources/icon.ico');
    const directories = ['Desktop', 'Start Menu', 'TaskBar'].map(name => join(root, name));
    for (const directory of directories) await fs.mkdir(directory);
    const other = join(root, 'other installation'); await fs.mkdir(other);
    const unrelated = join(other, 'OneYes Canvas.exe'); await fs.copyFile(executable, unrelated);
    const paths = directories.map(directory => join(directory, 'Canvas custom name.lnk'));
    paths.push(join(directories[1], 'Canvas second shortcut.lnk'));
    for (const path of paths) assert.ok(shell.writeShortcutLink(path, { target: executable, icon: executable, iconIndex: 0, args: '--project "中文 测试"', cwd: root, description: 'Keep my settings', appUserModelId: 'ai.oneyes.canvas' }));
    const otherLink = join(directories[0], 'OneYes Canvas.lnk');
    assert.ok(shell.writeShortcutLink(otherLink, { target: unrelated, icon: unrelated, iconIndex: 0 }));
    const otherBytes = await fs.readFile(otherLink);
    const before = paths.map(path => shell.readShortcutLink(path));
    const rootsFile = join(root, 'icon-roots.json'); await fs.writeFile(rootsFile, JSON.stringify(directories));
    const script = join(root, 'refresh.ps1');
    const ps = value => "'" + value.replaceAll("'", "''") + "'";
    await fs.writeFile(script, '\ufeff' + `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
. ${ps(resolve('desktop/refresh-windows-icons.ps1'))}
$directories = Get-Content -LiteralPath ${ps(rootsFile)} -Raw -Encoding UTF8 | ConvertFrom-Json
$provided = (New-Object -ComObject Scripting.FileSystemObject).GetFile(${ps(executable)}).ShortPath
Update-CanvasIcons -Executable $provided -IconSource ${ps(source)} -ShortcutDirectories $directories | ConvertTo-Json -Compress
`);
    const refresh = async () => JSON.parse((await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true })).stdout);
    assert.deepEqual(await refresh(), { updated: paths.length, failed: 0 });
    const iconPath = join(await fs.realpath(root), 'resources', 'oneyes-canvas-' + createHash('sha256').update(await fs.readFile(source)).digest('hex') + '.ico');
    for (let i = 0; i < paths.length; i++) {
        const after = shell.readShortcutLink(paths[i]);
        assert.equal(after.icon, iconPath);
        assert.equal(after.iconIndex, 0);
        for (const key of ['target', 'args', 'cwd', 'description', 'appUserModelId', 'toastActivatorClsid']) assert.equal(after[key], before[i][key], key);
    }
    assert.deepEqual(await fs.readFile(otherLink), otherBytes, 'same-name shortcuts for other installations must stay unchanged');
    assert.deepEqual(await refresh(), { updated: 0, failed: 0 }, 'same icon must not rewrite links');
    await fs.unlink(paths[0]);
    assert.deepEqual(await refresh(), { updated: 0, failed: 0 });
    await assert.rejects(fs.access(paths[0]), { code: 'ENOENT' });
    await fs.writeFile(join(root, 'icons-verified.json'), JSON.stringify({ verified: true }));
    console.log('WINDOWS_NATIVE_SHORTCUT_ICON_REFRESH_METADATA_PINNED_IDENTITY_OTHER_INSTALLATION_IDEMPOTENCE_OK');
    app.quit();
}).catch(error => { console.error(error); app.exit(1); });
