import type { NextFunction, Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  hostedPublicAuthorities,
  requireLocalDaemonRequest,
} from '../src/http/local-daemon-request.js';

const PUBLIC_BASE_URL = 'https://design.alpon.xyz';

interface FakeResponse {
  req: Request;
  statusCode?: number;
  body?: unknown;
  headers: Record<string, string>;
  setHeader(name: string, value: string): FakeResponse;
  status(code: number): FakeResponse;
  json(body: unknown): FakeResponse;
}

function createRequest(
  headers: Record<string, string>,
  remoteAddress = '127.0.0.1',
): Request {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    socket: { remoteAddress },
    method: 'GET',
    headers: normalized,
    get: (name: string) => normalized[name.toLowerCase()],
  } as unknown as Request;
}

function createResponse(req: Request): FakeResponse {
  const res: FakeResponse = {
    req,
    headers: {},
    setHeader(name: string, value: string) {
      res.headers[name.toLowerCase()] = value;
      return res;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

function run(request: Request): { res: FakeResponse; next: NextFunction; nexted: () => boolean } {
  const res = createResponse(request);
  const next = vi.fn() as unknown as NextFunction;
  requireLocalDaemonRequest(request, res as unknown as Response, next);
  return { res, next, nexted: () => (next as unknown as ReturnType<typeof vi.fn>).mock.calls.length > 0 };
}

describe('requireLocalDaemonRequest — loopback (upstream behaviour)', () => {
  beforeEach(() => {
    delete process.env.OD_PUBLIC_BASE_URL;
    delete process.env.OD_ALLOWED_ORIGINS;
  });

  afterEach(() => {
    delete process.env.OD_PUBLIC_BASE_URL;
    delete process.env.OD_ALLOWED_ORIGINS;
  });

  it('accepts a loopback daemon request', () => {
    const { res, nexted } = run(createRequest({ host: '127.0.0.1:7456' }));
    expect(nexted()).toBe(true);
    expect(res.statusCode).toBeUndefined();
  });

  it('rejects a public host when no hosted authority is configured', () => {
    const { res, nexted } = run(
      createRequest({ host: 'design.alpon.xyz', origin: PUBLIC_BASE_URL }),
    );
    expect(nexted()).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('requireLocalDaemonRequest — hosted deployment', () => {
  beforeEach(() => {
    process.env.OD_PUBLIC_BASE_URL = PUBLIC_BASE_URL;
    delete process.env.OD_ALLOWED_ORIGINS;
  });

  afterEach(() => {
    delete process.env.OD_PUBLIC_BASE_URL;
    delete process.env.OD_ALLOWED_ORIGINS;
  });

  it('accepts a proxied request for the configured public origin', () => {
    const { res, nexted } = run(
      createRequest({ host: 'design.alpon.xyz', origin: PUBLIC_BASE_URL }),
    );
    expect(nexted()).toBe(true);
    expect(res.statusCode).toBeUndefined();
    expect(res.headers['access-control-allow-origin']).toBe(PUBLIC_BASE_URL);
    expect(res.headers.vary).toBe('Origin');
  });

  it('accepts a proxied request that carries no Origin header', () => {
    const { res, nexted } = run(createRequest({ host: 'design.alpon.xyz' }));
    expect(nexted()).toBe(true);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects a proxied request from a foreign origin', () => {
    const { res, nexted } = run(
      createRequest({ host: 'design.alpon.xyz', origin: 'https://evil.example' }),
    );
    expect(nexted()).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(JSON.stringify(res.body)).toContain('origin');
  });

  it('rejects a host the operator never declared', () => {
    const { res, nexted } = run(
      createRequest({ host: 'design.attacker.example', origin: PUBLIC_BASE_URL }),
    );
    expect(nexted()).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it('honours OD_ALLOWED_ORIGINS without OD_PUBLIC_BASE_URL', () => {
    delete process.env.OD_PUBLIC_BASE_URL;
    process.env.OD_ALLOWED_ORIGINS = `http://127.0.0.1:4119, ${PUBLIC_BASE_URL}`;
    const { res, nexted } = run(
      createRequest({ host: 'design.alpon.xyz', origin: PUBLIC_BASE_URL }),
    );
    expect(nexted()).toBe(true);
    expect(res.headers['access-control-allow-origin']).toBe(PUBLIC_BASE_URL);
  });
});

describe('hostedPublicAuthorities', () => {
  it('is empty without configuration', () => {
    const { hosts, origins } = hostedPublicAuthorities({});
    expect(hosts.size).toBe(0);
    expect(origins.size).toBe(0);
  });

  it('derives hosts with and without the explicit port', () => {
    const { hosts, origins } = hostedPublicAuthorities({
      OD_PUBLIC_BASE_URL: 'https://design.alpon.xyz/',
      OD_ALLOWED_ORIGINS: 'http://127.0.0.1:4119',
    });
    expect([...origins].sort()).toEqual(['http://127.0.0.1:4119', PUBLIC_BASE_URL]);
    expect(hosts.has('design.alpon.xyz')).toBe(true);
    expect(hosts.has('127.0.0.1:4119')).toBe(true);
  });

  it('ignores a malformed base URL instead of throwing', () => {
    const { hosts, origins } = hostedPublicAuthorities({ OD_PUBLIC_BASE_URL: 'not-a-url' });
    expect(hosts.size).toBe(0);
    expect(origins.size).toBe(0);
  });
});
