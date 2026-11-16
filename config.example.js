// config.example.js → config.js 로 복사하세요.
// Gemini 비밀키는 확장에 넣지 마세요. 서버 server/.env 의 GEMINI_API_KEY 만 사용합니다.
if (!globalThis.CONFIG) {
  globalThis.CONFIG = {
    GEMINI_MODEL: 'gemini-2.5-flash',
    // 서버 프록시 (필수) — 확장은 이 URL만 호출합니다.
    // 로컬 E2E: config.local.js 에서 LOCAL_API_OVERRIDE_ENABLED=true
    // Railway: https://naver-smartstore-review-reply-production.up.railway.app
    API_BASE_URL: 'https://naver-smartstore-review-reply-production.up.railway.app',
    // 로컬 개발용(선택). 운영 빌드에는 넣지 마세요.
    // API_DEV_SECRET: 'dev-change-me',
    AUTH_STORAGE_KEY: 'smartstoreAuthSession',
    STORAGE_KEY: 'smartstoreReviewReplies',
    DRAFT_KEY: 'smartstoreReviewDraft',
    APPLY_ENABLED_KEY: 'smartstoreReviewApplyEnabled',
    PROGRESS_KEY: 'smartstoreReviewJobProgress',
    PARSE_CACHE_KEY: 'smartstoreReviewParseCache',
    SETTINGS_KEY: 'smartstoreReviewSettings',
    REVIEW_SEARCH_URL: '',
    REVIEW_DETAIL_URL: '',
    REVIEW_SUBMIT_URL: '',
    REVIEW_SUBMIT_ID_KEY: 'reviewId',
    REVIEW_SUBMIT_COMMENT_KEY: 'commentContent',
    INQUIRY_STORAGE_KEY: 'smartstoreInquiryReplies',
    INQUIRY_APPLY_ENABLED_KEY: 'smartstoreInquiryApplyEnabled',
    INQUIRY_PROGRESS_KEY: 'smartstoreInquiryJobProgress',
    INQUIRY_PARSE_CACHE_KEY: 'smartstoreInquiryParseCache',
    INQUIRY_DRAFT_KEY: 'smartstoreInquiryDraft',
    INQUIRY_REFERENCE_CACHE_KEY: 'smartstoreInquiryReferenceCache',
    INQUIRY_LIST_URL: '',
  };
}
var CONFIG = globalThis.CONFIG;
