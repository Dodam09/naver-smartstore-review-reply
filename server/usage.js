import { currentPeriod, ensureUsageRow, getUsageRow, incrementUsage } from './db.js';
import { getPlan } from './plans.js';

export const FREE_USAGE_PERIOD = 'lifetime';

function resolveUsagePeriod(subscriptionActive, period) {
  if (!subscriptionActive) return FREE_USAGE_PERIOD;
  return period || currentPeriod();
}

export function getUsageSummary(userId, planId, period = currentPeriod(), subscriptionActive = true) {
  const resolvedPeriod = resolveUsagePeriod(subscriptionActive, period);
  const plan = subscriptionActive ? getPlan(planId) : getPlan('none');
  const row = ensureUsageRow(userId, resolvedPeriod);
  const replyUsed = row.reply_count || 0;
  const toneUsed = row.tone_count || 0;

  return {
    period: resolvedPeriod,
    periodLabel: subscriptionActive ? resolvedPeriod : '체험',
    planId: plan.id,
    planName: plan.name,
    replyUsed,
    replyLimit: plan.replyLimit,
    replyRemaining: Math.max(0, plan.replyLimit - replyUsed),
    toneUsed,
    toneLimit: plan.toneLimit,
    toneRemaining: Math.max(0, plan.toneLimit - toneUsed),
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
      : `이번 달 답글 생성 한도(${usage.replyLimit}건)를 모두 사용했습니다.`;
  }
  return usage.trial
    ? `무료 체험 말투 분석 한도(${usage.toneLimit}회)를 모두 사용했습니다. [계정]에서 구독해 주세요.`
    : `이번 달 말투 분석 한도(${usage.toneLimit}회)를 모두 사용했습니다.`;
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
  incrementUsage(userId, kind, channel, resolveUsagePeriod(subscriptionActive, period));
  return getUsageRow(userId, resolveUsagePeriod(subscriptionActive, period));
}
