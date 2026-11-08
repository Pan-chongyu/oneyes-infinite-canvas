param([Parameter(Mandatory=$true)][string]$PlanPath, [switch]$Worker)
$ErrorActionPreference = 'Stop'
$plan = $null
$stage = 'prepare'
$form = $null
$finished = $false
function Show-Stage([string]$title, [string]$detail, [int]$step, [int]$percent = -1) {
    $form.Text = $title + ' - OneYes Canvas'
    $status.Text = $title
    $description.Text = $detail
    $steps.Text = @('准备完成    /    等待退出    /    安装    /    重新打开', '准备完成    /    校验中    /    安装    /    重新打开', '准备完成    /    校验完成    /    安装中    /    重新打开', '准备完成    /    校验完成    /    安装完成    /    重新打开')[$step]
    if ($percent -ge 0) {
        $progress.Style = 'Continuous'
        $progress.Value = $percent
        $amount.Text = "$percent%"
    } else {
        $progress.Style = 'Marquee'
        $amount.Text = '正在处理'
    }
    [System.Windows.Forms.Application]::DoEvents()
}
function Wait-Tick {
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 50
}
try {
    $plan = Get-Content -LiteralPath $PlanPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (!(Test-Path -LiteralPath $plan.file -PathType Leaf) -or !(Test-Path -LiteralPath $plan.executable -PathType Leaf)) { throw 'Missing update files' }
    if ($plan.version -notmatch '^\d+\.\d+\.\d+$' -or $plan.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'Invalid update plan' }
    $readyFile = Join-Path (Split-Path -LiteralPath $PlanPath) 'install-ready'
    if (!$Worker) {
        # Start-Process creates an independent worker with no console. A directly spawned
        # PowerShell inherits the app's console lifetime and can die at app exit.
        $child = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @('-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $PSCommandPath + '"'), '-PlanPath', ('"' + $PlanPath + '"'), '-Worker') -WorkingDirectory (Split-Path -LiteralPath $plan.errorFile) -WindowStyle Hidden -PassThru
        while (!$child.HasExited -and !(Test-Path -LiteralPath $readyFile)) { Start-Sleep -Milliseconds 50 }
        if (!(Test-Path -LiteralPath $readyFile)) { throw 'Worker failed to start' }
        [Console]::Out.WriteLine('ONEYES_UPDATE_READY')
        exit 0
    }
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    [System.Windows.Forms.Application]::EnableVisualStyles()
    $form = New-Object System.Windows.Forms.Form
    $form.ClientSize = New-Object System.Drawing.Size(432, 268)
    $form.AutoScaleMode = 'Dpi'
    $form.Font = New-Object System.Drawing.Font('Segoe UI', 9)
    $form.FormBorderStyle = 'FixedSingle'
    $form.StartPosition = 'CenterScreen'
    $form.MaximizeBox = $false
    $form.AccessibleName = 'OneYes Canvas 更新进度'
    $dark = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' -Name AppsUseLightTheme -ErrorAction SilentlyContinue).AppsUseLightTheme -eq 0
    $form.BackColor = if ($dark) { [System.Drawing.Color]::FromArgb(32, 32, 32) } else { [System.Drawing.Color]::White }
    $form.ForeColor = if ($dark) { [System.Drawing.Color]::FromArgb(245, 245, 245) } else { [System.Drawing.Color]::FromArgb(32, 32, 32) }
    $muted = if ($dark) { [System.Drawing.Color]::FromArgb(180, 180, 180) } else { [System.Drawing.Color]::FromArgb(100, 100, 100) }
    try { $form.Icon = New-Object System.Drawing.Icon($plan.icon) } catch { $form.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon($plan.executable) }
    $logo = New-Object System.Windows.Forms.PictureBox
    $logo.SetBounds(24, 24, 32, 32)
    $logo.SizeMode = 'Zoom'
    $logoStream = [System.IO.MemoryStream]::new([System.IO.File]::ReadAllBytes($plan.logo))
    $logo.Image = [System.Drawing.Image]::FromStream($logoStream)
    $heading = New-Object System.Windows.Forms.Label
    $heading.SetBounds(68, 22, 340, 25)
    $heading.Font = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Bold)
    $heading.Text = 'OneYes Canvas'
    $version = New-Object System.Windows.Forms.Label
    $version.SetBounds(68, 49, 340, 20)
    $version.ForeColor = $muted
    $version.Text = '正在更新至 v' + $plan.version
    $status = New-Object System.Windows.Forms.Label
    $status.SetBounds(24, 91, 384, 24)
    $status.Font = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
    $description = New-Object System.Windows.Forms.Label
    $description.SetBounds(24, 121, 384, 38)
    $description.ForeColor = $muted
    $progress = New-Object System.Windows.Forms.ProgressBar
    $progress.SetBounds(24, 169, 384, 6)
    $amount = New-Object System.Windows.Forms.Label
    $amount.SetBounds(310, 185, 98, 20)
    $amount.TextAlign = 'TopRight'
    $amount.ForeColor = $muted
    $hint = New-Object System.Windows.Forms.Label
    $hint.SetBounds(24, 185, 280, 20)
    $hint.ForeColor = $muted
    $hint.Text = '更新完成后自动打开，可最小化此窗口'
    $steps = New-Object System.Windows.Forms.Label
    $steps.SetBounds(24, 224, 384, 22)
    $steps.ForeColor = $muted
    $back = New-Object System.Windows.Forms.Button
    $back.SetBounds(296, 218, 112, 30)
    $back.Text = '返回应用重试'
    $back.Visible = $false
    $back.Add_Click({
        try { Start-Process -FilePath $plan.executable -WorkingDirectory $plan.destination; $form.Close() }
        catch { $description.Text = '请从开始菜单重新打开 OneYes Canvas，或从应用中心覆盖安装新版。' }
    })
    $form.Controls.AddRange(@($logo, $heading, $version, $status, $description, $progress, $amount, $hint, $steps, $back))
    $form.Add_FormClosing({ param($sender, $event)
        if (!$script:finished) { $event.Cancel = $true; $sender.WindowState = 'Minimized' }
    })
    $form.Show()
    Show-Stage '正在关闭旧版' '等待旧版保存并退出；如出现保存提示，请先在原窗口完成。' 0
    # The parent exits only after an actual visible window has been created.
    [System.IO.File]::WriteAllText($readyFile, (@{ pid = $PID; window = $form.Handle.ToInt64() } | ConvertTo-Json -Compress))
    $parent = Get-Process -Id $plan.parentPid -ErrorAction SilentlyContinue
    while ($parent -and !$parent.HasExited) { Wait-Tick }
    $stage = 'integrity'
    Show-Stage '正在校验更新包' '正在检查文件完整性，确保更新包安全且未损坏。' 1 0
    $stream = [System.IO.File]::OpenRead($plan.file)
    $hash = [System.Security.Cryptography.SHA256]::Create()
    try {
        $buffer = New-Object byte[] (1024 * 1024)
        $last = -1
        while (($count = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
            [void]$hash.TransformBlock($buffer, 0, $count, $buffer, 0)
            $percent = [int][Math]::Floor($stream.Position / $stream.Length * 100)
            if ($percent -ne $last) { $last = $percent; Show-Stage '正在校验更新包' '正在检查文件完整性，确保更新包安全且未损坏。' 1 $percent }
        }
        [void]$hash.TransformFinalBlock($buffer, 0, 0)
        $actual = [BitConverter]::ToString($hash.Hash).Replace('-', '')
    }
    finally { $stream.Dispose(); $hash.Dispose() }
    if ($actual -ne $plan.sha256) { throw 'Invalid installer hash' }
    $stage = 'installer'
    Show-Stage '正在安装新版' '正在替换程序文件，本地画布和设置不会被删除。' 2
    # NSIS requires /D to be the last argument and accepts its remaining text as the directory.
    $installer = Start-Process -FilePath $plan.file -ArgumentList @('/S', '--updated', ('/D=' + $plan.destination)) -WorkingDirectory (Split-Path -LiteralPath $PlanPath) -WindowStyle Hidden -PassThru
    while (!$installer.HasExited) { Wait-Tick }
    $installer.WaitForExit()
    if ($installer.ExitCode -ne 0) { throw 'Installer failed' }
    $stage = 'version'
    Show-Stage '正在确认安装版本' '正在确认新版已正确安装。' 3
    $installed = (Get-Item -LiteralPath $plan.executable).VersionInfo.ProductVersion -replace '\+.*$', ''
    if ($installed -ne $plan.version -and $installed -ne ($plan.version + '.0')) { throw 'Installed version mismatch' }
    $stage = 'launch'
    Show-Stage '正在打开新版' '即将回到创作画布，窗口准备好后此提示会自动关闭。' 3
    $opened = Start-Process -FilePath $plan.executable -ArgumentList '--oneyes-updated' -WorkingDirectory $plan.destination -PassThru
    while (!(Test-Path -LiteralPath $plan.ack)) {
        if ($opened.HasExited) { throw 'Application exited before it was ready' }
        Wait-Tick
    }
    Remove-Item -LiteralPath $plan.errorFile -Force -ErrorAction SilentlyContinue
    $finished = $true
    $form.Close()
} catch {
    if ($plan) {
        Set-Content -LiteralPath $plan.errorFile -Value ("windows-" + $stage) -Encoding utf8
        if ($stage -ne 'prepare' -and (Test-Path -LiteralPath $plan.executable)) { try { Start-Process -FilePath $plan.executable -WorkingDirectory $plan.destination } catch {} }
    }
    if ($stage -ne 'prepare' -and $form -and $form.Visible) {
        $finished = $true
        $form.Text = '更新未完成 - OneYes Canvas'
        $status.Text = '更新未完成'
        $description.Text = switch ($stage) {
            'integrity' { '更新包校验未通过，未执行安装。请返回应用重新下载。' }
            'installer' { '安装失败，请完成系统授权，检查安全软件和安装目录权限后重试。' }
            'version' { '程序文件未替换为新版，请检查安装目录权限后重试。' }
            'launch' { '新版未能完成启动，请重新打开应用，或从应用中心覆盖安装。' }
            default { '更新助手未能准备完成，请检查安全软件与文件权限后重试。' }
        }
        $progress.Style = 'Continuous'
        $progress.Value = 0
        $amount.Text = ''
        $steps.Visible = $false
        $hint.Text = '本地画布和账户配置保留'
        $back.Visible = $true
        $form.WindowState = 'Normal'
        $form.Activate()
        while ($form.Visible) { Wait-Tick }
    }
    exit 1
} finally {
    if ($form) { $form.Dispose() }
    if ($logoStream) { $logoStream.Dispose() }
}
