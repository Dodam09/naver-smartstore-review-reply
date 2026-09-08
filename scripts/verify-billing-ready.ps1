# 토스 결제 연결 여부(/health)를 확인합니다.
# 실행: .\scripts\verify-billing-ready.ps1

$ErrorActionPreference = 'Stop'
$HealthUrl = 'https://naver-smartstore-review-reply-production.up.railway.app/health'
$maxTries = 24
$delaySec = 10

Write-Host "Checking $HealthUrl ..."

for ($i = 1; $i -le $maxTries; $i++) {
  try {
    $r = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 30
    $b = $r.billing
    $line = "try $i/$maxTries  mockMode=$($b.mockMode) tossConfigured=$($b.tossConfigured) productionReady=$($b.productionReady)"
    Write-Host $line
    if ($b.mockMode -eq $false -and $b.tossConfigured -eq $true -and $b.productionReady -eq $true) {
      Write-Host 'OK: Toss billing is live (productionReady).' -ForegroundColor Green
      exit 0
    }
  } catch {
    Write-Host "try $i/$maxTries  error: $($_.Exception.Message)" -ForegroundColor Yellow
  }
  Start-Sleep -Seconds $delaySec
}

Write-Host 'FAIL: productionReady not true yet. Set Railway vars with .\scripts\enable-toss-billing.ps1' -ForegroundColor Red
exit 1
