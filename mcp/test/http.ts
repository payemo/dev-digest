import { vi } from 'vitest';

export interface RecordedCall {
  url: string;
  method: string;
  body: unknown;
}

export const calls: RecordedCall[] = [];

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function timeoutError(): Error {
  const err = new Error('The operation was aborted due to timeout');
  err.name = 'TimeoutError';
  return err;
}

/** Route by "METHOD /path"; a function value may throw to simulate transport failure. */
export function mockFetch(routes: Record<string, unknown | (() => never)>): void {
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const path = new URL(input).pathname;
      calls.push({
        url: path,
        method,
        body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
      });
      const route = routes[`${method} ${path}`];
      if (route === undefined) throw new Error(`unrouted: ${method} ${path}`);
      if (typeof route === 'function') return (route as () => never)();
      return route instanceof Response ? route : json(route);
    }),
  );
}
