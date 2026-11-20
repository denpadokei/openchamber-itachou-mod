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

# See install.ps1: keep Japanese output readable when the extension service
# captures it through a pipe instead of a console.
if ([Console]::IsOutputRedirected) {
    $OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
}

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

# Set when the link or one of the assets was actually removed, so the closing
# message never claims a removal that did not happen.
$removed = $false

$html = Get-Content -LiteralPath $indexPath -Raw -Encoding UTF8
if ($html.Contains($Marker)) {
    $pattern = [regex]::Escape($Marker) + '\s*<link[^>]*' + [regex]::Escape($CssName) + '[^>]*>\s*'
    if ($html -notmatch $pattern) {
        throw "itachou-mod marker found but the expected <link> markup was not recognised; index.html was left unchanged."
    }

    $html = [regex]::Replace($html, $pattern, '')
    if ($html.Contains($Marker)) {
        throw "itachou-mod marker is still present after removing the <link>; index.html was left unchanged."
    }

    Set-Content -LiteralPath $indexPath -Value $html -Encoding utf8 -NoNewline
    $removed = $true
    Write-Host "Removed the stylesheet link from index.html."
} else {
    Write-Host "No injected link found in index.html — nothing to remove there."
}

if (Test-Path $assets) {
    foreach ($name in @($CssName, $BgName)) {
        $path = Join-Path $assets $name
        if (Test-Path $path) {
            Remove-Item $path -Force
            $removed = $true
            Write-Host "Deleted assets\$name"
        }
    }
} else {
    Write-Host "No assets folder found under '$WebDist' — nothing to remove there."
}

Write-Host ""
if ($removed) {
    Write-Host "MOD removed. Reload OpenChamber (Ctrl+R) to drop the background."
} else {
    Write-Host "The MOD does not appear to be applied to this web-dist — nothing was removed."
}