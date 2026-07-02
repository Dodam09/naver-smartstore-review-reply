// config.example.js → config.js 로 복사 후 API 키를 입력하세요.
if (!globalThis.CONFIG) {
  globalThis.CONFIG = {
  GEMINI_API_KEY: 'AIzaYOUR_GEMINI_API_KEY_HERE',
  GEMINI_MODEL: 'gemini-2.5-flash',
  // 서버 프록시 (설정 시 확장은 Gemini 키 없이 서버만 호출)
  // 로컬: http://127.0.0.1:8787
  // Railway (베타): https://naver-smartstore-review-reply-production.up.railway.app
  // 배포용 config: beta/config.js 참고
  API_BASE_URL: 'http://127.0.0.1:8787',
  API_DEV_SECRET: 'dev-change-me',
  AUTH_STORAGE_KEY: 'smartstoreAuthSession',
  STORAGE_KEY: 'smartstoreReviewReplies',
  DRAFT_KEY: 'smartstoreReviewDraft',
  APPLY_ENABLED_KEY: 'smartstoreReviewApplyEnabled',
  PROGRESS_KEY: 'smartstoreReviewJobProgress',
  PARSE_CACHE_KEY: 'smartstoreReviewParseCache',
  SETTINGS_KEY: 'smartstoreReviewSettings',
  // (선택) Network > search(200) > Headers > Request URL 전체
  REVIEW_SEARCH_URL: '',
  // (선택) Network > 리뷰 상세(클릭) > Request URL. {id} 자리에 리뷰번호
  REVIEW_DETAIL_URL: '',
  // (선택) Network > 답글 등록 요청 > Headers > Request URL
  REVIEW_SUBMIT_URL: '',
  REVIEW_SUBMIT_ID_KEY: 'reviewId',
  REVIEW_SUBMIT_COMMENT_KEY: 'commentContent',
  INQUIRY_STORAGE_KEY: 'smartstoreInquiryReplies',
  INQUIRY_APPLY_ENABLED_KEY: 'smartstoreInquiryApplyEnabled',
  INQUIRY_PROGRESS_KEY: 'smartstoreInquiryJobProgress',
  INQUIRY_PARSE_CACHE_KEY: 'smartstoreInquiryParseCache',
  INQUIRY_DRAFT_KEY: 'smartstoreInquiryDraft',
  INQUIRY_REFERENCE_CACHE_KEY: 'smartstoreInquiryReferenceCache',
  // (선택) Network > 상품문의 목록 > Request URL (쿼리 제외)
  INQUIRY_LIST_URL: '',
  // inquiryUseReference, inquiryReferenceDays, reviewLookupDays, inquiryLookupDays
  // 참고 답변 선택(selectedIds)은 INQUIRY_REFERENCE_CACHE_KEY 캐시에 저장됩니다.
  // 아래 inquiry* 설정은 popup에서 자동 저장됩니다 (리뷰와 별도):
  // inquirySystemPrompt, inquiryTonePresetId, inquiryCustomPresets,
  // inquirySampleReplies, inquirySampleFlow
  };
}
var CONFIG = globalThis.CONFIG;
