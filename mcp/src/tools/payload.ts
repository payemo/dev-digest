import { z } from 'zod';
import { TOOLS } from './index.js';

/**
 * The exact `tools/list` payload this server sends.
 *
 * It lives in its own module because two very different callers must agree on
 * it byte for byte: the transport, which sends it, and the token-budget test,
 * which measures it. A test that rebuilt the payload itself would measure a
 * reconstruction, not the thing a client actually pays to load.
 */

export interface ToolListEntry {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean };
}

/**
 * A deliberately tiny zod → JSON Schema converter.
 *
 * It understands flat primitives and nothing else, which is the point: a
 * nested object or an array of objects cannot be described here, so it cannot
 * reach a tool signature by accident. The general-purpose converters also emit
 * a dialect declaration and every validation bound, all of which is startup
 * cost paid on every request.
 *
 * Bounds (min/max/int) are deliberately NOT emitted. Arguments are re-parsed
 * against the real zod schema before a handler runs, so the bounds are
 * enforced either way; repeating them here would buy nothing and cost tokens.
 */
function fieldSchema(field: z.ZodTypeAny): { schema: Record<string, unknown>; required: boolean } {
  const required = !(field instanceof z.ZodOptional);
  const inner: z.ZodTypeAny = field instanceof z.ZodOptional ? field.unwrap() : field;
  const description = field.description ?? inner.description;

  const base: Record<string, unknown> = (() => {
    if (inner instanceof z.ZodString) return { type: 'string' };
    if (inner instanceof z.ZodNumber) return { type: 'number' };
    if (inner instanceof z.ZodBoolean) return { type: 'boolean' };
    if (inner instanceof z.ZodEnum) return { type: 'string', enum: inner.options };
    throw new Error(
      `Tool arguments must be flat primitives; got ${inner.constructor.name}. ` +
        `Nested shapes are where models make argument mistakes — flatten it instead.`,
    );
  })();

  return { schema: description ? { ...base, description } : base, required };
}

export function toJsonSchema(object: z.ZodObject<z.ZodRawShape>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, field] of Object.entries(object.shape)) {
    const { schema, required: isRequired } = fieldSchema(field);
    properties[key] = schema;
    if (isRequired) required.push(key);
  }

  return required.length > 0
    ? { type: 'object', properties, required }
    : { type: 'object', properties };
}

export function toolListPayload(): ToolListEntry[] {
  return TOOLS.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: toJsonSchema(tool.inputSchema),
    annotations: { readOnlyHint: tool.readOnly },
  }));
}
