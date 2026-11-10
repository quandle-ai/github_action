// ==========================================================================
// Quandle GitHub Action · test/helpers/fake-github.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// In-memory GitHubApi for testing main without GitHub: holds PRs, their
// comments, open issues and the ignore file, records every call and everything written, and can
// make one call fail with our own reason (PRM-3).
// ==========================================================================
import type {
  GitHubApi,
  GitHubResult,
  IssueRef,
  PullRequestComment,
  PullRequestRef,
} from '../../src/io/github';

export type FakeGitHubMethod = keyof GitHubApi;

export interface FakeGitHubWrite {
  method: 'create' | 'update' | 'createIssue' | 'updateIssue' | 'closeIssue';
  target: number;
  body: string;
}

export interface FakeGitHub extends GitHubApi {
  calls: string[];
  comments: Map<number, PullRequestComment[]>;
  written: FakeGitHubWrite[];
  issueTitles: string[];
}

export interface FakeGitHubOptions {
  pullRequests?: readonly PullRequestRef[];
  comments?: Record<number, readonly PullRequestComment[]>;
  // Open issues, as GitHub would list them.
  issues?: readonly IssueRef[];
  // The text of .quandle-ignore.yml on the default branch; none when unset.
  ignoreFile?: string;
  // The default branch's head commit; DEFAULT_BRANCH_HEAD_SHA (never a deploy's commit) when unset.
  defaultBranchHeadSha?: string;
  failingMethod?: FakeGitHubMethod;
  failureReason?: string;
}

export const BOT_LOGIN = 'github-actions[bot]';

// The fake default branch's head: a commit no test deploys, so deploys are previews unless a test says so.
export const DEFAULT_BRANCH_HEAD_SHA = 'default-branch-head-sha';

export function buildFakeGitHub(options: FakeGitHubOptions = {}): FakeGitHub {
  const comments = new Map<number, PullRequestComment[]>(
    Object.entries(options.comments ?? {}).map(([number, list]) => [Number(number), [...list]]),
  );
  let nextCommentId = 9000;
  let nextIssueNumber = 500;
  const failure = (method: FakeGitHubMethod): GitHubResult<never> | undefined =>
    options.failingMethod === method
      ? { ok: false, reason: options.failureReason ?? 'GitHub API returned 500' }
      : undefined;
  const write = (method: FakeGitHubWrite['method'], target: number, body: string): GitHubResult<void> => {
    github.written.push({ method, target, body });
    return { ok: true, value: undefined };
  };
  const github: FakeGitHub = {
    calls: [],
    comments,
    written: [],
    issueTitles: [],
    async listPullRequestsForCommit(sha) {
      github.calls.push(`listPullRequestsForCommit:${sha}`);
      return failure('listPullRequestsForCommit') ?? { ok: true, value: options.pullRequests ?? [] };
    },
    async listPullRequestComments(pullRequestNumber) {
      github.calls.push(`listPullRequestComments:${pullRequestNumber}`);
      return failure('listPullRequestComments') ?? { ok: true, value: comments.get(pullRequestNumber) ?? [] };
    },
    async createPullRequestComment(pullRequestNumber, body) {
      github.calls.push(`createPullRequestComment:${pullRequestNumber}`);
      const failed = failure('createPullRequestComment');
      if (failed) return failed;
      const list = comments.get(pullRequestNumber) ?? [];
      list.push({ id: nextCommentId++, body, authorLogin: BOT_LOGIN });
      comments.set(pullRequestNumber, list);
      return write('create', pullRequestNumber, body);
    },
    async updatePullRequestComment(commentId, body) {
      github.calls.push(`updatePullRequestComment:${commentId}`);
      return failure('updatePullRequestComment') ?? write('update', commentId, body);
    },
    async listOpenIssues() {
      github.calls.push('listOpenIssues');
      return failure('listOpenIssues') ?? { ok: true, value: options.issues ?? [] };
    },
    async createIssue(title, body) {
      github.calls.push('createIssue');
      const failed = failure('createIssue');
      if (failed) return failed;
      github.issueTitles.push(title);
      return write('createIssue', nextIssueNumber++, body);
    },
    async updateIssue(issueNumber, body) {
      github.calls.push(`updateIssue:${issueNumber}`);
      return failure('updateIssue') ?? write('updateIssue', issueNumber, body);
    },
    async closeIssue(issueNumber) {
      github.calls.push(`closeIssue:${issueNumber}`);
      return failure('closeIssue') ?? write('closeIssue', issueNumber, '');
    },
    async readDefaultBranchHeadSha() {
      github.calls.push('readDefaultBranchHeadSha');
      return (
        failure('readDefaultBranchHeadSha') ?? {
          ok: true,
          value: options.defaultBranchHeadSha ?? DEFAULT_BRANCH_HEAD_SHA,
        }
      );
    },
    async readIgnoreFile() {
      github.calls.push('readIgnoreFile');
      return failure('readIgnoreFile') ?? { ok: true, value: options.ignoreFile };
    },
  };
  return github;
}
