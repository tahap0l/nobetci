<#
.SYNOPSIS
Removes the registration that register-windows.ps1 made. Windows only.

.DESCRIPTION
Deletes the browser's per-user registry key for Nobetci's ChatGPT Web bridge
and the manifest in %LOCALAPPDATA%\Nobetci: for both Chrome and Edge, unless
-Browser names one. The extension itself is removed in the browser, at
chrome://extensions or edge://extensions.

    powershell -NoProfile -ExecutionPolicy Bypass -File .\unregister-windows.ps1
#>
[CmdletBinding()]
param(
    [ValidateSet('Chrome', 'Edge', 'Both')]
    [string]$Browser = 'Both'
)

$ErrorActionPreference = 'Stop'

# Messages follow the system language; see register-windows.ps1 for why the
# Turkish ones are written with \u escapes.
$script:inTurkish = (Get-UICulture).TwoLetterISOLanguageName -eq 'tr'
function Say([string]$English, [string]$Turkish) {
    $text = if ($script:inTurkish) { $Turkish } else { $English }
    [regex]::Unescape($text)
}

$name = 'io.github.tahap0l.nobetci.chatgpt'
$root = Join-Path $env:LOCALAPPDATA 'Nobetci'
$browsers = if ($Browser -eq 'Both') { @('Chrome', 'Edge') } else { @($Browser) }

foreach ($each in $browsers) {
    $vendor = if ($each -eq 'Edge') { 'Microsoft\Edge' } else { 'Google\Chrome' }
    $key = "HKCU:\Software\$vendor\NativeMessagingHosts\$name"
    $manifest = Join-Path $root "chatgpt-native-host-$each.json"
    $found = $false
    if (Test-Path -LiteralPath $key) {
        Remove-Item -LiteralPath $key -Recurse -Force
        $found = $true
    }
    if (Test-Path -LiteralPath $manifest -PathType Leaf) {
        Remove-Item -LiteralPath $manifest -Force
        $found = $true
    }
    if ($found) {
        Write-Host ((Say 'Removed the ChatGPT Web registration for {0}.' '{0} i\u00e7in ChatGPT Web kayd\u0131 kald\u0131r\u0131ld\u0131.') -f $each)
    } else {
        Write-Host ((Say 'Nothing was registered for {0}.' '{0} i\u00e7in bir kay\u0131t yoktu.') -f $each)
    }
}
Write-Host (Say 'Remove the extension in the browser too: chrome://extensions or edge://extensions.' `
        'Eklentiyi taray\u0131c\u0131dan da kald\u0131r: chrome://extensions ya da edge://extensions.')
