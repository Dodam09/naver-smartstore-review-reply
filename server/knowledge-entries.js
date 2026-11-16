/**
 * 통합 AI 지식 목록·요약·필드 단위 수정/삭제 (3-4).
 * entryId: product:{no}:{field} | policy:{field} | faq:{id} | pending:{id}
 */

import {
  PRODUCT_META_FIELDS,
  POLICY_META_FIELDS,
  canUseAsVerifiedFact,
  fieldCanUseAsFact,
  getFieldMetaEntry,
  isKnowledgeEffective,
  normalizeSource,
  resolveTrustStatus,
} from './knowledge-meta.js';
import {
  PRODUCT_FIELD_COLUMNS,
  POLICY_FIELD_COLUMNS,
  checkKbLinkSync,
  clearProductKnowledgeField,
  clearStorePolicyField,
  deleteInquiryConfirmation,
  dismissInquiryConfirmation,
  getInquiryConfirmation,
  getProductKnowledge,
  getStorePolicies,
  listInquiryConfirmations,
  listProductKnowledge,
  productFieldValue,
  policyFieldValue,
  setProductKnowledgeField,
  setStorePolicyField,
  updateApprovedFaq,
} from './db.js';

const PRODUCT_FIELD_LABELS = Object.freeze({
  product_name: '상품명',
  detail_description: '상세설명',
  specs: '스펙·성분',
  usage: '사용법',
  options_compat: '옵션·호환',
  cautions: '주의사항',
  extra: '추가정보',
});

const POLICY_FIELD_LABELS = Object.freeze({
  shipping: '배송 정책',
  exchange_return: '교환·반품 정책',
  refund: '환불 정책',
  customer_service: '고객센터 안내',
});

export function parseKnowledgeEntryId(raw) {
  const id = decodeURIComponent(String(raw || '').trim());
  if (!id) {
    const err = new Error('entryId가 필요합니다.');
    err.code = 'BAD_ENTRY_ID';
    throw err;
  }
  const product = /^product:(\d+):([a-z_]+)$/.exec(id);
  if (product) {
    if (!PRODUCT_FIELD_COLUMNS[product[2]]) {
      const err = new Error(`알 수 없는 상품 필드: ${product[2]}`);
      err.code = 'BAD_ENTRY_ID';
      throw err;
    }
    return { entryId: id, type: 'product', productNo: product[1], field: product[2] };
  }
  const policy = /^policy:([a-z_]+)$/.exec(id);
  if (policy) {
    if (!POLICY_FIELD_COLUMNS[policy[1]]) {
      const err = new Error(`알 수 없는 정책 필드: ${policy[1]}`);
      err.code = 'BAD_ENTRY_ID';
      throw err;
    }
    return { entryId: id, type: 'policy', field: policy[1] };
  }
  const faq = /^faq:(\d+)$/.exec(id);
  if (faq) return { entryId: id, type: 'faq', confirmationId: Number(faq[1]) };
  const pending = /^pending:(\d+)$/.exec(id);
  if (pending) return { entryId: id, type: 'pending', confirmationId: Number(pending[1]) };

  const err = new Error('잘못된 entryId 형식입니다.');
  err.code = 'BAD_ENTRY_ID';
  throw err;
}

function fieldTrust(rowLike, field) {
  const entry = getFieldMetaEntry(rowLike?.fieldMeta ?? rowLike?.field_meta_json, field);
  return resolveTrustStatus({
    trustStatus: entry?.trustStatus ?? rowLike?.trustStatus ?? rowLike?.trust_status,
    source: entry?.source ?? rowLike?.source,
    verifiedAt: rowLike?.verifiedAt ?? rowLike?.verified_at,
  });
}

function fieldValidity(rowLike, field, now) {
  const entry = getFieldMetaEntry(rowLike?.fieldMeta ?? rowLike?.field_meta_json, field);
  return isKnowledgeEffective(
    {
      validFrom: entry?.validFrom ?? rowLike?.validFrom ?? rowLike?.valid_from,
      validTo: entry?.validTo ?? rowLike?.validTo ?? rowLike?.valid_to,
    },
    now
  );
}

function fieldSource(rowLike, field) {
  const entry = getFieldMetaEntry(rowLike?.fieldMeta ?? rowLike?.field_meta_json, field);
  return normalizeSource(entry?.source ?? rowLike?.sourceNormalized ?? rowLike?.source ?? 'MANUAL');
}

