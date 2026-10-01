import { describe, expect, it } from 'vitest';
import { shareBudget } from './budget.js';

describe('shareBudget', () => {
  it('keeps everything when it fits', () => {
    expect(shareBudget([10, 20, 30], 100)).toEqual([10, 20, 30]);
  });

  it('keeps short texts whole and splits the rest equally', () => {
    expect(shareBudget([500, 10, 500], 210)).toEqual([100, 10, 100]);
  });

  it('never exceeds the budget', () => {
    const allowed = shareBudget([7, 1000, 333, 52], 401);
    expect(allowed.reduce((sum: number, n: number) => sum + n, 0)).toBeLessThanOrEqual(401);
    expect(allowed[0]).toBe(7);
  });

  it('handles no texts and a zero budget', () => {
    expect(shareBudget([], 100)).toEqual([]);
    expect(shareBudget([5, 5], 0)).toEqual([0, 0]);
  });
});
