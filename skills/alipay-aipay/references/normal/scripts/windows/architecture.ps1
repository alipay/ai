# Read OS facts instead of inherited process environment variables. The native
# machine from IsWow64Process2 distinguishes ARM64 even under x64 emulation.
function Get-AipayApiArchitecture {
    if (-not ('AipayArchitecture.Native' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace AipayArchitecture {
    public static class Native {
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool IsWow64Process2(IntPtr process, out ushort processMachine, out ushort nativeMachine);
    }
}
'@ -ErrorAction Stop
    }
    [UInt16]$processMachine = 0
    [UInt16]$nativeMachine = 0
    if (-not [AipayArchitecture.Native]::IsWow64Process2([IntPtr](-1), [ref]$processMachine, [ref]$nativeMachine)) {
        throw 'ARCHITECTURE_CHECK_FAILED'
    }
    switch ($nativeMachine) {
        0x8664 { return 'x64' }
        0xAA64 { return 'arm64' }
        0x014C { return 'ia32' }
        0x01C4 { return 'arm' }
        0x0200 { return 'ia64' }
        default { throw 'ARCHITECTURE_CHECK_FAILED' }
    }
}

function Get-AipayNativeArchitecture {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'UNSUPPORTED_PLATFORM' }
    try { return Get-AipayApiArchitecture } catch {
        # Older Windows or policy-restricted Add-Type: use the built-in CIM
        # provider once. Never relax policy, install a tool, or infer from env.
    }
    try {
        $processors = @(Get-CimInstance -ClassName Win32_Processor -OperationTimeoutSec 5 -ErrorAction Stop)
        if ($processors.Count -eq 0) { throw 'ARCHITECTURE_CHECK_FAILED' }
        $values = @($processors | ForEach-Object {
            if ($null -eq $_.Architecture) { throw 'ARCHITECTURE_CHECK_FAILED' }
            [string]$_.Architecture
        } | Select-Object -Unique)
        if ($values.Count -ne 1) { throw 'ARCHITECTURE_CHECK_FAILED' }
        switch ($values[0]) {
            '9'  { return 'x64' }
            '12' { return 'arm64' }
            '0'  { return 'ia32' }
            '5'  { return 'arm' }
            '6'  { return 'ia64' }
            default { throw 'ARCHITECTURE_CHECK_FAILED' }
        }
    } catch { throw 'ARCHITECTURE_CHECK_FAILED' }
}
