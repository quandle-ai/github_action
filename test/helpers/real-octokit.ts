// ==========================================================================
// Quandle GitHub Action · test/helpers/real-octokit.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// The real Octokit (with the paginate plugin, as index.ts builds it) on an
// injected fake fetch, so tests see exactly the errors the library throws,
// without any network. The fetch is passed in; no global is touched.
// ==========================================================================
import { Octokit } from '@octokit/core';
import { paginateRest } from '@octokit/plugin-paginate-rest';
import type { OctokitApi } from '../../src/io/github';

const PaginatingOctokit = Octokit.plugin(paginateRest);

// What the fake answers for every request: a Response, or a rejection like fetch's own.
export type FakeFetch = () => Promise<Response>;

export function buildRealOctokit(fakeFetch: FakeFetch): OctokitApi {
  const octokit = new PaginatingOctokit({ auth: 'FAKE_TEST_KEY', request: { fetch: fakeFetch } });
  return {
    request: (route, parameters) => octokit.request(route, parameters),
    // Same cast as index.ts: Octokit types paginate per route; at runtime it is OctokitApi.paginate.
    paginate: (route, parameters, mapPage) =>
      (octokit.paginate as unknown as OctokitApi['paginate'])(route, parameters, mapPage),
  };
}

// What fetch rejects with when its AbortSignal.timeout fires.
export function rejectAsTimeout(): Promise<Response> {
  return Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
}

// What fetch rejects with when the connection fails (DNS, reset, refused).
export function rejectAsNetworkFailure(): Promise<Response> {
  return Promise.reject(new TypeError('fetch failed', { cause: new Error('ECONNRESET') }));
}

// A real HTTP answer from GitHub with this status and a JSON error body.
export function answerWithStatus(status: number): () => Promise<Response> {
  return async () =>
    new Response(JSON.stringify({ message: 'FAKE_GITHUB_ERROR_BODY' }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
}
