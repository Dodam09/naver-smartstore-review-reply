import { currentPeriod, ensureUsageRow, findUserById, getUsageChannelBreakdown, getUsageRow, incrementUsage } from './db.js';
import { getPlan } from './plans.js';

export const FREE_USAGE_PERIOD = 'lifetime';

export function subscriptionUsagePeriod(user) {
  const cycle = Number(user?.usage_cycle || 0);
  if (cycle > 0) return `cycle:${cycle}`;
  if (Number(user?.usage_legacy_review || 0) === 1) return currentPeriod();
  const expires = String(user?.subscription_expires_at || '').trim();
  return expires || null;
}

function resolveUsagePeriod(userId, subscriptionActive, period) {
  if (!subscriptionActive) return FREE_USAGE_PERIOD;
  const cycle = subscriptionUsagePeriod(findUserById(userId));
  if (cycle) return cycle;
  return period || currentPeriod();
}

export function getUsageSummary(userId, planId, period = currentPeriod(), subscriptionActive = true) {
  const resolvedPeriod = resolveUsagePeriod(userId, subscriptionActive, period);
  const plan = subscriptionActive ? getPlan(planId) : getPlan('none');
  const row = ensureUsageRow(userId, resolvedPeriod);
  const replyUsed = row.reply_count || 0;
  const toneUsed = row.tone_count || 0;
  const byChannel = getUsageChannelBreakdown(userId, resolvedPeriod);

  return {
    period: resolvedPeriod,
    periodLabel: subscriptionActive ? (subscriptionUsagePeriod(findUserById(userId)) ? '구독 기간' : resolvedPeriod) : '체험',
    planId: plan.id,
    planName: plan.name,
    replyUsed,
    replyLimit: plan.replyLimit,
    replyRemaining: Math.max(0, plan.replyLimit - replyUsed),
    toneUsed,
    toneLimit: plan.toneLimit,
    toneRemaining: Math.max(0, plan.toneLimit - toneUsed),
    replyByChannel: byChannel.reply,
    toneByChannel: byChannel.tone,
    trial: !subscriptionActive,
    locked: false,
  };
}

export class UsageLimitError extends Error {
  constructor(message, usage) {
    super(message);
    this.name = 'UsageLimitError';
    this.usage = usage;
  }
}

function limitReachedMessage(usage, kind) {
  if (kind === 'reply') {
    return usage.trial
      ? `무료 체험 답글 한도(${usage.replyLimit}건)를 모두 사용했습니다. [계정]에서 구독해 주세요.`
      : `이번 구독 기간 답글 생성 한도(${usage.replyLimit}건)를 모두 사용했습니다.`;
  }
  return usage.trial
    ? `무료 체험 말투 분석 한도(${usage.toneLimit}회)를 모두 사용했습니다. [계정]에서 구독해 주세요.`
    : `이번 구독 기간 말투 분석 한도(${usage.toneLimit}회)를 모두 사용했습니다.`;
}

export function assertWithinLimit(userId, planId, kind, period = currentPeriod(), subscriptionActive = true) {
  const usage = getUsageSummary(userId, planId, period, subscriptionActive);
  if (kind === 'reply') {
    if (usage.replyUsed >= usage.replyLimit) {
      throw new UsageLimitError(limitReachedMessage(usage, 'reply'), usage);
    }
    return usage;
  }

  if (usage.toneUsed >= usage.toneLimit) {
    throw new UsageLimitError(limitReachedMessage(usage, 'tone'), usage);
  }
  return usage;
}

export function recordUsage(userId, kind, channel, period = currentPeriod(), subscriptionActive = true) {
  const resolvedPeriod = resolveUsagePeriod(userId, subscriptionActive, period);
  incrementUsage(userId, kind, channel, resolvedPeriod);
  return getUsageRow(userId, resolvedPeriod);
}

const userLocks = new Map();

export function withUserLock(userId, fn) {
  const key = String(userId);
  const run = (userLocks.get(key) || Promise.resolve())
    .catch(() => {})
    .then(fn);
  userLocks.set(key, run);
  return run.finally(() => {
    if (userLocks.get(key) === run) userLocks.delete(key);
  });
}

export function resetUserLocksForTests() {
  userLocks.clear();
}
