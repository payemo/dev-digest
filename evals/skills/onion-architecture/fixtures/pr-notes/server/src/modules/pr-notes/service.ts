import { Octokit } from 'octokit';
import type { PrNote } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { NOTES_PAGE_SIZE } from './constants.js';
import { clampBody, toNote } from './helpers.js';
import { PrNoteRepository } from './repository.js';

export class PrNoteService {
  private repo: PrNoteRepository;

  constructor(private container: Container) {
    this.repo = new PrNoteRepository(container);
  }

  async list(workspaceId: string, pullId: string): Promise<PrNote[]> {
    const rows = await this.repo.list(workspaceId, pullId, NOTES_PAGE_SIZE);
    return rows.map(toNote);
  }

  async add(workspaceId: string, pullId: string, body: string): Promise<PrNote> {
    const token = await this.container.secrets.get('github-token');
    const octokit = new Octokit({ auth: token });
    const { data: viewer } = await octokit.rest.users.getAuthenticated();
    if (!viewer.login) throw new NotFoundError('github user');
    const row = await this.repo.insert(workspaceId, pullId, viewer.login, clampBody(body));
    return toNote(row);
  }
}
