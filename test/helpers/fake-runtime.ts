// ==========================================================================
// Quandle GitHub Action · test/helpers/fake-runtime.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// In-memory ActionRuntime for testing main without GitHub.
// Records every call in order, can be told to make one method throw, and records
// a "leak" whenever any output contains the value of a secret input or the OIDC token (TRU-5).
// ==========================================================================
import type { GitHubApi } from '../../src/io/github';
import type { ActionRuntime } from '../../src/main';
import type { FakeGitHub, FakeGitHubOptions } from './fake-github';
import { buildFakeEngine, FAKE_OIDC_TOKEN } from './fake-engine';
import type { FakeEngineOptions } from './fake-engine';
import { buildFakeGitHub } from './fake-github';
import type { EventContext, InputName } from '../../src/types';

export interface FakeRuntime extends ActionRuntime {
  calls: string[];
  secrets: string[];
  outputs: Record<string, string | number>;
  failures: string[];
  warnings: string[];
  infos: string[];
  summaries: string[];
  // Every output (method and text) that contained a secret input's value. Must stay empty.
  leaks: string[];
  // The fake GitHub behind getGitHubApi, and every token getGitHubApi was asked for.
  github: FakeGitHub;
  gitHubTokens: string[];
  // Every scan request the fake engine received, decoded from the body bytes.
  engineRequests: unknown[];
}

// One value per declared input, exhaustive: TypeScript errors if an input is missing or extra.
export const DEFAULT_TEST_INPUTS: Readonly<Record<InputName, string>> = {
  url: 'https://app.example.com/',
  'fail-on': 'critical',
  comment: 'true',
  issue: 'true',
  'bypass-secret': '',
  mock: 'false',
  'mock-scenario': 'clean',
  'github-token': 'FAKE_GITHUB_TOKEN',
};

const SECRET_INPUTS: readonly InputName[] = ['bypass-secret', 'github-token'];

export const DISPATCH_EVENT: EventContext = {
  eventName: 'workflow_dispatch',
  sha: 'context-sha',
  payload: {},
};

// A thrown value that would leak if it were ever printed.
export const LEAKY_ERROR_TEXT = 'FAKE_LEAKED_VALUE';

export interface FakeRuntimeOptions {
  // Overrides by name. Deliberately loose (any string key), so tests can pass names that
  // are not declared inputs, e.g. the removed api-url, and prove they are never read.
  inputs?: Record<string, string>;
  event?: EventContext;
  // Makes this runtime method throw every time it is called.
  failingMethod?: 'writeSummary' | 'warning' | 'setOutput' | 'readEvent';
  // Makes getInput throw when reading this input name.
  failingInput?: InputName;
  // What the failing method throws (an Error by default).
  thrownValue?: unknown;
  // PRs and comments in the fake GitHub, and which call (if any) fails.
  github?: FakeGitHubOptions;
  // When set, getGitHubApi returns this reason instead of an API (e.g. no GITHUB_REPOSITORY).
  gitHubUnavailableReason?: string;
  // The run's current time; TEST_NOW unless set.
  now?: Date;
  // How the fake engine answers (unreachable unless set), and whether an OIDC token can be had.
  engine?: FakeEngineOptions;
}

// The fake clock: 2026-11-09 in UTC, so an ignore that expires 2026-11-08 has expired.
export const TEST_NOW = new Date('2026-11-09T12:00:00Z');

export function buildFakeRuntime(options: FakeRuntimeOptions = {}): FakeRuntime {
  const inputs: Record<string, string> = { ...DEFAULT_TEST_INPUTS, ...options.inputs };
  // The OIDC token is a secret too (TRU-5): it must never appear in any output.
  const secretValues = [
    ...SECRET_INPUTS.map((name) => inputs[name] ?? '').filter((value) => value !== ''),
    FAKE_OIDC_TOKEN,
  ];
  const thrown = options.thrownValue ?? new Error(`detail that might include ${LEAKY_ERROR_TEXT}`);
  const failIf = (method: string): void => {
    if (options.failingMethod === method) throw thrown;
  };
  const recordLeaks = (method: string, text: string): void => {
    for (const secret of secretValues) {
      if (text.includes(secret)) runtime.leaks.push(`${method}: ${text}`);
    }
  };
  // The engine is unreachable unless a test says otherwise.
  const engine = buildFakeEngine(options.engine);
  const runtime: FakeRuntime = {
    calls: [],
    secrets: [],
    outputs: {},
    failures: [],
    warnings: [],
    infos: [],
    summaries: [],
    leaks: [],
    github: buildFakeGitHub(options.github),
    gitHubTokens: [],
    engineRequests: [],
    readEvent() {
      runtime.calls.push('readEvent');
      failIf('readEvent');
      return options.event ?? DISPATCH_EVENT;
    },
    getInput(name) {
      runtime.calls.push(`getInput:${name}`);
      if (options.failingInput === name) throw thrown;
      return inputs[name] ?? '';
    },
    setSecret(secret) {
      runtime.calls.push('setSecret');
      runtime.secrets.push(secret);
    },
    setOutput(name, value) {
      runtime.calls.push(`setOutput:${name}`);
      failIf('setOutput');
      recordLeaks(`setOutput:${name}`, String(value));
      runtime.outputs[name] = value;
    },
    setFailed(message) {
      runtime.calls.push('setFailed');
      recordLeaks('setFailed', message);
      runtime.failures.push(message);
    },
    warning(message) {
      runtime.calls.push('warning');
      failIf('warning');
      recordLeaks('warning', message);
      runtime.warnings.push(message);
    },
    info(message) {
      runtime.calls.push('info');
      recordLeaks('info', message);
      runtime.infos.push(message);
    },
    getGitHubApi(token) {
      runtime.calls.push('getGitHubApi');
      runtime.gitHubTokens.push(token);
      if (options.gitHubUnavailableReason !== undefined)
        return { ok: false, reason: options.gitHubUnavailableReason };
      return { ok: true, value: runtime.github satisfies GitHubApi };
    },
    async writeSummary(markdown) {
      runtime.calls.push('writeSummary');
      failIf('writeSummary');
      recordLeaks('writeSummary', markdown);
      runtime.summaries.push(markdown);
    },
    now() {
      runtime.calls.push('now');
      return options.now ?? TEST_NOW;
    },
    async getOidcToken(audience) {
      runtime.calls.push(`getOidcToken:${audience}`);
      return engine.getOidcToken(audience);
    },
    async fetch(url, init) {
      runtime.calls.push('fetch');
      if (init.body instanceof Uint8Array)
        runtime.engineRequests.push(JSON.parse(new TextDecoder().decode(init.body)));
      return engine.fetch(url, init);
    },
  };
  return runtime;
}
