# Adds or removes one directory on the current user's PATH. The installer runs
# it with the resources\bin directory so `emmer` works in any new terminal,
# and the uninstaller runs it again to take the entry out.
#
# Goes through the registry rather than [Environment]::SetEnvironmentVariable
# because that helper writes a plain string and would flatten a user PATH of
# kind REG_EXPAND_SZ, turning every %USERPROFILE% entry into a literal. setx
# is avoided because it truncates at 1024 characters. The WM_SETTINGCHANGE
# broadcast is what makes a terminal opened afterwards see the new value.
#
# Usage: emmer-path.ps1 add|remove <dir>
param(
  [Parameter(Mandatory = $true)][ValidateSet('add', 'remove')][string]$Action,
  [Parameter(Mandatory = $true)][string]$Dir
)

$ErrorActionPreference = 'Stop'

$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
try {
  $kind = [Microsoft.Win32.RegistryValueKind]::ExpandString
  $current = ''
  if ($null -ne $key.GetValue('Path')) {
    $kind = $key.GetValueKind('Path')
    $current = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  }
  $wanted = $Dir.TrimEnd('\')
  $kept = @($current -split ';' | Where-Object { $_ -ne '' -and $_.TrimEnd('\') -ne $wanted })
  if ($Action -eq 'add') { $kept += $wanted }
  $key.SetValue('Path', ($kept -join ';'), $kind)
} finally {
  $key.Close()
}

# Tell running Explorer and console hosts that the environment changed.
Add-Type -Namespace EmeraldPath -Name Native -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true, CharSet = System.Runtime.InteropServices.CharSet.Auto)]
public static extern System.IntPtr SendMessageTimeout(System.IntPtr hWnd, uint Msg, System.UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out System.UIntPtr lpdwResult);
'@
$result = [System.UIntPtr]::Zero
# HWND_BROADCAST, WM_SETTINGCHANGE, SMTO_ABORTIFHUNG, 5 s.
[void][EmeraldPath.Native]::SendMessageTimeout([System.IntPtr]0xffff, 0x001A, [System.UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result)
Write-Output "$Action $wanted"
