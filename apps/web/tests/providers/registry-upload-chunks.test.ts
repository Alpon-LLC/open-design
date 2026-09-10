import { afterEach, describe, expect, it, vi } from 'vitest';

import { uploadProjectFiles } from '../../src/providers/registry';

// ---------------------------------------------------------------------------
// Chat-composer attachment upload split: files ≤10 MiB keep the original
// multipart path; files >10 MiB are sliced into 5 MiB chunks, PUT to
// /api/projects/:id/upload/:uploadId/chunk/:index (so every request clears
// the 100MB edge/Cloudflare cap), then assembled server-side on complete.
// These tests pin the client contract against the daemon module
// apps/daemon/src/routes/project/upload-chunks.ts.
// ---------------------------------------------------------------------------

const CHUNK_UPLOAD_SIZE = 5 * 1024 * 1024;
const CHUNK_UPLOAD_THRESHOLD = 10 * 1024 * 1024;

type FetchCall = { url: string; init: RequestInit };
function makeFetchRouter(handler: (url: string, init: RequestInit, call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    // Headers-only fetches default to GET; normalize so handlers can branch.
    const resolved = { method: 'GET', ...(init ?? {}) } as RequestInit;
    const call: FetchCall = { url: String(input), init: resolved };
    calls.push(call);
    return await handler(call.url, call.init, call);
  });
  return { fetchMock, calls, stub: () => vi.stubGlobal('fetch', fetchMock) };
}

