/* api.ts — typed fetch client for the F1 Fastify engine (localhost:3001).
   All hooks build on `apiFetch`. Errors are normalized to ApiError so the
   error-UX taxonomy (toast/inline/full-screen) can branch on status. */
import type { ZodType } from "zod";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001";

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * `schema`, when given, validates the parsed JSON against the same zod
 * contract the server's route declares as `response.200` — turning a silent
 * client/server contract drift (`server/src/vendor/shared` and this package's
 * copy diverging) into a loud, typed failure instead of a UI that quietly
 * renders `undefined` fields. Optional and additive: most call sites don't
 * pass one yet.
 */
export async function apiFetch<T>(path: string, init?: RequestInit, schema?: ZodType<T>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        // Only declare a JSON body when one is actually sent — otherwise a
        // body-less POST/PUT (e.g. tour generate, refresh, reindex) trips
        // Fastify's "Body cannot be empty when content-type is application/json".
        ...(init?.body != null ? { "content-type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch (e) {
    // network failure / API down → full-screen error candidate
    throw new ApiError(
      `Cannot reach the DevDigest engine at ${API_BASE}. Is the API running?`,
      0,
      "network_error",
      e
    );
  }

  if (!res.ok) {
    let code: string | undefined;
    let message = `${res.status} ${res.statusText}`;
    let details: unknown;
    try {
      const body = await res.json();
      if (body?.error) {
        code = body.error.code;
        message = body.error.message ?? message;
        details = body.error.details;
      }
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(message, res.status, code, details);
  }

  if (res.status === 204) return undefined as T;
  const json = await res.json();
  if (!schema) return json as T;
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError(
      `Response from ${path} didn't match its expected shape — the client and server contracts have drifted.`,
      res.status,
      "contract_drift",
      parsed.error.flatten(),
    );
  }
  return parsed.data;
}

export const api = {
  get: <T>(path: string, schema?: ZodType<T>) => apiFetch<T>(path, undefined, schema),
  post: <T>(path: string, body?: unknown, schema?: ZodType<T>) =>
    apiFetch<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }, schema),
  put: <T>(path: string, body?: unknown, schema?: ZodType<T>) =>
    apiFetch<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }, schema),
  patch: <T>(path: string, body?: unknown, schema?: ZodType<T>) =>
    apiFetch<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }, schema),
  del: <T>(path: string, schema?: ZodType<T>) => apiFetch<T>(path, { method: "DELETE" }, schema),
};
