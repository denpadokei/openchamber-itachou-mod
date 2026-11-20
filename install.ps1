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

# The extension service captures this output without a console. Windows then
# falls back to an OEM code page that cannot represent Japanese, so ask for
# UTF-8 only in the redirected case and leave an interactive terminal alone.
if ([Console]::IsOutputRedirected) {
    $OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
}

# Windows PowerShell 5.1 cannot always represent the Japanese title when the
# output is captured (the extension service runs it without a console), so use
# ASCII there and keep the 痛PC spelling for an interactive terminal.
$ProductName = if ([Console]::IsOutputRedirected) { 'Itachou MOD' } else { '痛PC MOD' }

# Windows PowerShell 5.1 can fail to auto-load Microsoft.PowerShell.Utility
# when the host starts it without a console (Get-FileHash is then missing).
# Use .NET directly so hashing works in both 5.1 and 7.
function Get-Sha256Hex {
    param([Parameter(Mandatory)][string]$Path)

    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $stream = [System.IO.File]::OpenRead($Path)
        try {
            $bytes = $sha.ComputeHash($stream)
        } finally {
            $stream.Dispose()
        }
    } finally {
        $sha.Dispose()
    }

    return ([System.BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
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
if (-not (Test-Path $assets)) { throw "assets folder missing under '$WebDist'." }

$bgSource = if ($Image) { $Image } else { Join-Path $PSScriptRoot 'bg.jpg' }
$cssSource = Join-Path $PSScriptRoot 'mod.css'

if (-not (Test-Path $bgSource)) {
    throw "Background image not found: '$bgSource'. Save your image as bg.jpg next to install.ps1, or pass -Image <path>."
}
if (-not (Test-Path $cssSource)) {
    throw "mod.css not found next to install.ps1."
}

# The renderer serves /assets/* with "Cache-Control: immutable" for a year, so a
# plain reload would keep showing the previous CSS (and image). Giving both the
# <link> href and the background-image URL a content hash makes every change a
# new URL, which skips that cache.

$cssHash = Get-Sha256Hex -Path $cssSource
$bgHash = Get-Sha256Hex -Path $bgSource
$version = $cssHash.Substring(0, 6).ToLowerInvariant() + $bgHash.Substring(0, 6).ToLowerInvariant()

Copy-Item $bgSource (Join-Path $assets $BgName) -Force

$css = Get-Content -LiteralPath $cssSource -Raw -Encoding UTF8
$css = $css -replace "($([regex]::Escape($BgName)))(?!\?v=)", "`$1?v=$($bgHash.Substring(0, 10).ToLowerInvariant())"
Set-Content -LiteralPath (Join-Path $assets $CssName) -Value $css -Encoding utf8 -NoNewline

$indexPath = Join-Path $WebDist 'index.html'
$html = Get-Content -LiteralPath $indexPath -Raw -Encoding UTF8

# ${...} matters: "$CssName?v" would be parsed as one (empty) variable name.
$snippet = "$Marker`r`n  <link rel=`"stylesheet`" href=`"/assets/${CssName}?v=${version}`" />`r`n"
$linkPattern = '(?s)' + [regex]::Escape($Marker) + '\s*<link[^>]*' + [regex]::Escape($CssName) + '[^>]*>[ \t]*\r?\n?'

if ($html -match $linkPattern) {
    if ($html.Contains("/assets/${CssName}?v=${version}")) {
        Write-Host "Stylesheet link already at v=$version — files refreshed."
    } else {
        $html = [regex]::Replace($html, $linkPattern, [System.Text.RegularExpressions.MatchEvaluator] { param($m) $snippet })
        Set-Content -LiteralPath $indexPath -Value $html -Encoding utf8 -NoNewline
        Write-Host "Updated the stylesheet link to v=$version."
    }
} else {
    $backup = "$indexPath.itachou-backup"
    if (-not (Test-Path $backup)) {
        Copy-Item $indexPath $backup -Force
    }

    if ($html -notmatch '</head>') {
        throw "No </head> in index.html — cannot inject the stylesheet link."
    }

    $html = $html.Replace($Marker, '')
    $headEnd = $html.LastIndexOf('</head>')
    $html = $html.Substring(0, $headEnd) + $snippet + $html.Substring($headEnd)
    Set-Content -LiteralPath $indexPath -Value $html -Encoding utf8 -NoNewline
    Write-Host "Injected stylesheet link into index.html (v=$version)."
}

Write-Host ""
Write-Host "$ProductName installed:"
Write-Host "  web-dist : $WebDist"
Write-Host "  css      : assets\$CssName"
Write-Host "  image    : assets\$BgName"
Write-Host ""
Write-Host "Reload OpenChamber (Ctrl+R) if it is already running."