describe('uploadProjectFiles chunked path', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps a small file on the unchanged single-multipart path', async () => {
    const file = new File(['hello-small'], 'small.txt', { type: 'text/plain' });
    const router = makeFetchRouter((url, init) => {
      if (url === '/api/projects/project-1/upload' && init.method === 'POST') {
        return new Response(JSON.stringify({
          files: [{ name: 'small.txt', path: 'small.txt', size: 5, originalName: 'small.txt' }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'unexpected small-file call' }), { status: 400 });
    });
    router.stub();

    const result = await uploadProjectFiles('project-1', [file]);

    expect(result.failed).toEqual([]);
    expect(result.uploaded).toHaveLength(1);
    expect(result.uploaded[0]).toMatchObject({ path: 'small.txt', name: 'small.txt' });
    // Exactly one request total — no chunk PUTs, no complete, no status.
    expect(router.calls).toHaveLength(1);
    expect(router.calls[0]!.url).toBe('/api/projects/project-1/upload');
  });

  it('chunks a large file and the daemon reassembly stays byte-identical', async () => {
    const total = CHUNK_UPLOAD_THRESHOLD + CHUNK_UPLOAD_SIZE; // 15 MiB → 3 chunks
    const bytes = new Uint8Array(total);
    for (let i = 0; i < total; i += 1) bytes[i] = i % 251;
    const file = new File([bytes], 'big.bin', { type: 'application/octet-stream' });

    const router = makeFetchRouter((url, init) => {
      const uploadId = url.match(/\/upload\/([A-Za-z0-9_-]{8,64})\/chunk\/(\d+)$/);
      if (uploadId && init.method === 'PUT') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (/\/upload\/[A-Za-z0-9_-]+\/complete$/.test(url) && init.method === 'POST') {
        return new Response(JSON.stringify({
          files: [{ name: 'big.bin', path: 'big.bin', size: total, originalName: 'big.bin' }],
        }), { status: 200 });
      }
      return new Response(null, { status: 500 });
    });
    router.stub();

    const result = await uploadProjectFiles('project-1', [file]);

    expect(result.failed).toEqual([]);
    expect(result.uploaded).toHaveLength(1);

    // Reassemble the PUT bodies in index order and compare byte-for-byte
    // (elementwise with early exit — enough to pin exact reassembly without
    // paying vitest's deep-equal cost on 15 MiB arrays).
    const puts = router.calls.filter((c) => c.init.method === 'PUT');
    expect(puts).toHaveLength(3);
    const indexes = puts.map((c) => Number(c.url.match(/chunk\/(\d+)$/)![1]));
    expect(indexes.slice().sort()).toEqual([0, 1, 2]);
    const chunks = new Uint8Array(total);

    await Promise.all(puts.map(async (call) => {
      const index = Number(call.url.match(/chunk\/(\d+)$/)![1]);
      const body = call.init.body as Blob;
      const arr = new Uint8Array(await body.arrayBuffer());
      if (index === 2) {
        // Tail chunk is the only partial slice.
        expect(arr.length).toBe(total - 2 * CHUNK_UPLOAD_SIZE);
      } else {
        expect(arr.length).toBe(CHUNK_UPLOAD_SIZE);
      }
      chunks.set(arr, index * CHUNK_UPLOAD_SIZE);
    }));
    for (let i = 0; i < total; i += 1) {
      if (chunks[i] !== bytes[i]) throw new Error(`reassembly mismatch at byte ${i}`);
    }

    // Chunk PUTs stay far below the edge request-body cap.
    for (const call of puts) {
      expect((call.init.body as Blob).size).toBeLessThanOrEqual(CHUNK_UPLOAD_SIZE);
    }

    // Complete carries the declared total so the daemon can cross-check.
    const complete = router.calls.find((c) => c.url.endsWith('/complete'))!;
    expect(complete.init.method).toBe('POST');
    expect(JSON.parse(String(complete.init.body))).toEqual({ name: 'big.bin', totalChunks: 3 });
  });

  it('recovers a dropped chunk via GET status resume, then completes', async () => {
    const total = CHUNK_UPLOAD_SIZE * 2 + 1; // >10 MiB → exactly 3 chunks
    const bytes = new Uint8Array(total);
    bytes[0] = 1;
    bytes[CHUNK_UPLOAD_SIZE] = 2;
    const file = new File([bytes], 'resume.bin', { type: 'application/octet-stream' });

    let chunkFails = 0;
    const router = makeFetchRouter(async (url, init) => {
      if (init.method === 'GET') {
        return new Response(JSON.stringify({ received: [0, 2], totalChunks: 3 }), { status: 200 });
      }
      if (init.method === 'DELETE') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.endsWith('/complete')) {
        return new Response(JSON.stringify({
          files: [{ name: 'resume.bin', path: 'resume.bin', size: total, originalName: 'resume.bin' }],
        }), { status: 200 });
      }
      if (init.method === 'PUT' && /chunk\/1$/.test(url)) {
        chunkFails += 1;
        // First pass: exhaust the 3 in-PUT attempts, then succeed on the
        // resume pass's re-PUT.
        if (chunkFails <= 3) return new Response('boom', { status: 502 });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (init.method === 'PUT' && /chunk\/0$/.test(url)) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (init.method === 'PUT' && /chunk\/2$/.test(url)) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      throw new Error(`unexpected fetch ${init.method} ${url}`);
    });
    router.stub();

    const result = await uploadProjectFiles('project-1', [file]);

    expect(result.failed).toEqual([]);
    expect(result.uploaded).toHaveLength(1);
    // Chunk 1 was attempted 3× in the first pass and once on resume = 4.
    expect(chunkFails).toBe(4);
    // The resume pass queried status between the two passes.
    const statusCall = router.calls.find((c) => c.init.method === 'GET');
    expect(statusCall).toBeTruthy();
    const completeCall = router.calls.find((c) => c.url.endsWith('/complete'))!;
    expect(JSON.parse(String(completeCall.init.body))).toEqual({ name: 'resume.bin', totalChunks: 3 });
  });

  it('aborts staging and reports the file as failed when chunks are unrecoverable', async () => {
    const file = new File([new Uint8Array(CHUNK_UPLOAD_THRESHOLD + 1)], 'doomed.bin', { type: 'application/octet-stream' });
    const router = makeFetchRouter(async (url, init) => {
      if (init.method === 'PUT') {
        return new Response('boom', { status: 502 });
      }
      if (init.method === 'GET') {
        return new Response(JSON.stringify({ received: [], totalChunks: 1 }), { status: 200 });
      }
      if (init.method === 'DELETE') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(null, { status: 500 });
    });
    router.stub();

    const result = await uploadProjectFiles('project-1', [file]);

    expect(result.uploaded).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatchObject({ name: 'doomed.bin' });
    const abort = router.calls.find((c) => c.init.method === 'DELETE');
    expect(abort).toBeTruthy();
  });

  it('fails a chunked file only on its own entry and still uploads the small files', async () => {
    const doomed = new File([new Uint8Array(CHUNK_UPLOAD_THRESHOLD + 1)], 'doomed.bin', { type: 'application/octet-stream' });
    const smallA = new File(['a'], 'a.txt');
    const smallB = new File(['b'], 'b.txt');
    const router = makeFetchRouter(async (url, init) => {
      if (init.method === 'PUT') {
        return new Response('boom', { status: 502 });
      }
      if (init.method === 'GET') return new Response(JSON.stringify({ received: [], totalChunks: 1 }), { status: 200 });
      if (init.method === 'DELETE') return new Response(JSON.stringify({ ok: true }), { status: 200 });
      if (url === '/api/projects/project-1/upload' && init.method === 'POST') {
        const form = init.body as FormData;
        return new Response(JSON.stringify({
          files: [
            { name: 'a.txt', path: 'a.txt', size: 1, originalName: 'a.txt' },
            { name: 'b.txt', path: 'b.txt', size: 1, originalName: 'b.txt' },
          ],
        }), { status: 200 });
      }
      return new Response(null, { status: 500 });
    });
    router.stub();

    const result = await uploadProjectFiles('project-1', [doomed, smallA, smallB]);

    expect(result.uploaded).toHaveLength(2);
    expect(result.failed).toEqual([expect.objectContaining({ name: 'doomed.bin' })]);
    // multipart POST went out with only the two small files.
    const multipart = router.calls.find((c) => c.url === '/api/projects/project-1/upload')!;
    expect(JSON.stringify((multipart.init.body as FormData).getAll('files').map((f) => (f as File).name)))
      .toBe(JSON.stringify(['a.txt', 'b.txt']));
  });
});
