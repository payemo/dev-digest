/**
 * Blast Radius (L04) — the read-only use case behind `GET /pulls/:id/blast`.
 *
 * It reads the index `repo-intel` already built at clone time and maps it onto
 * the wire contract. There is NO model call, no persistence, no new table and
 * no re-parsing: one facade call per request, and the facade itself never
 * throws — an unusable index comes back as empty arrays plus `degraded`, which
 * is passed through so the UI can say so instead of showing a blank card.
 *
 * Both dependencies are typed `Container['reviewRepo']` / `Container['repoIntel']`
 * rather than the concrete classes ON PURPOSE: naming a class would force an
 * import of another module's data layer, and that edge is the
 * `no-cross-module-repository` rule in `.dependency-cruiser.cjs`. `import type`
 * does not escape it either — `tsPreCompilationDeps: true` keeps type-only
 * imports in the graph. Precedent: `smart-diff/service.ts`.
 */
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { toBlastRadiusResponse } from './helpers.js';
import type { BlastRadiusResponse } from '@devdigest/shared';

export class BlastService {
  constructor(
    private repo: Container['reviewRepo'],
    private intel: Container['repoIntel'],
  ) {}

  /** What else in the repo this PR's diff can reach. Workspace-scoped via the PR. */
  async forPull(workspaceId: string, prId: string): Promise<BlastRadiusResponse> {
    // The PR lookup IS the workspace scope check, and it is the ONLY one:
    // repo-intel's own tables carry no workspace_id, so nothing downstream of
    // here can re-check tenancy.
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const files = await this.repo.getPrFiles(prId);

    // An empty file list is passed straight through — the facade already
    // answers it with a degraded empty result, so there is nothing to special
    // case and no second call to make.
    const result = await this.intel.getBlastRadius(
      pull.repoId,
      files.map((f) => f.path),
    );
    return toBlastRadiusResponse(result);
  }
}
