param([Parameter(Mandatory=$true)][string]$Executable, [Parameter(Mandatory=$true)][string]$Resource)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class MagpieVersionResource {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr BeginUpdateResourceW(string file, bool deleteExisting);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool UpdateResourceW(IntPtr update, IntPtr type, IntPtr name, ushort language, byte[] data, uint size);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool EndUpdateResourceW(IntPtr update, bool discard);
    public static void Write(string file, byte[] data) {
        IntPtr update = BeginUpdateResourceW(file, false);
        if (update == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        bool committed = false;
        try {
            // Native Node uses RT_VERSION / 1 / en-US; replace it, preserve every other resource.
            if (!UpdateResourceW(update, new IntPtr(16), new IntPtr(1), 1033, data, (uint)data.Length))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            committed = true;
            if (!EndUpdateResourceW(update, false)) throw new Win32Exception(Marshal.GetLastWin32Error());
        } finally {
            if (!committed) EndUpdateResourceW(update, true);
        }
    }
}
'@
[MagpieVersionResource]::Write($Executable, [IO.File]::ReadAllBytes($Resource))
