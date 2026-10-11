import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadManifest, findManifestPath, loadAgentManifest } from './manifest.js';
import { RunnerError } from './errors.js';

const VALID_MANIFEST_YAML = `
name: "Security Reviewer"
provider: "openrouter"
model: "deepseek/deepseek-v4-flash"
system_prompt: "Review this PR for security issues."
skills: ["security-basics"]
strategy: "auto"
ci_fail_on: "critical"
`;

describe('manifest loading + validation (AC-20)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'devdigest-runner-manifest-'));
    mkdirSync(path.join(dir, 'agents'), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads and validates a well-formed manifest against the AgentManifest schema', () => {
    writeFileSync(path.join(dir, 'agents', 'security-reviewer.yaml'), VALID_MANIFEST_YAML);

    const manifest = loadManifest(dir);

    expect(manifest.name).toBe('Security Reviewer');
    expect(manifest.model).toBe('deepseek/deepseek-v4-flash');
    expect(manifest.skills).toEqual(['security-basics']);
    expect(manifest.ci_fail_on).toBe('critical');
  });

  it('fails clearly when the manifest fails schema validation (bad ci_fail_on)', () => {
    writeFileSync(
      path.join(dir, 'agents', 'bad.yaml'),
      `
name: "Bad Agent"
model: "gpt-4.1"
system_prompt: "review"
ci_fail_on: "sometimes"
`,
    );

    expect(() => loadManifest(dir)).toThrow(RunnerError);
    expect(() => loadManifest(dir)).toThrow(/failed validation/i);
  });

  it('fails clearly when the manifest is missing required fields', () => {
    writeFileSync(path.join(dir, 'agents', 'incomplete.yaml'), 'name: "No model or prompt"\n');
    expect(() => loadManifest(dir)).toThrow(RunnerError);
  });

  it('fails clearly when no manifest file exists', () => {
    rmSync(path.join(dir, 'agents', ), { recursive: true, force: true });
    expect(() => findManifestPath(dir)).toThrow(/not found/i);
  });

  it('fails clearly when more than one manifest file exists', () => {
    writeFileSync(path.join(dir, 'agents', 'a.yaml'), VALID_MANIFEST_YAML);
    writeFileSync(path.join(dir, 'agents', 'b.yaml'), VALID_MANIFEST_YAML);
    expect(() => findManifestPath(dir)).toThrow(/exactly one/i);
  });

  describe('--agent <slug> (several agents share one repo)', () => {
    it('selects the named manifest among several (.yaml or .yml)', () => {
      writeFileSync(path.join(dir, 'agents', 'security-reviewer.yaml'), VALID_MANIFEST_YAML);
      writeFileSync(
        path.join(dir, 'agents', 'perf.yml'),
        VALID_MANIFEST_YAML.replace('Security Reviewer', 'Perf Reviewer'),
      );
      expect(loadManifest(dir, {}, 'perf').name).toBe('Perf Reviewer');
      expect(loadManifest(dir, {}, 'security-reviewer').name).toBe('Security Reviewer');
      // Without a slug the exactly-one rule still applies, and names the flag.
      expect(() => findManifestPath(dir)).toThrow(/pass --agent <slug>/);
    });

    it('fails clearly when the named manifest does not exist', () => {
      writeFileSync(path.join(dir, 'agents', 'security-reviewer.yaml'), VALID_MANIFEST_YAML);
      expect(() => findManifestPath(dir, {}, 'missing')).toThrow(/No manifest for agent 'missing'/);
    });

    it('refuses a slug that could escape agents/', () => {
      writeFileSync(path.join(dir, 'agents', 'security-reviewer.yaml'), VALID_MANIFEST_YAML);
      for (const slug of ['../agents/security-reviewer', 'a/b', 'Security', '', '.hidden']) {
        expect(() => findManifestPath(dir, {}, slug), slug).toThrow(/Invalid agent slug/);
      }
    });
  });

  it('fails clearly on malformed YAML', () => {
    writeFileSync(path.join(dir, 'agents', 'broken.yaml'), 'name: "unterminated\n  bad: [1, 2\n');
    const manifestPath = path.join(dir, 'agents', 'broken.yaml');
    expect(() => loadAgentManifest(manifestPath)).toThrow(RunnerError);
  });
});
