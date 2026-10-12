import type {
  CiAgentOverview,
  CiExport,
  CiExportInput,
  CiFile,
  CiInstallation,
  CiPostAs,
  CiPreview,
  CiPreviewInput,
  CiRun,
  CiRunsQuery,
  CiTrigger,
  GitHubClient,
  RepoRef,
  RunnerBundle,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import type { AgentRow, RepoRow } from '../../db/rows.js';
import {
  AppError,
  ConfigError,
  ConflictError,
  ExternalServiceError,
  NotFoundError,
  ValidationError,
} from '../../platform/errors.js';
import {
  CI_BRANCH,
  CI_MEMORY_PATH,
  CI_OVERVIEW_RECENT_RUNS,
  CI_PR_TITLE,
  CI_RUNNER_PATH,
  CI_SECRET_NAMES,
  CI_SUPPORTED_PROVIDERS,
  CI_SUPPORTED_TARGETS,
  CI_WORKFLOW_TEMPLATE_VERSION,
} from './constants.js';
import {
  assertSafeExportPath,
  byteLength,
  ciAgentManifestPath,
  ciSkillPath,
  ciSlug,
  ciWorkflowPath,
  gitBlobSha,
  sha256,
  toCiInstallationDto,
  toCiRunDto,
  toMemoryJsonl,
} from './helpers.js';
import { buildManifestYaml } from './manifest.js';
import { buildWorkflowYaml, validateWorkflowYaml } from './workflow.js';
import { CiRepository, type CiInstallationRow } from './repository.js';

type Role = NonNullable<CiFile['role']>;
type Blocking = CiPreview['blocking'][number];

/** A generated file, with its full contents (the runner included). */
interface BundleFile {
  path: string;
  contents: string;
  role: Role;
}

/** Everything one export/preview/update generates for (agent, repo). */
interface Bundle {
  agentSlug: string;
  workflowPath: string;
  workflowYaml: string;
  manifestSha256: string;
  runner: RunnerBundle | null;
  files: BundleFile[];
  blocking: Blocking[];
  repoRow: RepoRow | undefined;
}

interface BundleOptions {
  repo: string;
  target: string;
  triggers: CiTrigger[];
  postAs: CiPostAs;
  /** User-edited (already validated) or stored workflow; null = generate. */
  workflowYaml: string | null;
}

function toRepoRef(fullName: string): RepoRef {
  const [owner, name] = fullName.split('/');
  if (!owner || !name) throw new ValidationError(`invalid repository "${fullName}"`);
  return { owner, name };
}

function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

/**
 * Export to CI: preview the generated bundle, commit it to `devdigest/ci` and
 * open a PR (or hand the files back for a zip), keep installations up to date,
 * and summarize CI state for an agent. Every generated file is produced here,
 * server-side; the only client-supplied content ever written is the edited
 * workflow, after validation.
 */
export class CiService {
  readonly repo: CiRepository;

  constructor(private container: Container) {
    this.repo = new CiRepository(container.db);
  }

  // ---- reads ----------------------------------------------------------------

  async preview(ws: string, agentId: string, input: CiPreviewInput): Promise<CiPreview> {
    const agent = await this.getAgent(ws, agentId);
    const existing = await this.findInstallation(ws, agentId, input.repo);
    const bundle = await this.assemble(ws, agent, existing, {
      repo: input.repo,
      target: input.target,
      triggers: input.triggers,
      postAs: input.post_as,
      workflowYaml: null,
    });
    return {
      files: bundle.files.map((f) => this.toFileDto(f, { includeRunner: false })),
      workflow_path: bundle.workflowPath,
      branch: CI_BRANCH,
      blocking: bundle.blocking,
      secret_names: [...CI_SECRET_NAMES],
    };
  }

  async overview(ws: string, agentId: string): Promise<CiAgentOverview> {
    const agent = await this.getAgent(ws, agentId);
    const installs = await this.repo.listInstallationsForAgent(ws, agentId);
    const runner = await this.container.runnerBundle.read();
    const manifestSha = installs.length > 0 ? sha256(await this.manifestFor(agent)) : null;

    const runs = await this.repo.listRuns(ws, {
      days: 90,
      agent_id: agentId,
      limit: CI_OVERVIEW_RECENT_RUNS,
    });

    const installations = installs.map((inst) => {
      const outdated =
        agent.version !== inst.manifestVersion ||
        (manifestSha != null && manifestSha !== inst.manifestSha256) ||
        (runner != null && runner.sha256 !== inst.runnerSha256);
      return toCiInstallationDto(inst, outdated);
    });
    return {
      agent_id: agent.id,
      ci_fail_on: agent.ciFailOn,
      active_repos: new Set(installs.map((i) => i.repo.toLowerCase())).size,
      installations,
      recent_runs: runs.map(toCiRunDto),
    };
  }

  async listRuns(ws: string, query: CiRunsQuery): Promise<CiRun[]> {
    const rows = await this.repo.listRuns(ws, query);
    return rows.map(toCiRunDto);
  }

  /** The runner bundle for the client-side zip. 409 when it is not built. */
  async runner(
    ws: string,
    agentId: string,
  ): Promise<{ path: string; contents: string; sha256: string; version: string }> {
    await this.getAgent(ws, agentId);
    const bundle = await this.container.runnerBundle.read();
    if (!bundle) throw new ConflictError(this.runnerMissingMessage());
    return { path: CI_RUNNER_PATH, contents: bundle.contents, sha256: bundle.sha256, version: bundle.version };
  }

  // ---- writes ---------------------------------------------------------------

  async export(ws: string, agentId: string, input: CiExportInput): Promise<CiExport> {
    const agent = await this.getAgent(ws, agentId);
    const existing = await this.findInstallation(ws, agentId, input.repo);

    // The only client-supplied file content: the edited workflow, validated
    // against the slug this export will use.
    const slug = await this.agentSlugFor(ws, agent, input.repo, existing);
    let workflowYaml: string | null = null;
    if (input.workflow_yaml != null && input.workflow_yaml.trim() !== '') {
      const check = validateWorkflowYaml(input.workflow_yaml, slug);
      if (check.errors.length > 0) {
        throw new ValidationError('The edited workflow is not valid', { errors: check.errors });
      }
      workflowYaml = input.workflow_yaml;
    }

    const bundle = await this.assemble(ws, agent, existing, {
      repo: input.repo,
      target: input.target,
      triggers: input.triggers,
      postAs: input.post_as,
      workflowYaml,
    });
    this.assertNotBlocked(bundle);

    let prUrl: string | null = null;
    if (input.action === 'open_pr') {
      prUrl = await this.publish(agent, input.repo, bundle, input.base ?? null);
    }

    const row = await this.saveInstallation(ws, agent, input.repo, bundle, {
      triggers: input.triggers,
      postAs: input.post_as,
      branch: input.action === 'open_pr' ? CI_BRANCH : null,
      prUrl,
    });
    return {
      installation: toCiInstallationDto(row, false),
      files: bundle.files.map((f) =>
        this.toFileDto(f, { includeRunner: input.action === 'files' }),
      ),
      pr_url: prUrl,
    };
  }

  /**
   * Regenerate and recommit every PR-based installation of the agent (manifest,
   * skills, memory, runner), keeping each installation's stored workflow.
   */
  async updateConfig(ws: string, agentId: string): Promise<{ installations: CiInstallation[] }> {
    const agent = await this.getAgent(ws, agentId);
    const installs = (await this.repo.listInstallationsForAgent(ws, agentId)).filter(
      (i) => i.branch != null,
    );
    const updated: CiInstallation[] = [];
    for (const inst of installs) {
      const triggers = inst.triggers.filter(
        (t): t is CiTrigger => t === 'opened' || t === 'synchronize' || t === 'reopened',
      );
      const bundle = await this.assemble(ws, agent, inst, {
        repo: inst.repo,
        target: inst.targetType,
        triggers: triggers.length > 0 ? triggers : ['opened', 'synchronize'],
        postAs: inst.postAs,
        workflowYaml: inst.workflowYaml,
      });
      this.assertNotBlocked(bundle);
      const prUrl = await this.publish(agent, inst.repo, bundle, null);
      const row = await this.saveInstallation(ws, agent, inst.repo, bundle, {
        triggers: triggers.length > 0 ? triggers : ['opened', 'synchronize'],
        postAs: inst.postAs,
        branch: CI_BRANCH,
        prUrl,
      });
      updated.push(toCiInstallationDto(row, false));
    }
    return { installations: updated };
  }

  // ---- internals ------------------------------------------------------------

  private async getAgent(ws: string, agentId: string): Promise<AgentRow> {
    const agent = await this.container.agentsRepo.getById(ws, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    return agent;
  }

  private async findInstallation(
    ws: string,
    agentId: string,
    repo: string,
  ): Promise<CiInstallationRow | undefined> {
    const all = await this.repo.listInstallationsForRepo(ws, repo);
    return all.find((i) => i.agentId === agentId);
  }

  /** Reuse the installation's slug; otherwise pick one unique within the repo. */
  private async agentSlugFor(
    ws: string,
    agent: AgentRow,
    repo: string,
    existing: CiInstallationRow | undefined,
  ): Promise<string> {
    if (existing?.agentSlug) return existing.agentSlug;
    const others = await this.repo.listInstallationsForRepo(ws, repo);
    const taken = new Set(
      others.filter((i) => i.agentId !== agent.id && i.agentSlug).map((i) => i.agentSlug),
    );
    return ciSlug(agent.name, taken);
  }

  /** Enabled linked skills, in the agent's order — what a run injects. */
  private async enabledSkills(agentId: string): Promise<{ slug: string; body: string }[]> {
    const links = await this.container.agentsRepo.linkedSkills(agentId);
    const taken = new Set<string>();
    return links
      .filter((l) => l.skill.enabled)
      .map((l) => ({ slug: ciSlug(l.skill.name, taken), body: l.skill.body }));
  }

  private async manifestFor(agent: AgentRow): Promise<string> {
    const skills = await this.enabledSkills(agent.id);
    return buildManifestYaml(
      {
        name: agent.name,
        version: agent.version,
        provider: agent.provider,
        model: agent.model,
        systemPrompt: agent.systemPrompt,
        strategy: agent.strategy,
        ciFailOn: agent.ciFailOn,
      },
      skills.map((s) => s.slug),
    );
  }

  private async assemble(
    ws: string,
    agent: AgentRow,
    existing: CiInstallationRow | undefined,
    opts: BundleOptions,
  ): Promise<Bundle> {
    const blocking: Blocking[] = [];
    const repoRow = await this.container.reposRepo.findByFullName(ws, opts.repo);
    if (!repoRow) {
      blocking.push({
        code: 'repo_not_imported',
        message: `${opts.repo} is not an imported repository. Import it first.`,
      });
    }
    if (!(CI_SUPPORTED_PROVIDERS as readonly string[]).includes(agent.provider)) {
      blocking.push({
        code: 'provider_unsupported',
        message: `CI runs use OpenRouter only; this agent uses ${agent.provider}. Switch its provider to OpenRouter in Config.`,
      });
    }
    if (!(CI_SUPPORTED_TARGETS as readonly string[]).includes(opts.target)) {
      blocking.push({
        code: 'target_unsupported',
        message: 'Only GitHub Actions is supported for now.',
      });
    }
    const runner = await this.container.runnerBundle.read();
    if (!runner) blocking.push({ code: 'runner_bundle_missing', message: this.runnerMissingMessage() });

    const agentSlug = await this.agentSlugFor(ws, agent, opts.repo, existing);
    const workflowPath = ciWorkflowPath(agentSlug);
    const skills = await this.enabledSkills(agent.id);
    const manifest = buildManifestYaml(
      {
        name: agent.name,
        version: agent.version,
        provider: agent.provider,
        model: agent.model,
        systemPrompt: agent.systemPrompt,
        strategy: agent.strategy,
        ciFailOn: agent.ciFailOn,
      },
      skills.map((s) => s.slug),
    );
    const memoryRows = await this.repo.listMemoryForExport(ws, repoRow?.id ?? null);
    const workflowYaml =
      opts.workflowYaml ??
      buildWorkflowYaml({
        agentName: agent.name,
        agentSlug,
        triggers: opts.triggers,
        postAs: opts.postAs,
      });

    const files: BundleFile[] = [
      { path: ciAgentManifestPath(agentSlug), contents: manifest, role: 'manifest' },
      ...skills.map((s) => ({ path: ciSkillPath(s.slug), contents: s.body, role: 'skill' as const })),
      { path: CI_MEMORY_PATH, contents: toMemoryJsonl(memoryRows), role: 'memory' },
      { path: workflowPath, contents: workflowYaml, role: 'workflow' },
    ];
    if (runner) files.push({ path: CI_RUNNER_PATH, contents: runner.contents, role: 'runner' });
    for (const f of files) assertSafeExportPath(f.path);

    return {
      agentSlug,
      workflowPath,
      workflowYaml,
      manifestSha256: sha256(manifest),
      runner,
      files,
      blocking,
      repoRow,
    };
  }

  private assertNotBlocked(bundle: Bundle): void {
    if (bundle.blocking.length > 0) {
      throw new ConflictError(bundle.blocking.map((b) => b.message).join(' '), {
        blocking: bundle.blocking,
      });
    }
  }

  private toFileDto(f: BundleFile, opts: { includeRunner: boolean }): CiFile {
    const omit = f.role === 'runner' && !opts.includeRunner;
    return {
      path: f.path,
      contents: omit ? '' : f.contents,
      editable: f.role === 'workflow',
      role: f.role,
      size_bytes: byteLength(f.contents),
    };
  }

  /** Commit the bundle to `devdigest/ci` and reuse or open its PR. */
  private async publish(
    agent: AgentRow,
    repoFullName: string,
    bundle: Bundle,
    base: string | null,
  ): Promise<string> {
    const repo = toRepoRef(repoFullName);
    const gh = await this.githubClient();
    const baseBranch =
      base ??
      (await this.ghCall('read the repository', 'Contents: read', () => gh.getRepoDefaultBranch(repo)));
    if (baseBranch === CI_BRANCH) {
      throw new ValidationError(`the base branch cannot be ${CI_BRANCH}`);
    }
    // Only ever the dedicated branch — never the base/default branch.
    await this.ghCall('commit to devdigest/ci', 'Contents: write and Workflows: write', () =>
      gh.commitFiles(repo, {
        branch: CI_BRANCH,
        base: baseBranch,
        message: `chore(devdigest): add ${agent.name} CI review`,
        files: bundle.files.map((f) => ({ path: f.path, contents: f.contents })),
      }),
    );
    const open = await this.ghCall('find the open PR', 'Pull requests: read', () =>
      gh.findOpenPr(repo, CI_BRANCH),
    );
    if (open) return open.url;
    const created = await this.ghCall('open the PR', 'Pull requests: write', () =>
      gh.openPullRequest(repo, {
        title: CI_PR_TITLE,
        head: CI_BRANCH,
        base: baseBranch,
        body: this.prBody(agent, bundle),
      }),
    );
    return created.url;
  }

  private prBody(agent: AgentRow, bundle: Bundle): string {
    const files = bundle.files.map((f) => `- \`${f.path}\``).join('\n');
    return [
      `This PR adds a DevDigest review agent (**${agent.name}**) to GitHub Actions.`,
      '',
      'Files:',
      files,
      '',
      '**Before merging:** add the repository secret `OPENROUTER_API_KEY`',
      '(Settings → Secrets and variables → Actions). `GITHUB_TOKEN` is provided by GitHub Actions automatically.',
      '',
      `To block merges on a failing review, mark the \`review\` check of \`${bundle.workflowPath}\` as a required status check.`,
    ].join('\n');
  }

  private async saveInstallation(
    ws: string,
    agent: AgentRow,
    repo: string,
    bundle: Bundle,
    meta: { triggers: CiTrigger[]; postAs: CiPostAs; branch: string | null; prUrl: string | null },
  ): Promise<CiInstallationRow> {
    const runner = bundle.runner!;
    const expectedBlobs = Object.fromEntries(bundle.files.map((f) => [f.path, gitBlobSha(f.contents)]));
    return this.repo.upsertInstallation(ws, {
      agentId: agent.id,
      repo,
      targetType: 'gha',
      repoId: bundle.repoRow?.id ?? null,
      agentSlug: bundle.agentSlug,
      postAs: meta.postAs,
      triggers: meta.triggers,
      workflowPath: bundle.workflowPath,
      workflowYaml: bundle.workflowYaml,
      workflowVersion: CI_WORKFLOW_TEMPLATE_VERSION,
      manifestVersion: agent.version,
      manifestSha256: bundle.manifestSha256,
      runnerVersion: runner.version,
      runnerSha256: runner.sha256,
      expectedBlobs,
      branch: meta.branch,
      prUrl: meta.prUrl,
    });
  }

  private runnerMissingMessage(): string {
    return 'The CI runner bundle has not been built. Run `cd agent-runner && pnpm install && pnpm build`.';
  }

  /** The GitHub port, with a missing token surfaced as an actionable error. */
  async githubClient(): Promise<GitHubClient> {
    try {
      return await this.container.github();
    } catch (err) {
      if (err instanceof ConfigError) {
        throw new AppError('github_not_connected', 'Connect GitHub in Settings → API Keys.', 412);
      }
      throw err;
    }
  }

  /** Map a raw GitHub failure to an error naming the likely missing scope. */
  private async ghCall<T>(what: string, scope: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (isAppError(err)) throw err;
      const status = (err as { status?: number } | null)?.status;
      if (status === 403 || status === 404) {
        throw new ExternalServiceError(
          `GitHub refused to ${what} (HTTP ${status}). The GitHub token likely lacks "${scope}" for this repository.`,
        );
      }
      throw new ExternalServiceError(`GitHub failed to ${what}: ${(err as Error).message}`);
    }
  }
}
