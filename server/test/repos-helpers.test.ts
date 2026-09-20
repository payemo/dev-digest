import { describe, it, expect } from 'vitest';
import { parseRepoUrl, canonicalCloneUrl } from '../src/modules/repos/helpers.js';
import { AppError } from '../src/platform/errors.js';

/**
 * Unit coverage for `parseRepoUrl` — the gate between a caller-supplied
 * `POST /repos` URL and `git clone`. Anchored matching is the whole point:
 * an unanchored regex let a string that merely *contains* `github.com/o/r`
 * extract owner/name while carrying arbitrary scheme/host/args around it,
 * which then reached `git clone` verbatim (git's `ext::` transport shells
 * out; other schemes give SSRF). These cases must be rejected, not sanitized.
 */

describe('parseRepoUrl', () => {
  it('parses the canonical https form', () => {
    expect(parseRepoUrl('https://github.com/payemo/dev-digest')).toEqual({
      owner: 'payemo',
      name: 'dev-digest',
    });
  });

  it('parses the https form with a .git suffix and trailing slash', () => {
    expect(parseRepoUrl('https://github.com/payemo/dev-digest.git')).toEqual({
      owner: 'payemo',
      name: 'dev-digest',
    });
    expect(parseRepoUrl('https://github.com/payemo/dev-digest/')).toEqual({
      owner: 'payemo',
      name: 'dev-digest',
    });
  });

  it('parses the ssh form', () => {
    expect(parseRepoUrl('git@github.com:payemo/dev-digest.git')).toEqual({
      owner: 'payemo',
      name: 'dev-digest',
    });
  });

  it('rejects a git ext:: transport smuggled around a github.com substring', () => {
    expect(() => parseRepoUrl('ext::sh -c id github.com/a/b')).toThrow(AppError);
  });

  it('rejects an SSRF attempt against a link-local host', () => {
    expect(() =>
      parseRepoUrl('http://169.254.169.254/latest/github.com/a/b'),
    ).toThrow(AppError);
  });

  it('rejects a file:// URL', () => {
    expect(() => parseRepoUrl('file:///etc/github.com/a/b')).toThrow(AppError);
  });

  it('rejects a look-alike host', () => {
    expect(() => parseRepoUrl('https://evil.example.com/github.com/a/b')).toThrow(AppError);
    expect(() => parseRepoUrl('https://github.com.evil.example.com/a/b')).toThrow(AppError);
  });

  it('rejects plain http (not https)', () => {
    expect(() => parseRepoUrl('http://github.com/payemo/dev-digest')).toThrow(AppError);
  });
});

describe('canonicalCloneUrl', () => {
  it('builds a clean https URL from owner/name alone', () => {
    expect(canonicalCloneUrl('payemo', 'dev-digest')).toBe(
      'https://github.com/payemo/dev-digest.git',
    );
  });
});
