# 스마트스토어 답글 도우미

네이버 스마트스토어 **리뷰·상품문의** 답글을 AI로 만들고 판매자센터에 올리는 Chrome 확장 (Manifest V3).

**현재 버전:** 1.3.31 (베타)

## Chrome Web Store (비공개)

1. Railway에 `server/` 재배포 → `privacy.html` 확인  
   https://naver-smartstore-review-reply-production.up.railway.app/privacy.html
2. `scripts/package-store.ps1` → `store/dist/naver-smartstore-reply-store.zip`
3. 등록 절차·심사 문구: `store/WEBSTORE-SUBMIT.txt`

## 베타 테스트 (지인 배포)

1. `scripts/package-beta.ps1` 실행 → `beta/dist/naver-smartstore-reply-beta.zip` 생성
2. ZIP 압축 해제 후 `chrome://extensions` → 개발자 모드 → 폴더 로드
3. **[계정]** 탭 로그인 → **테스트 결제**(구독)
4. 설명서: `beta/지인용-설치안내.txt`, `beta/사용설명서.txt`

베타 ZIP에는 `beta/config.js`가 포함되어 **API 키 입력이 필요 없습니다** (Railway 서버 연동).

## 사용 흐름 (요약)

```
[답변 스타일 설정]  →  말투(프롬프트) 선택
        ↓
[답변할 댓글 가져오기]  →  판매자센터/엑셀
        ↓
[답글 만들기]  →  AI 생성 · 검토 · 채우기 준비
        ↓
판매자센터  →  자동 입력 또는 한 번에 올리기
```

리뷰·상품문의 탭 모두 동일한 구조입니다.

## 로컬 개발

1. `config.example.js` → `config.js` (Gemini 키 또는 `API_BASE_URL`)
2. `chrome://extensions` → 개발자 모드 → 이 폴더 로드
3. 서버: `cd server && npm install && npm start`

## 문서

| 파일 | 대상 |
|------|------|
| `beta/지인용-설치안내.txt` | 베타 테스터 (짧은 안내) |
| `beta/사용설명서.txt` | 베타 테스터 (상세 설명) |
| `beta/INSTALL.txt` | 설치·패키징 (기술) |

## 저장소

https://github.com/Dodam09/naver-smartstore-review-reply
