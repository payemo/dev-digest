import type { FastifyRequest } from 'fastify';
import { applySeverityFloor } from '@devdigest/reviewer-core';
import type { Finding, SeverityPolicy } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { ValidationError } from '../../platform/errors.js';
import { SeverityPolicyRepository } from './repository.js';

const FLOORS = ['info', 'low', 'medium', 'high', 'critical'];

export class SeverityPolicyService {
  private repo: SeverityPolicyRepository;

  constructor(container: Container) {
    this.repo = new SeverityPolicyRepository(container.db);
  }

  async getPolicy(workspaceId: string, agentId: string): Promise<SeverityPolicy> {
    const row = await this.repo.get(workspaceId, agentId);
    return { agent_id: agentId, floor: (row?.floor ?? 'low') as SeverityPolicy['floor'] };
  }

  async setPolicy(req: FastifyRequest, workspaceId: string, agentId: string): Promise<SeverityPolicy> {
    const { floor } = req.body as { floor: string };
    if (!FLOORS.includes(floor)) throw new ValidationError('unknown floor');
    const row = await this.repo.upsert(workspaceId, agentId, floor);
    req.log.info({ agentId, floor }, 'severity policy updated');
    return { agent_id: agentId, floor: row.floor as SeverityPolicy['floor'] };
  }

  preview(findings: Finding[]): Finding[] {
    return applySeverityFloor(findings);
  }
}
