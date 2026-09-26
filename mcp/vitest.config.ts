import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // Mirrors the tsconfig path. Contracts are imported type-only, so this
      // alias should never actually resolve at runtime — it is here so a
      // stray value import fails loudly in tests rather than silently in prod.
      '@devdigest/shared': path.resolve(__dirname, '../server/src/vendor/shared'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
