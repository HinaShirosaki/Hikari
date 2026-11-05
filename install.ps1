# iwr -useb https://cdn.jsdelivr.net/npm/@hinashirosaki/hikari/install.ps1 | iex
# Prefer a verified release archive; HIKARI_BUILD_FROM_SOURCE=1 forces a local build.
# Asks for the install folder in the system dialog; HIKARI_OUT_DIR skips it for scripts.
$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 may otherwise negotiate an obsolete TLS version.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function Get-HikariDownload($Url, $Destination) {
  for ($attempt = 0; $attempt -lt 4; $attempt++) {
    try {
      Invoke-WebRequest -UseBasicParsing -TimeoutSec 300 $Url -OutFile $Destination
      return
    } catch {
      # Missing release assets should fall back immediately; retry transient failures.
      if ($_.Exception.Response.StatusCode -eq 404 -or $attempt -eq 3) { throw }
      Start-Sleep -Seconds ([Math]::Pow(2, $attempt))
    }
  }
}

function Move-HikariDirectory($From, $To) {
  for ($attempt = 1; ; $attempt++) {
    try {
      [IO.Directory]::Move($From, $To)
      return
    } catch {
      # Defender and the indexer briefly lock freshly extracted or just-run files, denying the rename.
      if ($attempt -ge 10) { throw }
      Start-Sleep -Milliseconds (200 * $attempt)
    }
  }
}

# Returns the chosen folder and a staging folder inside it, or nothing without a
# desktop session. Staging there makes the finished app arrive in one rename and
# rejects an unwritable folder right away.
function Select-HikariFolder {
  # A dialog in a session with no desktop, such as SSH, would wait forever.
  if (-not [Environment]::UserInteractive) { return }
  # The dialog needs an STA thread, which pwsh may lack. Without a shown topmost
  # owner it opens behind the terminal. Base64 keeps non-ASCII paths intact
  # through the console code page.
  $picker = @'
try {
  Add-Type -AssemblyName System.Windows.Forms
  $owner = New-Object Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; Opacity = 0 }
  $owner.Show()
  $dialog = New-Object Windows.Forms.FolderBrowserDialog -Property @{ Description = 'PROMPT'; SelectedPath = $env:USERPROFILE }
  if ($dialog.ShowDialog($owner) -ne 'OK') { exit 2 }
  [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($dialog.SelectedPath))
} catch { exit 3 }
'@
  $prompt = 'Choose where to install Hikari'
  while ($true) {
    $encoded = & powershell.exe -NoProfile -STA -Command $picker.Replace('PROMPT', $prompt)
    if ($LASTEXITCODE -eq 2) { throw 'Installation cancelled.' }
    if ($LASTEXITCODE -ne 0) { return }
    $folder = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($encoded))
    if (Test-Path -LiteralPath (Join-Path $folder 'Hikari')) {
      $prompt = 'Hikari is already in that folder. Choose another folder.'
      continue
    }
    try {
      $stage = Join-Path $folder ('.hikari-install-' + [IO.Path]::GetRandomFileName())
      New-Item -ItemType Directory $stage -ErrorAction Stop | Out-Null
      return $folder, $stage
    } catch { $prompt = 'Hikari cannot be installed in that folder. Choose another folder.' }
  }
}

function Complete-HikariInstall($Stage, $Folder) {
  # bin/hikari.js names the folder after Node's architecture, which can differ from the shell's.
  $built = Get-ChildItem -LiteralPath $Stage -Directory -Filter 'Hikari-win32-*' | Select-Object -First 1
  $app = Join-Path $Folder 'Hikari'
  Move-HikariDirectory (Join-Path $built.FullName 'Hikari') $app
  $exe = Join-Path $app 'Hikari.exe'
  $wsh = New-Object -ComObject WScript.Shell
  $shell = New-Object -ComObject Shell.Application
  foreach ($place in 'Programs', 'Desktop') {
    $links = [Environment]::GetFolderPath($place)
    try {
      # WScript.Shell rejects a target outside the ANSI code page, so it only creates the file.
      $placeholder = $wsh.CreateShortcut((Join-Path $links 'Hikari.lnk'))
      $placeholder.TargetPath = $env:SystemRoot
      $placeholder.Save()
      $link = $shell.NameSpace($links).ParseName('Hikari.lnk').GetLink
      $link.Path = $exe
      $link.Save()
    } catch { Write-Host "Could not add the $place shortcut: $_" }
  }
  Write-Host "Hikari is installed: $exe"
}

function Remove-HikariStage($Stage) {
  for ($attempt = 1; $attempt -le 10 -and (Test-Path -LiteralPath $Stage); $attempt++) {
    # Defender and the indexer briefly lock freshly extracted files.
    Remove-Item -LiteralPath $Stage -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $Stage) { Start-Sleep -Milliseconds (200 * $attempt) }
  }
}

