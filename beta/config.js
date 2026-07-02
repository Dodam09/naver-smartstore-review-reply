// 베타/배포용 — 프로젝트 루트의 config.js 로 복사해서 사용하세요.
// Gemini 키 없음. Railway 서버 + [설정] 가입/로그인으로 사용합니다.
if (!globalThis.CONFIG) {
  globalThis.CONFIG = {
    GEMINI_MODEL: 'gemini-2.5-flash',
    API_BASE_URL: 'https://naver-smartstore-review-reply-production.up.railway.app',
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
