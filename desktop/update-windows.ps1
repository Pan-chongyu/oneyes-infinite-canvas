param([Parameter(Mandatory=$true)][string]$PlanPath, [switch]$Worker)
$ErrorActionPreference = 'Stop'
$plan = $null
$stage = 'prepare'
try {
    $plan = Get-Content -LiteralPath $PlanPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (!(Test-Path -LiteralPath $plan.file -PathType Leaf) -or !(Test-Path -LiteralPath $plan.executable -PathType Leaf)) { throw 'Missing update files' }
    if ($plan.version -notmatch '^\d+\.\d+\.\d+$' -or $plan.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'Invalid update plan' }
    $readyFile = Join-Path (Split-Path -LiteralPath $PlanPath) 'install-ready'
    if (!$Worker) {
        # Start-Process creates an independent hidden worker. A directly spawned
        # PowerShell inherits the app's console lifetime and can die at app exit.
        $child = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $PSCommandPath + '"'), '-PlanPath', ('"' + $PlanPath + '"'), '-Worker') -WorkingDirectory (Split-Path -LiteralPath $plan.errorFile) -WindowStyle Hidden -PassThru
        while (!$child.HasExited -and !(Test-Path -LiteralPath $readyFile)) { Start-Sleep -Milliseconds 50 }
        if (!(Test-Path -LiteralPath $readyFile)) { throw 'Worker failed to start' }
        [Console]::Out.WriteLine('ONEYES_UPDATE_READY')
        exit 0
    }
    [System.IO.File]::WriteAllText($readyFile, 'ready')
    $parent = Get-Process -Id $plan.parentPid -ErrorAction SilentlyContinue
    if ($parent) { $parent.WaitForExit() }
    $stage = 'integrity'
    $stream = [System.IO.File]::OpenRead($plan.file)
    $hash = [System.Security.Cryptography.SHA256]::Create()
    try { $actual = [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '') }
    finally { $stream.Dispose(); $hash.Dispose() }
    if ($actual -ne $plan.sha256) { throw 'Invalid installer hash' }
    $stage = 'installer'
    # NSIS requires /D to be the last argument and accepts its remaining text as the directory.
    $installer = Start-Process -FilePath $plan.file -ArgumentList @('/S', '--updated', ('/D=' + $plan.destination)) -WorkingDirectory (Split-Path -LiteralPath $PlanPath) -WindowStyle Hidden -Wait -PassThru
    if ($installer.ExitCode -ne 0) { throw 'Installer failed' }
    $stage = 'version'
    $installed = (Get-Item -LiteralPath $plan.executable).VersionInfo.ProductVersion -replace '\+.*$', ''
    if ($installed -ne $plan.version -and $installed -ne ($plan.version + '.0')) { throw 'Installed version mismatch' }
    $stage = 'launch'
    Start-Process -FilePath $plan.executable -ArgumentList '--oneyes-updated' -WorkingDirectory $plan.destination
    Remove-Item -LiteralPath $plan.errorFile -Force -ErrorAction SilentlyContinue
} catch {
    if ($plan) {
        Set-Content -LiteralPath $plan.errorFile -Value ("windows-" + $stage) -Encoding utf8
        if ($stage -ne 'prepare' -and (Test-Path -LiteralPath $plan.executable)) { Start-Process -FilePath $plan.executable -WorkingDirectory $plan.destination }
    }
    exit 1
}