function Test-HikariRuntime($Node, $NpmCli, $NpxCli, $Arch = '') {
  try {
    if (-not (Test-Path $Node)) { return $false }
    $directory = Split-Path $Node
    if (-not (Test-Path (Join-Path $directory 'npm.cmd')) -or -not (Test-Path (Join-Path $directory 'npx.cmd'))) { return $false }
    & $Node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 && (!'$Arch' || process.arch === '$Arch') ? 0 : 1)" 2>$null
    if ($LASTEXITCODE -ne 0) { return $false }
    & $Node $NpmCli --version 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { return $false }
    & $Node $NpxCli --version 2>$null | Out-Null
    return $LASTEXITCODE -eq 0
  } catch { return $false }
}

function Install-Hikari {
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }
  $output = if ($env:HIKARI_OUT_DIR) { [IO.Path]::GetFullPath($env:HIKARI_OUT_DIR) } else { Join-Path (Get-Location).Path 'hikari-out' }
  # Separate from Squirrel's %LOCALAPPDATA%\Hikari install root.
  $hikariNode = if ($env:HIKARI_NODE_DIR) { [IO.Path]::GetFullPath($env:HIKARI_NODE_DIR) } else { Join-Path $env:LOCALAPPDATA 'HikariNode' }
  if ($hikariNode.TrimEnd('\', '/') -eq [IO.Path]::GetPathRoot($hikariNode).TrimEnd('\', '/')) { throw 'HIKARI_NODE_DIR must name a cache folder.' }
  $hikariNode = $hikariNode.TrimEnd('\', '/')
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ('hikari-install-' + [IO.Path]::GetRandomFileName())
  $nodeTmp = $null
  $nodeLock = $null
  $picked = $null
  $stage = $null
  New-Item -ItemType Directory $tmp | Out-Null
  try {
    if (-not $env:HIKARI_OUT_DIR) {
      $picked, $stage = Select-HikariFolder
      if ($picked) { $output = $stage } else { Write-Host "No desktop session to choose a folder; installing to $output" }
    }
    $version = $env:HIKARI_VERSION
    if (-not $version) {
      Get-HikariDownload 'https://registry.npmjs.org/-/package/@hinashirosaki%2fhikari/dist-tags' (Join-Path $tmp 'tags.json')
      $version = (Get-Content (Join-Path $tmp 'tags.json') -Raw | ConvertFrom-Json).latest
    }
    if ($version -notmatch '^\d+\.\d+\.\d+([-+][0-9A-Za-z.+-]+)?$') { throw 'Could not resolve a valid Hikari version.' }

    if ($env:HIKARI_BUILD_FROM_SOURCE -ne '1') {
      $asset = "Hikari-$version-win32-$arch.zip"
      $release = "https://github.com/HinaShirosaki/Hikari/releases/download/v$version"
      $archive = Join-Path $tmp $asset
      $checksum = Join-Path $tmp 'checksum'
      $available = $false
      Write-Host "Checking for Hikari $version for Windows $arch..."
      try {
        Get-HikariDownload "$release/$asset.sha256" $checksum
        Get-HikariDownload "$release/$asset" $archive
        $available = $true
      } catch { Write-Host 'A prebuilt archive is unavailable; building Hikari locally.' }
      if ($available) {
        $sha = ((Get-Content $checksum -Raw).Trim() -split '\s+')[0]
        if ($sha -notmatch '^[0-9a-fA-F]{64}$' -or (Get-FileHash $archive -Algorithm SHA256).Hash -ne $sha) {
          throw "Checksum mismatch for $asset"
        }
        New-Item -ItemType Directory -Force $output | Out-Null
        $destination = Join-Path $output "Hikari-win32-$arch"
        if (Test-Path $destination) { throw "$destination already exists. Choose another HIKARI_OUT_DIR." }
        $nodeTmp = Join-Path $output ('.hikari-extract-' + [IO.Path]::GetRandomFileName())
        Expand-Archive $archive -DestinationPath $nodeTmp
        $extracted = Join-Path $nodeTmp "Hikari-win32-$arch"
        if (-not (Test-Path -LiteralPath (Join-Path $extracted 'Hikari\Hikari.exe')) -or -not (Test-Path -LiteralPath (Join-Path $extracted 'HikariSetup.exe'))) {
          throw 'Hikari archive is missing the portable app or installer.'
        }
        Move-HikariDirectory $extracted $destination
        if ($picked) {
          Complete-HikariInstall $stage $picked
          return
        }
        Write-Host "Hikari portable: $destination\Hikari\Hikari.exe"
        Write-Host "Hikari installer: $destination\HikariSetup.exe"
        return
      }
    }

    $nodeCommand = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    $npmCommand = Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    $npxCommand = Get-Command npx.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    $haveNode = $false
    if ($nodeCommand -and $npmCommand -and $npxCommand) {
      try {
        & $nodeCommand.Source -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)"
        if ($LASTEXITCODE -eq 0) {
          & $npmCommand.Source --version | Out-Null
          if ($LASTEXITCODE -eq 0) { & $npxCommand.Source --version | Out-Null; $haveNode = $LASTEXITCODE -eq 0 }
        }
      } catch { $haveNode = $false }
    }
    if (-not $haveNode) {
      $node = Join-Path $hikariNode 'node.exe'
      $npmCli = Join-Path $hikariNode 'node_modules\npm\bin\npm-cli.js'
      $npxCli = Join-Path $hikariNode 'node_modules\npm\bin\npx-cli.js'
      if (-not (Test-HikariRuntime $node $npmCli $npxCli $arch)) {
        if ((Test-Path $hikariNode) -and (-not (Test-Path $hikariNode -PathType Container) -or
            (-not (Test-Path $node) -and -not (Test-Path (Join-Path $hikariNode 'node_modules\npm')) -and
             @(Get-ChildItem $hikariNode -Force).Count -gt 0))) {
          throw "$hikariNode contains unrelated files. Choose a dedicated HIKARI_NODE_DIR."
        }
        $parent = Split-Path $hikariNode
        New-Item -ItemType Directory -Force $parent | Out-Null
        $lockPath = "$hikariNode.install-lock"
        try { New-Item -ItemType Directory $lockPath -ErrorAction Stop | Out-Null }
        catch { throw "Another Node setup is using $lockPath. Retry after it finishes." }
        $nodeLock = $lockPath
        $nodeTmp = Join-Path $parent ('.hikari-node-' + [IO.Path]::GetRandomFileName())
        New-Item -ItemType Directory $nodeTmp | Out-Null
        Get-HikariDownload 'https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt' (Join-Path $nodeTmp 'sums')
        $sums = Get-Content (Join-Path $nodeTmp 'sums') -Raw
        if ($sums -notmatch "(?m)^([0-9a-f]{64})\s+(node-v[\d.]+-win-$arch\.zip)\s*$") { throw "No Node.js build for win-$arch" }
        $sha, $zip = $Matches[1], $Matches[2]
        $nodeVersion = ($zip -replace '-win-.*$', '') -replace '^node-', ''
        $zipPath = Join-Path $nodeTmp $zip
        Write-Host "Downloading $zip to $hikariNode"
        Get-HikariDownload "https://nodejs.org/dist/$nodeVersion/$zip" $zipPath
        if ((Get-FileHash $zipPath -Algorithm SHA256).Hash -ne $sha) { throw "Checksum mismatch for $zip" }
        Expand-Archive $zipPath -DestinationPath (Join-Path $nodeTmp 'extracted')
        $runtime = Join-Path $nodeTmp ('extracted\' + ($zip -replace '\.zip$', ''))
        if (-not (Test-HikariRuntime (Join-Path $runtime 'node.exe') (Join-Path $runtime 'node_modules\npm\bin\npm-cli.js') (Join-Path $runtime 'node_modules\npm\bin\npx-cli.js') $arch)) {
          throw 'Downloaded Node.js runtime failed validation.'
        }
        $previous = Join-Path $nodeTmp 'previous'
        if (Test-Path $hikariNode) { Move-HikariDirectory $hikariNode $previous }
        try { Move-HikariDirectory $runtime $hikariNode }
        catch {
          if (Test-Path $previous) { Move-HikariDirectory $previous $hikariNode }
          throw
        }
        Remove-Item $nodeTmp -Recurse -Force
        $nodeTmp = $null
        Remove-Item $nodeLock -Force
        $nodeLock = $null
      }
      $env:Path = "$hikariNode;$env:Path"
    }
    $package = if ($env:HIKARI_PACKAGE_SPEC) { $env:HIKARI_PACKAGE_SPEC } else { "@hinashirosaki/hikari@$version" }
    # .cmd works with PowerShell's Restricted execution policy.
    # iex runs in the caller's session, so its environment has to be put back.
    $requestedOutput = $env:HIKARI_OUT_DIR
    $env:HIKARI_OUT_DIR = $output
    try { & npx.cmd --yes $package } finally { $env:HIKARI_OUT_DIR = $requestedOutput }
    if ($LASTEXITCODE -ne 0) { throw "Hikari build failed (exit $LASTEXITCODE)." }
    if ($picked) { Complete-HikariInstall $stage $picked }
  } finally {
    if ($nodeTmp -and (Test-Path -LiteralPath $nodeTmp)) { Remove-Item -LiteralPath $nodeTmp -Recurse -Force }
    if ($nodeLock -and (Test-Path $nodeLock)) { Remove-Item $nodeLock -Force }
    if ($stage) { Remove-HikariStage $stage }
    Remove-Item $tmp -Recurse -Force
  }
}

Install-Hikari
