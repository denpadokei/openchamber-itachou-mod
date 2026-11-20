<#
.SYNOPSIS
    Re-applies the "痛PC" MOD and then launches OpenChamber.

.DESCRIPTION
    An app update replaces web-dist and drops the injected stylesheet. Point
    your usual shortcut at this script instead of OpenChamber.exe and the MOD
    is restored before every launch.

    If OpenChamber is already running, Windows focuses that instance and the
    freshly copied CSS is not loaded; press Ctrl+R once in the window.

.PARAMETER WebDist
    Explicit path to the web-dist folder. Omitted: auto-detected.

.PARAMETER NoLaunch
    Only apply the MOD, do not start OpenChamber.

.PARAMETER Image
    Background image to install. Defaults to bg.jpg next to install.ps1.

.EXAMPLE
    .\apply-on-launch.ps1

.EXAMPLE
    .\apply-on-launch.ps1 -NoLaunch
#>
[CmdletBinding()]
param(
    [string]$WebDist,
    [string]$Image,
    [switch]$NoLaunch
)

$ErrorActionPreference = 'Stop'

$install = Join-Path $PSScriptRoot 'install.ps1'
if (-not (Test-Path $install)) { throw "install.ps1 not found next to this script." }

$logPath = Join-Path $PSScriptRoot 'apply-on-launch.log'

# A shortcut launches this script without a visible console, so a failure would
# be silent. Record every problem next to the script instead. Logging must never
# be the reason the app does not start, hence the swallowed write error.
function Write-LaunchLog {
    param([string]$Message)

    try {
        $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $Message
        Add-Content -LiteralPath $logPath -Value $line -Encoding utf8
    } catch {
    }
}

$installArgs = @{}
if ($WebDist) { $installArgs['WebDist'] = $WebDist }
if ($Image) { $installArgs['Image'] = $Image }

# Applying the MOD is cosmetic: a failure must not stop OpenChamber from
# starting, so warn, log, and carry on.
try {
    & $install @installArgs
} catch {
    Write-LaunchLog "MOD apply failed: $($_.Exception.Message)"
    Write-Warning "痛PC MOD の適用に失敗しましたが、OpenChamber はそのまま起動します (MOD apply failed; OpenChamber starts anyway). 詳細: $($_.Exception.Message) — apply-on-launch.log にも記録しています"
}

if ($NoLaunch) { return }

$candidates = @()
if ($env:LOCALAPPDATA) {
    $candidates += (Join-Path $env:LOCALAPPDATA 'Programs\@openchamberelectron\OpenChamber.exe')
}
if (${env:ProgramFiles}) {
    $candidates += (Join-Path ${env:ProgramFiles} '@openchamberelectron\OpenChamber.exe')
}

$exe = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $exe) { throw "OpenChamber.exe not found. Start it yourself; the MOD is already applied." }

# Launching the app is the point of this script, so a failure here is fatal.
try {
    Start-Process -FilePath $exe
} catch {
    Write-LaunchLog "OpenChamber launch failed: $($_.Exception.Message)"
    throw
}