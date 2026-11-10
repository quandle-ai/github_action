// ==========================================================================
// Quandle GitHub Action · src/io/runtime.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Builds the real ActionRuntime from @actions/core, the environment and the file
// system. All three are passed in, so this is fully tested. Reads the GitHub event
// only when the run asks for it, inside main's try, so nothing can fail at import.
// Rules: TGT-3, TRU-3 … TRU-6, PRM-3, OUT-1, OUT-6, ERR-1 … ERR-3, IGN-7, IO-1
// ==========================================================================
import { quandle_github_build_api } from './github';
import type { EngineFetch } from './api';
import type { GitHubApi, OctokitApi, RepositoryRef } from './github';
import type { ActionRuntime } from '../main';
import type { EventContext, Parsed } from '../types';

// Builds an Octokit for one token and API base URL. The real one is passed in by index.ts.
export type OctokitFactory = (options: { auth: string; baseUrl: string }) => OctokitApi;

// TRU-6: the GitHub API on github.com, used when GITHUB_API_URL is not set.
const DEFAULT_GITHUB_API_URL = 'https://api.github.com';
// owner/repo: letters, digits, '-', '_' and '.', exactly one slash.
const REPOSITORY_PATTERN = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;

// The parts of @actions/core's job summary we use.
export interface CoreSummaryApi {
  emptyBuffer(): CoreSummaryApi;
  addRaw(text: string): CoreSummaryApi;
  write(): Promise<unknown>;
}

// The parts of @actions/core we use. The real module is passed in by index.ts.
export interface CoreApi {
  getInput(name: string): string;
  setSecret(secret: string): void;
  setOutput(name: string, value: string | number): void;
  setFailed(message: string): void;
  warning(message: string): void;
  info(message: string): void;
  getIDToken(audience: string): Promise<string>;
  readonly summary: CoreSummaryApi;
}

// The process environment, a file reader and the network fetch. The real ones are passed in by index.ts.
export interface RuntimeEnvironment {
  readonly env: Readonly<Record<string, string | undefined>>;
  readFile(path: string): string;
  readonly fetch: EngineFetch;
}

// Reads the GitHub event: its name and commit from the environment, its payload from the
// event file. The payload stays untrusted (`unknown`) until target.ts validates it.
// Throws our own fixed error, never the file's contents or the read error, when a variable is
// missing, the file can't be read, or it isn't valid JSON; main turns that into a fail-open
// internal error.
// Returns: the event context.
// Rules: ERR-3
export function quandle_runtime_read_eventContext(environment: RuntimeEnvironment): EventContext {
  const eventName = quandle_runtime_read_requiredVariable(environment, 'GITHUB_EVENT_NAME');
  const sha = quandle_runtime_read_requiredVariable(environment, 'GITHUB_SHA');
  const eventPath = quandle_runtime_read_requiredVariable(environment, 'GITHUB_EVENT_PATH');
  let eventFileText: string;
  try {
    eventFileText = environment.readFile(eventPath);
  } catch {
    throw new Error('Quandle: the GitHub event file could not be read.');
  }
  let payload: unknown;
  try {
    payload = JSON.parse(eventFileText);
  } catch {
    throw new Error('Quandle: the GitHub event file is not valid JSON.');
  }
  return { eventName, sha, payload };
}

// Builds the real runtime. Every method passes straight through to @actions/core; the event is
// read only when the run calls readEvent; the summary buffer is emptied before every write,
// so content from a failed write is never written again.
// Returns: the ActionRuntime main runs against.
// Rules: ERR-3, OUT-1, IO-1, TRU-5, OUT-6, ERR-1, ERR-2, TGT-3, IGN-7, TRU-3, TRU-4
export function quandle_runtime_build_actionRuntime(
  core: CoreApi,
  environment: RuntimeEnvironment,
  createOctokit: OctokitFactory,
): ActionRuntime {
  return {
    readEvent: () => quandle_runtime_read_eventContext(environment),
    getInput: (name) => core.getInput(name),
    setSecret: (secret) => core.setSecret(secret),
    setOutput: (name, value) => core.setOutput(name, value),
    setFailed: (message) => core.setFailed(message),
    warning: (message) => core.warning(message),
    info: (message) => core.info(message),
    writeSummary: async (markdown) => {
      await core.summary.emptyBuffer().addRaw(markdown).write();
    },
    getGitHubApi: (token) => quandle_runtime_build_gitHubApi(environment, createOctokit, token),
    // The one place the real clock is read; everything else gets the time from here (IGN-7).
    now: () => new Date(),
    // Only when the run asks, never while the runtime is built (TRU-3).
    // Rejects without id-token: write (TRU-8).
    getOidcToken: (audience) => core.getIDToken(audience),
    fetch: (url, init) => environment.fetch(url, init),
  };
}

// One environment variable GitHub always sets. Empty counts as missing.
// Returns: its value; throws our own fixed error naming the variable when it is missing.
// Rules: ERR-3
function quandle_runtime_read_requiredVariable(environment: RuntimeEnvironment, name: string): string {
  const value = environment.env[name];
  if (value === undefined || value === '') throw new Error(`Quandle: ${name} is not set.`);
  return value;
}

// Builds the GitHub API client for this run: only to GITHUB_API_URL (default https://api.github.com),
// only over https, only with the github-token, only for the repository in GITHUB_REPOSITORY.
// Returns: the API, or our own reason (never an environment value) when anything is missing or invalid.
// Rules: TRU-6, PRM-3
export function quandle_runtime_build_gitHubApi(
  environment: RuntimeEnvironment,
  createOctokit: OctokitFactory,
  token: string,
): Parsed<GitHubApi> {
  if (token === '') return { ok: false, reason: 'the github-token input is empty' };
  const repository = quandle_runtime_parse_repository(environment.env.GITHUB_REPOSITORY);
  if (repository === undefined) return { ok: false, reason: 'GITHUB_REPOSITORY is not set to owner/repo' };
  const baseUrl = quandle_runtime_parse_apiUrl(environment.env.GITHUB_API_URL);
  if (baseUrl === undefined) return { ok: false, reason: 'GITHUB_API_URL is not an https URL' };
  return { ok: true, value: quandle_github_build_api(createOctokit({ auth: token, baseUrl }), repository) };
}

// The GitHub API base URL: GITHUB_API_URL when set, else https://api.github.com.
// Returns: the URL without a trailing slash, or undefined unless it is https with no credentials.
// Rules: TRU-6
function quandle_runtime_parse_apiUrl(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === '') return DEFAULT_GITHUB_API_URL;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') return undefined;
  return parsed.href.replace(/\/$/, '');
}

// The owner and repo from GITHUB_REPOSITORY ("owner/repo").
// Returns: them, or undefined when the value is missing or not exactly owner/repo.
// Rules: PRM-3
function quandle_runtime_parse_repository(raw: string | undefined): RepositoryRef | undefined {
  const match = REPOSITORY_PATTERN.exec(raw ?? '');
  if (match === null) return undefined;
  // When the pattern matches, both capture groups always exist.
  const [, owner, repo] = match as unknown as [string, string, string];
  return { owner, repo };
}
