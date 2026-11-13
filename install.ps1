<#
.SYNOPSIS
    Installs the "痛PC" background MOD into the OpenChamber desktop renderer.

.DESCRIPTION
    Copies bg.jpg and mod.css into <app>\resources\web-dist\assets and adds a
    single <link> tag to web-dist\index.html. Idempotent: running it again only
    refreshes the files. An app update replaces web-dist, so run this again
    afterwards (apply-on-launch.ps1 does that for you).

.PARAMETER WebDist
    Explicit path to the web-dist folder. Omitted: auto-detected from the
    default per-user (or machine-wide) install location.

.PARAMETER Image
    Background image to install. Defaults to bg.jpg next to this script.
    The image is not part of the repository, so pass your own one here the
    first time (or save it as bg.jpg).

.EXAMPLE
    .\install.ps1 -Image "E:\pictures\wallpaper.jpg"

.EXAMPLE
    .\install.ps1 -WebDist "D:\apps\@openchamberelectron\resources\web-dist"
#>
[CmdletBinding()]
param(
    [string]$WebDist,
    [string]$Image
)

$ErrorActionPreference = 'Stop'

$Marker = '<!-- itachou-mod -->'
$CssName = 'itachou.css'
$BgName = 'itachou-bg.jpg'

function Resolve-WebDist {
    param([string]$Explicit)

    if ($Explicit) {
        $full = [System.IO.Path]::GetFullPath($Explicit)
        if (-not (Test-Path (Join-Path $full 'index.html'))) {
            throw "index.html not found under '$full' — is that really a web-dist folder?"
        }
        return $full
    }

    $roots = @()
    if ($env:LOCALAPPDATA) {
        $roots += (Join-Path $env:LOCALAPPDATA 'Programs\@openchamberelectron\resources\web-dist')
    }
    if (${env:ProgramFiles}) {
        $roots += (Join-Path ${env:ProgramFiles} '@openchamberelectron\resources\web-dist')
    }

    foreach ($root in $roots) {
        if (Test-Path (Join-Path $root 'index.html')) { return $root }
    }

    throw "OpenChamber web-dist not found. Pass -WebDist <path>."
}

$WebDist = Resolve-WebDist -Explicit $WebDist
$assets = Join-Path $WebDist 'assets'
if (-not (Test-Path $assets)) { throw "assets folder missing under '$WebDist'." }

$bgSource = if ($Image) { $Image } else { Join-Path $PSScriptRoot 'bg.jpg' }
$cssSource = Join-Path $PSScriptRoot 'mod.css'

if (-not (Test-Path $bgSource)) {
    throw "Background image not found: '$bgSource'. Save your image as bg.jpg next to install.ps1, or pass -Image <path>."
}
if (-not (Test-Path $cssSource)) {
    throw "mod.css not found next to install.ps1."
}

Copy-Item $bgSource (Join-Path $assets $BgName) -Force
Copy-Item $cssSource (Join-Path $assets $CssName) -Force

$indexPath = Join-Path $WebDist 'index.html'
$html = Get-Content -LiteralPath $indexPath -Raw

if ($html.Contains($Marker)) {
    Write-Host "Link already present in index.html — files refreshed."
} else {
    $backup = "$indexPath.itachou-backup"
    if (-not (Test-Path $backup)) {
        Copy-Item $indexPath $backup -Force
    }

    if ($html -notmatch '</head>') {
        throw "No </head> in index.html — cannot inject the stylesheet link."
    }

    $snippet = "$Marker`r`n  <link rel=`"stylesheet`" href=`"/assets/$CssName`" />`r`n"
    $headEnd = $html.LastIndexOf('</head>')
    $html = $html.Substring(0, $headEnd) + $snippet + $html.Substring($headEnd)
    Set-Content -LiteralPath $indexPath -Value $html -Encoding utf8 -NoNewline
    Write-Host "Injected stylesheet link into index.html."
}

Write-Host ""
Write-Host "痛PC MOD installed:"
Write-Host "  web-dist : $WebDist"
Write-Host "  css      : assets\$CssName"
Write-Host "  image    : assets\$BgName"
Write-Host ""
Write-Host "Reload OpenChamber (Ctrl+R) if it is already running."