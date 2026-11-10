// ==========================================================================
// Quandle GitHub Action · test/helpers/fake-engine.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Fakes for talking to the Quandle engine without the network: a fetch that must
// never be called, and an in-memory EngineAccess that hands out a fake OIDC token,
// records the order of token, masking and fetch calls, and answers each request
// the way a test says (or fails like a network that is down).
// ==========================================================================
import type { EngineAccess, EngineFetch } from '../../src/io/api';

// For runtime tests that never call the engine: fails loudly if anything does.
export const UNUSED_FETCH: EngineFetch = () =>
  Promise.reject(new Error('fetch was not expected in this test'));

// The OIDC token the fakes hand out. Obviously fake, never a real token format.
export const FAKE_OIDC_TOKEN = 'FAKE_OIDC_TOKEN';

export interface FakeEngine extends EngineAccess {
  // "getOidcToken:<audience>", "setSecret:<value>", "fetch:<url>", in call order.
  log: string[];
  // Every request fetch received.
  requests: { url: string; init: RequestInit }[];
}

export interface FakeEngineOptions {
  // How fetch answers; rejects like a network that is down unless set.
  respond?: (url: string, init: RequestInit) => Promise<Response>;
  // Makes getOidcToken reject, like a workflow without id-token: write.
  isTokenUnavailable?: boolean;
}

export function buildFakeEngine(options: FakeEngineOptions = {}): FakeEngine {
  const engine: FakeEngine = {
    log: [],
    requests: [],
    async getOidcToken(audience) {
      engine.log.push(`getOidcToken:${audience}`);
      if (options.isTokenUnavailable === true) throw new Error('Unable to get ACTIONS_ID_TOKEN_REQUEST_URL');
      return FAKE_OIDC_TOKEN;
    },
    setSecret(secret) {
      engine.log.push(`setSecret:${secret}`);
    },
    async fetch(url, init) {
      engine.log.push(`fetch:${url}`);
      engine.requests.push({ url, init });
      if (options.respond === undefined) throw new TypeError('fetch failed');
      return options.respond(url, init);
    },
  };
  return engine;
}

// A JSON answer from the engine with this HTTP status.
export function engineAnswer(body: unknown, status = 200): () => Promise<Response> {
  return async () => new Response(JSON.stringify(body), { status });
}
