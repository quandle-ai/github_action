// ==========================================================================
// Quandle GitHub Action · test/helpers/fake-octokit.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// In-memory OctokitApi for testing github.ts without the network: answers each
// route from a table (or throws a chosen error), serves paginated routes page by
// page, and records every route, its parameters and how many pages were read.
// ==========================================================================
import type { OctokitApi } from '../../src/io/github';
import type { OctokitFactory } from '../../src/io/runtime';

export interface FakeOctokitCall {
  route: string;
  parameters: Record<string, unknown>;
}

export interface FakeOctokit extends OctokitApi {
  calls: FakeOctokitCall[];
  pagesRead: number;
}

export interface FakeOctokitOptions {
  // Response data for request(route), by route.
  responses?: Record<string, unknown>;
  // Pages of data for paginate(route), by route.
  pages?: Record<string, unknown[][]>;
  // Makes every call throw this value (e.g. an object with a status, like Octokit's RequestError).
  thrown?: unknown;
}

export function buildFakeOctokit(options: FakeOctokitOptions = {}): FakeOctokit {
  const octokit: FakeOctokit = {
    calls: [],
    pagesRead: 0,
    async request(route, parameters) {
      octokit.calls.push({ route, parameters });
      if (options.thrown !== undefined) throw options.thrown;
      return { data: options.responses?.[route] };
    },
    async paginate(route, parameters, mapPage) {
      octokit.calls.push({ route, parameters });
      if (options.thrown !== undefined) throw options.thrown;
      const results: unknown[] = [];
      let isDone = false;
      for (const page of options.pages?.[route] ?? []) {
        if (isDone) break;
        octokit.pagesRead += 1;
        results.push(...mapPage({ data: page }, () => (isDone = true)));
      }
      return results;
    },
  };
  return octokit;
}

// For runtime tests that never ask for the GitHub API.
export const UNUSED_OCTOKIT_FACTORY: OctokitFactory = () => buildFakeOctokit();
