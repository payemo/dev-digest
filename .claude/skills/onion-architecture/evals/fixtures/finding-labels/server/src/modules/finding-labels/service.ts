import type { AddLabelBody, FindingLabel } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { ConflictError, NotFoundError } from '../../platform/errors.js';
import { canAddLabel, toLabel } from './helpers.js';
import { FindingLabelRepository, type FindingLabelRow } from './repository.js';

export class FindingLabelService {
  private repo: FindingLabelRepository;

  constructor(container: Container) {
    this.repo = new FindingLabelRepository(container.db);
  }

  async list(workspaceId: string, findingId: string): Promise<FindingLabelRow[]> {
    return this.repo.listForFinding(workspaceId, findingId);
  }

  async add(workspaceId: string, findingId: string, body: AddLabelBody): Promise<FindingLabel> {
    const existing = await this.repo.listForFinding(workspaceId, findingId);
    if (!canAddLabel(existing.length)) throw new ConflictError('label limit reached');
    return toLabel(await this.repo.insert(workspaceId, findingId, body.name, body.color));
  }

  async remove(workspaceId: string, labelId: string): Promise<void> {
    const removed = await this.repo.remove(workspaceId, labelId);
    if (!removed) throw new NotFoundError('label');
  }
}
