# Railway에 토스 결제 환경변수를 넣습니다.
# 사용 전: npx @railway/cli login  (브라우저 로그인)
# 실행:   .\scripts\enable-toss-billing.ps1
# 키는 채팅/로그에 남기지 마세요. 이 스크립트는 화면에 키 전체를 출력하지 않습니다.

$ErrorActionPreference = 'Stop'
$AppBaseUrl = 'https://naver-smartstore-review-reply-production.up.railway.app'
$ServerDir = Join-Path $PSScriptRoot '..\server' | Resolve-Path

Write-Host ''
Write-Host '=== 토스 결제 Railway 연결 ===' -ForegroundColor Cyan
Write-Host "APP_BASE_URL = $AppBaseUrl"
Write-Host '테스트 키: test_ck_... / test_sk_...  (권장)'
Write-Host '라이브 키: live_ck_... / live_sk_...'
Write-Host ''

Push-Location $ServerDir
try {
  $who = npx --yes @railway/cli whoami 2>&1
  if ($LASTEXITCODE -ne 0 -or "$who" -match 'Unauthorized') {
    Write-Host 'Railway 로그인이 필요합니다. 브라우저가 열리면 로그인하세요.' -ForegroundColor Yellow
    npx --yes @railway/cli login
  }

  $clientKey = Read-Host 'TOSS_CLIENT_KEY'
  $secretKey = Read-Host 'TOSS_SECRET_KEY'
  if (-not $clientKey -or -not $secretKey) {
    throw 'TOSS_CLIENT_KEY / TOSS_SECRET_KEY 가 비어 있습니다.'
  }
  if ($clientKey -notmatch '^(test|live)_ck_' -or $secretKey -notmatch '^(test|live)_sk_') {
    Write-Host '경고: 키 prefix가 test_/live_ ck/sk 형식이 아닐 수 있습니다. 계속합니다.' -ForegroundColor Yellow
  }

  Write-Host 'Variables 설정 중…'
  npx --yes @railway/cli variables --set "BILLING_MOCK=false"
  npx --yes @railway/cli variables --set "APP_BASE_URL=$AppBaseUrl"
  npx --yes @railway/cli variables --set "TOSS_CLIENT_KEY=$clientKey"
  npx --yes @railway/cli variables --set "TOSS_SECRET_KEY=$secretKey"

  Write-Host ''
  Write-Host '설정 완료. Railway 재배포 후 확인:' -ForegroundColor Green
  Write-Host "  .\scripts\verify-billing-ready.ps1"
  Write-Host "  $AppBaseUrl/health"
} finally {
  Pop-Location
}
