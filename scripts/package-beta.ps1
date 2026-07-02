# 베타 배포용 ZIP 생성 (server/ 제외, beta/config.js → config.js)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$outDir = Join-Path $root 'beta\dist\naver-smartstore-reply-beta'
$zipPath = Join-Path $root 'beta\dist\naver-smartstore-reply-beta.zip'

if (Test-Path $outDir) { Remove-Item $outDir -Recurse -Force }
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

$excludeDirs = @('server', '.git', 'beta\dist', 'node_modules', 'scripts')
$excludeFiles = @('config.js', 'sample.xlsx')

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

Copy-Item (Join-Path $root 'beta\config.js') (Join-Path $outDir 'config.js') -Force

if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path (Join-Path $outDir '*') -DestinationPath $zipPath -Force

Write-Host "Created: $zipPath"
Write-Host "Folder:  $outDir"