function buildProductEntry(product, field, now = new Date()) {
  const content = productFieldValue(product, field);
  if (!content && field !== 'product_name') return null;
  // product_name 빈 값도 목록에 안 넣음
  if (!content) return null;
  const trustStatus = fieldTrust(product, field);
  const validity = fieldValidity(product, field, now);
  const source = fieldSource(product, field);
  const entry = getFieldMetaEntry(product.fieldMeta, field);
  return {
    entryId: `product:${product.productNo}:${field}`,
    type: 'product',
    productNo: product.productNo,
    productName: product.productName || '',
    field,
    label: PRODUCT_FIELD_LABELS[field] || field,
    title: `${product.productName || product.productNo} · ${PRODUCT_FIELD_LABELS[field] || field}`,
    content,
    source,
    trustStatus,
    validFrom: entry?.validFrom ?? product.validFrom ?? null,
    validTo: entry?.validTo ?? product.validTo ?? null,
    effective: validity.effective,
    effectiveStatus: validity.effectiveStatus,
    usableAsFact: fieldCanUseAsFact(product, field, now),
    updatedAt: product.updatedAt,
    verifiedAt: product.verifiedAt,
  };
}

function buildPolicyEntry(policies, field, now = new Date()) {
  if (!policies) return null;
  const content = policyFieldValue(policies, field);
  if (!content) return null;
  const trustStatus = fieldTrust(policies, field);
  const validity = fieldValidity(policies, field, now);
  const source = fieldSource(policies, field);
  const entry = getFieldMetaEntry(policies.fieldMeta, field);
  return {
    entryId: `policy:${field}`,
    type: 'policy',
    productNo: null,
    productName: '',
    field,
    label: POLICY_FIELD_LABELS[field] || field,
    title: POLICY_FIELD_LABELS[field] || field,
    content,
    source,
    trustStatus,
    validFrom: entry?.validFrom ?? policies.validFrom ?? null,
    validTo: entry?.validTo ?? policies.validTo ?? null,
    effective: validity.effective,
    effectiveStatus: validity.effectiveStatus,
    usableAsFact: fieldCanUseAsFact(policies, field, now),
    updatedAt: policies.updatedAt,
    verifiedAt: policies.verifiedAt,
  };
}

function buildFaqEntry(faq, userId, now = new Date()) {
  if (!faq || faq.status !== 'approved') return null;
  const kbSync = checkKbLinkSync(userId, faq);
  const validity = isKnowledgeEffective(
    { validFrom: faq.validFrom, validTo: faq.validTo },
    now
  );
  return {
    entryId: `faq:${faq.id}`,
    type: 'faq',
    confirmationId: faq.id,
    productNo: faq.productNo || null,
    productName: faq.productName || '',
    field: faq.kbLink?.field || null,
    label: '승인 FAQ',
    title: (faq.question || faq.confirmPrompt || `FAQ #${faq.id}`).slice(0, 120),
    content: faq.approvedAnswer || '',
    question: faq.question || '',
    intentKey: faq.intentKey || '',
    knowledgeCategory: faq.knowledgeCategory || '',
    source: normalizeSource(faq.source || 'SELLER_APPROVED'),
    trustStatus: faq.trustStatus,
    validFrom: faq.validFrom,
    validTo: faq.validTo,
    effective: validity.effective,
    effectiveStatus: validity.effectiveStatus,
    usableAsFact: canUseAsVerifiedFact({
      trustStatus: faq.trustStatus,
      source: faq.source || 'SELLER_APPROVED',
      verifiedAt: faq.approvedAt,
      validFrom: faq.validFrom,
      validTo: faq.validTo,
      now,
    }),
    kbLink: faq.kbLink,
    kbSync,
    approvedAt: faq.approvedAt,
    updatedAt: faq.updatedAt,
  };
}

function buildPendingEntry(row) {
  if (!row || row.status !== 'needs_confirm') return null;
  return {
    entryId: `pending:${row.id}`,
    type: 'pending',
    confirmationId: row.id,
    productNo: row.productNo || null,
    productName: row.productName || '',
    field: null,
    label: '확인 필요',
    title: (row.question || `확인 #${row.id}`).slice(0, 120),
    content: row.draftReply || '',
    question: row.question || '',
    missingFields: row.missingFields || '',
    reason: row.reason || '',
    source: '',
    trustStatus: 'unverified',
    validFrom: null,
    validTo: null,
    effective: false,
    effectiveStatus: 'indefinite',
    usableAsFact: false,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
  };
}

