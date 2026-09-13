$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path $PSScriptRoot -Parent
$outputRoot = Split-Path $sourceRoot -Parent
$version = (Get-Content -LiteralPath (Join-Path $sourceRoot 'manifest.json') -Raw | ConvertFrom-Json).version
Add-Type -AssemblyName System.IO.Compression
function Write-Package([string]$destination, [bool]$chromeOnly) {
  $stream = [IO.File]::Open($destination, [IO.FileMode]::Create)
  $zip = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create)
  try {
    Get-ChildItem -LiteralPath $sourceRoot -Recurse -File -Force | ForEach-Object {
      $relative = $_.FullName.Substring($sourceRoot.Length + 1).Replace('\','/')
      $private = $relative -match '(^|/)(bin|downloads|node_modules|\.git)/|\.local\.json$|(^|/)launch\.cmd$|\.part$'
      $runtime = $relative -match '^(manifest\.json|background\.js|contentScript\.js|format-utils\.js|offscreen\.(html|js)|popup\.(html|css|js)|PRIVACY\.md|README\.md|LICENSE|icons/[^/]+\.png)$'
      if (-not $private -and (-not $chromeOnly -or $runtime)) {
        $entry = $zip.CreateEntry($relative, [IO.Compression.CompressionLevel]::Optimal)
        $entryStream = $entry.Open()
        $inputStream = [IO.File]::OpenRead($_.FullName)
        try { $inputStream.CopyTo($entryStream) } finally { $inputStream.Dispose(); $entryStream.Dispose() }
      }
    }
  } finally { $zip.Dispose(); $stream.Dispose() }
}
Write-Package (Join-Path $outputRoot "Media-Collector-v$version-source.zip") $false
Write-Package (Join-Path $outputRoot "Media-Collector-v$version-chrome.zip") $true
