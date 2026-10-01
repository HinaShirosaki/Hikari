# Runs app-only-update-e2e.mjs in a fresh Windows VM (UTM or any other). Run it
# from a PowerShell window in the VM's desktop session, not over SSH or a guest
# agent (Hikari has to open its window on that desktop):
#   iwr -useb https://raw.githubusercontent.com/HinaShirosaki/Hikari/feat/app-only-updates/scripts/dev/vm-test/windows-guest.ps1 | iex
# Downloads private copies of Node.js and the branch to %LOCALAPPDATA%\HikariE2E;
# no admin rights, Git or system-wide changes. HIKARI_E2E_BRANCH picks another branch.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$branch = if ($env:HIKARI_E2E_BRANCH) { $env:HIKARI_E2E_BRANCH } else { 'feat/app-only-updates' }
$root = Join-Path $env:LOCALAPPDATA 'HikariE2E'
New-Item -ItemType Directory -Force $root | Out-Null

$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
$nodeDist = 'https://nodejs.org/dist/latest-v24.x'
$sums = (Invoke-WebRequest -UseBasicParsing "$nodeDist/SHASUMS256.txt").Content
if ($sums -notmatch "(?m)^([0-9a-f]{64})\s+(node-v[\d.]+-win-$arch)\.zip\s*$") { throw "No Node.js build for win-$arch" }
$sha, $nodeName = $Matches[1], $Matches[2]
$nodeDir = Join-Path $root $nodeName
if (-not (Test-Path (Join-Path $nodeDir 'node.exe'))) {
  Write-Host "Downloading $nodeName"
  $nodeZip = Join-Path $root "$nodeName.zip"
  Invoke-WebRequest -UseBasicParsing "$nodeDist/$nodeName.zip" -OutFile $nodeZip
  if ((Get-FileHash $nodeZip -Algorithm SHA256).Hash -ne $sha) { throw "Checksum mismatch for $nodeName.zip" }
  Expand-Archive $nodeZip $root -Force
}
$env:Path = "$nodeDir;$env:Path"

Write-Host "Downloading the $branch branch"
$repoZip = Join-Path $root 'hikari-branch.zip'
Invoke-WebRequest -UseBasicParsing "https://codeload.github.com/HinaShirosaki/Hikari/zip/refs/heads/$branch" -OutFile $repoZip
$repo = Join-Path $root ('Hikari-' + ($branch -replace '/', '-'))
if (Test-Path $repo) { Remove-Item $repo -Recurse -Force }
Expand-Archive $repoZip $root -Force

Set-Location $repo
node scripts\dev\vm-test\app-only-update-e2e.mjs --compare-full