function collectAllEntries(userId, now = new Date(), { storeId, store_id } = {}) {
  const scope = { storeId: storeId ?? store_id };
  const out = [];
  for (const product of listProductKnowledge(userId, scope) || []) {
    for (const field of PRODUCT_META_FIELDS) {
      const e = buildProductEntry(product, field, now);
      if (e) out.push(e);
    }
  }
  const policies = getStorePolicies(userId, scope);
  for (const field of POLICY_META_FIELDS) {
    const e = buildPolicyEntry(policies, field, now);
    if (e) out.push(e);
  }
  for (const faq of listInquiryConfirmations(userId, {
    status: 'approved',
    limit: 500,
    ...scope,
  }) || []) {
    const e = buildFaqEntry(faq, userId, now);
    if (e) out.push(e);
  }
  for (const pending of listInquiryConfirmations(userId, {
    status: 'needs_confirm',
    limit: 500,
    ...scope,
  }) || []) {
    const e = buildPendingEntry(pending);
    if (e) out.push(e);
  }
  return out;
}

function matchesFilters(entry, filters = {}) {
  if (filters.type && entry.type !== filters.type) return false;
  if (filters.productNo) {
    const want = String(filters.productNo).replace(/[^\d]/g, '');
    const got = String(entry.productNo || '').replace(/[^\d]/g, '');
    if (want && got !== want) return false;
  }
  if (filters.source) {
    const want = normalizeSource(filters.source);
    if (normalizeSource(entry.source || '') !== want) return false;
  }
  if (filters.trustStatus && entry.trustStatus !== filters.trustStatus) return false;
  if (filters.effectiveStatus && entry.effectiveStatus !== filters.effectiveStatus) return false;
  if (filters.effective === 'true' && !entry.effective) return false;
  if (filters.effective === 'false' && entry.effective) return false;
  if (filters.q) {
    const q = String(filters.q).toLowerCase();
    const blob = [
      entry.title,
      entry.content,
      entry.question,
      entry.productNo,
      entry.productName,
      entry.label,
      entry.field,
    ]
      .join('\n')
      .toLowerCase();
    if (!blob.includes(q)) return false;
  }
  return true;
}

export function getKnowledgeSummary(userId, now = new Date(), options = {}) {
  const entries = collectAllEntries(userId, now, options);
  const summary = {
    total: entries.length,
    productFields: entries.filter((e) => e.type === 'product').length,
    policyFields: entries.filter((e) => e.type === 'policy').length,
    approvedFaqs: entries.filter((e) => e.type === 'faq').length,
    pendingConfirm: entries.filter((e) => e.type === 'pending').length,
    approved: entries.filter((e) => e.trustStatus === 'approved').length,
    unverified: entries.filter((e) => e.trustStatus === 'unverified').length,
    conflict: entries.filter((e) => e.trustStatus === 'conflict').length,
    expired: entries.filter((e) => e.effectiveStatus === 'expired').length,
    notYet: entries.filter((e) => e.effectiveStatus === 'not_yet').length,
    usableAsFact: entries.filter((e) => e.usableAsFact).length,
    kbOutOfSync: entries.filter((e) => e.type === 'faq' && e.kbSync && !e.kbSync.synced).length,
  };
  return summary;
}

