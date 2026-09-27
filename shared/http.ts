/**
 * The single fetch wrapper used by both the admin and staff clients.
 *
 * A bare `fetch` has no timeout, so on a shop LAN a half-open socket (a
 * sleeping tablet, a switched-off Wi-Fi access point, a server mid-restart)
 * leaves a promise pending forever: the UI keeps spinning and the operator has
 * no way to retry. Every call here is therefore bounded, and every failure
 * arrives as a real Error with a message an operator can act on.
 */

/** Long enough for a cold report query, short enough to not hang the UI. */
const DEFAULT_TIMEOUT_MS = 15000;

export interface RequestOptions {
  method?: string;
  body?: string;
  /** Per-call override; the weighing POST uses a longer window. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

interface ErrorBody {
  error?: string;
  formulas?: string[];
}

/** An error carrying the HTTP status, so callers can branch on 409 etc. */
export class ApiError extends Error {
  status: number;
  /** Formulas still referencing an item, present on a 409 from DELETE /items. */
  formulas?: string[];

  constructor(message: string, status: number, formulas?: string[]) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.formulas = formulas;
  }
}

const describe = (status: number): string => {
  if (status === 0) return 'The server is unreachable. Check that it is running and on the same network.';
  if (status === 404) return 'Not found on the server.';
  if (status >= 500) return `Server error (${status}).`;
  return `Request failed (${status}).`;
};

/**
 * Builds a `request` bound to an API base. Both clients keep their own
 * API_BASE (they can be pointed at different hosts) but share this logic.
 *
 * `base` may be a function, which is what the Android build uses: the server
 * address is configurable at runtime, so the value is read per call instead of
 * being frozen at import time.
 */
export function createRequester(base: string | (() => string)) {
  const resolve = typeof base === 'function' ? base : () => base;
  return async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method, body, timeoutMs = DEFAULT_TIMEOUT_MS, signal } = options;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    // Let a caller-supplied signal (e.g. a screen unmounting) cancel us too.
    const onExternalAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', onExternalAbort, { once: true });
    }

    let res: Response;
    try {
      res = await fetch(`${resolve()}${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body,
        signal: controller.signal,
      });
    } catch (err) {
      if (timedOut) {
        throw new ApiError(`The server did not respond within ${Math.round(timeoutMs / 1000)}s.`, 0);
      }
      if (signal?.aborted) {
        throw new ApiError('Request cancelled.', 0);
      }
      // fetch only rejects on a network-level failure, never on HTTP status.
      throw new ApiError(describe(0), 0);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onExternalAbort);
    }

    // A proxy, a captive portal or a crashing server can answer with HTML even
    // for an API path. Parsing that as JSON used to surface as
    // "Unexpected token '<'" with no hint about the real cause.
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('application/json')) {
      const text = await res.text().catch(() => '');
      if (res.ok) {
        throw new ApiError(
          `The server returned ${contentType || 'an unknown format'} instead of JSON for /${path}. ${describe(res.status)}`.trim(),
          res.status,
        );
      }
      throw new ApiError(`${describe(res.status)} ${text.slice(0, 120)}`.trim(), res.status);
    }

    // A 200 with a truncated or empty body is a real failure mode on a kiosk,
    // so it is reported rather than silently becoming undefined.
    const raw = await res.text();
    let data: unknown = {};
    if (raw.trim()) {
      try {
        data = JSON.parse(raw);
      } catch {
        throw new ApiError(`The server sent a malformed response for /${path}.`, res.status);
      }
    }

    if (!res.ok) {
      const body = data as ErrorBody;
      throw new ApiError(
        body.error || describe(res.status),
        res.status,
        Array.isArray(body.formulas) ? body.formulas : undefined,
      );
    }
    return data as T;
  };
}
