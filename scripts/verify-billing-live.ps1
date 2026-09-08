# 실결제(live) 연결 여부 확인
$ErrorActionPreference = 'Stop'
$ConfigUrl = 'https://naver-smartstore-review-reply-production.up.railway.app/api/billing/config'
$maxTries = 24
$delaySec = 10

Write-Host "Checking $ConfigUrl ..."

for ($i = 1; $i -le $maxTries; $i++) {
  try {
    $r = Invoke-RestMethod -Uri $ConfigUrl -TimeoutSec 30
    $ck = [string]$r.clientKey
    $prefix = if ($ck.Length -ge 8) { $ck.Substring(0, 8) + '…' } else { $ck }
    Write-Host ("try {0}/{1} mock={2} ready={3} liveMode={4} key={5}" -f $i, $maxTries, $r.mockMode, $r.productionReady, $r.liveMode, $prefix)
    if ($r.mockMode -eq $false -and $r.productionReady -eq $true -and $r.liveMode -eq $true) {
      Write-Host 'OK: Live Toss billing is active.' -ForegroundColor Green
      exit 0
    }
  } catch {
    Write-Host ("try {0}/{1} error: {2}" -f $i, $maxTries, $_.Exception.Message) -ForegroundColor Yellow
  }
  Start-Sleep -Seconds $delaySec
}

Write-Host 'FAIL: liveMode not true. Put live_ck_/live_sk_ in Railway (.\scripts\enable-toss-live.ps1)' -ForegroundColor Red
exit 1
