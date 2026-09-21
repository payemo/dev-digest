import { describe, it, expect } from 'vitest';
import { assemblePrompt } from '@devdigest/reviewer-core';
import { renderSkillBlock, selectInjectableSkills } from '../src/modules/reviews/helpers.js';

/**
 * Skills-in-prompt assembly (pure, no LLM, no DB).
 *
 * Covers the two halves of "a skill reaches the model":
 *  - `selectInjectableSkills` decides WHICH skills go in (enabled, in order);
 *  - `assemblePrompt` decides WHERE the block lands and what it looks like.
 *
 * The byte-identity assertions pin the promise that an agent with no enabled
 * skills gets exactly the prompt it got before this feature existed.
 */

const COMMON = {
  system: 'You are a reviewer.',
  prDescription: 'Adds a rate limiter.',
  memory: ['Do not flag try/catch around JSON.parse'],
  diff: '@@ -1 +1 @@\n+stripeKey',
  task: "Review PR #482 'rate limit'",
};

const skill = (over: Partial<{ id: string; name: string; description: string; body: string; enabled: boolean }> = {}) => ({
  id: over.id ?? 'id-1',
  name: over.name ?? 'API contract compatibility',
  description: over.description ?? 'Flag breaking route-signature changes.',
  body: over.body ?? '- A renamed response field is a breaking change.',
  enabled: over.enabled ?? true,
});

describe('selectInjectableSkills', () => {
  it('keeps enabled skills in agent_skills order', () => {
    const sel = selectInjectableSkills([
      { skill: skill({ id: 'b', name: 'Second' }), order: 1 },
      { skill: skill({ id: 'a', name: 'First' }), order: 0 },
    ]);
    expect(sel.skillIds).toEqual(['a', 'b']);
    expect(sel.names).toEqual(['First', 'Second']);
    expect(sel.total).toBe(2);
    expect(sel.skipped).toEqual([]);
  });

  it('drops disabled skills from BOTH the prompt and the attribution ids', () => {
    const sel = selectInjectableSkills([
      { skill: skill({ id: 'a', name: 'Kept' }), order: 0 },
      { skill: skill({ id: 'b', name: 'Dropped', enabled: false }), order: 1 },
    ]);
    expect(sel.skillIds).toEqual(['a']);
    expect(sel.bodies).toHaveLength(1);
    expect(sel.total).toBe(2);
    expect(sel.skipped).toEqual(['Dropped']);
  });

  it('preserves the survivors relative order when a middle skill is disabled', () => {
    const sel = selectInjectableSkills([
      { skill: skill({ id: 'a', name: 'A' }), order: 0 },
      { skill: skill({ id: 'b', name: 'B', enabled: false }), order: 1 },
      { skill: skill({ id: 'c', name: 'C' }), order: 2 },
    ]);
    expect(sel.skillIds).toEqual(['a', 'c']);
  });

  it('yields nothing injectable when every linked skill is disabled', () => {
    const sel = selectInjectableSkills([
      { skill: skill({ id: 'a', enabled: false, name: 'A' }), order: 0 },
    ]);
    expect(sel.bodies).toEqual([]);
    expect(sel.skillIds).toEqual([]);
    expect(sel.skipped).toEqual(['A']);
  });

  it('renders a skill as its own headed block carrying name + description', () => {
    const block = renderSkillBlock(skill());
    expect(block).toBe(
      '### API contract compatibility\n' +
        '_Flag breaking route-signature changes._\n\n' +
        '- A renamed response field is a breaking change.',
    );
  });

  it('omits the description line when the description is blank', () => {
    expect(renderSkillBlock(skill({ description: '   ' }))).toBe(
      '### API contract compatibility\n- A renamed response field is a breaking change.',
    );
  });
});

describe('assemblePrompt + skills block', () => {
  const bodies = selectInjectableSkills([
    { skill: skill({ id: 'a', name: 'First' }), order: 0 },
    { skill: skill({ id: 'b', name: 'Second' }), order: 1 },
  ]).bodies;

  it('places ## Skills / rules AFTER PR description and BEFORE Relevant memory', () => {
    const { messages } = assemblePrompt({ ...COMMON, skills: bodies });
    const user = messages[1]!.content;

    const idxPr = user.indexOf('## PR description');
    const idxSkills = user.indexOf('## Skills / rules');
    const idxMemory = user.indexOf('## Relevant memory');
    const idxDiff = user.indexOf('## Diff to review');
    expect(idxPr).toBeGreaterThan(-1);
    expect(idxSkills).toBeGreaterThan(idxPr);
    expect(idxMemory).toBeGreaterThan(idxSkills);
    expect(idxDiff).toBeGreaterThan(idxMemory);
  });

  it('keeps each skill as a distinct sub-block, in order', () => {
    const { messages } = assemblePrompt({ ...COMMON, skills: bodies });
    const user = messages[1]!.content;
    expect(user.indexOf('### First')).toBeGreaterThan(-1);
    expect(user.indexOf('### Second')).toBeGreaterThan(user.indexOf('### First'));
  });

  it('records the block verbatim in the trace assembly', () => {
    const { assembly } = assemblePrompt({ ...COMMON, skills: bodies });
    expect(assembly.skills).toBe(bodies.join('\n\n'));
  });

  it('does NOT delimiter-wrap the skills block', () => {
    // Skills are the one block assemblePrompt treats as instructions rather
    // than data. That is deliberate — and it is exactly why an imported skill
    // is stored disabled until a human vets it. If this assertion ever starts
    // failing, the vetting gate's rationale changed too.
    const { messages } = assemblePrompt({ ...COMMON, skills: bodies });
    const user = messages[1]!.content;
    const block = user.slice(
      user.indexOf('## Skills / rules'),
      user.indexOf('## Relevant memory'),
    );
    expect(block).not.toContain('<untrusted source=');
  });

  it('is byte-identical to omitting the slot when no skill is injectable', () => {
    const baseline = assemblePrompt({ ...COMMON }).messages[1]!.content;
    expect(assemblePrompt({ ...COMMON, skills: [] }).messages[1]!.content).toBe(baseline);
    expect(assemblePrompt({ ...COMMON, skills: undefined }).messages[1]!.content).toBe(baseline);
    expect(assemblePrompt({ ...COMMON }).assembly.skills).toBeNull();
  });
});
