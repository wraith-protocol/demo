import { describe, it, expect } from 'vitest';
import { computePrivacyScore, gradeFromScore } from './privacy-score';

describe('gradeFromScore', () => {
  it('returns green for score >= 75', () => {
    expect(gradeFromScore(75)).toBe('green');
    expect(gradeFromScore(100)).toBe('green');
  });
  it('returns yellow for 40–74', () => {
    expect(gradeFromScore(40)).toBe('yellow');
    expect(gradeFromScore(74)).toBe('yellow');
  });
  it('returns red for < 40', () => {
    expect(gradeFromScore(39)).toBe('red');
    expect(gradeFromScore(0)).toBe('red');
  });
});

describe('computePrivacyScore', () => {
  it('gives full score to fresh address with no transfers', () => {
    const result = computePrivacyScore({
      reuseCount: 1,
      balance: '0',
      transferTimestamps: [],
    });
    expect(result.score).toBe(100);
    expect(result.grade).toBe('green');
    expect(result.factors.reuse).toBe(100);
    expect(result.factors.balance).toBe(100);
    expect(result.factors.timePattern).toBe(100);
  });

  it('penalises heavy reuse', () => {
    const result = computePrivacyScore({
      reuseCount: 5,
      balance: '0',
      transferTimestamps: [],
    });
    expect(result.factors.reuse).toBe(0);
    expect(result.score).toBeLessThan(75);
  });

  it('penalises large balance', () => {
    const result = computePrivacyScore({
      reuseCount: 1,
      balance: '100',
      transferTimestamps: [],
    });
    expect(result.factors.balance).toBe(20);
    // score = 100*0.5 + 20*0.3 + 100*0.2 = 76 — balance is penalised but reuse/time are clean
    expect(result.score).toBeLessThan(100);
  });

  it('penalises regular time patterns', () => {
    // 5 transfers at perfectly regular 1h intervals
    const base = 1_000_000_000;
    const hour = 3_600_000;
    const timestamps = [0, 1, 2, 3, 4].map((i) => base + i * hour);
    const result = computePrivacyScore({
      reuseCount: 1,
      balance: '0',
      transferTimestamps: timestamps,
    });
    expect(result.factors.timePattern).toBe(0);
  });

  it('rewards irregular time patterns', () => {
    // Highly irregular gaps → high CV
    const timestamps = [0, 100, 10000, 10050, 500000].map((t) => t * 1000);
    const result = computePrivacyScore({
      reuseCount: 1,
      balance: '0',
      transferTimestamps: timestamps,
    });
    expect(result.factors.timePattern).toBe(100);
  });

  it('returns red grade for highly reused, funded, regular address', () => {
    const base = Date.now();
    const hour = 3_600_000;
    const result = computePrivacyScore({
      reuseCount: 5,
      balance: '50',
      transferTimestamps: [0, 1, 2, 3].map((i) => base + i * hour),
    });
    expect(result.grade).toBe('red');
  });

  it('score is bounded 0–100', () => {
    const result = computePrivacyScore({
      reuseCount: 100,
      balance: '999',
      transferTimestamps: [1, 2, 3, 4].map((i) => i * 1000),
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});
