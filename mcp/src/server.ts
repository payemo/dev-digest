import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ZodError } from 'zod';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { baseUrl } from './api.js';
import { TOOLS } from './tools/index.js';
import { toolListPayload } from './tools/payload.js';

/**
 * Transport, registration, and the factory that builds both — no business
 * logic lives here.
 *
 * Two rules this file exists to keep:
 *
 * 1. Standard output carries the JSON-RPC frame. Every diagnostic goes to
 *    standard error instead; a stray line on the other stream corrupts the
 *    frame, and the symptom is a dead session rather than a visible log.
 * 2. Nothing happens during initialize — no probe of the API, no warm-up, no
 *    cache pre-fill. A client may drop a server that fails to start, so an
 *    unreachable API is reported on the first tool call, where the message can
 *    actually tell the user what to do about it.
 *
 * The low-level Server is used rather than the high-level helper because the
 * payload below is measured by a test: we send exactly what we build here.
 */

/**
 * Builds and wires a `Server`, but does not connect it to any transport — a
 * test connects the returned instance to an `InMemoryTransport` (with `fetch`
 * stubbed the same way every other test in this package stubs it) instead of
 * a real stdio process. Only the bottom of this file, guarded to run as the
 * entry script, connects stdio for real.
 */
export function createServer(): Server {
  const server = new Server(
    { name: 'devdigest', version: '0.0.0' },
    {
      // Tools only. The other two capability kinds are also pulled into
      // context at startup by some clients, and this server has nothing to
      // put in them.
      capabilities: { tools: {} },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolListPayload() }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = TOOLS.find((t) => t.name === name);

    if (!tool) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Unknown tool "${name}". This server provides: ${TOOLS.map((t) => t.name).join(', ')}.`,
          },
        ],
        isError: true,
      };
    }

    try {
      return await tool.handler(args);
    } catch (err) {
      // The low-level Server does not validate arguments against a tool's
      // inputSchema — the handler's own parse is the only gate. So a bad
      // argument arrives here, and reporting it as an internal failure would
      // hide the one thing the caller can actually fix.
      if (err instanceof ZodError) {
        const problems = err.errors
          .map((e) => `${e.path.join('.') || '(root)'}: ${e.message}`)
          .join('; ');
        return {
          content: [
            {
              type: 'text' as const,
              text:
                `Invalid arguments for ${name} — ${problems}. ` +
                `Check the tool's schema and call it again with corrected arguments.`,
            },
          ],
          isError: true,
        };
      }
      // An uncaught throw would take the whole session down with it. Turn it
      // into a result the agent can read and act on.
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[devdigest-mcp] ${name} failed: ${message}\n`);
      return {
        content: [
          { type: 'text' as const, text: `The ${name} tool failed unexpectedly: ${message}` },
        ],
        isError: true,
      };
    }
  });

  return server;
}

// Only run the stdio process when this file is the entry script — importing
// it (e.g. from a test that drives `createServer()` over an in-memory
// transport) must not also open a real stdio connection.
const isEntryScript = import.meta.url === `file://${process.argv[1]}`;
if (isEntryScript) {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  process.stderr.write(`[devdigest-mcp] ready — API ${baseUrl()}\n`);
}
