// ==========================================================================
// Quandle GitHub Action · test/io/github/quandle_github_build_api.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/io/github.ts → quandle_github_build_api
// Also covers (private): every GitHub call, its response validation and its error mapping
//
// Proves each call asks GitHub for the right repository and object, validates the
// untrusted response before using it, reads at most 10 pages of comments, passes a
// timeout with every request, and turns every failure (403, 5xx, timeout, malformed
// response) into our own one-line reason, never a throw and never the response.
// A status is reported only when GitHub really answered: checked against the real
// Octokit too, which wraps timeouts and network failures as status 500.
// Covers the production issue calls too: open issues only, PRs skipped. And the
// ignore file: read from the default branch (no ref), 404 means no file, over 1 MB
// or any other shape is a failure.
// Rules: IGN-9, OUT-2, OUT-7, OUT-9, OUT-10, OUT-12, PRM-3, TGT-11
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_github_build_api } from '../../../src/io/github';
import { LEAKY_ERROR_TEXT } from '../../helpers/fake-runtime';
import { buildFakeOctokit } from '../../helpers/fake-octokit';
import {
  answerWithStatus,
  buildRealOctokit,
  rejectAsNetworkFailure,
  rejectAsTimeout,
} from '../../helpers/real-octokit';

const REPOSITORY = { owner: 'acme', repo: 'shop' };
const PULLS_ROUTE = 'GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls';
const COMMENTS_ROUTE = 'GET /repos/{owner}/{repo}/issues/{issue_number}/comments';
const CREATE_ROUTE = 'POST /repos/{owner}/{repo}/issues/{issue_number}/comments';
const UPDATE_ROUTE = 'PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}';
const ISSUES_ROUTE = 'GET /repos/{owner}/{repo}/issues';
const CREATE_ISSUE_ROUTE = 'POST /repos/{owner}/{repo}/issues';
const UPDATE_ISSUE_ROUTE = 'PATCH /repos/{owner}/{repo}/issues/{issue_number}';

function rawComment(id: number, body: unknown, login: unknown): unknown {
  return { id, body, user: login === undefined ? null : { login } };
}

