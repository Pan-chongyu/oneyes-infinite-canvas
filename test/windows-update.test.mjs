import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url), run = promisify(execFile);
const { prepareInstall } = require('../desktop/update-install.cjs');
const { downloadBlocks, readBlockmap } = require('../desktop/update-blockmap.cjs');

test('Windows helper waits for its parent, installs real NSIS in Unicode paths, verifies the version and reopens', { skip: process.platform !== 'win32' }, async t => {
    const root = await mkdtemp(join(tmpdir(), 'canvas-win-ota-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const compiler = join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    const { getMakeNsisPath } = require('app-builder-lib/out/toolsets/windows.js');
    const nsis = await getMakeNsisPath();
    const source = join(root, 'app.cs'), next = join(root, 'next.exe'), old = join(root, 'old.exe');
    const program = version => `using System.IO; using System.Reflection; [assembly: AssemblyInformationalVersion("${version}.0")] class App { static void Main(string[] args) { var root=System.AppDomain.CurrentDomain.BaseDirectory; File.WriteAllText(Path.Combine(root,"opened.txt"),string.Join(" ",args)); if(args.Length>0) { if(File.Exists(Path.Combine(root,"fail-launch")))return; while(!File.Exists(Path.Combine(root,"allow-ready")))System.Threading.Thread.Sleep(10); File.WriteAllText(File.ReadAllText(Path.Combine(root,"ack-path.txt")),"ready"); } } }`;
    for (const [file, version] of [[old, '0.20.0'], [next, '0.21.0']]) {
        await writeFile(source, program(version));
        await run(compiler, ['/nologo', '/target:winexe', '/out:' + file, source], { windowsHide: true });
    }
    const childScript = join(root, 'apply.cjs');
    await writeFile(childScript, `const fs=require('node:fs/promises');const {prepareInstall}=require(${JSON.stringify(resolve('desktop/update-install.cjs'))});(async()=>{const plan=JSON.parse(await fs.readFile(process.argv[2],'utf8'));const apply=await prepareInstall(plan);await apply();console.log('HANDOFF');await fs.writeFile(plan.root+'/handoff','ready');setInterval(async()=>{if(await fs.access(plan.root+'/exit').then(()=>true,()=>false))process.exit(0)},10)})().catch(e=>{console.error(e.message);process.exit(1)});`);
    const inspect = join(root, 'inspect.ps1');
    await writeFile(inspect, `param([long]$Handle,[string]$Action)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class WindowProbe {
  public delegate bool Visitor(IntPtr hwnd, IntPtr param);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hwnd, Visitor visitor, IntPtr param);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr hwnd, int msg, IntPtr size, StringBuilder text);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder name, int size);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hwnd, int index);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, int msg, IntPtr a, IntPtr b);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int command);
  public static string Text(IntPtr hwnd) { var text=new StringBuilder(2048);SendMessage(hwnd,13,(IntPtr)text.Capacity,text);return text.ToString(); }
  public static string[] Children(IntPtr hwnd) { var result=new List<string>();EnumChildWindows(hwnd,(h,p)=>{result.Add(Text(h));return true;},IntPtr.Zero);return result.ToArray(); }
  public static bool Marquee(IntPtr hwnd) { bool result=false;EnumChildWindows(hwnd,(h,p)=>{var name=new StringBuilder(256);GetClassName(h,name,256);if(name.ToString().Contains("msctls_progress32"))result=(GetWindowLong(h,-16)&8)!=0;return true;},IntPtr.Zero);return result; }
}
'@
if($Action -eq 'close'){[void][WindowProbe]::PostMessage([IntPtr]$Handle,16,[IntPtr]::Zero,[IntPtr]::Zero)}
if($Action -eq 'restore'){[void][WindowProbe]::ShowWindow([IntPtr]$Handle,9)}
@{visible=[WindowProbe]::IsWindowVisible([IntPtr]$Handle);minimized=[WindowProbe]::IsIconic([IntPtr]$Handle);title=[WindowProbe]::Text([IntPtr]$Handle);text=[WindowProbe]::Children([IntPtr]$Handle);marquee=[WindowProbe]::Marquee([IntPtr]$Handle)}|ConvertTo-Json -Compress
`);
    const probe = async (ready, action = '') => JSON.parse((await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', inspect, '-Handle', String(ready.window), '-Action', action], { windowsHide: true, encoding: 'utf8' })).stdout);
    const quote = value => '"' + value.replaceAll('$', '$$').replaceAll('"', '$\\"') + '"';
    for (const scenario of ['success', 'installer', 'version', 'integrity', 'launch', 'prepare']) {
        const folder = join(root, '更新 缓存 ' + scenario), destination = join(root, '安装 目录 ' + scenario), executable = join(destination, 'OneYes Canvas.exe');
        await mkdir(folder); await mkdir(destination); await copyFile(old, executable);
        const file = join(folder, 'setup.exe'), nsi = join(folder, 'fixture.nsi');
        await writeFile(nsi, '\ufeff' + `Unicode true\nName "Canvas OTA isolated test"\nOutFile ${quote(file)}\nRequestExecutionLevel user\nSilentInstall silent\nSection\n${scenario === 'success' ? `FileOpen $0 ${quote(join(folder, 'installer-running'))} w\nFileClose $0\nwaiting:\nIfFileExists ${quote(join(folder, 'allow-install'))} install\nSleep 10\nGoto waiting\ninstall:\n` : ''}${scenario === 'installer' ? 'SetErrorLevel 2' : scenario === 'version' ? '' : `SetOutPath "$INSTDIR"\nFile "/oname=OneYes Canvas.exe" ${quote(next)}`}\nSectionEnd\n`);
        await run(nsis.path, ['/V2', nsi], { env: { ...process.env, ...nsis.env }, windowsHide: true });
        if (scenario === 'success') {
            const baseFile = join(folder, 'base-setup.exe'), baseNsi = join(folder, 'base.nsi');
            await writeFile(baseNsi, '\ufeff' + `Unicode true\nName "Canvas OTA base"\nOutFile ${quote(baseFile)}\nRequestExecutionLevel user\nSilentInstall silent\nSection\nSetOutPath "$INSTDIR"\nFile "/oname=OneYes Canvas.exe" ${quote(old)}\nSectionEnd\n`);
            await run(nsis.path, ['/V2', baseNsi], { env: { ...process.env, ...nsis.env }, windowsHide: true });
            const { buildBlockMap } = require('app-builder-lib/out/targets/blockmap/blockmap');
            for (const path of [baseFile, file]) await buildBlockMap(path, 'gzip', path + '.blockmap');
            const baseBytes = await readFile(baseFile), nextBytes = await readFile(file), outputFile = join(folder, 'reconstructed.exe');
            await readBlockmap(file + '.blockmap', nextBytes.length);
            const sha = bytes => createHash('sha256').update(bytes).digest('hex');
            const info = { size: nextBytes.length, sha256: sha(nextBytes), blockmap: { sha256: sha(await readFile(file + '.blockmap')) }, url: 'https://invalid.test/setup.exe' };
            const progress = [];
            await downloadBlocks({ baseFile, oldMapFile: baseFile + '.blockmap', newMapFile: file + '.blockmap', base: { size: baseBytes.length, sha256: sha(baseBytes), blockmap: { sha256: sha(await readFile(baseFile + '.blockmap')) } }, entry: info, outputFile,
                changed: state => progress.push(state), fetcher: async (_url, init) => {
                    const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(init.headers.Range);
                    return new Response(nextBytes.subarray(Number(start), Number(end) + 1), { status: 206, headers: { 'content-range': `bytes ${start}-${end}/${nextBytes.length}` } });
                } });
            assert.ok(progress.at(-1).reused > 0, 'real NSIS and builder block maps must reuse bytes');
            assert.equal(sha(await readFile(outputFile)), info.sha256); await copyFile(outputFile, file);
        }
        const sha256 = scenario === 'integrity' ? 'a'.repeat(64) : createHash('sha256').update(await readFile(file)).digest('hex');
        const plan = { platform: 'win32', format: 'nsis', root: folder, folder, destination, executable, file, version: '0.21.0', sha256 };
        await writeFile(join(destination, 'ack-path.txt'), join(folder, 'installed-0.21.0.ok'));
        if (scenario === 'launch') await writeFile(join(destination, 'fail-launch'), 'fail');
        if (scenario === 'prepare') plan.file = join(folder, 'missing.exe');
        const config = join(folder, 'fixture.json'); await writeFile(config, JSON.stringify(plan));
        const child = spawn(process.execPath, [childScript, config], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
        const finished = new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
        const wait = async condition => { const end = Date.now() + 20000; while (!await condition()) { if (Date.now() > end) throw Error('Windows OTA fixture timed out: ' + scenario + ': ' + output + ': ' + await readFile(join(folder, 'install-error.txt'), 'utf8').catch(() => 'no failure marker')); await new Promise(resolve => setTimeout(resolve, 25)); } };
        const exists = path => access(path).then(() => true, () => false);
        let ready;
        try {
            if (scenario === 'prepare') {
                assert.equal(await finished, 1); assert.match(output, /无法启动 Windows 更新助手/);
                assert.equal(await exists(join(destination, 'opened.txt')), false, 'failed startup must leave the old app running');
                continue;
            }
            await wait(() => exists(join(folder, 'handoff')));
            ready = JSON.parse(await readFile(join(folder, 'install-ready'), 'utf8'));
            let ui = await probe(ready);
            assert.equal(ui.visible, true, 'a visible native update window must exist before the parent exits');
            assert.match(ui.title, /正在关闭旧版/);
            assert.ok(ui.text.some(text => text.includes('v0.21.0')), 'target version must be visible');
            if (scenario === 'success') {
                await probe(ready, 'close'); ui = await probe(ready);
                assert.equal(ui.minimized, true, 'closing the progress window minimizes it without cancelling the update');
                await probe(ready, 'restore');
            }
            assert.equal(await exists(join(destination, 'opened.txt')), false, 'installer must wait for the running app to exit');
            await writeFile(join(folder, 'exit'), 'exit'); assert.equal(await finished, 0);
            if (scenario === 'success') {
                await wait(() => exists(join(folder, 'installer-running')));
                ui = await probe(ready); assert.match(ui.title, /正在安装新版/); assert.equal(ui.marquee, true, 'installer progress must be honestly indeterminate');
                await writeFile(join(folder, 'allow-install'), 'continue');
            }
            // WriteAllText creates the file before filling it. Existence alone
            // can observe an empty file on ARM64 before the relaunch args land.
            await wait(() => scenario === 'success'
                ? readFile(join(destination, 'opened.txt'), 'utf8').then(text => text === '--oneyes-updated', () => false)
                : exists(join(destination, 'opened.txt')));
            if (scenario === 'success') {
                ui = await probe(ready); assert.equal(ui.visible, true); assert.match(ui.title, /正在打开新版/);
                assert.equal(await exists(join(folder, 'installed-0.21.0.ok')), false, 'helper must wait for the new UI readiness, not just process creation');
                await writeFile(join(destination, 'allow-ready'), 'ready');
                await wait(() => exists(join(folder, 'installed-0.21.0.ok')));
                await wait(() => { try { process.kill(ready.pid, 0); return false; } catch { return true; } });
                assert.equal(await readFile(join(folder, 'install-error.txt'), 'utf8').catch(() => ''), '', 'successful install must not use failure fallback');
                assert.equal(await readFile(join(destination, 'opened.txt'), 'utf8'), '--oneyes-updated');
                assert.deepEqual(await readFile(executable), await readFile(next));
                assert.equal(await exists(join(folder, 'install-error.txt')), false);
            } else {
                await wait(() => exists(join(folder, 'install-error.txt')));
                assert.equal((await readFile(join(folder, 'install-error.txt'), 'utf8')).trim(), 'windows-' + scenario);
                assert.deepEqual(await readFile(executable), await readFile(scenario === 'launch' ? next : old), 'failed installation must preserve the existing app');
                ui = await probe(ready); assert.equal(ui.visible, true); assert.match(ui.title, /更新未完成/); assert.ok(ui.text.includes('返回应用重试'));
                await probe(ready, 'close');
                await wait(() => { try { process.kill(ready.pid, 0); return false; } catch { return true; } });
            }
        } finally {
            if (child.exitCode === null) { child.kill(); await finished; }
            if (ready) await run('taskkill.exe', ['/PID', String(ready.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
        }
    }
});
