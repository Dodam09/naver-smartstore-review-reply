import { currentPeriod, ensureUsageRow, getUsageRow, incrementUsage } from './db.js';
import { getPlan } from './plans.js';

export function getUsageSummary(userId, planId, period = currentPeriod()) {
  const plan = getPlan(planId);
  const row = ensureUsageRow(userId, period);
  const replyUsed = row.reply_count || 0;
  const toneUsed = row.tone_count || 0;

  return {
    period,
    planId: plan.id,
    planName: plan.name,
    replyUsed,
    replyLimit: plan.replyLimit,
    replyRemaining: Math.max(0, plan.replyLimit - replyUsed),
    toneUsed,
    toneLimit: plan.toneLimit,
    toneRemaining: Math.max(0, plan.toneLimit - toneUsed),
  };
}

export class UsageLimitError extends Error {
  constructor(message, usage) {
    super(message);
    this.name = 'UsageLimitError';
    this.usage = usage;
  }
}

export function assertWithinLimit(userId, planId, kind, period = currentPeriod()) {
  const usage = getUsageSummary(userId, planId, period);
  if (kind === 'reply') {
    if (usage.replyUsed >= usage.replyLimit) {
      throw new UsageLimitError(
        `이번 달 답글 생성 한도(${usage.replyLimit}건)를 모두 사용했습니다.`,
        usage
      );
    }
    return usage;
  }

  if (usage.toneUsed >= usage.toneLimit) {
    throw new UsageLimitError(
      `이번 달 말투 분석 한도(${usage.toneLimit}회)를 모두 사용했습니다.`,
      usage
    );
  }
  return usage;
}

export function recordUsage(userId, kind, channel, period = currentPeriod()) {
  incrementUsage(userId, kind, channel, period);
  return getUsageRow(userId, period);
}
