import { DigestModelOutput, type Digest } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { DIGEST_JOB_KIND, DIGEST_TEMPERATURE, DIGEST_TIMEOUT_MS } from './constants.js';
import { renderMessage, selectPulls, toDigest } from './helpers.js';
import { buildDigestMessages } from './prompt.js';

const DIGEST_SYSTEM_PROMPT = `You write a weekly engineering digest for a team lead.
Summarise the pull requests below into at most 8 items. Each item names the
pull request number and one sentence on what changed and why it matters.
Group related pull requests, skip trivial dependency bumps, and open with a
single-sentence headline. Reply with JSON matching the requested schema only.`;

interface DigestPayload {
  workspaceId: string;
  from: string;
  to: string;
}

export class DigestService {
  constructor(private container: Container) {}

  async latest(workspaceId: string): Promise<Digest> {
    const row = await this.container.digestRepo.latest(workspaceId);
    if (!row) throw new NotFoundError('digest');
    return toDigest(row);
  }

  async requestBuild(workspaceId: string, from: Date, to: Date): Promise<{ jobId: string }> {
    this.container.jobs.register(DIGEST_JOB_KIND, async (payload) => {
      const p = payload as DigestPayload;
      await this.build(p.workspaceId, new Date(p.from), new Date(p.to));
    });
    const job = await this.container.jobs.enqueue(workspaceId, DIGEST_JOB_KIND, {
      workspaceId,
      from: from.toISOString(),
      to: to.toISOString(),
    } satisfies DigestPayload);
    return { jobId: job.id };
  }

  async build(workspaceId: string, from: Date, to: Date): Promise<void> {
    const pulls = selectPulls(await this.container.digestRepo.pullsInRange(workspaceId, from, to));
    const choice = await resolveFeatureModel(this.container, workspaceId, 'digest');
    const llm = await this.container.llm(choice.provider);

    const result = await llm.structured({
      model: choice.model,
      messages: buildDigestMessages(DIGEST_SYSTEM_PROMPT, pulls),
      schema: DigestModelOutput,
      schemaName: 'digest',
      temperature: DIGEST_TEMPERATURE,
      timeoutMs: DIGEST_TIMEOUT_MS,
    });

    await this.container.digestRepo.save(workspaceId, {
      periodStart: from,
      periodEnd: to,
      headline: result.headline,
      items: result.items,
    });

    const hook = await this.container.secrets.get('slack-webhook-url');
    if (hook) {
      await fetch(hook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: renderMessage(result) }),
      });
    }
  }
}
