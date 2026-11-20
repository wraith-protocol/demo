/**
 * Local privacy score for stealth addresses.
 * All computation is local — no network calls.
 *
 * Score: 0–100 (higher = more private)
 * Green: 75–100, Yellow: 40–74, Red: 0–39
 */

export type PrivacyGrade = 'green' | 'yellow' | 'red';

export interface AddressActivity {
  /** Number of times this stealth address has appeared in scanned announcements */
  reuseCount: number;
  /** Current balance in native units (e.g. "1.5") — empty/zero means less correlation risk */
  balance: string;
  /** Unix timestamps (ms) of each inbound transfer */
  transferTimestamps: number[];
}

export interface PrivacyScore {
  score: number; // 0–100
  grade: PrivacyGrade;
  factors: {
    reuse: number; // 0–100 (100 = not reused)
    balance: number; // 0–100 (100 = empty)
    timePattern: number; // 0–100 (100 = unpredictable)
  };
}

/** Returns 0–100: penalises reuse heavily since it directly links payments */
function reuseScore(reuseCount: number): number {
  if (reuseCount <= 1) return 100;
  if (reuseCount === 2) return 60;
  if (reuseCount === 3) return 30;
  return 0;
}

/** Returns 0–100: a funded address that has not been swept is a correlation risk */
function balanceScore(balance: string): number {
  const n = parseFloat(balance);
  if (!n || n <= 0) return 100;
  if (n < 0.001) return 90;
  if (n < 1) return 70;
  if (n < 10) return 40;
  return 20;
}

/**
 * Returns 0–100: regular intervals are detectable on-chain.
 * Uses coefficient of variation (stddev / mean) of inter-transfer gaps.
 * High variation → unpredictable → private.
 */
function timePatternScore(timestamps: number[]): number {
  if (timestamps.length < 2) return 100;

  const sorted = [...timestamps].sort((a, b) => a - b);
  const gaps = sorted.slice(1).map((t, i) => t - sorted[i]);
  const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  if (mean === 0) return 0;

  const variance = gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length;
  const cv = Math.sqrt(variance) / mean; // coefficient of variation

  // cv >= 1 → highly irregular → score 100; cv = 0 → perfectly regular → score 0
  return Math.min(100, Math.round(cv * 100));
}

export function gradeFromScore(score: number): PrivacyGrade {
  if (score >= 75) return 'green';
  if (score >= 40) return 'yellow';
  return 'red';
}

export function computePrivacyScore(activity: AddressActivity): PrivacyScore {
  const reuse = reuseScore(activity.reuseCount);
  const balance = balanceScore(activity.balance);
  const timePattern = timePatternScore(activity.transferTimestamps);

  // Weighted average: reuse is the most critical factor
  const score = Math.round(reuse * 0.5 + balance * 0.3 + timePattern * 0.2);

  return {
    score,
    grade: gradeFromScore(score),
    factors: { reuse, balance, timePattern },
  };
}
