/**
 * 응대/말투 지침을 의미 단위 항목으로 파싱·편집·직렬화
 */

let guidelineEditorStylesReady = false;

function ensureGuidelineEditorStyles() {
  if (guidelineEditorStylesReady) return;
  if (typeof document === 'undefined') return;
  if (document.getElementById('guideline-items-editor-style')) {
    guidelineEditorStylesReady = true;
    return;
  }
  const style = document.createElement('style');
  style.id = 'guideline-items-editor-style';
  style.textContent = `
.guideline-items-editor { display:flex; flex-direction:column; gap:10px; }
.guideline-items-toolbar { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.guideline-items-count { font-size:12px; color:#64748b; font-weight:600; }
.guideline-add-btn {
  border:1px solid #bfdbfe; background:#eff6ff; color:#1d4ed8;
  border-radius:8px; padding:7px 10px; font-size:12px; font-weight:700; cursor:pointer;
}
.guideline-add-btn:hover { background:#dbeafe; }
.guideline-items-list { display:flex; flex-direction:column; gap:12px; max-height:min(52vh, 420px); overflow:auto; padding-right:2px; }
.guideline-empty {
  padding:16px; border:1px dashed #cbd5e1; border-radius:10px; color:#64748b; font-size:13px; text-align:center;
}
.guideline-group { display:flex; flex-direction:column; gap:8px; }
.guideline-group-title {
  font-size:12px; font-weight:800; color:#334155; letter-spacing:-0.01em;
  padding:2px 2px;
}
.guideline-group-items { display:flex; flex-direction:column; gap:8px; }
.guideline-item {
  display:flex; flex-direction:column; gap:8px;
  padding:10px; border:1px solid #e2e8f0; border-radius:12px; background:#f8fafc;
}
.guideline-item-text {
  width:100%; box-sizing:border-box; min-height:54px; resize:vertical;
  border:1px solid #cbd5e1; border-radius:8px; padding:8px 10px;
  font:inherit; font-size:13px; line-height:1.5; background:#fff; color:#0f172a;
}
.guideline-item-text:focus { outline:none; border-color:#2563eb; box-shadow:0 0 0 2px rgba(37,99,235,.15); }
.guideline-item-actions { display:flex; gap:8px; align-items:center; justify-content:space-between; }
.guideline-item-category {
  flex:1; min-width:0; height:34px; border:1px solid #cbd5e1; border-radius:8px;
  padding:0 8px; font-size:12px; background:#fff;
}
.guideline-item-delete {
  border:1px solid #fecaca; background:#fff; color:#b91c1c;
  border-radius:8px; padding:7px 10px; font-size:12px; font-weight:700; cursor:pointer; white-space:nowrap;
}
.guideline-item-delete:hover { background:#fef2f2; }
.guideline-source-textarea[hidden] { display:none !important; }
.learned-prompt-editor .guideline-items-host { margin-top:4px; }
.ss-style-guideline-host .guideline-items-list { max-height:min(48vh, 380px); }
.ss-style-guideline-host .guideline-item { background:#eff6ff; border-color:#bfdbfe; }
`;
  document.head.appendChild(style);
  guidelineEditorStylesReady = true;
}

const GUIDELINE_CATEGORIES = [
  { id: 'tone', label: '말투·표현', patterns: [/말투/, /존댓/, /반말/, /이모지/, /종결/, /해요체/, /합니다체/, /감사/, /인사/, /표현/, /문장\s*길이/, /짧게/, /길게/] },
  { id: 'policy', label: '응대 원칙', patterns: [/사과/, /죄송/, /취소/, /반품/, /환불/, /병원/, /고객센터/, /넘기/, /제안하지/, /하지\s*말/, /먼저\s*꺼/, /공감/] },
  { id: 'answer', label: '답변 방식', patterns: [/질문/, /구체/, /복붙/, /사실/, /지어내/, /확인/, /상세페이지/, /바로\s*답/, /조건/, /참고/, /과거/] },
  { id: 'product', label: '상품·안내', patterns: [/보관/, /냉장/, /배송/, /사용법/, /급여/, /성분/, /원료/, /용량/, /호환/, /대상/, /품질/, /출고/, /일정/, /브랜드/] },
  { id: 'other', label: '기타', patterns: [] },
];

