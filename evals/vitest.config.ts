import { defineConfig } from "vitest/config";
import TrendReporter from "./src/trend-reporter.js";

export default defineConfig({
  test: {
    // *.eval.ts = model-backed evals; src/**/*.test.ts = the pure stats unit tests.
    include: ["**/*.eval.ts", "src/**/*.test.ts"],
    // Real Claude sessions (and a subagent dispatch) are slow — give them room.
    // CI sets EVAL_TEST_TIMEOUT_MS higher: cheap reasoning models take 30+ agent turns per case.
    testTimeout: Number(process.env.EVAL_TEST_TIMEOUT_MS ?? 240_000),
    hookTimeout: Number(process.env.EVAL_TEST_TIMEOUT_MS ?? 240_000),
    // One session per test; a few files can run concurrently. Keep it modest to stay cheap.
    fileParallelism: true,
    reporters: ["default", new TrendReporter()],
  },
});
