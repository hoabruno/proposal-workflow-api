import type { NextFunction, Request, Response } from 'express';
import type { ApiErrorBody } from './api-exception.filter.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence in depth. SameSite=Strict keeps the session cookie away from
 * other sites, but not from sibling subdomains (they count as the same site),
 * so state-changing requests must also come from an allowed origin.
 *
 * Browsers always send Origin on cross-origin POST/DELETE; requests without
 * it (curl, server-to-server) carry no ambient browser cookie risk and pass.
 * With an empty allow-list (local development) the check is off.
 */
export function originCheck(allowedOrigins: string[]) {
  const allowed = new Set(allowedOrigins);
  return (request: Request, response: Response, next: NextFunction): void => {
    const origin = request.headers.origin;
    if (
      allowed.size === 0 ||
      SAFE_METHODS.has(request.method) ||
      !origin ||
      allowed.has(origin)
    ) {
      next();
      return;
    }
    response.status(403).json({
      code: 'FORBIDDEN_ORIGIN',
      message: 'Request origin not allowed',
    } satisfies ApiErrorBody);
  };
}

/** Parses ALLOWED_ORIGINS, a comma-separated list such as "https://atipik.middlewa.re". */
export function parseOrigins(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
