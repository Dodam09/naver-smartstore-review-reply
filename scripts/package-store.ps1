# Chrome Web Store 업로드용 ZIP (server/ 제외, store/manifest.json + store/config.js 적용)
# - 로컬 config.local.js / 루트 config.js(비밀키) / e2e / 테스트 산출물 제외
# - SW importScripts 호환용 no-op config.local.js 만 주입 (오버라이드 비활성)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$distRoot = Join-Path $root 'store\dist'
$outDir = Join-Path $distRoot 'naver-smartstore-reply-store'
$zipPath = Join-Path $distRoot 'naver-smartstore-reply-store.zip'

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

# Nested junk that may have been under copied trees
@(
  'node_modules', 'e2e', 'server', 'store', 'beta', 'scripts',
  'railway-backups', '.git', 'agent-transcripts'
) | ForEach-Object {
  $p = Join-Path $outDir $_
  if (Test-Path $p) { Remove-Item $p -Recurse -Force }
}

Copy-Item (Join-Path $root 'store\manifest.json') (Join-Path $outDir 'manifest.json') -Force
Copy-Item (Join-Path $root 'store\config.js') (Join-Path $outDir 'config.js') -Force

# No-op local overlay for background.js importScripts — never enable local API override
$noopLocal = @'
/**
 * Store package stub — local API override disabled.
 * Do not put secrets or LOCAL_API_OVERRIDE here.
 */
(function applyLocalConfigOverlay() {
  if (!globalThis.CONFIG) return;
  globalThis.CONFIG.__LOCAL_API_OVERRIDE__ = false;
})();
'@
Set-Content -Path (Join-Path $outDir 'config.local.js') -Value $noopLocal -Encoding UTF8

# Strip nested dist leftovers if any
Get-ChildItem -Path $outDir -Recurse -Directory -Filter 'dist' -ErrorAction SilentlyContinue |
  ForEach-Object { Remove-Item $_.FullName -Recurse -Force }

Compress-Archive -Path (Join-Path $outDir '*') -DestinationPath $zipPath -Force

$manifestRaw = Get-Content (Join-Path $outDir 'manifest.json') -Raw
$verMatch = [regex]::Match($manifestRaw, '"version"\s*:\s*"([^"]+)"')
$version = if ($verMatch.Success) { $verMatch.Groups[1].Value } else { 'unknown' }

Write-Host "Created: $zipPath"
Write-Host "Folder:  $outDir"
Write-Host "Privacy: https://naver-smartstore-review-reply-production.up.railway.app/privacy.html"
Write-Host "Version: $version"

# Fail packaging if Gemini-like live keys appear in package (values not printed)
node (Join-Path $root 'scripts\verify-store-package.mjs') --dir $outDir
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
