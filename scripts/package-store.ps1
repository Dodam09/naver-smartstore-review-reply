# Chrome Web Store 업로드용 ZIP (server/ 제외, store/manifest.json + store/config.js 적용)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$distRoot = Join-Path $root 'store\dist'
$outDir = Join-Path $distRoot 'naver-smartstore-reply-store'
$zipPath = Join-Path $distRoot 'naver-smartstore-reply-store.zip'

if (Test-Path $distRoot) { Remove-Item $distRoot -Recurse -Force }
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

$excludeDirs = @('server', '.git', 'beta', 'store', 'node_modules', 'scripts')
$excludeFiles = @(
  'config.js',
  'config.example.js',
  'sample.xlsx',
  'README.md',
  'Dockerfile',
  'railway.toml',
  '.dockerignore',
  '.gitignore'
)

Get-ChildItem -Path $root -Force | ForEach-Object {
  if ($_.PSIsContainer) {
    if ($excludeDirs -contains $_.Name) { return }
    Copy-Item $_.FullName -Destination (Join-Path $outDir $_.Name) -Recurse -Force
    return
  }
  if ($excludeFiles -contains $_.Name) { return }
  if ($_.Extension -eq '.xlsx') { return }
  Copy-Item $_.FullName -Destination $outDir -Force
}

Copy-Item (Join-Path $root 'store\manifest.json') (Join-Path $outDir 'manifest.json') -Force
Copy-Item (Join-Path $root 'store\config.js') (Join-Path $outDir 'config.js') -Force

Compress-Archive -Path (Join-Path $outDir '*') -DestinationPath $zipPath -Force

Write-Host "Created: $zipPath"
Write-Host "Folder:  $outDir"
Write-Host "Privacy: https://naver-smartstore-review-reply-production.up.railway.app/privacy.html"
Write-Host "Version: $(Get-Content (Join-Path $outDir 'manifest.json') -Raw | Select-String -Pattern '\"version\":\s*\"([^\"]+)\"' | ForEach-Object { $_.Matches[0].Groups[1].Value })"
