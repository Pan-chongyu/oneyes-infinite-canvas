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
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;
[ComImport, Guid("00021401-0000-0000-C000-000000000046")]
class CanvasShellLink { }
[ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ICanvasShellLinkW {
    void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int size, IntPtr data, uint flags);
    void GetIDList(out IntPtr list);
    void SetIDList(IntPtr list);
    void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int size);
    void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string text);
    void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int size);
    void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string path);
    void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int size);
    void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string text);
    void GetHotkey(out short key);
    void SetHotkey(short key);
    void GetShowCmd(out int command);
    void SetShowCmd(int command);
    void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int size, out int index);
    void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string path, int index);
    void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved);
    void Resolve(IntPtr window, uint flags);
    void SetPath([MarshalAs(UnmanagedType.LPWStr)] string path);
}
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
    public static bool Refresh(string shortcutPath, string executablePath, string iconPath) {
        var link = (ICanvasShellLinkW)new CanvasShellLink();
        try {
            var file = (IPersistFile)link;
            file.Load(shortcutPath, 0);
            var target = new StringBuilder(32768);
            link.GetPath(target, target.Capacity, IntPtr.Zero, 4);
            var path = Environment.ExpandEnvironmentVariables(target.ToString());
            if (!File.Exists(path) || !String.Equals(LongPath(Path.GetFullPath(path)), executablePath, StringComparison.OrdinalIgnoreCase)) return false;
            var icon = new StringBuilder(32768); int index;
            link.GetIconLocation(icon, icon.Capacity, out index);
            if (index == 0 && String.Equals(icon.ToString(), iconPath, StringComparison.OrdinalIgnoreCase)) return false;
            link.SetIconLocation(iconPath, 0);
            file.Save(shortcutPath, true);
            Item(shortcutPath);
            return true;
        } finally { Marshal.FinalReleaseComObject(link); }
    }
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
    $updated = 0; $failed = 0
    foreach ($directory in ($ShortcutDirectories | Where-Object { $_ } | Select-Object -Unique)) {
        # Only Start Menu needs recursion; do not walk users' desktop project folders.
        foreach ($file in (Get-ChildItem -LiteralPath $directory -Filter '*.lnk' -File -Recurse:($directory -in $menus) -ErrorAction SilentlyContinue)) {
            try { if ([CanvasIconNotification]::Refresh($file.FullName, $executablePath, $iconPath)) { $updated++ } }
            catch { $failed++ }
        }
    }
    [CanvasIconNotification]::Item($iconPath)
    [CanvasIconNotification]::Item($executablePath)
    [CanvasIconNotification]::Icons()
    [PSCustomObject]@{ updated = $updated; failed = $failed }
}

if ($Executable -and $IconSource) { Update-CanvasIcons -Executable $Executable -IconSource $IconSource | ConvertTo-Json -Compress }
