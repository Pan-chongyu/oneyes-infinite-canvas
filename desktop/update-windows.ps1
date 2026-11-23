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
    for ($i = 0; $i -lt $steps.Count; $i++) {
        $steps[$i].Text = $(if ($i -lt $step) { '✓ ' } elseif ($i -eq $step) { '● ' } else { '○ ' }) + @('准备', '校验', '安装', '打开')[$i]
        $steps[$i].ForeColor = if ($i -eq $step) { $accent } else { $muted }
    }
    if ($percent -ge 0) {
        $progress.Style = 'Continuous'
        $progress.Value = $percent
        $amount.Text = "$percent%"
    } else {
        $progress.Style = 'Marquee'
        $amount.Text = @('正在准备', '正在校验', '安装中', '即将完成')[$step]
    }
    $progress.Invalidate()
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
    Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public class CanvasUpdateWindow : Form {
    [DllImport("user32.dll")] static extern bool ReleaseCapture();
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int value, int size);
    protected override CreateParams CreateParams { get { var p = base.CreateParams; p.Style |= 0xA0000; return p; } }
    public void DragHeader() { ReleaseCapture(); SendMessage(Handle, 0xA1, (IntPtr)2, IntPtr.Zero); }
    protected override void OnHandleCreated(EventArgs e) {
        base.OnHandleCreated(e);
        int round = 2; DwmSetWindowAttribute(Handle, 33, ref round, 4);
    }
    protected override void WndProc(ref Message m) {
        // Preserve system move/menu/minimize while keeping one continuous client surface.
        if (m.Msg == 0xA3) return;
        base.WndProc(ref m);
        if (m.Msg == 0x84 && m.Result == (IntPtr)1) {
            var point = PointToClient(new Point(unchecked((short)m.LParam.ToInt64()), unchecked((short)(m.LParam.ToInt64() >> 16))));
            if (point.Y < 38 * DeviceDpi / 96 && point.X >= 80 * DeviceDpi / 96) m.Result = (IntPtr)2;
        }
    }
}
public class CanvasWindowButton : Button {
    bool hovered;
    public string Kind { get; set; }
    public Color CircleColor { get; set; }
    public CanvasWindowButton() { SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true); }
    protected override void OnMouseEnter(EventArgs e) { hovered = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { hovered = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnPaint(PaintEventArgs e) {
        var g = e.Graphics; g.Clear(BackColor); g.SmoothingMode = SmoothingMode.AntiAlias;
        float scale = DeviceDpi / 96f, size = 12 * scale, x = (Width - size) / 2, y = (Height - size) / 2;
        using (var fill = new SolidBrush(CircleColor)) using (var edge = new Pen(Color.FromArgb(45, ForeColor), scale)) {
            g.FillEllipse(fill, x, y, size, size); g.DrawEllipse(edge, x, y, size, size);
        }
        if (Enabled && (hovered || (Focused && ShowFocusCues) || SystemInformation.HighContrast)) using (var pen = new Pen(ForeColor, scale)) {
            if (Kind == "close") { g.DrawLine(pen, x + size * .3f, y + size * .3f, x + size * .7f, y + size * .7f); g.DrawLine(pen, x + size * .7f, y + size * .3f, x + size * .3f, y + size * .7f); }
            else g.DrawLine(pen, x + size * .25f, y + size * .5f, x + size * .75f, y + size * .5f);
        }
        if (Focused && ShowFocusCues) using (var focus = new Pen(SystemColors.Highlight, scale)) g.DrawEllipse(focus, x - 3 * scale, y - 3 * scale, size + 6 * scale, size + 6 * scale);
    }
}
public class CanvasUpdateProgress : ProgressBar {
    readonly Timer animation = new Timer();
    readonly System.Diagnostics.Stopwatch clock = System.Diagnostics.Stopwatch.StartNew();
    readonly bool animate;
    [DllImport("user32.dll")] static extern bool SystemParametersInfo(int action, int param, out bool value, int flags);
    public Color TrackColor { get; set; }
    public CanvasUpdateProgress() {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
        bool enabled; animate = !SystemParametersInfo(0x1042, 0, out enabled, 0) || enabled;
        animation.Interval = 40;
        animation.Tick += delegate { if (Visible && Style == ProgressBarStyle.Marquee) Invalidate(); };
        if (animate) animation.Start();
    }
    static void Fill(Graphics g, Color color, RectangleF rect) {
        if (rect.Width <= 0 || rect.Height <= 0) return;
        float size = Math.Min(rect.Height, rect.Width);
        using (var shape = new GraphicsPath()) using (var brush = new SolidBrush(color)) {
            shape.AddArc(rect.X, rect.Y, size, rect.Height, 90, 180);
            shape.AddArc(rect.Right - size, rect.Y, size, rect.Height, 270, 180);
            shape.CloseFigure(); g.FillPath(brush, shape);
        }
    }
    protected override void OnPaint(PaintEventArgs e) {
        e.Graphics.Clear(BackColor); e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        Fill(e.Graphics, TrackColor, new RectangleF(0, 0, Width, Height));
        if (Style == ProgressBarStyle.Marquee) {
            float width = Width * .32f;
            float left = animate ? (float)(clock.Elapsed.TotalSeconds % 1.8 / 1.8) * (Width + width) - width : (Width - width) / 2;
            Fill(e.Graphics, ForeColor, new RectangleF(left, 0, width, Height));
        } else Fill(e.Graphics, ForeColor, new RectangleF(0, 0, Width * (float)Value / Maximum, Height));
    }
    protected override void Dispose(bool disposing) { if (disposing) animation.Dispose(); base.Dispose(disposing); }
}
'@
    [System.Windows.Forms.Application]::EnableVisualStyles()
    $form = New-Object CanvasUpdateWindow
    $form.ClientSize = New-Object System.Drawing.Size(432, 304)
    $form.AutoScaleMode = 'Dpi'
    $form.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)
    $form.FormBorderStyle = 'None'
    $form.StartPosition = 'CenterScreen'
    $form.MaximizeBox = $false
    $form.AccessibleName = 'OneYes Canvas 更新进度'
    $dark = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' -Name AppsUseLightTheme -ErrorAction SilentlyContinue).AppsUseLightTheme -eq 0
    # A macOS-style utility window, rendered natively without an Electron dependency.
    $form.BackColor = [System.Drawing.ColorTranslator]::FromHtml($(if ($dark) { '#28282a' } else { '#f5f5f7' }))
    $form.ForeColor = [System.Drawing.ColorTranslator]::FromHtml($(if ($dark) { '#f5f5f7' } else { '#1d1d1f' }))
    $muted = [System.Drawing.ColorTranslator]::FromHtml($(if ($dark) { '#b2b2b8' } else { '#69696e' }))
    $accent = [System.Drawing.ColorTranslator]::FromHtml($(if ($dark) { '#64a5ff' } else { '#0065d1' }))
    $track = [System.Drawing.ColorTranslator]::FromHtml($(if ($dark) { '#464648' } else { '#dedee2' }))
    if ([System.Windows.Forms.SystemInformation]::HighContrast) {
        $form.BackColor = [System.Drawing.SystemColors]::Window; $form.ForeColor = [System.Drawing.SystemColors]::WindowText
        $muted = $form.ForeColor; $accent = [System.Drawing.SystemColors]::Highlight; $track = [System.Drawing.SystemColors]::GrayText
    }
    try { $form.Icon = New-Object System.Drawing.Icon($plan.icon) } catch { $form.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon($plan.executable) }
    $logo = New-Object System.Windows.Forms.PictureBox
    $logo.SetBounds(192, 48, 48, 48)
    $logo.SizeMode = 'Zoom'
    $logoStream = [System.IO.MemoryStream]::new([System.IO.File]::ReadAllBytes($plan.logo))
    $logo.Image = [System.Drawing.Image]::FromStream($logoStream)
    $heading = New-Object System.Windows.Forms.Label
    $heading.SetBounds(96, 10, 240, 22)
    $heading.TextAlign = 'MiddleCenter'
    $heading.Font = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Bold)
    $heading.Text = 'OneYes Canvas'
    $version = New-Object System.Windows.Forms.Label
    $version.SetBounds(24, 145, 384, 20)
    $version.TextAlign = 'TopCenter'
    $version.ForeColor = $muted
    $version.Text = '更新至 v' + $plan.version
    $minimize = New-Object CanvasWindowButton
    $close = New-Object CanvasWindowButton
    $zoom = New-Object CanvasWindowButton
    $close.SetBounds(8, 8, 24, 24)
    $minimize.SetBounds(32, 8, 24, 24)
    $zoom.SetBounds(56, 8, 24, 24)
    $close.Kind = 'close'; $minimize.Kind = 'minimize'
    $close.CircleColor = [System.Drawing.ColorTranslator]::FromHtml('#ff5f57')
    $minimize.CircleColor = [System.Drawing.ColorTranslator]::FromHtml('#febc2e')
    $zoom.CircleColor = $track; $zoom.Enabled = $false; $zoom.TabStop = $false
    $zoom.AccessibleName = '最大化（不可用）'
    $minimize.Text = [char]0xE921; $close.Text = [char]0xE8BB; $zoom.Text = [char]0xE922
    $minimize.AccessibleName = '最小化'; $close.AccessibleName = '关闭'
    $close.TabIndex = 0; $minimize.TabIndex = 1
    foreach ($button in @($minimize, $close, $zoom)) {
        $button.FlatStyle = 'Flat'; $button.FlatAppearance.BorderSize = 0
        $button.BackColor = $form.BackColor; $button.ForeColor = [System.Drawing.Color]::FromArgb(80, 45, 32)
        if ([System.Windows.Forms.SystemInformation]::HighContrast) { $button.CircleColor = [System.Drawing.SystemColors]::ButtonFace; $button.ForeColor = $form.ForeColor }
    }
    $minimize.Add_Click({ $form.WindowState = 'Minimized' })
    $close.Add_Click({ $form.Close() })
    $tooltip = New-Object System.Windows.Forms.ToolTip
    $tooltip.SetToolTip($minimize, '最小化到任务栏')
    $tooltip.SetToolTip($close, '最小化到任务栏，更新会继续')
    $heading.Add_MouseDown({ param($sender, $event) if ($event.Button -eq 'Left') { $form.DragHeader() } })
    $status = New-Object System.Windows.Forms.Label
    $status.SetBounds(24, 112, 384, 28)
    $status.TextAlign = 'TopCenter'
    $status.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 13, [System.Drawing.FontStyle]::Bold)
    $description = New-Object System.Windows.Forms.Label
    $description.SetBounds(24, 177, 384, 36)
    $description.TextAlign = 'TopCenter'
    $description.ForeColor = $muted
    $progress = New-Object CanvasUpdateProgress
    $progress.SetBounds(32, 221, 368, 5)
    $progress.BackColor = $form.BackColor; $progress.ForeColor = $accent; $progress.TrackColor = $track
    $progress.AccessibleName = '更新进度'
    $amount = New-Object System.Windows.Forms.Label
    $amount.SetBounds(312, 238, 88, 20)
    $amount.TextAlign = 'TopRight'
    $amount.ForeColor = $accent
    $hint = New-Object System.Windows.Forms.Label
    $hint.SetBounds(32, 238, 278, 20)
    $hint.ForeColor = $muted
    $hint.Text = '完成后自动打开，可最小化等待'
    $steps = @(0..3 | ForEach-Object {
        $label = New-Object System.Windows.Forms.Label
        $label.SetBounds((32 + 94 * $_), 272, 86, 20)
        $label.TextAlign = 'TopCenter'
        $label.ForeColor = $muted
        $label
    })
    $back = New-Object System.Windows.Forms.Button
    $back.SetBounds(280, 266, 120, 28)
    $back.Text = '返回应用重试'
    $back.Visible = $false
    $back.FlatStyle = 'Flat'; $back.FlatAppearance.BorderSize = 0
    $back.BackColor = $accent; $back.ForeColor = $form.BackColor
    $back.Add_Click({
        try { Start-Process -FilePath $plan.executable -WorkingDirectory $plan.destination; $form.Close() }
        catch { $description.Text = '请从开始菜单重新打开 OneYes Canvas，或从应用中心覆盖安装新版。' }
    })
    $form.Controls.AddRange(@($logo, $heading, $version, $close, $minimize, $zoom, $status, $description, $progress, $amount, $hint, $back) + $steps)
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
        foreach ($label in $steps) { $label.Visible = $false }
        $hint.Text = '本地画布和账户配置保留'
        $back.Visible = $true
        $tooltip.SetToolTip($close, '关闭此提示')
        $form.WindowState = 'Normal'
        $form.Activate()
        while ($form.Visible) { Wait-Tick }
    }
    exit 1
} finally {
    if ($form) { $form.Dispose() }
    if ($logoStream) { $logoStream.Dispose() }
    if ($tooltip) { $tooltip.Dispose() }
}
