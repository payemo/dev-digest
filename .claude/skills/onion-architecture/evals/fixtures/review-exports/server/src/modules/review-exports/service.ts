import type { ReviewExport } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { ReviewRepository } from '../reviews/repository.js';
import { DEFAULT_EXPORT_ROWS } from './constants.js';
import { toExport } from './helpers.js';
import { ReviewExportRepository } from './repository.js';

export class ReviewExportService {
  private repo: ReviewExportRepository;
  private reviews: ReviewRepository;

  constructor(private container: Container) {
    this.repo = new ReviewExportRepository(container.db);
    this.reviews = new ReviewRepository(container.db);
  }

  async export(workspaceId: string, reviewId: string, format: 'csv' | 'json'): Promise<ReviewExport> {
    const review = await this.reviews.getReview(reviewId);
    if (!review) throw new Error(`review ${reviewId} not found`);

    const limit = Number(process.env.EXPORT_MAX_ROWS ?? DEFAULT_EXPORT_ROWS);
    const rows = await this.repo.findingsForReview(workspaceId, reviewId, limit);
    return toExport(format, rows);
  }
}
