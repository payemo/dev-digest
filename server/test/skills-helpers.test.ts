import { describe, it, expect } from 'vitest';
import {
  computeSkillStats,
  isBodyChange,
  mayBeEnabledOnCreate,
  type SkillStatsInput,
} from '../src/modules/skills/helpers.js';
import { STATS_WINDOW_DAYS } from '../src/modules/skills/constants.js';

/** Pure helpers for the skills module — versioning, vetting, stats folding. */

const baseStats: SkillStatsInput = {
  skillId: 'sk-1',
  usedByAgents: 0,
  linkedAgentRuns: 0,
  injectedRuns: 0,
  accepted: 0,
  dismissed: 0,
  byCategory: [],
};

describe('isBodyChange', () => {
  it('is true only when the body actually differs', () => {
    expect(isBodyChange({ body: 'old' }, { body: 'new' })).toBe(true);
    expect(isBodyChange({ body: 'same' }, { body: 'same' })).toBe(false);
  });

  it('is false for a patch that leaves the body alone', () => {
    // Renaming a skill or toggling it off does not change what the model is
    // told, so it must not burn a version number.
    expect(isBodyChange({ body: 'x' }, {})).toBe(false);
  });
});

describe('mayBeEnabledOnCreate', () => {
  it('allows only hand-authored skills to start enabled', () => {
    expect(mayBeEnabledOnCreate('manual')).toBe(true);
    for (const source of ['community', 'imported_url', 'extracted'] as const) {
      expect(mayBeEnabledOnCreate(source)).toBe(false);
    }
  });
});

describe('computeSkillStats', () => {
  it('reports null, not zero, when a denominator is empty', () => {
    // "no data yet" and "0%" are different claims; the UI renders "—" for the
    // first and a real number for the second.
    const stats = computeSkillStats(baseStats);
    expect(stats.pull_frequency_pct).toBeNull();
    expect(stats.accept_rate).toBeNull();
    expect(stats.findings).toBe(0);
    expect(stats.window_days).toBe(STATS_WINDOW_DAYS);
  });

  it('computes pull frequency from injected over linked runs', () => {
    const stats = computeSkillStats({ ...baseStats, linkedAgentRuns: 40, injectedRuns: 12 });
    expect(stats.pull_frequency_pct).toBe(30);
    // Both sides stay visible so the UI can show "12 of 40 runs".
    expect(stats.linked_agent_runs).toBe(40);
    expect(stats.injected_runs).toBe(12);
  });

  it('computes accept rate over triaged findings only', () => {
    // 3 accepted, 1 dismissed, plus untriaged ones that must not dilute it.
    const stats = computeSkillStats({
      ...baseStats,
      accepted: 3,
      dismissed: 1,
      byCategory: [{ category: 'security', count: 10 }],
    });
    expect(stats.accept_rate).toBe(75);
    expect(stats.findings).toBe(10);
  });

  it('is 0%, not null, when everything triaged was dismissed', () => {
    const stats = computeSkillStats({ ...baseStats, accepted: 0, dismissed: 4 });
    expect(stats.accept_rate).toBe(0);
  });

  it('totals findings from the category breakdown and sorts it biggest-first', () => {
    const stats = computeSkillStats({
      ...baseStats,
      byCategory: [
        { category: 'style', count: 2 },
        { category: 'security', count: 9 },
        { category: 'bug', count: 5 },
      ],
    });
    expect(stats.findings).toBe(16);
    expect(stats.by_category.map((c) => c.category)).toEqual(['security', 'bug', 'style']);
  });

  it('breaks category ties alphabetically so the donut is stable across reloads', () => {
    const stats = computeSkillStats({
      ...baseStats,
      byCategory: [
        { category: 'perf', count: 3 },
        { category: 'bug', count: 3 },
      ],
    });
    expect(stats.by_category.map((c) => c.category)).toEqual(['bug', 'perf']);
  });

  it('does not mutate the caller-supplied category array', () => {
    const byCategory = [
      { category: 'style', count: 1 },
      { category: 'security', count: 7 },
    ];
    computeSkillStats({ ...baseStats, byCategory });
    expect(byCategory.map((c) => c.category)).toEqual(['style', 'security']);
  });
});
