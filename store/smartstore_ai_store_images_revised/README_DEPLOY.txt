스마트스토어 AI 자동답글 랜딩페이지
===================================

구성
- public/index.html : 반응형 랜딩페이지 1개 파일 (CSS/JS 포함)

주요 연결 주소
- Chrome 웹스토어: https://chromewebstore.google.com/detail/mlofjmlcjmobjphnafajiiomfcnnkblj
- 개인정보 처리방침: https://naver-smartstore-review-reply-production.up.railway.app/privacy
- 구독·결제 안내: https://naver-smartstore-review-reply-production.up.railway.app/billing-terms.html
- 결제 안내: https://naver-smartstore-review-reply-production.up.railway.app/billing.html

중요: 이 파일은 정적 랜딩페이지 소스이며 Railway에 자동 배포된 상태가 아닙니다.
현재 운영 중인 서버 코드/결제/로그인/API/DB를 수정하지 말고 별도 브랜치 또는 복사본에서 작업하세요.

Express 서버에 연결하는 예시 (기존 프로젝트 구조를 확인한 뒤 적용)
1. public 폴더를 서버 프로젝트에 추가합니다.
2. 기존 API 라우트, 로그인, 결제, /health 등을 그대로 둡니다.
3. 기존 404 처리보다 앞에 다음 루트 라우트를 추가합니다.

CommonJS:
  const path = require('path');
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

ES Modules:
  import path from 'node:path';
  import { fileURLToPath } from 'node:url';
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

주의:
- 위 코드를 그대로 붙이기 전에 현재 서버가 CommonJS인지 ES Modules인지 확인해야 합니다.
- 기존 app.get('/') 또는 catch-all 라우트와 충돌하지 않게 해야 합니다.
- 루트 GET 요청만 랜딩페이지를 반환해야 합니다. /api/*, /health, /privacy, /billing*, webhook 및 기타 기존 경로를 덮어쓰지 마세요.
- 기존 privacy, billing-terms, billing 페이지 경로가 실제로 정상 응답하는지 배포 전에 확인하세요.
- 배포 전 별도 테스트 환경에서 PC/모바일, CTA 링크, FAQ, 기존 API/로그인/결제 경로를 확인하세요.
- 검토 전에 광고를 재개하지 마세요.

검수 메모
- 요금제/무료 체험/사업자 정보는 사용자가 제공한 광고 브리프 기준으로 작성했습니다.
- 네이버 공식 제휴·인증을 주장하지 않습니다.
- 완전 무인 자동 게시를 주장하지 않습니다.
- 제품 시연 카드는 설명용 UI 예시이며 실제 확장 프로그램 스크린샷을 가장하지 않습니다.
- 실제 배포 직전 사업자 정보와 약관 내용이 최신인지, 모든 링크가 정상인지 확인하세요.
