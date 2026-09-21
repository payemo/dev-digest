/**
 * Architecture rules for @devdigest/api — Onion Architecture layer boundaries.
 *
 * The prose version, with rationale and examples, is
 * `.claude/skills/onion-architecture/SKILL.md`. Keep the two in sync: every
 * CRITICAL rule there should be a `forbidden` entry here.
 *
 *   cd server && pnpm exec depcruise src --config .dependency-cruiser.cjs
 *
 * NOT wired into CI and NOT a package.json script — `server/package.json` is
 * `skip-worktree` (see the root CLAUDE.md), so a script added there would not
 * reach other checkouts. Run it locally / from an agent.
 *
 * This file does NOT affect `adapters/depgraph/index.ts`: that calls
 * dependency-cruiser's programmatic `cruise()` with an explicit options object
 * (no config-file lookup), and it cruises *cloned* repos under `clones/`,
 * never our own `src/`.
 *
 * Dependency rule (Palermo): all code can depend on layers more central, but
 * code cannot depend on layers further out from the core.
 *
 *   Edge     modules/<d>/routes.ts, app.ts, server.ts, modules/index.ts,
 *            modules/_shared/context.ts
 *   Root     platform/container.ts
 *   Infra    adapters/**, db/**, modules/<d>/repository{,/*}.ts
 *   App      modules/<d>/service.ts, modules/<d>/helpers.ts
 *   Ports    vendor/shared/adapters.ts
 *   Core     vendor/shared/contracts/**, ../reviewer-core/src/**
 *
 * `platform/` is deliberately unruled: it is mixed by design (jobs.ts is
 * infrastructure and uses Drizzle; grounding.ts / prompt.ts / structured.ts
 * are pure).
 */

/**
 * Match an npm package by name. `to.path` is tested against the RESOLVED path,
 * and under pnpm that is
 *   node_modules/.pnpm/fastify@5.8.5/node_modules/fastify/fastify.js
 * so an anchored '^fastify' would never match. Matching the trailing
 * `node_modules/<pkg>/` segment is both pnpm- and npm-safe.
 */
const pkg = (...names) => `node_modules/(${names.join('|')})/`;

/**
 * Modules that predate these rules and query Drizzle straight from their route
 * handlers. This is a DEBT LIST — it should only ever shrink. If you are
 * editing one of these files anyway, extract the queries you touch into a
 * `repository.ts` and delete the entry.
 *
 *   settings  — no service; feature-models.ts also queries directly
 *   workspace — no service or repository
 *
 * `pulls` and `polling` were the worst case (397 lines, 18 inline queries,
 * duplicated between the two) — extracted into pulls/repository.ts +
 * pulls/service.ts.
 */
const LEGACY_DB_IN_ROUTES = '^src/modules/(settings|workspace)/(routes|feature-models)\\.ts$';

/** Files allowed to name Fastify — the HTTP edge, and nothing else. */
const HTTP_EDGE = [
  '^src/(app|server)\\.ts$',
  '^src/modules/index\\.ts$',
  '^src/modules/_shared/context\\.ts$',
  '^src/modules/[^/]+/routes\\.ts$',
];

/** A module's repository layer — the flat file and the per-aggregate split. */
const REPOSITORY = [
  '^src/modules/[^/]+/repository\\.ts$',
  '^src/modules/[^/]+/repository/[^/]+\\.ts$',
];

/** Third-party SDKs that may only be reached through an adapter. */
const EXTERNAL_SDKS = pkg(
  'octokit',
  'simple-git',
  '@ast-grep/napi',
  'openai',
  '@anthropic-ai/sdk',
  '@vscode/ripgrep',
  'graphology',
  'dependency-cruiser',
);

const DRIZZLE = pkg('drizzle-orm');
const FASTIFY = pkg('fastify', '@fastify/[^/]+', 'fastify-type-provider-zod', 'fastify-sse-v2');

