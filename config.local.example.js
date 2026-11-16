/**
 * 로컬 언팩 확장 전용 API 오버레이 예시.
 * 사용: 이 파일을 config.local.js 로 복사한 뒤 LOCAL_API_OVERRIDE_ENABLED 만 조정.
 * - 기본값: 비활성 (운영 Railway URL 유지)
 * - store/ · beta/ 패키지에는 이 파일을 넣지 않습니다 (패키저가 no-op stub 주입).
 */
(function applyLocalConfigOverlay() {
  if (!globalThis.CONFIG) return;

  const LOCAL_API_OVERRIDE_ENABLED = false;
  const LOCAL_API_BASE_URL = 'http://127.0.0.1:8787';

  if (!LOCAL_API_OVERRIDE_ENABLED) {
    globalThis.CONFIG.__LOCAL_API_OVERRIDE__ = false;
    return;
  }

  globalThis.CONFIG.API_BASE_URL = LOCAL_API_BASE_URL;
  globalThis.CONFIG.__LOCAL_API_OVERRIDE__ = true;
  if (!globalThis.CONFIG.AUTH_STORAGE_KEY) {
    globalThis.CONFIG.AUTH_STORAGE_KEY = 'smartstoreAuthSession';
  }
})();
