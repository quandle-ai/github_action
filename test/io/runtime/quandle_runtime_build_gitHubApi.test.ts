// ==========================================================================
// Quandle GitHub Action · test/io/runtime/quandle_runtime_build_gitHubApi.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/io/runtime.ts → quandle_runtime_build_gitHubApi
// Also covers (private): quandle_runtime_parse_apiUrl, quandle_runtime_parse_repository
//
// Proves the GitHub API client only ever talks to GITHUB_API_URL (default
// https://api.github.com) over https with the github-token, for the repository in
// GITHUB_REPOSITORY, and that anything missing or invalid is our own reason
// (warn and continue), never a throw and never the environment's value.
// Rules: PRM-3, TRU-6
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_runtime_build_gitHubApi } from '../../../src/io/runtime';
import type { OctokitFactory, RuntimeEnvironment } from '../../../src/io/runtime';
import { buildFakeOctokit } from '../../helpers/fake-octokit';
import type { FakeOctokit } from '../../helpers/fake-octokit';
import { UNUSED_FETCH } from '../../helpers/fake-engine';

function buildEnvironment(env: Record<string, string | undefined>): RuntimeEnvironment {
  return { env: { GITHUB_REPOSITORY: 'acme/shop', ...env }, readFile: () => '{}', fetch: UNUSED_FETCH };
}

function buildRecordingFactory(): {
  factory: OctokitFactory;
  built: { auth: string; baseUrl: string }[];
  octokit: FakeOctokit;
} {
  const built: { auth: string; baseUrl: string }[] = [];
  const octokit = buildFakeOctokit({
    responses: { 'GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls': [] },
  });
  return {
    built,
    octokit,
    factory: (options) => {
      built.push(options);
      return octokit;
    },
  };
}

describe('quandle_runtime_build_gitHubApi', () => {
  it('[TRU-6] talks to GITHUB_API_URL with the github-token', () => {
    const { factory, built } = buildRecordingFactory();
    const api = quandle_runtime_build_gitHubApi(
      buildEnvironment({ GITHUB_API_URL: 'https://github.example.com/api/v3' }),
      factory,
      'FAKE_TOKEN',
    );
    expect(api.ok).toBe(true);
    expect(built).toEqual([{ auth: 'FAKE_TOKEN', baseUrl: 'https://github.example.com/api/v3' }]);
  });

  it('[TRU-6] uses https://api.github.com when GITHUB_API_URL is not set', () => {
    const { factory, built } = buildRecordingFactory();
    quandle_runtime_build_gitHubApi(buildEnvironment({}), factory, 'FAKE_TOKEN');
    expect(built[0]?.baseUrl).toBe('https://api.github.com');
  });

  it('[TRU-6] sends requests for the repository named in GITHUB_REPOSITORY', async () => {
    const { factory, octokit } = buildRecordingFactory();
    const api = quandle_runtime_build_gitHubApi(buildEnvironment({}), factory, 'FAKE_TOKEN');
    if (!api.ok) throw new Error('expected an API');
    await api.value.listPullRequestsForCommit('deploy-sha');
    expect(octokit.calls[0]?.parameters).toMatchObject({ owner: 'acme', repo: 'shop' });
  });

  it.each([
    ['plain http', 'http://api.github.com'],
    ['embedded credentials', 'https://user:FAKE_PASSWORD@api.github.com'],
    ['not a URL', 'api.github.com'],
  ])('[TRU-6] refuses a GITHUB_API_URL with %s, so the token is never sent there', (_name, apiUrl) => {
    const { factory, built } = buildRecordingFactory();
    const api = quandle_runtime_build_gitHubApi(
      buildEnvironment({ GITHUB_API_URL: apiUrl }),
      factory,
      'FAKE_TOKEN',
    );
    expect(api).toEqual({ ok: false, reason: 'GITHUB_API_URL is not an https URL' });
    expect(built).toEqual([]);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['without an owner', 'shop'],
    ['with extra parts', 'acme/shop/extra'],
  ])('[PRM-3] reports a GITHUB_REPOSITORY that is %s as our own reason', (_name, repository) => {
    const { factory } = buildRecordingFactory();
    const api = quandle_runtime_build_gitHubApi(
      buildEnvironment({ GITHUB_REPOSITORY: repository }),
      factory,
      'FAKE_TOKEN',
    );
    expect(api).toEqual({ ok: false, reason: 'GITHUB_REPOSITORY is not set to owner/repo' });
  });

  it('[PRM-3] reports a missing github-token as our own reason, without building a client', () => {
    const { factory, built } = buildRecordingFactory();
    const api = quandle_runtime_build_gitHubApi(buildEnvironment({}), factory, '');
    expect(api).toEqual({ ok: false, reason: 'the github-token input is empty' });
    expect(built).toEqual([]);
  });

  it('[TRU-6] never puts the environment values into the reason', () => {
    const { factory } = buildRecordingFactory();
    const api = quandle_runtime_build_gitHubApi(
      buildEnvironment({
        GITHUB_API_URL: 'https://user:FAKE_PASSWORD@evil.example',
        GITHUB_REPOSITORY: 'FAKE_REPO_VALUE',
      }),
      factory,
      'FAKE_TOKEN',
    );
    expect(JSON.stringify(api)).not.toMatch(/FAKE_PASSWORD|FAKE_REPO_VALUE|FAKE_TOKEN/);
  });
});
