// ==========================================================================
// Quandle GitHub Action · test/io/runtime/quandle_runtime_build_actionRuntime.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/io/runtime.ts → quandle_runtime_build_actionRuntime
// Also covers (private): none
//
// Proves the real runtime passes every call straight to @actions/core, reads the
// GitHub event only when the run asks for it (never while being built), and
// empties the summary buffer before every write so a failed write is never repeated,
// and offers no other way to report a result (no Checks or Statuses API).
// Rules: ERR-1, ERR-2, ERR-3, IGN-7, IO-1, OUT-1, OUT-5, OUT-6, TGT-3, TRU-3, TRU-4, TRU-5
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_runtime_build_actionRuntime } from '../../../src/io/runtime';
import type { CoreApi, CoreSummaryApi, RuntimeEnvironment } from '../../../src/io/runtime';
import type { EngineFetch } from '../../../src/io/api';
import { UNUSED_FETCH } from '../../helpers/fake-engine';
import { UNUSED_OCTOKIT_FACTORY } from '../../helpers/fake-octokit';

interface FakeCore extends CoreApi {
  calls: string[];
}

function buildFakeCore(): FakeCore {
  const calls: string[] = [];
  const summary: CoreSummaryApi = {
    emptyBuffer() {
      calls.push('summary.emptyBuffer');
      return summary;
    },
    addRaw(text) {
      calls.push(`summary.addRaw:${text}`);
      return summary;
    },
    async write() {
      calls.push('summary.write');
    },
  };
  return {
    calls,
    summary,
    getInput: (name) => {
      calls.push(`getInput:${name}`);
      return `value-of-${name}`;
    },
    setSecret: (secret) => void calls.push(`setSecret:${secret}`),
    setOutput: (name, value) => void calls.push(`setOutput:${name}=${value}`),
    setFailed: (message) => void calls.push(`setFailed:${message}`),
    warning: (message) => void calls.push(`warning:${message}`),
    info: (message) => void calls.push(`info:${message}`),
    getIDToken: async (audience) => {
      calls.push(`getIDToken:${audience}`);
      return 'FAKE_OIDC_TOKEN';
    },
  };
}

function buildEnvironment(readCalls: string[], fetch: EngineFetch = UNUSED_FETCH): RuntimeEnvironment {
  return {
    fetch,
    env: {
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      GITHUB_SHA: 'env-sha',
      GITHUB_EVENT_PATH: '/fake/event.json',
    },
    readFile(path) {
      readCalls.push(path);
      return '{}';
    },
  };
}

