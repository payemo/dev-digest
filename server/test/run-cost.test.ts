import { describe, it, expect } from 'vitest';
import { effectiveRunCost, sumRunCosts, type Estimator, type RunCostInputs } from '../src/platform/run-cost.js';

// Fake estimator: only prices a couple of models, deterministic per test —
// no PriceBook, no network, no live cache.
const estimate: Estimator = (model, tokensIn, tokensOut) => {
  if (model === 'deepseek/deepseek-v4-flash') return (tokensIn * 0.14 + tokensOut * 0.28) / 1_000_000;
  return null; // unpriced model
};

function row(partial: Partial<RunCostInputs>): RunCostInputs {
  return { costUsd: null, model: null, tokensIn: null, tokensOut: null, ...partial };
}

describe('effectiveRunCost', () => {
  it('returns the provider-reported cost verbatim — never re-derives when one is present', () => {
    const cost = effectiveRunCost(
      row({ costUsd: 0.0013, model: 'deepseek/deepseek-v4-flash', tokensIn: 1_000_000, tokensOut: 1_000_000 }),
      estimate,
    );
    // If this derived instead it would be 0.42, not 0.0013 — proves the early-out.
    expect(cost).toBe(0.0013);
  });

  it('derives from tokens when the provider reported no cost but the model is priced', () => {
    const cost = effectiveRunCost(
      row({ costUsd: null, model: 'deepseek/deepseek-v4-flash', tokensIn: 1_000_000, tokensOut: 1_000_000 }),
      estimate,
    );
    expect(cost).toBeCloseTo(0.42, 9);
  });

  it('is null when there is no cost and no model', () => {
    expect(effectiveRunCost(row({ costUsd: null, model: null }), estimate)).toBeNull();
  });

  it('is null when there is no cost and the model is unpriced', () => {
    expect(
      effectiveRunCost(row({ costUsd: null, model: 'totally/unknown', tokensIn: 5000, tokensOut: 500 }), estimate),
    ).toBeNull();
  });

  it('treats missing token counts as 0 rather than throwing', () => {
    expect(
      effectiveRunCost(row({ costUsd: null, model: 'deepseek/deepseek-v4-flash', tokensIn: null, tokensOut: null }), estimate),
    ).toBe(0);
  });
});

describe('sumRunCosts', () => {
  it('is null for an empty list — no successful runs to price, so the list shows a dash', () => {
    expect(sumRunCosts([], estimate)).toBeNull();
  });

  it('sums provider-reported and derived costs together', () => {
    const total = sumRunCosts(
      [
        row({ costUsd: 0.01, model: 'deepseek/deepseek-v4-flash', tokensIn: 10_000, tokensOut: 2_000 }),
        row({ costUsd: null, model: 'deepseek/deepseek-v4-flash', tokensIn: 1_000_000, tokensOut: 1_000_000 }),
      ],
      estimate,
    );
    expect(total).toBeCloseTo(0.43, 6);
  });

  it('a run with an unknown model contributes 0 to the sum (not skipped, not thrown)', () => {
    const total = sumRunCosts(
      [
        row({ costUsd: 0.01, model: 'deepseek/deepseek-v4-flash', tokensIn: 10_000, tokensOut: 2_000 }),
        row({ costUsd: null, model: 'totally/unknown', tokensIn: 5_000, tokensOut: 500 }),
      ],
      estimate,
    );
    expect(total).toBeCloseTo(0.01, 6);
  });

  it('rounds away float drift from repeated addition', () => {
    const total = sumRunCosts(
      [row({ costUsd: 0.1 }), row({ costUsd: 0.2 })], // 0.1 + 0.2 === 0.30000000000000004 in float64
      estimate,
    );
    expect(total).toBe(0.3);
  });
});
