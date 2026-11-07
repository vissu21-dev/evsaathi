/**
 * Community + report reputation (P4-M02).
 * Ties into Phase 2 crowdsource reports without inventing trust.
 */

export type ReputationEventKind =
  | 'verified_report'
  | 'helpful_post'
  | 'moderated_reject'
  | 'spam_flag'
  | 'useful_vote';

export interface ReputationEvent {
  kind: ReputationEventKind;
  weight?: number;
  at?: string;
}

export interface ReputationScoreInput {
  events: ReputationEvent[];
  /** Confirmed station reports (Phase 2) that passed moderation. */
  verifiedReportCount?: number;
  /** Community posts marked helpful / not rejected. */
  helpfulPostCount?: number;
  /** Soft votes from peers on posts. */
  usefulVotesReceived?: number;
  /** Moderator rejects / spam. */
  rejectedCount?: number;
  spamFlags?: number;
}

export interface ReputationScoreResult {
  score: number;
  tier: 'newcomer' | 'contributor' | 'trusted' | 'expert';
  components: {
    verified_reports: number;
    helpful_posts: number;
    useful_votes: number;
    penalties: number;
  };
  display_label: string;
  note: string;
  formula_version: 'p4-v1';
}

const EVENT_POINTS: Record<ReputationEventKind, number> = {
  verified_report: 8,
  helpful_post: 5,
  useful_vote: 1,
  moderated_reject: -12,
  spam_flag: -20,
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function round(n: number, places = 0): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

export function computeReputationScore(input: ReputationScoreInput): ReputationScoreResult {
  const verified = input.verifiedReportCount ?? 0;
  const helpful = input.helpfulPostCount ?? 0;
  const votes = input.usefulVotesReceived ?? 0;
  const rejected = input.rejectedCount ?? 0;
  const spam = input.spamFlags ?? 0;

  let fromEvents = 0;
  for (const e of input.events) {
    const base = EVENT_POINTS[e.kind] ?? 0;
    fromEvents += (e.weight ?? 1) * base;
  }

  const verifiedPts = verified * EVENT_POINTS.verified_report;
  const helpfulPts = helpful * EVENT_POINTS.helpful_post;
  const votePts = votes * EVENT_POINTS.useful_vote;
  const penalties =
    rejected * Math.abs(EVENT_POINTS.moderated_reject) +
    spam * Math.abs(EVENT_POINTS.spam_flag);

  const raw = fromEvents + verifiedPts + helpfulPts + votePts - penalties;
  const score = clamp(round(raw), 0, 1000);

  let tier: ReputationScoreResult['tier'] = 'newcomer';
  if (score >= 250) tier = 'expert';
  else if (score >= 100) tier = 'trusted';
  else if (score >= 25) tier = 'contributor';

  const display_label =
    tier === 'expert'
      ? 'Expert contributor'
      : tier === 'trusted'
        ? 'Trusted contributor'
        : tier === 'contributor'
          ? 'Active contributor'
          : 'Newcomer';

  return {
    score,
    tier,
    components: {
      verified_reports: verifiedPts,
      helpful_posts: helpfulPts,
      useful_votes: votePts,
      penalties,
    },
    display_label,
    note:
      'Reputation blends moderated Phase 2 station reports with community usefulness. Not a social-follower count; spam and rejects reduce score.',
    formula_version: 'p4-v1',
  };
}

/** Minimum reputation before a user can post photos / vehicle-space tips without rate throttle. */
export const COMMUNITY_PHOTO_MIN_SCORE = 10;

/** Soft rate limit: posts per rolling 24h for newcomers. */
export const COMMUNITY_NEWCOMER_DAILY_POST_CAP = 5;

export function canPostWithoutThrottle(score: number): boolean {
  return score >= COMMUNITY_PHOTO_MIN_SCORE;
}

export function dailyPostCap(score: number): number {
  if (score >= 100) return 50;
  if (score >= 25) return 20;
  return COMMUNITY_NEWCOMER_DAILY_POST_CAP;
}
