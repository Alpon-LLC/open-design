import net from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import { configuredAllowedOrigins } from '../origin-validation.js';
import { sendApiError } from './api-errors.js';

interface LocalAuthority {
  hostname: string;
  port: string;
}

interface LocalDaemonValidation {
  ok: true;
  origin: string | null;
}

interface LocalDaemonValidationError {
  ok: false;
  message: string;
  details: Record<string, string>;
}

export function normalizeLocalAuthority(value: unknown): LocalAuthority | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || /[\s/@]/.test(trimmed) || trimmed.includes(',')) return null;

  try {
    const parsed = new URL(`http://${trimmed}`);
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
    if (!hostname || parsed.username || parsed.password || parsed.pathname !== '/') return null;
    return { hostname, port: parsed.port };
  } catch {
    return null;
  }
}

export function isLoopbackHostname(hostname: unknown): boolean {
  const normalized = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (normalized === 'localhost') return true;
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
  if (net.isIP(normalized) === 4) return normalized === '127.0.0.1' || normalized.startsWith('127.');
  return false;
}

export function isLoopbackPeerAddress(address: unknown): boolean {
  if (typeof address !== 'string') return false;
  const normalized = address.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!normalized) return false;
  if (normalized.startsWith('::ffff:')) return isLoopbackPeerAddress(normalized.slice('::ffff:'.length));
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
  if (net.isIP(normalized) === 4) return normalized === '127.0.0.1' || normalized.startsWith('127.');
  return false;
}

export function localOriginFromHeader(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'null' || trimmed.includes(',')) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) return null;
    if (!isLoopbackHostname(parsed.hostname)) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function validateLocalDaemonRequest(req: Request): LocalDaemonValidation | LocalDaemonValidationError {
  if (!isLoopbackPeerAddress(req.socket?.remoteAddress)) {
    return {
      ok: false,
      message: 'request peer must be a loopback address',
      details: { peer: 'remoteAddress' },
    };
  }

  const host = normalizeLocalAuthority(req.get('host'));
  if (!host || !isLoopbackHostname(host.hostname)) {
    return {
      ok: false,
      message: 'request host must be a loopback daemon address',
      details: { header: 'host' },
    };
  }

  const originHeader = req.get('origin');
  if (originHeader !== undefined && !localOriginFromHeader(originHeader)) {
    return {
      ok: false,
      message: 'request origin must be a loopback daemon origin',
      details: { header: 'origin' },
    };
  }

  return { ok: true, origin: localOriginFromHeader(originHeader) };
}

/**
 * Authorities a *hosted* deployment is legitimately reached through.
 *
 * Self-hosted cloud deployments (Alpon: `https://design.alpon.xyz`) sit behind
 * a reverse proxy, so the daemon never sees a loopback `Host`/`Origin`: the
 * proxy forwards the public hostname and the browser sends the matching
 * origin. Rejecting those requests would 403 every browser call, so the
 * operator-declared public origin (`OD_PUBLIC_BASE_URL`) and the explicit
 * `OD_ALLOWED_ORIGINS` allowlist are accepted alongside loopback.
 *
 * Nothing is trusted implicitly: an unset/empty configuration yields empty
 * sets and the middleware stays exactly as strict as upstream.
 */
export function hostedPublicAuthorities(env: NodeJS.ProcessEnv = process.env): {
  hosts: Set<string>;
  origins: Set<string>;
} {
  const origins = new Set<string>();

  const baseUrl = env.OD_PUBLIC_BASE_URL?.trim();
  if (baseUrl && /^https?:\/\//iu.test(baseUrl)) {
    try {
      origins.add(new URL(baseUrl).origin);
    } catch {
      // Malformed base URL: ignore it rather than widening the guard.
    }
  }

  try {
    for (const origin of configuredAllowedOrigins(env)) origins.add(origin);
  } catch {
    // Malformed OD_ALLOWED_ORIGINS: configuredAllowedOrigins throws so the
    // misconfiguration is loud elsewhere; here it must not widen the guard.
  }

  const hosts = new Set<string>();
  for (const origin of origins) {
    const parsed = new URL(origin);
    hosts.add(parsed.host.toLowerCase());
    hosts.add(parsed.hostname.toLowerCase());
  }
  return { hosts, origins };
}

function validateHostedPublicRequest(
  req: Request,
): LocalDaemonValidation | LocalDaemonValidationError | null {
  const { hosts, origins } = hostedPublicAuthorities();
  if (hosts.size === 0) return null;

  const host = req.get('host')?.trim().toLowerCase();
  if (!host || !hosts.has(host)) return null;

  const originHeader = req.get('origin')?.trim();
  if (originHeader && originHeader !== 'null' && !origins.has(originHeader)) {
    return {
      ok: false,
      message: 'request origin must match the configured public origin',
      details: { header: 'origin' },
    };
  }

  return {
    ok: true,
    origin: originHeader && originHeader !== 'null' ? originHeader : null,
  };
}

function applyLocalCorsHeaders(res: Response, origin: string | null): void {
  res.setHeader('Vary', 'Origin');
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
}

export function requireLocalDaemonRequest(req: Request, res: Response, next: NextFunction): void | Response {
  const validation = validateLocalDaemonRequest(req);
  if (!validation.ok) {
    const hosted = validateHostedPublicRequest(req);
    if (hosted == null || !hosted.ok) {
      const failure = hosted == null ? validation : hosted;
      return sendApiError(res, 403, 'FORBIDDEN', failure.message, { details: failure.details });
    }
    applyLocalCorsHeaders(res, hosted.origin);
    next();
    return;
  }

  applyLocalCorsHeaders(res, validation.origin);
  next();
}
