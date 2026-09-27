import { z } from 'zod';
import type { ToolResult } from '../errors.js';

/**
 * One tool = one file, default-exporting one of these. `tools/index.ts`
 * collects them into a single array that both `server.ts` and the token-budget
 * test iterate, so a sixth tool is one file plus one entry — and the budget
 * test covers it automatically.
 */
export interface ToolDef {
  name: string;
  title: string;
  description: string;
  /**
   * The input object schema. Flat primitives only, so the emitted JSON Schema
   * is flat too — a nested object is where models start making argument
   * mistakes, and it costs more tokens to describe.
   */
  inputSchema: z.ZodObject<z.ZodRawShape>;
  /** False for the one tool that starts a billed model run. */
  readOnly: boolean;
  handler: (args: unknown) => Promise<ToolResult>;
}

/**
 * Keeps each handler strongly typed against its own shape while letting all
 * five live in one array. The SDK validates arguments before calling us; the
 * re-parse here is what carries those types into the handler body.
 */
export function defineTool<S extends z.ZodRawShape>(def: {
  name: string;
  title: string;
  description: string;
  shape: S;
  readOnly: boolean;
  handler: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResult>;
}): ToolDef {
  const schema = z.object(def.shape);
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    inputSchema: schema,
    readOnly: def.readOnly,
    // async, so a parse failure is a REJECTION rather than a synchronous
    // throw — the declared return type promises a promise, and a caller that
    // only handles rejections would otherwise miss every bad argument.
    handler: async (args: unknown) => def.handler(schema.parse(args ?? {})),
  };
}

/** Shared field definitions — one wording, one token cost, five tools. */
export const repoArg = z
  .string()
  .describe('Repository as "owner/name", e.g. "acme/payments-api". A GitHub URL also works.');

export const prArg = z.number().int().positive().describe('The pull request number, e.g. 42.');

export const responseFormatArg = z
  .enum(['concise', 'detailed'])
  .optional()
  .describe('"concise" (default) returns only the essential fields; "detailed" adds rationale.');