export function listKnowledgeEntries(userId, query = {}, now = new Date()) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
  const filters = {
    q: query.q || query.search || '',
    productNo: query.productNo || '',
    type: query.type || '',
    source: query.source || '',
    trustStatus: query.trustStatus || '',
    effectiveStatus: query.effectiveStatus || '',
    effective: query.effective != null ? String(query.effective) : '',
  };
  const scope = { storeId: query.storeId ?? query.store_id };
  const all = collectAllEntries(userId, now, scope).filter((e) => matchesFilters(e, filters));
  all.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  const total = all.length;
  const offset = (page - 1) * limit;
  const items = all.slice(offset, offset + limit);
  return {
    items,
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

export function getKnowledgeEntry(userId, entryId, now = new Date(), options = {}) {
  const scope = { storeId: options.storeId ?? options.store_id };
  const parsed = parseKnowledgeEntryId(entryId);
  if (parsed.type === 'product') {
    const product = getProductKnowledge(userId, parsed.productNo, scope);
    if (!product) {
      const err = new Error('상품 지식을 찾을 수 없습니다.');
      err.code = 'NOT_FOUND';
      throw err;
    }
    const entry = buildProductEntry(product, parsed.field, now);
    if (!entry) {
      const err = new Error('해당 필드에 내용이 없습니다.');
      err.code = 'NOT_FOUND';
      throw err;
    }
    return { ...entry, raw: { product } };
  }
  if (parsed.type === 'policy') {
    const policies = getStorePolicies(userId, scope);
    const entry = buildPolicyEntry(policies, parsed.field, now);
    if (!entry) {
      const err = new Error('해당 정책 필드를 찾을 수 없습니다.');
      err.code = 'NOT_FOUND';
      throw err;
    }
    return { ...entry, raw: { policies } };
  }
  if (parsed.type === 'faq') {
    const faq = getInquiryConfirmation(userId, parsed.confirmationId);
    const entry = buildFaqEntry(faq, userId, now);
    if (!entry) {
      const err = new Error('승인 FAQ를 찾을 수 없습니다.');
      err.code = 'NOT_FOUND';
      throw err;
    }
    return { ...entry, raw: { confirmation: faq } };
  }
  if (parsed.type === 'pending') {
    const row = getInquiryConfirmation(userId, parsed.confirmationId);
    const entry = buildPendingEntry(row);
    if (!entry) {
      const err = new Error('확인 필요 항목을 찾을 수 없습니다.');
      err.code = 'NOT_FOUND';
      throw err;
    }
    return { ...entry, raw: { confirmation: row } };
  }
  const err = new Error('잘못된 entryId입니다.');
  err.code = 'BAD_ENTRY_ID';
  throw err;
}

export function patchKnowledgeEntry(userId, entryId, body = {}) {
  const scope = { storeId: body.storeId ?? body.store_id };
  const parsed = parseKnowledgeEntryId(entryId);
  if (parsed.type === 'product') {
    const existing = getProductKnowledge(userId, parsed.productNo, scope);
    if (!existing) {
      const err = new Error('상품 지식을 찾을 수 없습니다.');
      err.code = 'NOT_FOUND';
      throw err;
    }
    const item = setProductKnowledgeField(userId, parsed.productNo, parsed.field, body.content ?? body.value ?? '', {
      ...scope,
      source: body.source,
      trustStatus: body.trustStatus || 'approved',
      validFrom: body.validFrom,
      validTo: body.validTo,
      productName: body.productName,
    });
    return getKnowledgeEntry(userId, `product:${item.productNo}:${parsed.field}`, undefined, scope);
  }
  if (parsed.type === 'policy') {
    setStorePolicyField(userId, parsed.field, body.content ?? body.value ?? '', {
      ...scope,
      source: body.source,
      trustStatus: body.trustStatus || 'approved',
      validFrom: body.validFrom,
      validTo: body.validTo,
    });
    return getKnowledgeEntry(userId, `policy:${parsed.field}`, undefined, scope);
  }
  if (parsed.type === 'faq') {
    updateApprovedFaq(userId, parsed.confirmationId, {
      approvedAnswer: body.content ?? body.value ?? body.approvedAnswer,
      validFrom: body.validFrom,
      validTo: body.validTo,
      intentKey: body.intentKey,
      knowledgeCategory: body.knowledgeCategory,
      confirmPrompt: body.confirmPrompt,
      syncKb: body.syncKb,
    });
    return getKnowledgeEntry(userId, `faq:${parsed.confirmationId}`);
  }
  if (parsed.type === 'pending') {
    const err = new Error('확인 필요 항목은 approve-fact 또는 dismiss로 처리하세요.');
    err.code = 'CONFLICT';
    throw err;
  }
  const err = new Error('잘못된 entryId입니다.');
  err.code = 'BAD_ENTRY_ID';
  throw err;
}

export function deleteKnowledgeEntry(userId, entryId, options = {}) {
  const scope = { storeId: options.storeId ?? options.store_id };
  const parsed = parseKnowledgeEntryId(entryId);
  if (parsed.type === 'product') {
    clearProductKnowledgeField(userId, parsed.productNo, parsed.field, scope);
    return { deleted: true, entryId: parsed.entryId, keptRow: true };
  }
  if (parsed.type === 'policy') {
    clearStorePolicyField(userId, parsed.field, scope);
    return { deleted: true, entryId: parsed.entryId };
  }
  if (parsed.type === 'faq') {
    return {
      ...deleteInquiryConfirmation(userId, parsed.confirmationId, {
        clearKbField: options.clearKbField === true || options.clearKb === true,
      }),
      entryId: parsed.entryId,
    };
  }
  if (parsed.type === 'pending') {
    dismissInquiryConfirmation(userId, parsed.confirmationId, {
      reason: options.reason || 'knowledge_ui_delete',
    });
    return { deleted: true, entryId: parsed.entryId, dismissed: true };
  }
  const err = new Error('잘못된 entryId입니다.');
  err.code = 'BAD_ENTRY_ID';
  throw err;
}
