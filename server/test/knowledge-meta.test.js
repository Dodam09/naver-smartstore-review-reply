import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertValidRange,
  canUseAsVerifiedFact,
  contentHash,
  fieldCanUseAsFact,
  isKnowledgeEffective,
  isUnverifiedByDefaultSource,
  normalizeSource,
  parseFieldMetaJson,
  resolveTrustStatus,
  trustStatusForInsert,
} from '../knowledge-meta.js';

test('source 정규화와 자동수집 unverified 기본', () => {
  assert.equal(normalizeSource('manual'), 'MANUAL');
  assert.equal(normalizeSource('seller_approved'), 'SELLER_APPROVED');
  assert.equal(normalizeSource('NAVER_PRODUCT'), 'NAVER_PRODUCT');
  assert.equal(isUnverifiedByDefaultSource('NAVER_PRODUCT'), true);
  assert.equal(isUnverifiedByDefaultSource('manual'), false);
  assert.equal(trustStatusForInsert({ source: 'NAVER_PRODUCT' }), 'unverified');
  assert.equal(trustStatusForInsert({ source: 'manual' }), null);
});

test('레거시 manual은 approved로 해석, NAVER는 unverified', () => {
  assert.equal(resolveTrustStatus({ source: 'manual', verifiedAt: '2026-01-01' }), 'approved');
  assert.equal(resolveTrustStatus({ source: 'NAVER_PRODUCT' }), 'unverified');
  assert.equal(
    resolveTrustStatus({ source: 'NAVER_PRODUCT', verifiedAt: '2026-01-01 00:00:00' }),
    'approved'
  );
  assert.equal(
    resolveTrustStatus({ trustStatus: 'approved', source: 'NAVER_PRODUCT' }),
    'approved'
  );
  assert.equal(
    resolveTrustStatus({
      trustStatus: 'unverified',
      source: 'NAVER_PRODUCT',
      verifiedAt: '2026-01-01',
    }),
    'unverified'
  );
  assert.equal(canUseAsVerifiedFact({ source: 'NAVER_PRODUCT', trustStatus: 'unverified' }), false);
  assert.equal(canUseAsVerifiedFact({ source: 'manual', verifiedAt: '2026-01-01' }), true);
  assert.equal(canUseAsVerifiedFact({ source: 'HISTORICAL_QA', trustStatus: 'approved' }), false);
});

test('필드 메타 없으면 행 단위 trust/source/verified_at 폴백', () => {
  assert.equal(
    fieldCanUseAsFact({ source: 'manual', verifiedAt: '2026-01-01', fieldMeta: {} }, 'specs'),
    true
  );
  assert.equal(
    fieldCanUseAsFact(
      {
        source: 'NAVER_PRODUCT',
        trustStatus: 'unverified',
        fieldMeta: { specs: { trustStatus: 'approved', source: 'SELLER_APPROVED' } },
      },
      'specs'
    ),
    true
  );
  assert.equal(
    fieldCanUseAsFact(
      {
        source: 'NAVER_PRODUCT',
        trustStatus: 'unverified',
        fieldMeta: { specs: { trustStatus: 'approved', source: 'SELLER_APPROVED' } },
      },
      'usage'
    ),
    false
  );
});

test('유효기간 KST 규칙', () => {
  assert.deepEqual(assertValidRange(null, null), { validFrom: null, validTo: null });
  assert.throws(() => assertValidRange('2026-12-01', '2026-11-01'));

  const now = new Date('2026-11-12T03:00:00+09:00');
  assert.equal(isKnowledgeEffective({}, now).effective, true);
  assert.equal(isKnowledgeEffective({ validFrom: '2026-11-20' }, now).effective, false);
  assert.equal(isKnowledgeEffective({ validFrom: '2026-11-20' }, now).effectiveStatus, 'not_yet');
  assert.equal(isKnowledgeEffective({ validTo: '2026-11-01' }, now).effective, false);
  assert.equal(isKnowledgeEffective({ validTo: '2026-11-01' }, now).effectiveStatus, 'expired');
  assert.equal(
    isKnowledgeEffective({ validFrom: '2026-11-01', validTo: '2026-11-30' }, now).effective,
    true
  );
  assert.equal(
    canUseAsVerifiedFact({
      source: 'manual',
      verifiedAt: 'x',
      validTo: '2026-11-01',
      now,
    }),
    false
  );
});

test('field_meta_json 파싱 손상 시 빈 객체', () => {
  assert.deepEqual(parseFieldMetaJson('{not-json'), {});
  assert.deepEqual(parseFieldMetaJson('{"shipping":{"trustStatus":"approved"}}').shipping.trustStatus, 'approved');
  assert.equal(contentHash('A  B'), contentHash('a b'));
});
