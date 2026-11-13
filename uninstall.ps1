<#
.SYNOPSIS
    Removes the "痛PC" background MOD from the OpenChamber desktop renderer.

.DESCRIPTION
    Deletes the injected <link> tag from web-dist\index.html and removes the
    copied itachou.css / itachou-bg.jpg from web-dist\assets. Your source files
    in this folder are left untouched, so install.ps1 can bring it back.

.PARAMETER WebDist
    Explicit path to the web-dist folder. Omitted: auto-detected.

.EXAMPLE
    .\uninstall.ps1
#>
[CmdletBinding()]
param(
    [string]$WebDist
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
$indexPath = Join-Path $WebDist 'index.html'

$html = Get-Content -LiteralPath $indexPath -Raw
if ($html.Contains($Marker)) {
    $pattern = [regex]::Escape($Marker) + '\s*<link[^>]*' + [regex]::Escape($CssName) + '[^>]*>\s*'
    $html = [regex]::Replace($html, $pattern, '')
    Set-Content -LiteralPath $indexPath -Value $html -Encoding utf8 -NoNewline
    Write-Host "Removed the stylesheet link from index.html."
} else {
    Write-Host "No injected link found in index.html — nothing to remove there."
}

foreach ($name in @($CssName, $BgName)) {
    $path = Join-Path $assets $name
    if (Test-Path $path) {
        Remove-Item $path -Force
        Write-Host "Deleted assets\$name"
    }
}

Write-Host ""
Write-Host "MOD removed. Reload OpenChamber (Ctrl+R) to drop the background."