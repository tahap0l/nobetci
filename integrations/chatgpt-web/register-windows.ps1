<#
.SYNOPSIS
Registers the ChatGPT Web bridge of Nobi with Chrome or Edge. Windows only.

.DESCRIPTION
Writes the native-messaging host manifest to %LOCALAPPDATA%\Nobi and points
the browser's per-user registry key at it. The manifest names Nobi's relay
(nobi-hook.exe) and lets only the given extension start it.

Run it from this folder without changing the system's execution policy:

    powershell -NoProfile -ExecutionPolicy Bypass -File .\register-windows.ps1 -ExtensionId <id> -Browser Chrome

unregister-windows.ps1 undoes it.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^[a-p]{32}$')]
    [string]$ExtensionId,
    [ValidateSet('Chrome', 'Edge')]
    [string]$Browser = 'Chrome'
)

$ErrorActionPreference = 'Stop'

# Messages follow the system language. This file stays plain ASCII, because
# Windows PowerShell 5.1 reads a script without a byte-order mark in the ANSI
# code page: other letters are written as \u escapes and decoded here. A
# template never holds a backslash of its own; paths go in through -f.
$script:inTurkish = (Get-UICulture).TwoLetterISOLanguageName -eq 'tr'
function Say([string]$English, [string]$Turkish) {
    $text = if ($script:inTurkish) { $Turkish } else { $English }
    [regex]::Unescape($text)
}

$name = 'io.github.tahap0l.nobi.chatgpt'
$root = Join-Path $env:LOCALAPPDATA 'Nobi'
$relay = Join-Path $root 'bin\nobi-hook.exe'
if (-not (Test-Path -LiteralPath $relay -PathType Leaf)) {
    throw ((Say 'N\u00f6bet\u00e7i''s relay was not found at {0}. Install N\u00f6bet\u00e7i, open it once, then run this script again.' `
            'N\u00f6bet\u00e7i''nin aktar\u0131c\u0131s\u0131 {0} konumunda bulunamad\u0131. N\u00f6bet\u00e7i''yi kur, bir kez a\u00e7 ve bu beti\u011fi yeniden \u00e7al\u0131\u015ft\u0131r.') -f $relay)
}

# UTF-8 without a byte-order mark. The relay's path holds the profile folder,
# whose name can have letters outside ASCII: written as ASCII they would turn
# into question marks and name a file that does not exist.
$manifest = Join-Path $root "chatgpt-native-host-$Browser.json"
$json = [ordered]@{
    name            = $name
    description     = 'Nobi ChatGPT Web status relay'
    path            = $relay
    type            = 'stdio'
    allowed_origins = @("chrome-extension://$ExtensionId/")
} | ConvertTo-Json
$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($manifest, $json, $utf8)

# Read it back as the browser will, before pointing the browser at it.
$written = [System.IO.File]::ReadAllText($manifest, $utf8) | ConvertFrom-Json
if ($written.path -ne $relay -or -not (Test-Path -LiteralPath $written.path -PathType Leaf)) {
    throw ((Say 'The manifest written to {0} does not name the relay, so nothing was registered.' `
            '{0} konumuna yaz\u0131lan manifest dosyas\u0131 aktar\u0131c\u0131y\u0131 g\u00f6stermiyor; kay\u0131t yap\u0131lmad\u0131.') -f $manifest)
}

$vendor = if ($Browser -eq 'Edge') { 'Microsoft\Edge' } else { 'Google\Chrome' }
$key = "HKCU:\Software\$vendor\NativeMessagingHosts\$name"
New-Item -Path $key -Force | Out-Null
Set-Item -Path $key -Value $manifest

Write-Host ((Say 'Registered N\u00f6bet\u00e7i''s ChatGPT Web bridge for {0}. Reload the ChatGPT tab and start a response: the island shows it while it is being written.' `
        'N\u00f6bet\u00e7i''nin ChatGPT Web k\u00f6pr\u00fcs\u00fc {0} i\u00e7in kaydedildi. ChatGPT sekmesini yenile ve bir yan\u0131t ba\u015flat: yan\u0131t yaz\u0131l\u0131rken adada g\u00f6r\u00fcn\u00fcr.') -f $Browser)
Write-Host ((Say 'To undo it: {0}' 'Geri almak i\u00e7in: {0}') -f 'powershell -NoProfile -ExecutionPolicy Bypass -File .\unregister-windows.ps1')
