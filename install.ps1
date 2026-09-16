# Hikari installer for Windows (PowerShell):
#   iwr -useb https://cdn.jsdelivr.net/npm/@hinashirosaki/hikari/install.ps1 | iex
# Builds the native Hikari app on this machine and writes the installer to .\hikari-out\make\.
# Without Node.js 20+ on PATH it downloads a private copy to %LOCALAPPDATA%\Hikari\node; nothing system-wide changes.
$ErrorActionPreference = 'Stop'

$nodeDist = 'https://nodejs.org/dist/latest-v24.x'
$hikariNode = if ($env:HIKARI_NODE_DIR) { $env:HIKARI_NODE_DIR } else { Join-Path $env:LOCALAPPDATA 'Hikari\node' }

function Test-Node {
  $node = Get-Command node -ErrorAction SilentlyContinue
  return [bool]$node -and ([int](node -p 'process.versions.node.split(".")[0]') -ge 20)
}

if (-not (Test-Node)) {
  if (-not (Test-Path (Join-Path $hikariNode 'node.exe'))) {
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
    $sums = (Invoke-WebRequest -UseBasicParsing "$nodeDist/SHASUMS256.txt").Content
    if ($sums -notmatch "(?m)^([0-9a-f]{64})\s+(node-v[\d.]+-win-$arch\.zip)\s*$") {
      throw "No Node.js build for win-$arch at $nodeDist"
    }
    $sha, $zip = $Matches[1], $Matches[2]
    Write-Host "Node.js 20+ not found; downloading $zip to $hikariNode"
    $tmpZip = Join-Path ([IO.Path]::GetTempPath()) $zip
    $tmpDir = Join-Path ([IO.Path]::GetTempPath()) ([IO.Path]::GetRandomFileName())
    Invoke-WebRequest -UseBasicParsing "$nodeDist/$zip" -OutFile $tmpZip
    if ((Get-FileHash $tmpZip -Algorithm SHA256).Hash -ne $sha) { throw "Checksum mismatch for $zip" }
    Expand-Archive $tmpZip -DestinationPath $tmpDir
    New-Item -ItemType Directory -Force (Split-Path $hikariNode) | Out-Null
    Move-Item (Join-Path $tmpDir ($zip -replace '\.zip$')) $hikariNode
    Remove-Item $tmpZip, $tmpDir -Recurse -Force
  }
  $env:Path = "$hikariNode;$env:Path"
}

# npx.cmd, not npx: PowerShell would pick npx.ps1, which a Restricted execution policy blocks.
npx.cmd --yes @hinashirosaki/hikari
