# 베타 배포용 ZIP 생성 (server/ 제외, beta/config.js → config.js)
# - 루트 비밀 config.js / 로컬 override / e2e 제외
# - SW 호환 no-op config.local.js 주입

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$distRoot = Join-Path $root 'beta\dist'
$outDir = Join-Path $distRoot 'naver-smartstore-reply-beta'
$zipPath = Join-Path $distRoot 'naver-smartstore-reply-beta.zip'

if (Test-Path $distRoot) { Remove-Item $distRoot -Recurse -Force }
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

$excludeDirs = @(
  'server', '.git', 'beta', 'store', 'node_modules', 'scripts',
  'e2e', 'agent-transcripts', 'railway-backups', '.cursor', '.vscode',
  'terminals', 'coverage', 'dist'
)
$excludeFiles = @(
  'config.js',
  'config.local.js',
  'config.example.js',
  'config.local.example.js',
  'sample.xlsx',
  'README.md',
  'Dockerfile',
  'railway.toml',
  '.dockerignore',
  '.gitignore',
  '.env',
  '.env.local'
)

Get-ChildItem -Path $root -Force | ForEach-Object {
  if ($_.PSIsContainer) {
    if ($excludeDirs -contains $_.Name) { return }
    if ($_.Name -like '.*') { return }
    Copy-Item $_.FullName -Destination (Join-Path $outDir $_.Name) -Recurse -Force
    return
  }
  if ($excludeFiles -contains $_.Name) { return }
  if ($_.Extension -eq '.xlsx') { return }
  if ($_.Name -like '.env*') { return }
  if ($_.Name -like '*.md') { return }
  Copy-Item $_.FullName -Destination $outDir -Force
}

@(
  'node_modules', 'e2e', 'server', 'store', 'beta', 'scripts',
  'railway-backups', '.git', 'agent-transcripts'
) | ForEach-Object {
  $p = Join-Path $outDir $_
  if (Test-Path $p) { Remove-Item $p -Recurse -Force }
}

Copy-Item (Join-Path $root 'beta\config.js') (Join-Path $outDir 'config.js') -Force

$noopLocal = @'
/**
 * Beta package stub — local API override disabled.
 */
(function applyLocalConfigOverlay() {
  if (!globalThis.CONFIG) return;
  globalThis.CONFIG.__LOCAL_API_OVERRIDE__ = false;
})();
'@
Set-Content -Path (Join-Path $outDir 'config.local.js') -Value $noopLocal -Encoding UTF8

$betaDir = Join-Path $root 'beta'
Get-ChildItem -Path $betaDir -Filter '*.txt' -ErrorAction SilentlyContinue | ForEach-Object {
  Copy-Item $_.FullName -Destination (Join-Path $outDir $_.Name) -Force
}

$guideDocs = @(Get-ChildItem -Path $betaDir -Filter '*.txt' -ErrorAction SilentlyContinue)
$shortGuide = $guideDocs | Sort-Object Length | Select-Object -First 1
$fullManual = $guideDocs | Sort-Object Length | Select-Object -Last 1
if ($shortGuide) {
  Copy-Item $shortGuide.FullName -Destination (Join-Path $outDir '00-START-HERE.txt') -Force
}
if ($fullManual) {
  Copy-Item $fullManual.FullName -Destination (Join-Path $outDir 'MANUAL.txt') -Force
}

Compress-Archive -Path (Join-Path $outDir '*') -DestinationPath $zipPath -Force

$manifestRaw = Get-Content (Join-Path $outDir 'manifest.json') -Raw
$verMatch = [regex]::Match($manifestRaw, '"version"\s*:\s*"([^"]+)"')
$version = if ($verMatch.Success) { $verMatch.Groups[1].Value } else { 'unknown' }

Write-Host "Created: $zipPath"
Write-Host "Folder:  $outDir"
Write-Host "Version: $version"
