param([string]$Executable, [string]$IconSource)

function Update-CanvasIcons {
    param([string]$Executable, [string]$IconSource, [string[]]$ShortcutDirectories)
    $ErrorActionPreference = 'Stop'
    # Installer parents can inherit a PowerShell 7 module path; use Windows' own modules.
    Import-Module "$PSHOME\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1" -ErrorAction Stop
    Import-Module "$PSHOME\Modules\Microsoft.PowerShell.Management\Microsoft.PowerShell.Management.psd1" -ErrorAction Stop
    if (!('CanvasIconNotification' -as [type])) {
        Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class CanvasIconNotification {
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern uint GetLongPathName(string path, StringBuilder output, uint size);
    [DllImport("shell32.dll", CharSet=CharSet.Unicode)]
    static extern void SHChangeNotify(uint eventId, uint flags, string path, IntPtr unused);
    public static string LongPath(string path) {
        uint size = GetLongPathName(path, null, 0);
        if (size == 0) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        var output = new StringBuilder((int)size);
        if (GetLongPathName(path, output, size) == 0) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        return output.ToString();
    }
    public static void Item(string path) { SHChangeNotify(0x2000, 0x2005, path, IntPtr.Zero); }
    public static void Icons() { SHChangeNotify(0x08000000, 0x2000, null, IntPtr.Zero); }
}
'@
    }
    $executablePath = [CanvasIconNotification]::LongPath([IO.Path]::GetFullPath($Executable))
    if (!(Test-Path -LiteralPath $executablePath -PathType Leaf)) { throw 'Canvas executable is missing' }
    $hash = (Get-FileHash -LiteralPath $IconSource -Algorithm SHA256).Hash.ToLowerInvariant()
    $iconDirectory = Join-Path (Split-Path -LiteralPath $executablePath) 'resources'
    [void][IO.Directory]::CreateDirectory($iconDirectory)
    $iconPath = Join-Path $iconDirectory ('oneyes-canvas-' + $hash + '.ico')
    if (!(Test-Path -LiteralPath $iconPath) -or (Get-FileHash -LiteralPath $iconPath -Algorithm SHA256).Hash -ne $hash) {
        Copy-Item -LiteralPath $IconSource -Destination $iconPath -Force
    }
    $menus = @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('CommonPrograms'))
    if (!$ShortcutDirectories) {
        $ShortcutDirectories = @(
            [Environment]::GetFolderPath('DesktopDirectory'),
            [Environment]::GetFolderPath('CommonDesktopDirectory'),
            $menus[0],
            $menus[1],
            (Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar')
        )
    }
    $shell = New-Object -ComObject WScript.Shell
    $updated = 0; $failed = 0
    try {
        foreach ($directory in ($ShortcutDirectories | Where-Object { $_ } | Select-Object -Unique)) {
            # Only Start Menu needs recursion; do not walk users' desktop project folders.
            foreach ($file in (Get-ChildItem -LiteralPath $directory -Filter '*.lnk' -File -Recurse:($directory -in $menus) -ErrorAction SilentlyContinue)) {
                $shortcut = $null
                try {
                    $shortcut = $shell.CreateShortcut($file.FullName)
                    if (!$shortcut.TargetPath -or !(Test-Path -LiteralPath $shortcut.TargetPath -PathType Leaf)) { continue }
                    $target = [CanvasIconNotification]::LongPath([IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($shortcut.TargetPath)))
                    if (![string]::Equals($target, $executablePath, [StringComparison]::OrdinalIgnoreCase)) { continue }
                    $location = $iconPath + ',0'
                    if ($shortcut.IconLocation -ne $location) {
                        $shortcut.IconLocation = $location
                        $shortcut.Save()
                        [CanvasIconNotification]::Item($file.FullName)
                        $updated++
                    }
                } catch { $failed++ }
                finally { if ($shortcut) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut) } }
            }
        }
        [CanvasIconNotification]::Item($iconPath)
        [CanvasIconNotification]::Item($executablePath)
        [CanvasIconNotification]::Icons()
        [PSCustomObject]@{ updated = $updated; failed = $failed }
    } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) }
}

if ($Executable -and $IconSource) { Update-CanvasIcons -Executable $Executable -IconSource $IconSource | ConvertTo-Json -Compress }
