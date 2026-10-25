param([Parameter(Mandatory=$true)][string]$PlanPath)
$ErrorActionPreference = 'Stop'
$plan = Get-Content -LiteralPath $PlanPath -Raw | ConvertFrom-Json
try {
    $parent = Get-Process -Id $plan.parentPid -ErrorAction SilentlyContinue
    if ($parent) { $parent.WaitForExit() }
    # NSIS requires /D to be the last argument and accepts its remaining text as the directory.
    $installer = Start-Process -FilePath $plan.file -ArgumentList @('/S', '--updated', ('/D=' + $plan.destination)) -WindowStyle Hidden -Wait -PassThru
    if ($installer.ExitCode -ne 0) { throw 'Installer failed' }
    Start-Process -FilePath $plan.executable -ArgumentList '--oneyes-updated'
} catch {
    Set-Content -LiteralPath $plan.errorFile -Value 'Installation failed' -Encoding utf8
    if (Test-Path -LiteralPath $plan.executable) { Start-Process -FilePath $plan.executable }
}
