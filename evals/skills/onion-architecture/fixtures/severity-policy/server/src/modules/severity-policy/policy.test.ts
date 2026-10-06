import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../../db/client.js';
import { SeverityPolicyRepository } from './repository.js';

describe('SeverityPolicyRepository', () => {
  const { db, close } = createDb(process.env.DATABASE_URL!);
  const repo = new SeverityPolicyRepository(db);
  const workspaceId = '00000000-0000-0000-0000-000000000001';
  const agentId = '00000000-0000-0000-0000-0000000000aa';

  beforeAll(async () => {
    await repo.upsert(workspaceId, agentId, 'low');
  });

  afterAll(async () => {
    await close();
  });

  it('returns the stored floor', async () => {
    const row = await repo.get(workspaceId, agentId);
    expect(row?.floor).toBe('low');
  });

  it('replaces the floor on upsert', async () => {
    await repo.upsert(workspaceId, agentId, 'high');
    const row = await repo.get(workspaceId, agentId);
    expect(row?.floor).toBe('high');
  });
});
