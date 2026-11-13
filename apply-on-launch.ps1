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

$installArgs = @{}
if ($WebDist) { $installArgs['WebDist'] = $WebDist }
if ($Image) { $installArgs['Image'] = $Image }
& $install @installArgs

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

Start-Process -FilePath $exe