const GUIDELINE_CATEGORY_BY_LABEL = (() => {
  const map = new Map();
  for (const cat of GUIDELINE_CATEGORIES) {
    map.set(cat.label, cat.id);
    map.set(cat.id, cat.id);
    map.set(`[${cat.label}]`, cat.id);
  }
  map.set('말투', 'tone');
  map.set('응대원칙', 'policy');
  map.set('응대 원칙', 'policy');
  map.set('답변방식', 'answer');
  map.set('답변 방식', 'answer');
  map.set('상품안내', 'product');
  map.set('상품 안내', 'product');
  map.set('상품·안내', 'product');
  return map;
})();

function createGuidelineItemId() {
  return `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function escapeGuidelineHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function detectGuidelineCategory(text) {
  const raw = String(text || '');
  for (const cat of GUIDELINE_CATEGORIES) {
    if (cat.id === 'other') continue;
    if (cat.patterns.some((re) => re.test(raw))) return cat.id;
  }
  return 'other';
}

function getGuidelineCategoryLabel(categoryId) {
  return GUIDELINE_CATEGORIES.find((c) => c.id === categoryId)?.label || '기타';
}

function stripGuidelineBullet(line) {
  return String(line || '')
    .replace(/^[\s>*]*[-•*·▪▸]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .trim();
}

function parseTaggedGuidelineLine(line) {
  const raw = stripGuidelineBullet(line);
  const tagged = raw.match(/^\[([^\]]+)\]\s*(.+)$/);
  if (tagged) {
    const key = tagged[1].trim();
    const body = stripGuidelineBullet(tagged[2]);
    const category = GUIDELINE_CATEGORY_BY_LABEL.get(key) || detectGuidelineCategory(body);
    return { text: body, category };
  }
  const headerOnly = raw.match(/^\[([^\]]+)\]\s*$/);
  if (headerOnly) {
    const category = GUIDELINE_CATEGORY_BY_LABEL.get(headerOnly[1].trim());
    return category ? { header: category } : null;
  }
  return { text: raw, category: detectGuidelineCategory(raw) };
}

function splitLongGuidelineSentence(chunk) {
  const text = String(chunk || '').trim();
  if (!text) return [];
  if (text.length < 70) return [text];

  const parts = text
    .split(/(?<=(?:다|요|음|죠|까|다요|습니다|세요|해요|예요|이에요)[.!?。])\s+|(?<=[.!?。])\s+(?=[가-힣A-Za-z([0-9])/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 6);

  if (parts.length >= 2) return parts;

  const byBreak = text
    .split(/\s*[;|/]\s*/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 8);
  return byBreak.length >= 2 ? byBreak : [text];
}

function parseGuidelineItems(text) {
  const raw = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return [];

  const lines = raw
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const items = [];
  let pendingCategory = null;

  const pushText = (value, categoryHint) => {
    for (const chunk of splitLongGuidelineSentence(value)) {
      const textValue = chunk.trim();
      if (!textValue || textValue.length < 2) continue;
      items.push({
        id: createGuidelineItemId(),
        text: textValue,
        category: categoryHint || detectGuidelineCategory(textValue),
      });
    }
  };

  if (lines.length >= 2) {
    for (const line of lines) {
      const parsed = parseTaggedGuidelineLine(line);
      if (!parsed) continue;
      if (parsed.header) {
        pendingCategory = parsed.header;
        continue;
      }
      pushText(parsed.text, pendingCategory || parsed.category);
      pendingCategory = null;
    }
  } else {
    pushText(raw);
  }

  return items;
}

function serializeGuidelineItems(items) {
  const list = (Array.isArray(items) ? items : [])
    .map((item) => ({
      text: String(item?.text || '').trim(),
      category: item?.category || detectGuidelineCategory(item?.text),
    }))
    .filter((item) => item.text);

  if (!list.length) return '';

  const lines = [];
  for (const cat of GUIDELINE_CATEGORIES) {
    const group = list.filter((item) => item.category === cat.id);
    if (!group.length) continue;
    lines.push(`[${cat.label}]`);
    for (const item of group) {
      lines.push(`- ${item.text}`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

function normalizeEditorItems(next) {
  return (Array.isArray(next) ? next : [])
    .map((item) => ({
      id: item?.id || createGuidelineItemId(),
      text: String(item?.text || '').trim(),
      category: item?.category || detectGuidelineCategory(item?.text),
      _categoryTouched: !!item?._categoryTouched,
    }))
    .filter((item) => item.text || item.id);
}

function groupGuidelineItems(items) {
  const list = Array.isArray(items) ? items : [];
  return GUIDELINE_CATEGORIES.map((cat) => ({
    id: cat.id,
    label: cat.label,
    items: list.filter((item) => (item.category || 'other') === cat.id),
  })).filter((group) => group.items.length > 0);
}

function mountGuidelineItemsEditor(container, options = {}) {
  if (!container) {
    return {
      getItems: () => [],
      setItems: () => {},
      getSerialized: () => '',
      destroy: () => {},
    };
  }

  ensureGuidelineEditorStyles();
  let items = normalizeEditorItems(options.items || parseGuidelineItems(options.text || ''));
  const onChange = typeof options.onChange === 'function' ? options.onChange : null;
  const emptyText = options.emptyText || '지침이 없습니다. 아래에서 추가해 주세요.';

  container.classList.add('guideline-items-editor');
  container.innerHTML = '';

  const toolbar = document.createElement('div');
  toolbar.className = 'guideline-items-toolbar';
  toolbar.innerHTML = `
    <span class="guideline-items-count"></span>
    <button type="button" class="guideline-add-btn" data-action="add">+ 지침 추가</button>
  `;
  container.appendChild(toolbar);

  const listEl = document.createElement('div');
  listEl.className = 'guideline-items-list';
  container.appendChild(listEl);

  const countEl = toolbar.querySelector('.guideline-items-count');

  function emitChange() {
    if (onChange) onChange(items.slice());
  }

  function render() {
    const visible = items.filter((item) => String(item.text || '').trim() || true);
    countEl.textContent = `${items.filter((i) => String(i.text || '').trim()).length}개 지침`;

    if (!visible.length) {
      listEl.innerHTML = `<div class="guideline-empty">${escapeGuidelineHtml(emptyText)}</div>`;
      return;
    }

    const groups = GUIDELINE_CATEGORIES.map((cat) => ({
      ...cat,
      items: items.filter((item) => (item.category || 'other') === cat.id),
    })).filter((group) => group.items.length);

    listEl.innerHTML = groups
      .map(
        (group) => `
      <section class="guideline-group" data-category="${escapeGuidelineHtml(group.id)}">
        <div class="guideline-group-title">${escapeGuidelineHtml(group.label)}</div>
        <div class="guideline-group-items">
          ${group.items
            .map(
              (item) => `
            <article class="guideline-item" data-id="${escapeGuidelineHtml(item.id)}">
              <textarea class="guideline-item-text" rows="2" data-id="${escapeGuidelineHtml(item.id)}" placeholder="지침 내용">${escapeGuidelineHtml(item.text)}</textarea>
              <div class="guideline-item-actions">
                <select class="guideline-item-category" data-id="${escapeGuidelineHtml(item.id)}" aria-label="분류">
                  ${GUIDELINE_CATEGORIES.map(
                    (cat) =>
                      `<option value="${escapeGuidelineHtml(cat.id)}" ${
                        cat.id === (item.category || 'other') ? 'selected' : ''
                      }>${escapeGuidelineHtml(cat.label)}</option>`
                  ).join('')}
                </select>
                <button type="button" class="guideline-item-delete" data-action="delete" data-id="${escapeGuidelineHtml(
                  item.id
                )}" title="삭제">삭제</button>
              </div>
            </article>`
            )
            .join('')}
        </div>
      </section>`
      )
      .join('');

    listEl.querySelectorAll('.guideline-item-text').forEach((textarea) => {
      textarea.addEventListener('input', () => {
        const id = textarea.dataset.id;
        const target = items.find((item) => item.id === id);
        if (!target) return;
        target.text = textarea.value;
        emitChange();
        countEl.textContent = `${items.filter((i) => String(i.text || '').trim()).length}개 지침`;
      });
      textarea.addEventListener('blur', () => {
        const id = textarea.dataset.id;
        const target = items.find((item) => item.id === id);
        if (!target) return;
        const next = textarea.value.trim();
        if (!next) {
          items = items.filter((item) => item.id !== id);
          render();
          emitChange();
          return;
        }
        if (target.text !== next) {
          target.text = next;
          emitChange();
        }
        const detected = detectGuidelineCategory(next);
        if (!target._categoryTouched && target.category !== detected) {
          target.category = detected;
          render();
          emitChange();
        }
      });
    });

    listEl.querySelectorAll('.guideline-item-category').forEach((select) => {
      select.addEventListener('change', () => {
        const id = select.dataset.id;
        const target = items.find((item) => item.id === id);
        if (!target) return;
        target.category = select.value;
        target._categoryTouched = true;
        render();
        emitChange();
      });
    });

    listEl.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        items = items.filter((item) => item.id !== btn.dataset.id);
        render();
        emitChange();
      });
    });
  }

  toolbar.querySelector('[data-action="add"]').addEventListener('click', () => {
    const id = createGuidelineItemId();
    items.push({
      id,
      text: '',
      category: 'other',
      _categoryTouched: true,
    });
    render();
    const focusEl = listEl.querySelector(`.guideline-item-text[data-id="${id}"]`);
    if (focusEl) focusEl.focus();
  });

  render();

  return {
    getItems() {
      return items
        .map((item) => ({
          id: item.id,
          text: String(item.text || '').trim(),
          category: item.category || 'other',
        }))
        .filter((item) => item.text);
    },
    setItems(nextItems) {
      items = normalizeEditorItems(nextItems);
      render();
    },
    setFromText(text) {
      items = normalizeEditorItems(parseGuidelineItems(text));
      render();
    },
    getSerialized() {
      return serializeGuidelineItems(this.getItems());
    },
    destroy() {
      container.innerHTML = '';
    },
  };
}

const boundGuidelineEditors = new WeakMap();

function bindGuidelineEditorToTextarea(textarea, options = {}) {
  if (!textarea) return null;
  const existing = boundGuidelineEditors.get(textarea);
  if (existing) {
    existing.refreshFromTextarea();
    return existing;
  }

  textarea.classList.add('guideline-source-textarea');
  textarea.setAttribute('hidden', '');
  textarea.setAttribute('aria-hidden', 'true');

  const host = document.createElement('div');
  host.className = 'guideline-items-host';
  textarea.insertAdjacentElement('afterend', host);

  let suppressEmit = false;
  const api = mountGuidelineItemsEditor(host, {
    items: parseGuidelineItems(textarea.value),
    emptyText: options.emptyText,
    onChange(nextItems) {
      if (suppressEmit) return;
      const next = serializeGuidelineItems(nextItems);
      if (textarea.value === next) return;
      suppressEmit = true;
      textarea.value = next;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      suppressEmit = false;
    },
  });

  const binding = {
    api,
    refreshFromTextarea() {
      if (suppressEmit) return;
      suppressEmit = true;
      api.setFromText(textarea.value);
      suppressEmit = false;
    },
    destroy() {
      api.destroy();
      host.remove();
      textarea.classList.remove('guideline-source-textarea');
      textarea.removeAttribute('hidden');
      textarea.removeAttribute('aria-hidden');
      boundGuidelineEditors.delete(textarea);
    },
  };

  boundGuidelineEditors.set(textarea, binding);
  return binding;
}

function refreshBoundGuidelineEditor(textarea) {
  const binding = boundGuidelineEditors.get(textarea);
  if (binding) binding.refreshFromTextarea();
  else bindGuidelineEditorToTextarea(textarea);
}
