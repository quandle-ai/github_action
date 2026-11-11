// ==========================================================================
// Quandle GitHub Action · test/io/api/quandle_api_request_postScanToEngine.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/io/api.ts → quandle_api_request_postScanToEngine
// Also covers (private): the OIDC step, the capped body read and the timeout
//
// Proves a scan gets an OIDC token for https://api.quandle.ai and masks it before
// anything else, sends it only to the constant engine URL, bare in X-Quandle-Token
// (never in Authorization), with a JSON body of exactly the request and its hash,
// refuses redirects, and hands the answer to the
// strict parser; no token means no call and a fail-open reason; a body over 2 MB,
// an exchange slower than 60 seconds or any network failure is engine-error with
// our fixed reason, never the error's text or the token.
// Rules: MOCK-4, TGT-1, TRU-1, TRU-2, TRU-3, TRU-4, TRU-5, TRU-7, TRU-8
// ==========================================================================
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ENGINE_URL, quandle_api_request_postScanToEngine } from '../../../src/io/api';
import type { ScanRequest } from '../../../src/types';
import { buildFakeEngine, engineAnswer, FAKE_OIDC_TOKEN } from '../../helpers/fake-engine';
import { LEAKY_ERROR_TEXT } from '../../helpers/fake-runtime';

const REQUEST: ScanRequest = {
  url: 'https://preview.example.com/?share=FAKE_SHARE',
  environment: 'Preview',
  production: false,
  bypassSecret: 'FAKE_BYPASS',
  contract: 2,
};
const MAX_BYTES = 2 * 1024 * 1024;
const ENGINE_ERROR_REASON = 'the Quandle engine could not complete the scan';
const OIDC_REASON = 'could not get a GitHub OIDC token; the workflow needs `id-token: write`';
const CLEAN_SCAN = { status: 'scanned', scanId: 'scan_test01', findings: [] };

// A body that streams these chunks, then ends.
function streamedResponse(chunks: readonly Uint8Array[], headers: Record<string, string> = {}): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers });
}

// A fetch that never answers until its signal aborts, like an engine that hangs.
function hangingFetch(url: string, init: RequestInit): Promise<Response> {
  void url;
  return new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
}

// The body fetch received, as bytes: the Action sends the same bytes it hashed (TRU-2).
function sentBodyBytes(engine: ReturnType<typeof buildFakeEngine>): Uint8Array {
  const body = engine.requests[0]?.init.body;
  if (!(body instanceof Uint8Array)) throw new Error('the body was not sent as bytes');
  return body;
}

