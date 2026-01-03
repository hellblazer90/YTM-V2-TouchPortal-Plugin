param(
  [string]$Hostname = "127.0.0.1",
  [int]$Port = 9863,
  [string]$AppId = "ytm_companion",
  [string]$AppName = "YTM TouchPortal V2 (by HellBlazer90)",
  [string]$AppVersion = "3.0.0",
  [string]$OutFile,
  [switch]$NoPause
)

$ErrorActionPreference = "Stop"

if (-not $OutFile) {
  $root = Split-Path -Parent $PSScriptRoot
  $OutFile = Join-Path $root "ytmd_companion_token.txt"
}

$baseUrl = "http://$Hostname`:$Port/api/v1"

try {
  $requestBody = @{
    appId = $AppId
    appName = $AppName
    appVersion = $AppVersion
  } | ConvertTo-Json

  $codeResponse = Invoke-RestMethod -Method Post -Uri "$baseUrl/auth/requestcode" -Body $requestBody -ContentType "application/json"
  $code = $codeResponse.code
  if (-not $code) {
    throw "Authorization code was not returned."
  }

  $tokenBody = @{ appId = $AppId; code = $code } | ConvertTo-Json
  $tokenResponse = Invoke-RestMethod -Method Post -Uri "$baseUrl/auth/request" -Body $tokenBody -ContentType "application/json"
  $token = $tokenResponse.token
  if (-not $token) {
    throw "Token was not returned."
  }

  Set-Content -Path $OutFile -Value $token -NoNewline
  Write-Host "Token saved to $OutFile"
  if (-not $NoPause) {
    Read-Host "Press Enter to close"
  }
} catch {
  Write-Error $_
  if (-not $NoPause) {
    Read-Host "Press Enter to close"
  }
  exit 1
}