describe('quandle_github_build_api', () => {
  describe('listPullRequestsForCommit', () => {
    it('[OUT-2] lists the PRs for a commit with their number, open state and head commit', async () => {
      const octokit = buildFakeOctokit({
        responses: {
          [PULLS_ROUTE]: [
            { number: 7, state: 'open', head: { sha: 'deploy-sha' } },
            { number: 8, state: 'closed', head: { sha: 'other-sha' } },
          ],
        },
      });
      await expect(
        quandle_github_build_api(octokit, REPOSITORY).listPullRequestsForCommit('deploy-sha'),
      ).resolves.toEqual({
        ok: true,
        value: [
          { number: 7, isOpen: true, headSha: 'deploy-sha' },
          { number: 8, isOpen: false, headSha: 'other-sha' },
        ],
      });
    });

    it('[OUT-2] asks GitHub for the PRs of this repository and this commit', async () => {
      const octokit = buildFakeOctokit({ responses: { [PULLS_ROUTE]: [] } });
      await quandle_github_build_api(octokit, REPOSITORY).listPullRequestsForCommit('deploy-sha');
      expect(octokit.calls[0]).toMatchObject({
        route: PULLS_ROUTE,
        parameters: { owner: 'acme', repo: 'shop', commit_sha: 'deploy-sha' },
      });
    });

    it('[PRM-3] reports a malformed PR list as an unexpected response, never as "no PRs"', async () => {
      const octokit = buildFakeOctokit({ responses: { [PULLS_ROUTE]: { not: 'a list' } } });
      const result = await quandle_github_build_api(octokit, REPOSITORY).listPullRequestsForCommit(
        'deploy-sha',
      );
      expect(result).toEqual({ ok: false, reason: 'GitHub API returned an unexpected response' });
    });

    it('[PRM-3] reports a PR without a numeric number as an unexpected response', async () => {
      const octokit = buildFakeOctokit({
        responses: { [PULLS_ROUTE]: [{ number: '7', state: 'open', head: { sha: 'deploy-sha' } }] },
      });
      const result = await quandle_github_build_api(octokit, REPOSITORY).listPullRequestsForCommit(
        'deploy-sha',
      );
      expect(result.ok).toBe(false);
    });
  });

  describe('listPullRequestComments', () => {
    it('[OUT-7] lists the comments with their id, body and author login across pages', async () => {
      const octokit = buildFakeOctokit({
        pages: {
          [COMMENTS_ROUTE]: [
            [rawComment(1, 'first', 'octocat')],
            [rawComment(2, 'second', 'github-actions[bot]')],
          ],
        },
      });
      await expect(quandle_github_build_api(octokit, REPOSITORY).listPullRequestComments(7)).resolves.toEqual(
        {
          ok: true,
          value: [
            { id: 1, body: 'first', authorLogin: 'octocat' },
            { id: 2, body: 'second', authorLogin: 'github-actions[bot]' },
          ],
        },
      );
      expect(octokit.calls[0]).toMatchObject({
        parameters: { owner: 'acme', repo: 'shop', issue_number: 7 },
      });
    });

    it('[OUT-7] treats a comment with no body or no author as empty, so it can never be taken for ours', async () => {
      const octokit = buildFakeOctokit({ pages: { [COMMENTS_ROUTE]: [[rawComment(3, null, undefined)]] } });
      await expect(quandle_github_build_api(octokit, REPOSITORY).listPullRequestComments(7)).resolves.toEqual(
        {
          ok: true,
          value: [{ id: 3, body: '', authorLogin: '' }],
        },
      );
    });

    it('[PRM-3] stops reading comments after 10 pages, so a huge thread cannot stall the run', async () => {
      const pages = Array.from({ length: 12 }, (_, index) => [rawComment(index, 'x', 'octocat')]);
      const octokit = buildFakeOctokit({ pages: { [COMMENTS_ROUTE]: pages } });
      const result = await quandle_github_build_api(octokit, REPOSITORY).listPullRequestComments(7);
      expect(octokit.pagesRead).toBe(10);
      expect(result.ok && result.value).toHaveLength(10);
    });

    it('[PRM-3] reports a page of comments that is not a list as an unexpected response', async () => {
      const octokit = buildFakeOctokit({
        pages: { [COMMENTS_ROUTE]: [{ not: 'a list' } as unknown as unknown[]] },
      });
      const result = await quandle_github_build_api(octokit, REPOSITORY).listPullRequestComments(7);
      expect(result).toEqual({ ok: false, reason: 'GitHub API returned an unexpected response' });
    });

    it('[PRM-3] reports a comment without a numeric id as an unexpected response', async () => {
      const octokit = buildFakeOctokit({
        pages: { [COMMENTS_ROUTE]: [[{ id: 'one', body: 'x', user: null }]] },
      });
      const result = await quandle_github_build_api(octokit, REPOSITORY).listPullRequestComments(7);
      expect(result).toEqual({ ok: false, reason: 'GitHub API returned an unexpected response' });
    });
  });

  describe('createPullRequestComment and updatePullRequestComment', () => {
    it('[OUT-9] creates a comment on the PR with exactly the given body', async () => {
      const octokit = buildFakeOctokit();
      const result = await quandle_github_build_api(octokit, REPOSITORY).createPullRequestComment(
        7,
        'the body',
      );
      expect(result).toEqual({ ok: true, value: undefined });
      expect(octokit.calls[0]).toMatchObject({
        route: CREATE_ROUTE,
        parameters: { owner: 'acme', repo: 'shop', issue_number: 7, body: 'the body' },
      });
    });

    it('[OUT-9] updates the comment with the given id to exactly the given body', async () => {
      const octokit = buildFakeOctokit();
      const result = await quandle_github_build_api(octokit, REPOSITORY).updatePullRequestComment(
        42,
        'new body',
      );
      expect(result).toEqual({ ok: true, value: undefined });
      expect(octokit.calls[0]).toMatchObject({
        route: UPDATE_ROUTE,
        parameters: { owner: 'acme', repo: 'shop', comment_id: 42, body: 'new body' },
      });
    });
  });

  describe('failures', () => {
    const leakyError = (status?: number, name?: string): unknown => ({
      status,
      name,
      message: `request failed: ${LEAKY_ERROR_TEXT}`,
      response: { headers: { authorization: `token ${LEAKY_ERROR_TEXT}` }, data: LEAKY_ERROR_TEXT },
    });

    it('[PRM-3] reports a 403 as our own message with the missing-permission hint, never the response', async () => {
      const octokit = buildFakeOctokit({ thrown: leakyError(403) });
      const result = await quandle_github_build_api(octokit, REPOSITORY).createPullRequestComment(7, 'body');
      expect(result).toEqual({
        ok: false,
        reason: 'GitHub API returned 403 (does the workflow grant `pull-requests: write`?)',
      });
    });

    it('[PRM-3] reports a 500 as our own message with only the status code', async () => {
      const octokit = buildFakeOctokit({ thrown: leakyError(500) });
      const result = await quandle_github_build_api(octokit, REPOSITORY).listPullRequestsForCommit(
        'deploy-sha',
      );
      expect(result).toEqual({ ok: false, reason: 'GitHub API returned 500' });
    });

    it.each(['TimeoutError', 'AbortError'])('[PRM-3] reports a %s as a timeout', async (name) => {
      const octokit = buildFakeOctokit({ thrown: leakyError(undefined, name) });
      const result = await quandle_github_build_api(octokit, REPOSITORY).listPullRequestComments(7);
      expect(result).toEqual({ ok: false, reason: 'GitHub API timed out' });
    });

    it('[PRM-3] reports "GitHub API timed out", not a status, when the real Octokit request hits its time limit', async () => {
      const api = quandle_github_build_api(buildRealOctokit(rejectAsTimeout), REPOSITORY);
      await expect(api.listPullRequestsForCommit('deploy-sha')).resolves.toEqual({
        ok: false,
        reason: 'GitHub API timed out',
      });
    });

    it('[PRM-3] reports "GitHub API timed out" when a paginated list through the real Octokit hits its time limit', async () => {
      const api = quandle_github_build_api(buildRealOctokit(rejectAsTimeout), REPOSITORY);
      await expect(api.listPullRequestComments(7)).resolves.toEqual({
        ok: false,
        reason: 'GitHub API timed out',
      });
    });

    it('[PRM-3] reports "GitHub API request failed", not a status, when the real Octokit cannot reach GitHub', async () => {
      const api = quandle_github_build_api(buildRealOctokit(rejectAsNetworkFailure), REPOSITORY);
      await expect(api.createPullRequestComment(7, 'body')).resolves.toEqual({
        ok: false,
        reason: 'GitHub API request failed',
      });
    });

    it('[PRM-3] reports "GitHub API returned 503" when GitHub really answers 503 through the real Octokit', async () => {
      const api = quandle_github_build_api(buildRealOctokit(answerWithStatus(503)), REPOSITORY);
      await expect(api.updateIssue(3, 'body')).resolves.toEqual({
        ok: false,
        reason: 'GitHub API returned 503',
      });
    });

    it('[PRM-3] keeps the permission hint when GitHub really answers 403 through the real Octokit', async () => {
      const api = quandle_github_build_api(buildRealOctokit(answerWithStatus(403)), REPOSITORY);
      await expect(api.listOpenIssues()).resolves.toEqual({
        ok: false,
        reason: 'GitHub API returned 403 (does the workflow grant `issues: write`?)',
      });
    });

    it('[PRM-3] reports anything else thrown as a generic GitHub API failure', async () => {
      const octokit = buildFakeOctokit({ thrown: LEAKY_ERROR_TEXT });
      const result = await quandle_github_build_api(octokit, REPOSITORY).updatePullRequestComment(42, 'body');
      expect(result).toEqual({ ok: false, reason: 'GitHub API request failed' });
    });

    it('[PRM-3] never puts any part of the error or response into the reason', async () => {
      const api = quandle_github_build_api(buildFakeOctokit({ thrown: leakyError(502) }), REPOSITORY);
      const results = await Promise.all([
        api.listPullRequestsForCommit('deploy-sha'),
        api.listPullRequestComments(7),
        api.createPullRequestComment(7, 'body'),
        api.updatePullRequestComment(42, 'body'),
      ]);
      expect(JSON.stringify(results)).not.toContain(LEAKY_ERROR_TEXT);
    });

    it('[PRM-3] passes a timeout signal with every request', async () => {
      const octokit = buildFakeOctokit({ responses: { [PULLS_ROUTE]: [] }, pages: { [COMMENTS_ROUTE]: [] } });
      const api = quandle_github_build_api(octokit, REPOSITORY);
      await api.listPullRequestsForCommit('deploy-sha');
      await api.listPullRequestComments(7);
      await api.createPullRequestComment(7, 'body');
      await api.updatePullRequestComment(42, 'body');
      expect(octokit.calls).toHaveLength(4);
      for (const call of octokit.calls) {
        expect((call.parameters.request as { signal?: unknown } | undefined)?.signal).toBeInstanceOf(
          AbortSignal,
        );
      }
    });
  });

  describe('issues', () => {
    const rawIssue = (
      number: number,
      body: unknown,
      login: unknown,
      extra: Record<string, unknown> = {},
    ): unknown => ({
      number,
      body,
      user: login === undefined ? null : { login },
      ...extra,
    });

    it('[OUT-10] lists only open issues opened by github-actions[bot], with number, body and author', async () => {
      const octokit = buildFakeOctokit({
        pages: { [ISSUES_ROUTE]: [[rawIssue(12, 'body', 'github-actions[bot]')]] },
      });
      await expect(quandle_github_build_api(octokit, REPOSITORY).listOpenIssues()).resolves.toEqual({
        ok: true,
        value: [{ number: 12, body: 'body', authorLogin: 'github-actions[bot]' }],
      });
      expect(octokit.calls[0]).toMatchObject({
        route: ISSUES_ROUTE,
        parameters: { owner: 'acme', repo: 'shop', state: 'open', creator: 'github-actions[bot]' },
      });
    });

    it('[OUT-10] skips pull requests, which the GitHub issues list also returns', async () => {
      const octokit = buildFakeOctokit({
        pages: {
          [ISSUES_ROUTE]: [
            [rawIssue(7, 'a PR', 'github-actions[bot]', { pull_request: {} }), rawIssue(12, 'b', 'x')],
          ],
        },
      });
      const result = await quandle_github_build_api(octokit, REPOSITORY).listOpenIssues();
      expect(result.ok && result.value.map((issue) => issue.number)).toEqual([12]);
    });

    it('[OUT-10] treats an issue with no body or no author as empty, so it can never be taken for ours', async () => {
      const octokit = buildFakeOctokit({ pages: { [ISSUES_ROUTE]: [[rawIssue(14, null, undefined)]] } });
      await expect(quandle_github_build_api(octokit, REPOSITORY).listOpenIssues()).resolves.toEqual({
        ok: true,
        value: [{ number: 14, body: '', authorLogin: '' }],
      });
    });

    it('[PRM-3] reports a page of issues that is not a list as an unexpected response', async () => {
      const octokit = buildFakeOctokit({
        pages: { [ISSUES_ROUTE]: [{ not: 'a list' } as unknown as unknown[]] },
      });
      const result = await quandle_github_build_api(octokit, REPOSITORY).listOpenIssues();
      expect(result).toEqual({ ok: false, reason: 'GitHub API returned an unexpected response' });
    });

    it('[PRM-3] stops reading issues after 10 pages', async () => {
      const pages = Array.from({ length: 12 }, (_, index) => [rawIssue(index, 'x', 'octocat')]);
      const octokit = buildFakeOctokit({ pages: { [ISSUES_ROUTE]: pages } });
      await quandle_github_build_api(octokit, REPOSITORY).listOpenIssues();
      expect(octokit.pagesRead).toBe(10);
    });

    it('[PRM-3] reports an issue without a numeric number as an unexpected response', async () => {
      const octokit = buildFakeOctokit({
        pages: { [ISSUES_ROUTE]: [[rawIssue('12' as unknown as number, 'x', 'y')]] },
      });
      const result = await quandle_github_build_api(octokit, REPOSITORY).listOpenIssues();
      expect(result).toEqual({ ok: false, reason: 'GitHub API returned an unexpected response' });
    });

    it('[OUT-12] opens an issue with exactly the given title and body', async () => {
      const octokit = buildFakeOctokit();
      await quandle_github_build_api(octokit, REPOSITORY).createIssue('the title', 'the body');
      expect(octokit.calls[0]).toMatchObject({
        route: CREATE_ISSUE_ROUTE,
        parameters: { owner: 'acme', repo: 'shop', title: 'the title', body: 'the body' },
      });
    });

    it('[OUT-12] rewrites the issue with the given number to exactly the given body', async () => {
      const octokit = buildFakeOctokit();
      await quandle_github_build_api(octokit, REPOSITORY).updateIssue(12, 'new body');
      expect(octokit.calls[0]).toMatchObject({
        route: UPDATE_ISSUE_ROUTE,
        parameters: { owner: 'acme', repo: 'shop', issue_number: 12, body: 'new body' },
      });
    });

    it('[OUT-12] closes the issue with the given number', async () => {
      const octokit = buildFakeOctokit();
      await quandle_github_build_api(octokit, REPOSITORY).closeIssue(12);
      expect(octokit.calls[0]).toMatchObject({
        route: UPDATE_ISSUE_ROUTE,
        parameters: { owner: 'acme', repo: 'shop', issue_number: 12, state: 'closed' },
      });
    });

    it('[PRM-3] reports a 403 on an issue call with the issues: write hint', async () => {
      const octokit = buildFakeOctokit({ thrown: { status: 403, response: {} } });
      const api = quandle_github_build_api(octokit, REPOSITORY);
      const hint = {
        ok: false,
        reason: 'GitHub API returned 403 (does the workflow grant `issues: write`?)',
      };
      await expect(api.listOpenIssues()).resolves.toEqual(hint);
      await expect(api.createIssue('t', 'b')).resolves.toEqual(hint);
      await expect(api.updateIssue(12, 'b')).resolves.toEqual(hint);
      await expect(api.closeIssue(12)).resolves.toEqual(hint);
    });

    it('[PRM-3] passes a timeout signal with every issue request', async () => {
      const octokit = buildFakeOctokit({ pages: { [ISSUES_ROUTE]: [] } });
      const api = quandle_github_build_api(octokit, REPOSITORY);
      await api.listOpenIssues();
      await api.createIssue('t', 'b');
      await api.updateIssue(12, 'b');
      await api.closeIssue(12);
      for (const call of octokit.calls) {
        expect((call.parameters.request as { signal?: unknown } | undefined)?.signal).toBeInstanceOf(
          AbortSignal,
        );
      }
    });
  });

  describe('readIgnoreFile', () => {
    const CONTENTS_ROUTE = 'GET /repos/{owner}/{repo}/contents/{path}';
    const FILE_TEXT = 'ignore:\n  - id: qf_test01\n';

    function fileResponse(overrides: Record<string, unknown> = {}): unknown {
      const content = Buffer.from(FILE_TEXT, 'utf8').toString('base64');
      return { type: 'file', encoding: 'base64', content, ...overrides };
    }

    it('[IGN-9] asks for .quandle-ignore.yml at the root of this repository with no ref, so GitHub reads the default branch', async () => {
      const octokit = buildFakeOctokit({ responses: { [CONTENTS_ROUTE]: fileResponse() } });
      await quandle_github_build_api(octokit, REPOSITORY).readIgnoreFile();
      expect(octokit.calls[0]).toMatchObject({
        route: CONTENTS_ROUTE,
        parameters: { owner: 'acme', repo: 'shop', path: '.quandle-ignore.yml' },
      });
      expect(octokit.calls[0]?.parameters).not.toHaveProperty('ref');
    });

    it('[IGN-9] returns the decoded text of the file', async () => {
      const octokit = buildFakeOctokit({ responses: { [CONTENTS_ROUTE]: fileResponse() } });
      await expect(quandle_github_build_api(octokit, REPOSITORY).readIgnoreFile()).resolves.toEqual({
        ok: true,
        value: FILE_TEXT,
      });
    });

    it('[IGN-9] decodes base64 that GitHub splits across lines', async () => {
      const content = Buffer.from(FILE_TEXT, 'utf8')
        .toString('base64')
        .replace(/(.{8})/g, '$1\n');
      const octokit = buildFakeOctokit({ responses: { [CONTENTS_ROUTE]: fileResponse({ content }) } });
      await expect(quandle_github_build_api(octokit, REPOSITORY).readIgnoreFile()).resolves.toEqual({
        ok: true,
        value: FILE_TEXT,
      });
    });

    it('[IGN-9] returns no file (undefined) when GitHub answers 404', async () => {
      const octokit = buildFakeOctokit({ thrown: { status: 404 } });
      await expect(quandle_github_build_api(octokit, REPOSITORY).readIgnoreFile()).resolves.toEqual({
        ok: true,
        value: undefined,
      });
    });

    it('[IGN-9] fails with a hint to grant contents: read when GitHub answers 403', async () => {
      const octokit = buildFakeOctokit({ thrown: { status: 403, response: {} } });
      await expect(quandle_github_build_api(octokit, REPOSITORY).readIgnoreFile()).resolves.toEqual({
        ok: false,
        reason: 'GitHub API returned 403 (does the workflow grant `contents: read`?)',
      });
    });

    it('[IGN-9] fails with "GitHub API returned 500" when GitHub answers 500', async () => {
      const octokit = buildFakeOctokit({ thrown: { status: 500, response: {} } });
      await expect(quandle_github_build_api(octokit, REPOSITORY).readIgnoreFile()).resolves.toEqual({
        ok: false,
        reason: 'GitHub API returned 500',
      });
    });

    it('[IGN-9] fails with "GitHub API timed out" when the request times out', async () => {
      const octokit = buildFakeOctokit({ thrown: { name: 'TimeoutError' } });
      await expect(quandle_github_build_api(octokit, REPOSITORY).readIgnoreFile()).resolves.toEqual({
        ok: false,
        reason: 'GitHub API timed out',
      });
    });

    it('[IGN-9] fails with "GitHub did not return its contents (over 1 MB)" for a file over 1 MB', async () => {
      const octokit = buildFakeOctokit({
        responses: { [CONTENTS_ROUTE]: fileResponse({ encoding: 'none', content: '' }) },
      });
      await expect(quandle_github_build_api(octokit, REPOSITORY).readIgnoreFile()).resolves.toEqual({
        ok: false,
        reason: 'GitHub did not return its contents (over 1 MB)',
      });
    });

    it.each([
      ['a directory listing', [{ type: 'file', name: 'a.yml' }]],
      ['a symlink', { type: 'symlink', target: 'elsewhere.yml' }],
      ['a file with no content', { type: 'file', encoding: 'base64' }],
      ['a file in an unknown encoding', { type: 'file', encoding: 'utf-16', content: 'x' }],
      ['nothing', undefined],
    ])('[IGN-9] fails with an unexpected-response reason when GitHub returns %s', async (_label, data) => {
      const octokit = buildFakeOctokit({ responses: { [CONTENTS_ROUTE]: data } });
      await expect(quandle_github_build_api(octokit, REPOSITORY).readIgnoreFile()).resolves.toEqual({
        ok: false,
        reason: 'GitHub API returned an unexpected response',
      });
    });

    it('[IGN-9] never repeats the error text or response GitHub sent with a failure', async () => {
      const octokit = buildFakeOctokit({
        thrown: { status: 502, message: `failed: ${LEAKY_ERROR_TEXT}`, response: { data: LEAKY_ERROR_TEXT } },
      });
      const result = await quandle_github_build_api(octokit, REPOSITORY).readIgnoreFile();
      expect(JSON.stringify(result)).not.toContain(LEAKY_ERROR_TEXT);
    });

    it('[PRM-3] passes a timeout signal when reading the ignore file', async () => {
      const octokit = buildFakeOctokit({ responses: { [CONTENTS_ROUTE]: fileResponse() } });
      await quandle_github_build_api(octokit, REPOSITORY).readIgnoreFile();
      const request = octokit.calls[0]?.parameters.request as { signal?: unknown } | undefined;
      expect(request?.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('readDefaultBranchHeadSha', () => {
    const REPO_ROUTE = 'GET /repos/{owner}/{repo}';
    const BRANCH_ROUTE = 'GET /repos/{owner}/{repo}/branches/{branch}';
    const HEAD = {
      [REPO_ROUTE]: { default_branch: 'main' },
      [BRANCH_ROUTE]: { commit: { sha: 'head-sha' } },
    };

    it('[TGT-11] reads the default branch of this repository, then the commit at its head', async () => {
      const octokit = buildFakeOctokit({ responses: HEAD });
      await expect(quandle_github_build_api(octokit, REPOSITORY).readDefaultBranchHeadSha()).resolves.toEqual(
        {
          ok: true,
          value: 'head-sha',
        },
      );
      expect(octokit.calls).toMatchObject([
        { route: REPO_ROUTE, parameters: { owner: 'acme', repo: 'shop' } },
        { route: BRANCH_ROUTE, parameters: { owner: 'acme', repo: 'shop', branch: 'main' } },
      ]);
    });

    it('[TGT-11] fails with a hint to grant contents: read when GitHub answers 403', async () => {
      const octokit = buildFakeOctokit({ thrown: { status: 403, response: {} } });
      await expect(quandle_github_build_api(octokit, REPOSITORY).readDefaultBranchHeadSha()).resolves.toEqual(
        {
          ok: false,
          reason: 'GitHub API returned 403 (does the workflow grant `contents: read`?)',
        },
      );
    });

    it.each([
      [
        'a repository with no default_branch',
        { [REPO_ROUTE]: {}, [BRANCH_ROUTE]: { commit: { sha: 'head-sha' } } },
      ],
      [
        'an empty default_branch',
        { [REPO_ROUTE]: { default_branch: '' }, [BRANCH_ROUTE]: { commit: { sha: 'x' } } },
      ],
      ['a branch with no commit', { [REPO_ROUTE]: { default_branch: 'main' }, [BRANCH_ROUTE]: {} }],
      ['a commit with no sha', { [REPO_ROUTE]: { default_branch: 'main' }, [BRANCH_ROUTE]: { commit: {} } }],
      ['nothing', {}],
    ])('[TGT-11] fails with an unexpected-response reason for %s', async (_label, responses) => {
      const octokit = buildFakeOctokit({ responses });
      await expect(quandle_github_build_api(octokit, REPOSITORY).readDefaultBranchHeadSha()).resolves.toEqual(
        {
          ok: false,
          reason: 'GitHub API returned an unexpected response',
        },
      );
    });

    it('[PRM-3] passes a timeout signal with both default-branch reads', async () => {
      const octokit = buildFakeOctokit({ responses: HEAD });
      await quandle_github_build_api(octokit, REPOSITORY).readDefaultBranchHeadSha();
      expect(octokit.calls).toHaveLength(2);
      for (const call of octokit.calls) {
        const request = call.parameters.request as { signal?: unknown } | undefined;
        expect(request?.signal).toBeInstanceOf(AbortSignal);
      }
    });
  });
});
