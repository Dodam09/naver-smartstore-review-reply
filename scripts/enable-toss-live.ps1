# Railway에 토스 라이브(실결제) 키를 넣습니다.
# 사용 전: npx @railway/cli login
# 실행:   .\scripts\enable-toss-live.ps1
# 키는 채팅에 붙이지 마세요.

$ErrorActionPreference = 'Stop'
$AppBaseUrl = 'https://naver-smartstore-review-reply-production.up.railway.app'
$ServerDir = Join-Path $PSScriptRoot '..\server' | Resolve-Path

Write-Host ''
Write-Host '=== 토스 실결제(live) Railway 연결 ===' -ForegroundColor Cyan
Write-Host "APP_BASE_URL = $AppBaseUrl"
Write-Host '필수: live_ck_... / live_sk_...  (자동결제 빌링 탭)'
Write-Host '주의: test 키로 등록한 빌링키는 live에서 동작하지 않습니다. 재구독이 필요할 수 있습니다.'
Write-Host ''

Push-Location $ServerDir
try {
  $who = npx --yes @railway/cli whoami 2>&1
  if ($LASTEXITCODE -ne 0 -or "$who" -match 'Unauthorized') {
    Write-Host 'Railway 로그인이 필요합니다. 브라우저가 열리면 로그인하세요.' -ForegroundColor Yellow
    npx --yes @railway/cli login
  }

  $clientKey = Read-Host 'TOSS_CLIENT_KEY (live_ck_)'
  $secretKey = Read-Host 'TOSS_SECRET_KEY (live_sk_)'
  if (-not $clientKey -or -not $secretKey) {
    throw 'TOSS_CLIENT_KEY / TOSS_SECRET_KEY 가 비어 있습니다.'
  }
  if ($clientKey -notmatch '^live_ck_' -or $secretKey -notmatch '^live_sk_') {
    throw '실결제는 live_ck_ / live_sk_ 만 허용합니다. (test_ 키는 enable-toss-billing.ps1 사용)'
  }

  Write-Host 'Variables 설정 중…'
  npx --yes @railway/cli variables --set "BILLING_MOCK=false"
  npx --yes @railway/cli variables --set "APP_BASE_URL=$AppBaseUrl"
  npx --yes @railway/cli variables --set "TOSS_CLIENT_KEY=$clientKey"
  npx --yes @railway/cli variables --set "TOSS_SECRET_KEY=$secretKey"

  Write-Host ''
  Write-Host '설정 완료. 재배포 후 확인:' -ForegroundColor Green
  Write-Host "  .\scripts\verify-billing-live.ps1"
} finally {
  Pop-Location
}