module.exports = {
  forbidden: [
    // ---- Edge ------------------------------------------------------------
    {
      name: 'no-db-in-routes',
      comment:
        'A route handler must not touch the database. Move the query into the ' +
        "module's repository.ts and call it through service.ts. " +
        'See skills/onion-architecture SKILL.md §1.',
      severity: 'error',
      from: {
        path: '^src/modules/[^/]+/routes\\.ts$',
        pathNot: LEGACY_DB_IN_ROUTES,
      },
      to: { path: ['^src/db/', DRIZZLE] },
    },

    // ---- Application -----------------------------------------------------
    {
      name: 'no-db-in-service',
      comment:
        'A service orchestrates ports and its repository; it must not build SQL. ' +
        'See SKILL.md §2.',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/service\\.ts$' },
      to: { path: ['^src/db/schema', DRIZZLE] },
    },
    {
      name: 'no-fastify-in-service',
      comment:
        'A service must be callable from a job handler and a test with no HTTP ' +
        'in sight. See SKILL.md §2.',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/service\\.ts$' },
      to: { path: FASTIFY },
    },
    {
      name: 'no-schema-in-helpers',
      comment:
        'helpers.ts is pure. A row type belongs in src/db/rows.ts and is ' +
        'imported type-only. See SKILL.md §4/§5.',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/helpers\\.ts$' },
      to: { path: ['^src/db/schema', DRIZZLE] },
    },
    {
      name: 'no-container-in-helpers',
      comment:
        'A helper that needs the container is a service method. See SKILL.md §5.',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/helpers\\.ts$' },
      to: { path: '^src/platform/container\\.ts$' },
    },
    {
      name: 'no-db-outside-repository',
      comment:
        'Closes the blind spot the three rules above leave: they only match ' +
        "routes.ts/service.ts/helpers.ts, so a module's other application-layer " +
        'files (run-executor.ts, diff-loader.ts, findings.ts, a repo-intel ' +
        'pipeline stage, …) could add a raw query and stay green. Only a ' +
        "module's repository.ts touches Drizzle/schema — everything else calls " +
        'it. See SKILL.md §2/§3.',
      severity: 'error',
      from: {
        path: '^src/modules/[^/]+/',
        pathNot: [
          ...REPOSITORY,
          '^src/modules/[^/]+/routes\\.ts$',
          '^src/modules/[^/]+/service\\.ts$',
          '^src/modules/[^/]+/helpers\\.ts$',
          LEGACY_DB_IN_ROUTES,
        ],
      },
      to: { path: ['^src/db/schema', DRIZZLE] },
    },

    // ---- Infrastructure --------------------------------------------------
    {
      name: 'no-container-in-repository',
      comment:
        'A repository takes Db in its constructor and nothing else. Reaching ' +
        'for the container means the query wants data it should have been ' +
        'passed. See SKILL.md §3.',
      severity: 'error',
      from: { path: REPOSITORY },
      to: { path: '^src/platform/container\\.ts$' },
    },
    {
      name: 'no-sdk-outside-adapters',
      comment:
        'Every external call goes behind a port in vendor/shared/adapters.ts, ' +
        'implemented under src/adapters/. See SKILL.md §6.',
      severity: 'error',
      from: {
        pathNot: [
          '^src/adapters/',
          // reviewer-core's OWN adapter directory. `openai` is confined to
          // these two files (openrouter.ts, structured.ts); the actual pure
          // core — grounding.ts, prompt.ts, review/, output/ — never imports
          // an SDK, and this rule keeps it that way.
          'reviewer-core/src/llm/',
        ],
      },
      to: { path: EXTERNAL_SDKS },
    },
    {
      name: 'no-fastify-outside-edge',
      comment:
        'Fastify is a delivery detail. Only routes.ts, app.ts, server.ts, ' +
        'modules/index.ts and _shared/context.ts may name it. See SKILL.md §1.',
      severity: 'error',
      from: { pathNot: HTTP_EDGE },
      to: { path: FASTIFY },
    },

    // ---- Core ------------------------------------------------------------
    {
      name: 'core-stays-pure',
      comment:
        'Contracts define the wire format and must not learn the storage ' +
        'format or the framework. zod only. See SKILL.md §7.',
      severity: 'error',
      from: { path: '^src/vendor/shared/contracts/' },
      to: {
        path: ['^src/db/', '^src/adapters/', '^src/platform/', FASTIFY, DRIZZLE],
      },
    },
    {
      name: 'ports-stay-pure',
      comment:
        'vendor/shared/adapters.ts declares interfaces; it must not import an ' +
        'implementation. See SKILL.md §6.',
      severity: 'error',
      from: { path: '^src/vendor/shared/adapters\\.ts$' },
      to: {
        path: ['^src/db/', '^src/adapters/', '^src/platform/', DRIZZLE, EXTERNAL_SDKS],
      },
    },
    {
      name: 'reviewer-core-stays-pure',
      comment:
        'reviewer-core is the pure engine: no DB, no GitHub, no FS, no HTTP. ' +
        'Its only side effect is an injected LLMProvider. See SKILL.md §7.',
      severity: 'error',
      from: { path: 'reviewer-core/src/' },
      to: {
        path: [
          '^src/db/',
          '^src/adapters/',
          '^src/platform/',
          FASTIFY,
          DRIZZLE,
          pkg('postgres', 'octokit', 'simple-git'),
        ],
      },
    },

    // ---- Cross-module ----------------------------------------------------
    {
      name: 'no-cross-module-repository',
      comment:
        "Don't reach into another module's data layer. Shared repositories are " +
        'built in the composition root (container.agentsRepo, container.reviewRepo); ' +
        'shared row types live in src/db/rows.ts. See SKILL.md §8.',
      severity: 'warn',
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/([^/]+)/repository',
        pathNot: '^src/modules/$1/',
      },
    },
    {
      name: 'no-circular',
      comment:
        'Circular imports make layering unprovable and break tree-shaking. ' +
        'viaOnly.dependencyTypesNot excludes cycles whose every hop is ' +
        'type-only: those are erased at compile time, so they are not a runtime ' +
        'cycle — and the import style SKILL.md §4 mandates ' +
        "(`import type { FooRow } from './repository.js'` inside a helper) " +
        'necessarily creates one, as does `import type { Container }` in a ' +
        'service (the accepted service-locator exception, SKILL.md §8).',
      severity: 'error',
      from: {},
      to: { circular: true, viaOnly: { dependencyTypesNot: ['type-only'] } },
    },
    {
      name: 'no-orphans',
      comment: 'Dead module — nothing imports it and it imports nothing.',
      severity: 'warn',
      from: {
        orphan: true,
        pathNot: [
          '\\.d\\.ts$',
          '^src/db/migrations/',
          // Intentionally uncalled: routeModel/PromptCache are additive and
          // opt-in ("does not change existing behaviour unless a service
          // chooses to route/cache through it"). Remove this entry if a call
          // site ever appears.
          '^src/platform/model-router\\.ts$',
        ],
      },
      to: {},
    },
  ],

  options: {
    // doNotFollow (not exclude) for node_modules: `exclude` drops the modules
    // from the graph entirely, which makes every npm-package rule above
    // silently match nothing. doNotFollow keeps the node, skips traversal.
    doNotFollow: { path: '(^|/)node_modules/' },
    exclude: { path: '(^|/)(dist|clones)/' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.js', '.ts', '.d.ts'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
