/**
 * 판매자센터 조회 기간 (미답변·등록 답변·참고 문의 공용)
 */
(function (global) {
  if (global.__ssLookupDaysLoaded) return;
  global.__ssLookupDaysLoaded = true;

  const LOOKUP_PERIOD_SHORT = [
    { value: 0, label: '당일' },
    { value: 1, label: '2일' },
    { value: 2, label: '3일' },
    { value: 7, label: '1주일' },
  ];

  const LOOKUP_PERIOD_LONG = [
    { value: 14, label: '2주일' },
    { value: 30, label: '1개월' },
    { value: 90, label: '3개월' },
  ];

  function clampLookupDays(days, options = {}) {
    const min = options.min ?? 0;
    const max = options.max ?? 365;
    const n = Number(days);
    if (!Number.isFinite(n)) return options.fallback ?? 7;
    return Math.max(min, Math.min(max, Math.floor(n)));
  }

  function formatLookupDaysLabel(days) {
    const d = clampLookupDays(days);
    const preset = [...LOOKUP_PERIOD_SHORT, ...LOOKUP_PERIOD_LONG].find((o) => o.value === d);
    if (preset) return preset.label;
    if (d === 0) return '당일';
    return `최근 ${d}일`;
  }

  function getLookupPeriodOptions(includeLong = true) {
    return includeLong ? [...LOOKUP_PERIOD_SHORT, ...LOOKUP_PERIOD_LONG] : [...LOOKUP_PERIOD_SHORT];
  }

  function renderLookupDayOptions(selectEl, options = {}) {
    if (!selectEl) return;
    const includeLong = options.includeLong !== false;
    const selected = clampLookupDays(options.selected ?? 7, {
      min: 0,
      max: includeLong ? 365 : 7,
      fallback: 7,
    });
    const list = getLookupPeriodOptions(includeLong);

    selectEl.innerHTML = '';
    for (const item of list) {
      const opt = document.createElement('option');
      opt.value = String(item.value);
      opt.textContent = item.label;
      selectEl.appendChild(opt);
    }
    selectEl.value = String(list.some((o) => o.value === selected) ? selected : 7);
  }

  function formatKstIsoDate(date, endOfDay) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);

    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    const time = endOfDay ? '23:59:59.999' : '00:00:00.000';
    return `${y}-${m}-${d}T${time}+09:00`;
  }

  /** 상품문의 목록 API용 기간 (days=0 → 당일만) */
  function buildInquiryLookupDateRange(days) {
    const clamped = clampLookupDays(days, { min: 0, max: 365, fallback: 7 });
    const now = new Date();

    if (clamped === 0) {
      return {
        startDate: formatKstIsoDate(now, false),
        endDate: formatKstIsoDate(now, true),
      };
    }

    const from = new Date(now);
    from.setDate(from.getDate() - clamped);
    return {
      startDate: formatKstIsoDate(from, false),
      endDate: formatKstIsoDate(now, true),
    };
  }

  global.clampLookupDays = clampLookupDays;
  global.formatLookupDaysLabel = formatLookupDaysLabel;
  global.getLookupPeriodOptions = getLookupPeriodOptions;
  global.renderLookupDayOptions = renderLookupDayOptions;
  global.formatKstIsoDate = formatKstIsoDate;
  global.buildInquiryLookupDateRange = buildInquiryLookupDateRange;
  global.LOOKUP_PERIOD_SHORT = LOOKUP_PERIOD_SHORT;
  global.LOOKUP_PERIOD_LONG = LOOKUP_PERIOD_LONG;
})(globalThis);
