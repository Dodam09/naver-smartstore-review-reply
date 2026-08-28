# 베타 배포용 ZIP 생성 (server/ 제외, beta/config.js → config.js)

$ErrorActionPreference = 'Stop'



$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

$distRoot = Join-Path $root 'beta\dist'

$outDir = Join-Path $distRoot 'naver-smartstore-reply-beta'

$zipPath = Join-Path $distRoot 'naver-smartstore-reply-beta.zip'



if (Test-Path $distRoot) { Remove-Item $distRoot -Recurse -Force }

New-Item -ItemType Directory -Path $outDir -Force | Out-Null



$excludeDirs = @('server', '.git', 'beta', 'node_modules', 'scripts')

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

Copy-Item (Join-Path $root 'beta\INSTALL.txt') (Join-Path $outDir 'INSTALL.txt') -Force

Copy-Item (Join-Path $root 'beta\지인용-설치안내.txt') (Join-Path $outDir '지인용-설치안내.txt') -Force

Copy-Item (Join-Path $root 'beta\사용설명서.txt') (Join-Path $outDir '사용설명서.txt') -Force



Compress-Archive -Path (Join-Path $outDir '*') -DestinationPath $zipPath -Force



Write-Host "Created: $zipPath"

Write-Host "Folder:  $outDir"

Write-Host "Version: $(Get-Content (Join-Path $outDir 'manifest.json') -Raw | Select-String -Pattern '\"version\":\s*\"([^\"]+)\"' | ForEach-Object { $_.Matches[0].Groups[1].Value })"