describe('quandle_runtime_build_actionRuntime', () => {
  it('[ERR-3] reads the event only when the run asks for it, never while the runtime is being built', () => {
    const reads: string[] = [];
    const runtime = quandle_runtime_build_actionRuntime(
      buildFakeCore(),
      buildEnvironment(reads),
      UNUSED_OCTOKIT_FACTORY,
    );
    expect(reads).toEqual([]);
    expect(runtime.readEvent()).toEqual({ eventName: 'workflow_dispatch', sha: 'env-sha', payload: {} });
    expect(reads).toEqual(['/fake/event.json']);
  });

  it('[OUT-1] empties the summary buffer before every write, so a failed write is never repeated', async () => {
    const core = buildFakeCore();
    const runtime = quandle_runtime_build_actionRuntime(core, buildEnvironment([]), UNUSED_OCTOKIT_FACTORY);
    await runtime.writeSummary('first');
    await runtime.writeSummary('second');
    expect(core.calls).toEqual([
      'summary.emptyBuffer',
      'summary.addRaw:first',
      'summary.write',
      'summary.emptyBuffer',
      'summary.addRaw:second',
      'summary.write',
    ]);
  });

  it('[OUT-5] gives the run no way to report a result except the job result, outputs, log, summary and PR comment', () => {
    const runtime = quandle_runtime_build_actionRuntime(
      buildFakeCore(),
      buildEnvironment([]),
      UNUSED_OCTOKIT_FACTORY,
    );
    // No Checks API, no Statuses API: the job's own pass/fail is the status check.
    expect(Object.keys(runtime).sort()).toEqual(
      [
        'fetch',
        'getGitHubApi',
        'getInput',
        'getOidcToken',
        'info',
        'now',
        'readEvent',
        'setFailed',
        'setOutput',
        'setSecret',
        'warning',
        'writeSummary',
      ].sort(),
    );
  });

  it('[OUT-5] hands out a GitHub API with only PR, comment, issue, ignore-file and default-branch calls, nothing that sets a check or status', () => {
    const environment = {
      ...buildEnvironment([]),
      env: { ...buildEnvironment([]).env, GITHUB_REPOSITORY: 'owner/repo' },
    };
    const runtime = quandle_runtime_build_actionRuntime(buildFakeCore(), environment, UNUSED_OCTOKIT_FACTORY);
    const github = runtime.getGitHubApi('FAKE_TOKEN');
    expect(github.ok).toBe(true);
    if (!github.ok) return;
    expect(Object.keys(github.value).sort()).toEqual(
      [
        'closeIssue',
        'createIssue',
        'createPullRequestComment',
        'listOpenIssues',
        'listPullRequestComments',
        'listPullRequestsForCommit',
        'readDefaultBranchHeadSha',
        'readIgnoreFile',
        'updateIssue',
        'updatePullRequestComment',
      ].sort(),
    );
  });

  it('[IO-1] reads inputs through @actions/core getInput', () => {
    const runtime = quandle_runtime_build_actionRuntime(
      buildFakeCore(),
      buildEnvironment([]),
      UNUSED_OCTOKIT_FACTORY,
    );
    expect(runtime.getInput('fail-on')).toBe('value-of-fail-on');
  });

  it.each([
    ['[TRU-5] registers secrets through @actions/core setSecret', 'setSecret:FAKE_SECRET'],
    ['[OUT-6] sets outputs through @actions/core setOutput', 'setOutput:status=mock'],
    ['[ERR-1] fails the job through @actions/core setFailed', 'setFailed:Quandle: failed'],
    ['[ERR-2] warns through @actions/core warning', 'warning:Quandle: warned'],
    ['[TGT-3] logs through @actions/core info', 'info:Quandle: info'],
  ])('%s', (_name, expectedCall) => {
    const core = buildFakeCore();
    const runtime = quandle_runtime_build_actionRuntime(core, buildEnvironment([]), UNUSED_OCTOKIT_FACTORY);
    runtime.setSecret('FAKE_SECRET');
    runtime.setOutput('status', 'mock');
    runtime.setFailed('Quandle: failed');
    runtime.warning('Quandle: warned');
    runtime.info('Quandle: info');
    expect(core.calls).toContain(expectedCall);
  });

  it('[IGN-7] gives the run the current time from the real clock, for ignore expiry', () => {
    const runtime = quandle_runtime_build_actionRuntime(
      buildFakeCore(),
      buildEnvironment([]),
      UNUSED_OCTOKIT_FACTORY,
    );
    const before = Date.now();
    const now = runtime.now();
    expect(now).toBeInstanceOf(Date);
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
    expect(now.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('[TRU-3] gets the OIDC token from @actions/core for exactly the audience it is asked for', async () => {
    const core = buildFakeCore();
    const runtime = quandle_runtime_build_actionRuntime(core, buildEnvironment([]), UNUSED_OCTOKIT_FACTORY);
    await expect(runtime.getOidcToken('https://api.quandle.ai')).resolves.toBe('FAKE_OIDC_TOKEN');
    expect(core.calls).toContain('getIDToken:https://api.quandle.ai');
  });

  it('[TRU-3] fetches no OIDC token while the runtime is being built', () => {
    const core = buildFakeCore();
    quandle_runtime_build_actionRuntime(core, buildEnvironment([]), UNUSED_OCTOKIT_FACTORY);
    expect(core.calls.filter((call) => call.startsWith('getIDToken'))).toEqual([]);
  });

  it('[TRU-4] passes the engine call to the environment fetch unchanged and returns its response', async () => {
    const seen: [string, RequestInit][] = [];
    const answer = new Response('{}', { status: 200 });
    const fetch: EngineFetch = async (url, init) => {
      seen.push([url, init]);
      return answer;
    };
    const runtime = quandle_runtime_build_actionRuntime(
      buildFakeCore(),
      buildEnvironment([], fetch),
      UNUSED_OCTOKIT_FACTORY,
    );
    const init: RequestInit = { method: 'POST', body: '{}', redirect: 'error' };
    await expect(runtime.fetch('https://api.quandle.ai/v1/scan', init)).resolves.toBe(answer);
    expect(seen).toEqual([['https://api.quandle.ai/v1/scan', init]]);
  });
});
