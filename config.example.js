// config.example.js → config.js 로 복사 후 API 키를 입력하세요.
const CONFIG = {
  GEMINI_API_KEY: 'AIzaYOUR_GEMINI_API_KEY_HERE',
  GEMINI_MODEL: 'gemini-2.5-flash',
  STORAGE_KEY: 'smartstoreReviewReplies',
  DRAFT_KEY: 'smartstoreReviewDraft',
  APPLY_ENABLED_KEY: 'smartstoreReviewApplyEnabled',
  PROGRESS_KEY: 'smartstoreReviewJobProgress',
  PARSE_CACHE_KEY: 'smartstoreReviewParseCache',
  SETTINGS_KEY: 'smartstoreReviewSettings',
  // (선택) Network > search(200) > Headers > Request URL 전체
  REVIEW_SEARCH_URL: '',
  // (선택) Network > 답글 등록 요청 > Headers > Request URL
  REVIEW_SUBMIT_URL: '',
  REVIEW_SUBMIT_ID_KEY: 'reviewId',
  REVIEW_SUBMIT_COMMENT_KEY: 'commentContent',
};
