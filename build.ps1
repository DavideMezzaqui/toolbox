<#
    Builds Toolbox, or launches it from source.

        .\build.ps1          build and install it to Tools\_app\Toolbox, and point
                             Tools\Toolbox.lnk at it
        .\build.ps1 -Setup   also write an installer to dist\, for another PC
        .\build.ps1 -Run     launch from source (fast, for iterating)

    Why an unpacked folder and not the portable .exe: the portable unpacks the
    whole app into a temporary folder every time it starts. Measured on this
    PC: 3.3 to 5 s before the window appeared, against 0.4 to 0.5 s from an
    unpacked folder. The folder is about 360 MB.
#>
param([switch]$Run, [switch]$Setup)

$ErrorActionPreference = 'Stop'

# npm and electron-builder write notices to stderr. Under $ErrorActionPreference
# 'Stop', PowerShell 5.1 turns each stderr line from a native command into a
# terminating NativeCommandError whenever the output is redirected - so a mere
# deprecation warning would abort the build. Exit codes are what actually matter,
# and they are checked explicitly after every call below.
function Invoke-Native {
    param([Parameter(Mandatory)][string]$Exe,
          [Parameter(ValueFromRemainingArguments)][string[]]$Arguments)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $Exe @Arguments } finally { $ErrorActionPreference = $prev }
}

$proj = $PSScriptRoot
$name = Split-Path $proj -Leaf

# Node is installed machine-wide; a stale shell may not have it on PATH yet.
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
            [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js not found. Install it with: winget install OpenJS.NodeJS.LTS"
}

# Electron downloads are ~110 MB, so share one cache with the neighbouring tools
# when this project sits in the usual Tools\apps\<Tool> layout. If it has been
# copied somewhere else, fall back to a cache inside the project - slower first
# build, but the project stays self-sufficient.
$root = $proj
while ($root -and -not (Test-Path (Join-Path $root 'apps'))) {
    $parent = Split-Path $root -Parent
    if ($parent -eq $root) { $root = $null; break }
    $root = $parent
}
$cache = if ($root) { Join-Path $root '_cache' } else { Join-Path $proj '_cache' }

# The Claude desktop app runs in an MSIX container that redirects %LOCALAPPDATA%.
# electron-builder then fails renaming its downloads across that boundary, so
# keep every cache outside AppData. Harmless when run from a normal shell.
New-Item -ItemType Directory -Force -Path "$cache\electron", "$cache\electron-builder", "$cache\tmp" | Out-Null
$env:ELECTRON_CACHE         = "$cache\electron"
$env:ELECTRON_BUILDER_CACHE = "$cache\electron-builder"
$env:TEMP = "$cache\tmp"
$env:TMP  = "$cache\tmp"

Set-Location $proj

# Checks for electron specifically: a node_modules holding only, say, a library
# pulled in by hand would otherwise look like a complete install.
if (-not (Test-Path "$proj\node_modules\electron")) {
    Write-Host "Installing dependencies..." -ForegroundColor Cyan
    if (Test-Path "$proj\package-lock.json") { Invoke-Native npm ci --no-audit --no-fund }
    else { Invoke-Native npm install --no-audit --no-fund }
    if ($LASTEXITCODE -ne 0) { throw "dependency install failed" }
}

# npm 11+ can silently skip Electron's postinstall, which is what fetches the
# actual browser binary. Without it nothing runs.
if (-not (Test-Path "$proj\node_modules\electron\dist\electron.exe")) {
    Write-Host "Electron binary missing - approving its install script..." -ForegroundColor Yellow
    Invoke-Native npm approve-scripts electron
    Invoke-Native npm rebuild electron
    if (-not (Test-Path "$proj\node_modules\electron\dist\electron.exe")) {
        throw "Electron binary still missing. Run: npm approve-scripts electron; npm rebuild electron"
    }
}

Invoke-Native node (Join-Path $proj "prepare-scene-sync.cjs")
if ($LASTEXITCODE -ne 0) { throw "Scene Sync preparation failed" }

if ($Run) {
    Write-Host "Launching $name from source..." -ForegroundColor Cyan
    & "$proj\node_modules\electron\dist\electron.exe" $proj
    return
}

# The installed copy can only be replaced while it is closed. electron-builder
# does not say so, it just hangs: check first.
$tools = if ($root) { $root } else { Split-Path $proj -Parent }
$install = Join-Path $tools '_app\Toolbox'
$running = Get-Process -Name 'Toolbox' -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and ($_.Path -like "$install*" -or $_.Path -like "$proj\dist*") }
if ($running) { throw "Toolbox is open. Close it and run the build again." }

Write-Host "Building $name..." -ForegroundColor Cyan
if ($Setup) { Invoke-Native npx --no-install electron-builder --win nsis }
else        { Invoke-Native npx --no-install electron-builder --dir }
if ($LASTEXITCODE -ne 0) { throw "electron-builder failed" }

# Mirror the build into the install folder: new files in, stale files out.
New-Item -ItemType Directory -Force -Path $install | Out-Null
Invoke-Native robocopy "$proj\dist\win-unpacked" $install /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "copying the build to $install failed (robocopy $LASTEXITCODE)" }
$global:LASTEXITCODE = 0

$link = Join-Path $tools 'Toolbox.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($link)
$shortcut.TargetPath = Join-Path $install 'Toolbox.exe'
$shortcut.WorkingDirectory = $install
$shortcut.IconLocation = (Join-Path $install 'Toolbox.exe') + ',0'
$shortcut.Save()

# The unpacked build is now a duplicate of the installed copy.
Remove-Item -Recurse -Force "$proj\dist\win-unpacked" -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Done. Installed to $install, Toolbox.lnk updated." -ForegroundColor Green
if ($Setup) {
    Get-ChildItem "$proj\dist\*.exe" |
        Select-Object Name, @{n = 'MB'; e = { [math]::Round($_.Length / 1MB, 1) } } |
        Format-Table -AutoSize
}
Write-Host "node_modules\ is disposable - delete it to reclaim space." -ForegroundColor DarkGray
