import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * AC-78 / NFR-7 — the client's vendored copy of the shared contracts must be
 * byte-identical to the server's for every file the eval pipeline touches.
 * (CI runs `diff -r` over the whole directory; this keeps `verify:l06` honest
 * on its own.)
 */

const SERVER = path.resolve(__dirname, '../src/vendor/shared');
const CLIENT = path.resolve(__dirname, '../../client/src/vendor/shared');

const FILES = ['contracts/knowledge.ts', 'contracts/eval-ci.ts', 'contracts/findings.ts', 'index.ts'];

const read = (root: string, f: string) => readFileSync(path.join(root, f), 'utf8');

describe('shared eval contracts — server/client parity', () => {
  it.each(FILES)('%s is byte-identical in both copies', (f) => {
    const server = read(SERVER, f);
    const client = read(CLIENT, f);
    expect(
      client === server,
      `client/src/vendor/shared/${f} differs from server/src/vendor/shared/${f} — copy server → client`,
    ).toBe(true);
  });

  it.each(['contracts/eval-ci.ts', 'contracts/knowledge.ts'])(
    'every Eval* export of the server %s is declared in the client copy',
    (f) => {
      const names = [...read(SERVER, f).matchAll(/^export (?:const|type) (Eval\w+)/gm)].map((m) => m[1]!);
      expect(names.length).toBeGreaterThan(0);
      const client = read(CLIENT, f);
      const missing = [...new Set(names)].filter(
        (n) => !new RegExp(`^export (?:const|type) ${n}\\b`, 'm').test(client),
      );
      expect(missing, `client ${f} lacks ${missing.join(', ')} — copy server → client`).toEqual([]);
    },
  );
});
