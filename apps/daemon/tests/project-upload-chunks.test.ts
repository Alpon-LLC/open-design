import type http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

// ---------------------------------------------------------------------------
// Chunked project upload — large chat attachments split into small
// application/octet-stream chunks so every request stays below edge/CDN
// request-body caps (e.g. Cloudflare's 100MB limit). Covers the PUT chunk /
// POST complete / GET status / DELETE abort contract under
// /api/projects/:id/upload/:uploadId.
// ---------------------------------------------------------------------------

describe('chunked project upload', () => {
  let server: http.Server;
  let baseUrl: string;
  let base: string;
  const projectId = 'proj-chunk-upload-test';

  beforeAll(async () => {
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    baseUrl = started.url;
    server = started.server;

    const createResponse = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: projectId, name: 'Chunk upload fixture' }),
    });
    expect(createResponse.status).toBe(200);

    base = `${baseUrl}/api/projects/${projectId}/upload`;
  });

  afterAll(() => new Promise<void>((resolve) => {
    // Destroy pooled keep-alive sockets so close() does not wait on them.
    (server as any).closeAllConnections?.();
    server.close(() => resolve());
  }));

  const uploadId = 'chunktest-1a2b3c';
  const stageRoot = path.join(process.env.OD_DATA_DIR!, 'upload-staging', uploadId);

  async function putChunk(index: number, body: Buffer, extra: Record<string, string> = {}) {
    return fetch(`${base}/${uploadId}/chunk/${index}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/octet-stream',
        'x-total-chunks': '3',
        'x-file-name': encodeURIComponent('big-asset.bin'),
        ...extra,
      },
      body: body,
    });
  }

  it('assembles chunks byte-identical into the project dir and purges staging', async () => {
    const a = Buffer.alloc(5 * 1024 * 1024, 0x11);
    const b = Buffer.alloc(5 * 1024 * 1024, 0x22);
    const c = Buffer.from('tail-bytes');
    const chunks = [a, b, c];
    for (let i = 0; i < chunks.length; i += 1) {
      const res = await putChunk(i, chunks[i]!);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    }

    const complete = await fetch(`${base}/${uploadId}/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'big-asset.bin', totalChunks: 3 }),
    });
    expect(complete.status).toBe(200);
    const json = (await complete.json()) as {
      files: { name: string; path: string; size: number; mtime: number; originalName: string }[];
    };
    expect(json.files).toHaveLength(1);
    expect(json.files[0]?.originalName).toBe('big-asset.bin');
    expect(json.files[0]?.size).toBe(a.length + b.length + c.length);

    const saved = await readFile(path.join(process.env.OD_DATA_DIR!, 'projects', projectId, 'big-asset.bin'));
    const canonical = Buffer.concat([a, b, c]);
    expect(
      createHash('sha256').update(saved).digest('hex'),
    ).toBe(createHash('sha256').update(canonical).digest('hex'));

    // Success purges staging.
    await expect(readdir(stageRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports received chunks and total for resume via GET status', async () => {
    const id = 'chunktest-resume1';
    const stageDir = path.join(process.env.OD_DATA_DIR!, 'upload-staging', id);
    await fetch(`${base}/${id}/chunk/0`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/octet-stream',
        'x-total-chunks': '2',
        'x-file-name': encodeURIComponent('resume.bin'),
      },
      body: Buffer.from('part-one'),
    });
    const status = await fetch(`${base}/${id}`);
    expect(status.status).toBe(200);
    const body = (await status.json()) as { received: number[]; totalChunks: number };
    expect(body.received).toEqual([0]);
    expect(body.totalChunks).toBe(2);

    // Resume: PUT the missing chunk with alpha input validated, then complete.
    const second = await fetch(`${base}/${id}/chunk/1`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/octet-stream',
        'x-total-chunks': '2',
        'x-file-name': encodeURIComponent('resume.bin'),
      },
      body: Buffer.from('part-two'),
    });
    expect(second.status).toBe(200);
    const complete = await fetch(`${base}/${id}/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ totalChunks: 2 }),
    });
    expect(complete.status).toBe(200);
    const saved = await readFile(path.join(process.env.OD_DATA_DIR!, 'projects', projectId, 'resume.bin'));
    expect(saved.toString()).toBe('part-onepart-two');
    // Success purges staging.
    await expect(readdir(stageDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects out-of-range chunk indexes without writing to disk', async () => {
    const id = 'chunktest-range-1';
    const res = await fetch(`${base}/${id}/chunk/7`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/octet-stream',
        'x-total-chunks': '2',
        'x-file-name': encodeURIComponent('evil.bin'),
      },
      body: Buffer.from('should-not-land'),
    });
    expect(res.status).toBe(400);
    // Nothing may be written before meta exists (index validation happens first).
    const stageDir = path.join(process.env.OD_DATA_DIR!, 'upload-staging', id);
    await expect(readdir(stageDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects path-traversal upload ids with 400', async () => {
    const encoded = encodeURIComponent('../../etc/attack');
    const res = await fetch(`${base}/${encoded}/chunk/0`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/octet-stream',
        'x-total-chunks': '1',
        'x-file-name': encodeURIComponent('evil.bin'),
      },
      body: Buffer.from('evil'),
    });
    expect(res.status).toBe(400);
    // Express may not even route %2F segments; the direct-dot variant must also 400.
    const res2 = await fetch(`${base}/....pc/chunk/0`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/octet-stream',
        'x-total-chunks': '1',
        'x-file-name': encodeURIComponent('evil.bin'),
      },
      body: Buffer.from('evil'),
    });
    expect(res2.status).toBe(400);
  });

  it('rejects complete when chunks are missing', async () => {
    const id = 'chunktest-partial';
    await fetch(`${base}/${id}/chunk/0`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/octet-stream',
        'x-total-chunks': '3',
        'x-file-name': encodeURIComponent('partial.bin'),
      },
      body: Buffer.from('only-first'),
    });
    const complete = await fetch(`${base}/${id}/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ totalChunks: 3 }),
    });
    expect(complete.status).toBe(400);
  });

  it('purges staging on DELETE abort', async () => {
    const id = 'chunktest-abort';
    const stageDir = path.join(process.env.OD_DATA_DIR!, 'upload-staging', id);
    await fetch(`${base}/${id}/chunk/0`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/octet-stream',
        'x-total-chunks': '2',
        'x-file-name': encodeURIComponent('abort.bin'),
      },
      body: Buffer.from('doomed'),
    });
    expect((await readdir(stageDir)).length).toBeGreaterThan(0);
    const abort = await fetch(`${base}/${id}`, { method: 'DELETE' });
    expect(abort.status).toBe(200);
    await expect(readdir(stageDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

// Server-side size cap: OD_MAX_UPLOAD_MB (runtime knob, read per startServer)
// enforces the assembled-upload ceiling server-side, tracked via cumulative
// per-chunk byte counts in meta.json — independent of the web client.
describe('chunked project upload size cap (OD_MAX_UPLOAD_MB=1)', () => {
  let server: http.Server;
  let capBase: string;
  let configBase: string;

  beforeAll(async () => {
    process.env.OD_MAX_UPLOAD_MB = '1';
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    server = started.server;
    capBase = `${started.url}/api/projects/proj-chunk-upload-test/upload`;
    configBase = `${started.url}/api/config`;
  });

  afterAll(() => new Promise<void>((resolve) => {
    delete process.env.OD_MAX_UPLOAD_MB;
    (server as any).closeAllConnections?.();
    server.close(() => resolve());
  }));

  it('rejects a chunk PUT that would overflow the cap and writes nothing', async () => {
    const res = await fetch(`${capBase}/chunktest-cap-1/chunk/0`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/octet-stream',
        'x-total-chunks': '3',
        'x-file-name': encodeURIComponent('oversize.bin'),
      },
      body: Buffer.alloc(2 * 1024 * 1024),
    });
    expect(res.status).toBe(413);
    const stageDir = path.join(process.env.OD_DATA_DIR!, 'upload-staging', 'chunktest-cap-1');
    // Nothing lands before the cap clears — no chunk, no meta, empty staging dir.
    expect(await readdir(stageDir)).toEqual([]);
  });

  it('stages chunks exactly at the cap and rejects via cumulative meta tracking', async () => {
    const half = 512 * 1024;
    const put = (index: number, body: Buffer) => fetch(`${capBase}/chunktest-cap-2/chunk/${index}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/octet-stream',
        'x-total-chunks': '3',
        'x-file-name': encodeURIComponent('cap.bin'),
      },
      body,
    });
    expect((await put(0, Buffer.alloc(half))).status).toBe(200);
    expect((await put(1, Buffer.alloc(half))).status).toBe(200);
    const over = await put(2, Buffer.alloc(1));
    expect(over.status).toBe(413);
  });

  it('exposes the resolved cap via GET /api/config as the canonical value', async () => {
    const res = await fetch(configBase);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as { maxUploadBytes?: unknown };
    expect(body.maxUploadBytes).toBe(1024 * 1024);
  });
});
