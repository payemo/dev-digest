import { describe, expect, it } from 'vitest';
import { TOOLS_LIST_CHAR_BUDGET } from '../src/constants.js';
import { toolListPayload } from '../src/tools/payload.js';

/**
 * The startup-cost gate. Tool definitions are loaded into a model's context
 * before the user's first word, so this is the one number that is paid on
 * every single request whether or not a tool is ever called.
 */
describe('tools/list token budget', () => {
  const payload = toolListPayload();
  const serialized = JSON.stringify(payload);

  it('stays within the startup budget', () => {
    // Printed rather than merely asserted: drift should be visible while there
    // is still headroom, not only when the build breaks.
    const chars = serialized.length;
    console.log(
      `tools/list = ${chars} chars ≈ ${Math.round(chars / 3.5)} tokens ` +
        `(budget ${TOOLS_LIST_CHAR_BUDGET} chars / 1500 tokens, ` +
        `${Math.round((1 - chars / TOOLS_LIST_CHAR_BUDGET) * 100)}% headroom)`,
    );
    expect(chars).toBeLessThanOrEqual(TOOLS_LIST_CHAR_BUDGET);
  });

  it('exposes exactly the five tools, unprefixed', () => {
    expect(payload.map((t) => t.name)).toEqual([
      'list_agents',
      'run_agent_on_pr',
      'get_findings',
      'get_conventions',
      'get_blast_radius',
    ]);
    // The client namespaces by server name, so a devdigest_ prefix would be
    // the word "devdigest" twice in every name, paid on every request.
    for (const t of payload) expect(t.name.startsWith('devdigest_')).toBe(false);
  });

  it('gives every tool a description a search could match', () => {
    for (const t of payload) {
      expect(t.description.length).toBeGreaterThan(40);
      expect(t.description.length).toBeLessThanOrEqual(600);
    }
  });

  it('describes every argument', () => {
    // A dropped description is invisible at runtime and degrades tool
    // selection silently — so it is asserted on the EMITTED schema, not on the
    // zod source it was built from.
    for (const t of payload) {
      const props = (t.inputSchema['properties'] ?? {}) as Record<string, { description?: string }>;
      for (const [field, schema] of Object.entries(props)) {
        expect(schema.description, `${t.name}.${field}`).toBeTruthy();
      }
    }
  });

  it('keeps every argument a flat primitive', () => {
    for (const t of payload) {
      const props = (t.inputSchema['properties'] ?? {}) as Record<string, { type?: string }>;
      for (const [field, schema] of Object.entries(props)) {
        expect(['string', 'number', 'boolean'], `${t.name}.${field}`).toContain(schema.type);
      }
    }
  });

  it('marks the one tool that writes', () => {
    const writes = payload.filter((t) => !t.annotations.readOnlyHint).map((t) => t.name);
    expect(writes).toEqual(['run_agent_on_pr']);
  });
});
