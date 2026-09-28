import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetCache } from '../src/resolve.js';
import { createServer } from '../src/server.js';
import { agent } from './fixtures.js';
import { mockFetch } from './http.js';

/**
 * Drives the real `Server` built by `createServer()` over an in-memory
 * transport pair — the request routing, unknown-tool message, and
 * ZodError-to-tool-result translation in server.ts have no other coverage,
 * since importing the module used to open a real stdio connection as a side
 * effect. `fetch` is stubbed the same way every other test in this package
 * stubs it; that stub is the "stub API client" this test needed.
 */
async function connectedClient(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer();
  const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

beforeEach(() => resetCache());
afterEach(() => vi.unstubAllGlobals());

describe('createServer', () => {
  it('lists every registered tool over a real MCP round trip', async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'get_blast_radius',
      'get_conventions',
      'get_findings',
      'list_agents',
      'run_agent_on_pr',
    ]);
  });

  it('routes a call to the matching tool and returns its result', async () => {
    mockFetch({ 'GET /agents': [agent()] });
    const client = await connectedClient();
    const result = await client.callTool({ name: 'list_agents', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect((result.content as { text: string }[])[0]!.text).toContain('Security Reviewer');
  });

  it('reports an unknown tool name instead of throwing', async () => {
    const client = await connectedClient();
    const result = await client.callTool({ name: 'not_a_real_tool', arguments: {} });
    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0]!.text).toContain('Unknown tool "not_a_real_tool"');
    expect((result.content as { text: string }[])[0]!.text).toContain('list_agents');
  });

  it('turns a bad argument into a readable tool result, not a dead session', async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: 'get_findings',
      arguments: { repo: 'acme/payments-api', pr: 'not-a-number' },
    });
    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0]!.text).toContain('Invalid arguments for get_findings');
  });
});
