[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^[a-p]{32}$')]
    [string]$ExtensionId,
    [ValidateSet('Chrome', 'Edge')]
    [string]$Browser = 'Chrome'
)

$ErrorActionPreference = 'Stop'
$root = Join-Path $env:LOCALAPPDATA 'Nobetci'
$relay = Join-Path $root 'bin\nobetci-hook.exe'
if (-not (Test-Path -LiteralPath $relay -PathType Leaf)) {
    throw 'Nobetci hook executable not found. Install the app version with ChatGPT Web support first.'
}

$name = 'io.github.tahap0l.nobetci.chatgpt'
$manifest = Join-Path $root "chatgpt-native-host-$Browser.json"
@{
    name = $name
    description = 'Nobetci ChatGPT Web status relay'
    path = $relay
    type = 'stdio'
    allowed_origins = @("chrome-extension://$ExtensionId/")
} | ConvertTo-Json | Set-Content -LiteralPath $manifest -Encoding ascii

$vendor = if ($Browser -eq 'Edge') { 'Microsoft\Edge' } else { 'Google\Chrome' }
$key = "HKCU:\Software\$vendor\NativeMessagingHosts\$name"
New-Item -Path $key -Force | Out-Null
Set-Item -Path $key -Value $manifest
Write-Host "Registered Nobetci for $Browser. Refresh the ChatGPT tab."
