# References — Onion Architecture

Sources behind [SKILL.md](SKILL.md), with why each is cited.

## Primary — the pattern itself

Jeffrey Palermo introduced Onion Architecture in 2008. The four-part series is
the canonical statement; everything else on this page is commentary.

- [The Onion Architecture: part 1](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/)
  — the dependency rule in its original wording: *"all code can depend on layers
  more central, but code cannot depend on layers further out from the core."*
  Also the source of *"the database is not the center. It is external."*
- [Part 2](http://jeffreypalermo.com/blog/the-onion-architecture-part-2/) — the
  layer breakdown and where interfaces live.
- [Part 3](http://jeffreypalermo.com/blog/the-onion-architecture-part-3/) —
  applying it to a real project structure.
- [Part 4: After Four Years](http://jeffreypalermo.com/blog/onion-architecture-part-4-after-four-years/)
  — what held up and what Palermo would change. Read before treating any of the
  above as fixed.

**Caveat worth carrying:** a large share of secondary write-ups — including
several high-ranking blog posts and AI-generated summaries — state the
dependency rule *backwards* ("inner may depend on outer"). Check any source
against part 1 before following it.

## Placing it among its neighbours

- [Onion Architecture — Herberto Graça](https://medium.com/the-software-architecture-chronicles/onion-architecture-79529d127f85)
  — where onion sits relative to Hexagonal/Ports-and-Adapters and Clean
  Architecture. Useful because the three are often conflated; our
  `vendor/shared/adapters.ts` is literally the hexagonal ports idea inside an
  onion layering.
- [Sliced Onion Architecture — Oliver Drotbohm](http://odrotbohm.github.io/2023/07/sliced-onion-architecture/)
  — onion rings combined with vertical feature slices. This is exactly our
  `modules/<domain>/` layout, and it is the argument for why a per-domain
  `repository.ts` beats one global `data/` layer.

## Node.js / TypeScript implementations

- [Implementing SOLID and the onion architecture in Node.js with TypeScript — Remo Jansen](http://blog.wolksoftware.com/implementing-solid-and-the-onion-architecture-in-node-js-with-typescript-and-inversifyjs)
  — the reference TS treatment. We take the layering and the
  interface-at-the-boundary rule; we do **not** take InversifyJS — our
  `platform/container.ts` is a hand-rolled composition root, which is enough at
  this size.
- [Clean architecture with TypeScript: DDD, Onion — André Bazaglia](https://bazaglia.com/clean-architecture-with-typescript-ddd-onion/)
  — pragmatic folder structure and the case for keeping the core free of
  framework types.
- [onion-architecture-boilerplate (TypeScript)](https://github.com/Melzar/onion-architecture-boilerplate)
  — a worked layout to compare against; heavier on decorators than we want.

## Enforcement

Rules are only real if something checks them. `dependency-cruiser` is already a
`server/` dependency (v17.4.3, used by `adapters/depgraph` for repo-intel), so
`server/.dependency-cruiser.cjs` adds no new package.

- [dependency-cruiser — rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md)
  — `forbidden` / `allowed` / `required`, `pathNot`, `dependencyTypes`,
  severities. The authority for the config's syntax.
- [Validate Dependencies According to Clean Architecture — Ken Miyashita](https://betterprogramming.pub/validate-dependencies-according-to-clean-architecture-743077ea084c)
  — the layer-rule-per-`forbidden`-entry approach our config follows.
- [Avoid Cross Module Dependencies with Dependency Cruiser — Jakub Andrzejewski](https://dev.to/jacobandrewsky/avoid-cross-module-dependencies-with-dependency-cruiser-3b0b)
  — the module-boundary case, and the `no-circular` rule.

## Stack-specific

### Fastify — keeping the framework at the edge

- [The complete guide to the Fastify plugin system — Nearform](https://nearform.com/digital-community/the-complete-guide-to-fastify-plugin-system/)
  — encapsulation, scoping, the DAG of registrations. The reason a module's
  plugin boundary is a sensible architectural boundary too.
- [The hitchhiker's guide to plugins — Fastify docs](https://fastify.dev/docs/latest/Guides/Plugins-Guide/)
  — `register` creating a new scope; decorators and their visibility.
- [Fastify plugins as building blocks — Snyk](https://snyk.io/blog/fastify-plugins-for-backend-node-js-api/)
  — the routes / services / infrastructure split we use, argued from
  testability.

### Drizzle — keeping persistence behind the repository

- [Drizzle ORM Best Practices: Principles, Patterns, and Real-World Case Studies](https://paulserban.eu/blog/post/drizzle-orm-best-practices-principles-patterns-and-real-world-case-studies/)
  — *don't expose raw schema types beyond repository boundaries; the schema is
  an implementation detail of the data-access layer.* This is our §4.
- [Repository Pattern with Drizzle ORM](https://medium.com/@vimulatus/repository-pattern-in-nest-js-with-drizzle-orm-e848aa75ecae)
  — the repository as an Adapter, and mapping row → domain type at the seam.

## Counterweight — read this before adding a layer

- [You might not need… the repository pattern — Jay Freestone](https://www.jayfreestone.com/writing/you-might-not-need-the-repository-pattern/)
  — modern ORMs like Drizzle are closer to typed query builders than to classic
  ORMs, so the "swap the database" justification is weak. A repository earns its
  place at an **aggregate boundary with an invariant to protect**, not as
  ceremony around a single `SELECT`.

This is cited deliberately. The skill enforces layering because this codebase
has real external dependencies worth isolating — an LLM, GitHub, git, a code
index — not because indirection is inherently good. A wrapper with one caller
and no invariant is a cost, and §9's guidance to extract queries applies to
queries you are already touching, not to a sweep.