function sentBodyText(engine: ReturnType<typeof buildFakeEngine>): string {
  return new TextDecoder().decode(sentBodyBytes(engine));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('quandle_api_request_postScanToEngine', () => {
  describe('where the scan goes (TRU-4)', () => {
    it('[TRU-4] sends scans only to the constant engine URL https://api.quandle.ai/v1/scan', () => {
      expect(ENGINE_URL).toBe('https://api.quandle.ai/v1/scan');
    });

    it('[TRU-4] calls only https://api.quandle.ai/v1/scan, whatever the request URL says', async () => {
      const engine = buildFakeEngine({ respond: engineAnswer(CLEAN_SCAN) });
      await quandle_api_request_postScanToEngine(
        { url: 'https://evil.example.com/v1/scan', production: false, contract: 2 },
        engine,
      );
      expect(engine.requests.map((request) => request.url)).toEqual(['https://api.quandle.ai/v1/scan']);
    });

    it('[TRU-4] sends a POST that refuses to follow redirects', async () => {
      const engine = buildFakeEngine({ respond: engineAnswer(CLEAN_SCAN) });
      await quandle_api_request_postScanToEngine(REQUEST, engine);
      expect(engine.requests[0]?.init).toMatchObject({ method: 'POST', redirect: 'error' });
    });
  });

  describe('the OIDC token (TRU-2, TRU-3, TRU-5, TRU-8)', () => {
    it('[TRU-3] asks for an OIDC token for the audience https://api.quandle.ai', async () => {
      const engine = buildFakeEngine({ respond: engineAnswer(CLEAN_SCAN) });
      await quandle_api_request_postScanToEngine(REQUEST, engine);
      expect(engine.log[0]).toBe('getOidcToken:https://api.quandle.ai');
    });

    it('[TRU-5] masks the OIDC token the moment it exists, before the engine is called', async () => {
      const engine = buildFakeEngine({ respond: engineAnswer(CLEAN_SCAN) });
      await quandle_api_request_postScanToEngine(REQUEST, engine);
      expect(engine.log).toEqual([
        'getOidcToken:https://api.quandle.ai',
        `setSecret:${FAKE_OIDC_TOKEN}`,
        'fetch:https://api.quandle.ai/v1/scan',
      ]);
    });

    it('[TRU-2] sends the bare token in X-Quandle-Token, with no Bearer prefix, and Content-Type: application/json', async () => {
      const engine = buildFakeEngine({ respond: engineAnswer(CLEAN_SCAN) });
      await quandle_api_request_postScanToEngine(REQUEST, engine);
      const headers = new Headers(engine.requests[0]?.init.headers);
      expect(headers.get('x-quandle-token')).toBe(FAKE_OIDC_TOKEN);
      expect(headers.get('content-type')).toBe('application/json');
    });

    it('[TRU-2] sends no Authorization header at all (the engine hosting signs requests there)', async () => {
      const engine = buildFakeEngine({ respond: engineAnswer(CLEAN_SCAN) });
      await quandle_api_request_postScanToEngine(REQUEST, engine);
      expect(new Headers(engine.requests[0]?.init.headers).has('authorization')).toBe(false);
    });

    it('[TRU-2] sends x-amz-content-sha256 as the sha256 of the body: 14e53593… for this request', async () => {
      const engine = buildFakeEngine({ respond: engineAnswer(CLEAN_SCAN) });
      await quandle_api_request_postScanToEngine(REQUEST, engine);
      const headers = new Headers(engine.requests[0]?.init.headers);
      // Computed independently (sha256sum) over the exact JSON of REQUEST.
      expect(headers.get('x-amz-content-sha256')).toBe(
        '14e53593b7bf225ae5976da351c56f1066c27552d89b1cb13c51c19db1b5cc1b',
      );
    });

    it('[TRU-2] hashes exactly the bytes it sends: the header matches the sha256 of the body fetch received', async () => {
      const engine = buildFakeEngine({ respond: engineAnswer(CLEAN_SCAN) });
      const withUnicode: ScanRequest = { ...REQUEST, environment: 'Prévia ✓' };
      await quandle_api_request_postScanToEngine(withUnicode, engine);
      const sent = sentBodyBytes(engine);
      const headers = new Headers(engine.requests[0]?.init.headers);
      expect(headers.get('x-amz-content-sha256')).toBe(createHash('sha256').update(sent).digest('hex'));
      expect(JSON.parse(new TextDecoder().decode(sent))).toEqual(withUnicode);
    });

    it('[TRU-8] does not call the engine when the OIDC token cannot be fetched', async () => {
      const engine = buildFakeEngine({ respond: engineAnswer(CLEAN_SCAN), isTokenUnavailable: true });
      await quandle_api_request_postScanToEngine(REQUEST, engine);
      expect(engine.requests).toEqual([]);
    });

    it('[TRU-8] fails open with "could not get a GitHub OIDC token; the workflow needs `id-token: write`"', async () => {
      const engine = buildFakeEngine({ isTokenUnavailable: true });
      await expect(quandle_api_request_postScanToEngine(REQUEST, engine)).resolves.toEqual({
        status: 'engine-error',
        url: REQUEST.url,
        environment: 'Preview',
        reason: OIDC_REASON,
        findings: [],
        isMock: false,
      });
    });

    it('[TRU-5] never puts the OIDC token in the result', async () => {
      const results = [
        await quandle_api_request_postScanToEngine(
          REQUEST,
          buildFakeEngine({ respond: engineAnswer(CLEAN_SCAN) }),
        ),
        await quandle_api_request_postScanToEngine(REQUEST, buildFakeEngine()),
      ];
      expect(JSON.stringify(results)).not.toContain(FAKE_OIDC_TOKEN);
    });
  });

  describe('the request body (TRU-1)', () => {
    it('[TRU-1] sends exactly the scan request as JSON: url, environment, production and bypassSecret', async () => {
      const engine = buildFakeEngine({ respond: engineAnswer(CLEAN_SCAN) });
      await quandle_api_request_postScanToEngine(REQUEST, engine);
      expect(JSON.parse(sentBodyText(engine))).toEqual(REQUEST);
    });
  });

  describe('the answer (TRU-7)', () => {
    it('[TRU-7] turns a 200 scanned answer into a scanned result through the strict parser', async () => {
      const engine = buildFakeEngine({ respond: engineAnswer(CLEAN_SCAN) });
      await expect(quandle_api_request_postScanToEngine(REQUEST, engine)).resolves.toEqual({
        status: 'scanned',
        url: REQUEST.url,
        environment: 'Preview',
        scanId: 'scan_test01',
        findings: [],
        isMock: false,
      });
    });

    it('[TRU-7] turns a 429 into rate-limited', async () => {
      const engine = buildFakeEngine({ respond: engineAnswer({ error: 'slow down' }, 429) });
      expect((await quandle_api_request_postScanToEngine(REQUEST, engine)).status).toBe('rate-limited');
    });

    it('[TRU-7] turns a 401 with no body at all into engine-error with our fixed reason', async () => {
      const engine = buildFakeEngine({ respond: async () => new Response(null, { status: 401 }) });
      await expect(quandle_api_request_postScanToEngine(REQUEST, engine)).resolves.toMatchObject({
        status: 'engine-error',
        reason: ENGINE_ERROR_REASON,
      });
    });

    it('[TRU-7] accepts a body of exactly 2 MB', async () => {
      const json = JSON.stringify(CLEAN_SCAN);
      const body = json + ' '.repeat(MAX_BYTES - json.length);
      const engine = buildFakeEngine({ respond: async () => new Response(body, { status: 200 }) });
      expect((await quandle_api_request_postScanToEngine(REQUEST, engine)).status).toBe('scanned');
    });

    it('[TRU-7] turns a body that streams past 2 MB (with no Content-Length) into engine-error', async () => {
      const chunk = new Uint8Array(1024 * 1024).fill(32);
      const engine = buildFakeEngine({
        respond: async () => streamedResponse([chunk, chunk, new Uint8Array([32])]),
      });
      await expect(quandle_api_request_postScanToEngine(REQUEST, engine)).resolves.toMatchObject({
        status: 'engine-error',
        reason: ENGINE_ERROR_REASON,
      });
    });

    it('[TRU-7] turns a Content-Length over 2 MB into engine-error without reading the body', async () => {
      let isBodyRead = false;
      // highWaterMark 0: the stream only pulls when someone reads, so a pull means the body was read.
      const stream = new ReadableStream<Uint8Array>(
        {
          pull() {
            isBodyRead = true;
          },
        },
        { highWaterMark: 0 },
      );
      const headers = { 'content-length': String(MAX_BYTES + 1) };
      const engine = buildFakeEngine({ respond: async () => new Response(stream, { status: 200, headers }) });
      const result = await quandle_api_request_postScanToEngine(REQUEST, engine);
      expect(result).toMatchObject({ status: 'engine-error', reason: ENGINE_ERROR_REASON });
      expect(isBodyRead).toBe(false);
    });

    it.each([
      ['the network is down', new TypeError('fetch failed')],
      ['the engine redirects', new TypeError('unexpected redirect')],
      ['the error carries secret-looking text', new Error(LEAKY_ERROR_TEXT)],
    ])(
      '[MOCK-4] reports engine-error with no findings and our fixed reason when %s',
      async (_label, error) => {
        const engine = buildFakeEngine({ respond: () => Promise.reject(error) });
        const result = await quandle_api_request_postScanToEngine(REQUEST, engine);
        expect(result).toEqual({
          status: 'engine-error',
          url: REQUEST.url,
          environment: 'Preview',
          reason: ENGINE_ERROR_REASON,
          findings: [],
          isMock: false,
        });
        expect(JSON.stringify(result)).not.toContain(LEAKY_ERROR_TEXT);
      },
    );

    it('[TGT-1] leaves the environment out of the result when the request has none, never guessing one', async () => {
      const result = await quandle_api_request_postScanToEngine(
        { url: 'https://app.example.com/', production: false, contract: 2 },
        buildFakeEngine(),
      );
      expect(result).not.toHaveProperty('environment');
    });
  });

  describe('the 60-second limit (TRU-7)', () => {
    it('[TRU-7] gives up with engine-error when the engine has not answered after 60 seconds', async () => {
      vi.useFakeTimers();
      const engine = buildFakeEngine({ respond: hangingFetch });
      const pending = quandle_api_request_postScanToEngine(REQUEST, engine);
      await vi.advanceTimersByTimeAsync(60_000);
      await expect(pending).resolves.toMatchObject({ status: 'engine-error', reason: ENGINE_ERROR_REASON });
    });

    it('[TRU-7] is still waiting after 59.999 seconds', async () => {
      vi.useFakeTimers();
      const engine = buildFakeEngine({ respond: hangingFetch });
      let isSettled = false;
      void quandle_api_request_postScanToEngine(REQUEST, engine).then(() => (isSettled = true));
      await vi.advanceTimersByTimeAsync(59_999);
      expect(isSettled).toBe(false);
      expect(engine.requests[0]?.init.signal?.aborted).toBe(false);
    });

    it('[TRU-7] gives up with engine-error when the body is still arriving after 60 seconds', async () => {
      vi.useFakeTimers();
      const respond = async (_url: string, init: RequestInit): Promise<Response> => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([123]));
            init.signal?.addEventListener('abort', () =>
              controller.error(new DOMException('aborted', 'AbortError')),
            );
          },
        });
        return new Response(stream, { status: 200 });
      };
      const pending = quandle_api_request_postScanToEngine(REQUEST, buildFakeEngine({ respond }));
      await vi.advanceTimersByTimeAsync(60_000);
      await expect(pending).resolves.toMatchObject({ status: 'engine-error', reason: ENGINE_ERROR_REASON });
    });

    it('[TRU-7] leaves no timer running after a fast answer', async () => {
      vi.useFakeTimers();
      await quandle_api_request_postScanToEngine(
        REQUEST,
        buildFakeEngine({ respond: engineAnswer(CLEAN_SCAN) }),
      );
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
