// ==========================================================================
// Quandle GitHub Action · src/io/github.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// GitHub REST calls on an injected Octokit: find the PRs for a commit; list, create
// and update PR comments; list, create, update and close the production issue; read
// .quandle-ignore.yml from the default branch; and read the default branch's head
// commit. Every response is untrusted and validated.
// Never throws: every call returns ok or our own one-line reason (PRM-3), never
// a library error or response body.
// Rules: TGT-11, PRM-3, OUT-2, OUT-7, OUT-9, OUT-10, OUT-12, IGN-9
// ==========================================================================
// OUT-7 / OUT-10: the identity the GITHUB_TOKEN writes as; the only author whose comment or issue we edit.
export const GITHUB_ACTIONS_BOT_LOGIN = 'github-actions[bot]';

// The permission a call needs, with its access level, named in its 403 hint (PRM-3).
type GitHubPermission = 'pull-requests: write' | 'issues: write' | 'contents: read';

// IGN-9: the ignore file, at the repository root.
const IGNORE_FILE_PATH = '.quandle-ignore.yml';

// PRM-3: no single GitHub request may hang the run.
export const GITHUB_REQUEST_TIMEOUT_MS = 10_000;
// PRM-3: a PR with thousands of comments, or a repo with thousands of open issues, must not stall
// the run (100 per page, so at most 1,000 comments or issues).
export const MAX_LIST_PAGES = 10;
const UNEXPECTED_RESPONSE = 'GitHub API returned an unexpected response';

// The parts of an Octokit instance we use. The real one (with the paginate plugin) is built in index.ts.
export interface OctokitApi {
  request(route: string, parameters: Record<string, unknown>): Promise<{ data: unknown }>;
  paginate(
    route: string,
    parameters: Record<string, unknown>,
    mapPage: (response: { data: unknown }, done: () => void) => unknown[],
  ): Promise<unknown[]>;
}

export interface RepositoryRef {
  readonly owner: string;
  readonly repo: string;
}

export interface PullRequestRef {
  readonly number: number;
  readonly isOpen: boolean;
  readonly headSha: string;
}

export interface PullRequestComment {
  readonly id: number;
  readonly body: string;
  readonly authorLogin: string;
}

// An open issue, as listed (PRs filtered out).
export interface IssueRef {
  readonly number: number;
  readonly body: string;
  readonly authorLogin: string;
}

// A GitHub call's result: the value, or our own one-line reason it failed.
export type GitHubResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

export interface GitHubApi {
  listPullRequestsForCommit(sha: string): Promise<GitHubResult<readonly PullRequestRef[]>>;
  listPullRequestComments(pullRequestNumber: number): Promise<GitHubResult<readonly PullRequestComment[]>>;
  createPullRequestComment(pullRequestNumber: number, body: string): Promise<GitHubResult<void>>;
  updatePullRequestComment(commentId: number, body: string): Promise<GitHubResult<void>>;
  listOpenIssues(): Promise<GitHubResult<readonly IssueRef[]>>;
  createIssue(title: string, body: string): Promise<GitHubResult<void>>;
  updateIssue(issueNumber: number, body: string): Promise<GitHubResult<void>>;
  closeIssue(issueNumber: number): Promise<GitHubResult<void>>;
  // IGN-9: the ignore file's text from the default branch, or undefined when there is none.
  readIgnoreFile(): Promise<GitHubResult<string | undefined>>;
  // TGT-11: the commit at the head of the repository's default branch.
  readDefaultBranchHeadSha(): Promise<GitHubResult<string>>;
}

// Builds the GitHub API for one repository on top of an Octokit instance.
// Every call passes a timeout, validates the response, and never throws.
// Returns: the PR, comment, issue and ignore-file calls main uses.
// Rules: OUT-2, OUT-7, OUT-9, OUT-10, OUT-12, PRM-3, IGN-9, TGT-11
export function quandle_github_build_api(octokit: OctokitApi, repository: RepositoryRef): GitHubApi {
  const { owner, repo } = repository;
  return {
    listPullRequestsForCommit: (sha) =>
      quandle_github_call_safely('pull-requests: write', async () => {
        const response = await octokit.request('GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls', {
          owner,
          repo,
          commit_sha: sha,
          per_page: 100,
          request: quandle_github_build_requestOptions(),
        });
        return quandle_github_parse_pullRequests(response.data);
      }),
    listPullRequestComments: (pullRequestNumber) =>
      quandle_github_call_safely('pull-requests: write', async () => {
        let pagesRead = 0;
        const items = await octokit.paginate(
          'GET /repos/{owner}/{repo}/issues/{issue_number}/comments',
          {
            owner,
            repo,
            issue_number: pullRequestNumber,
            per_page: 100,
            request: quandle_github_build_requestOptions(),
          },
          (response, done) => {
            pagesRead += 1;
            if (pagesRead >= MAX_LIST_PAGES) done();
            return Array.isArray(response.data) ? response.data : [UNEXPECTED_RESPONSE];
          },
        );
        return quandle_github_parse_comments(items);
      }),
    createPullRequestComment: (pullRequestNumber, body) =>
      quandle_github_call_safely('pull-requests: write', async () => {
        await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
          owner,
          repo,
          issue_number: pullRequestNumber,
          body,
          request: quandle_github_build_requestOptions(),
        });
        return { ok: true, value: undefined };
      }),
    updatePullRequestComment: (commentId, body) =>
      quandle_github_call_safely('pull-requests: write', async () => {
        await octokit.request('PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}', {
          owner,
          repo,
          comment_id: commentId,
          body,
          request: quandle_github_build_requestOptions(),
        });
        return { ok: true, value: undefined };
      }),
    listOpenIssues: () =>
      quandle_github_call_safely('issues: write', async () => {
        let pagesRead = 0;
        const items = await octokit.paginate(
          'GET /repos/{owner}/{repo}/issues',
          {
            owner,
            repo,
            state: 'open',
            creator: GITHUB_ACTIONS_BOT_LOGIN,
            per_page: 100,
            request: quandle_github_build_requestOptions(),
          },
          (response, done) => {
            pagesRead += 1;
            if (pagesRead >= MAX_LIST_PAGES) done();
            return Array.isArray(response.data) ? response.data : [UNEXPECTED_RESPONSE];
          },
        );
        return quandle_github_parse_issues(items);
      }),
    createIssue: (title, body) =>
      quandle_github_call_safely('issues: write', async () => {
        await octokit.request('POST /repos/{owner}/{repo}/issues', {
          owner,
          repo,
          title,
          body,
          request: quandle_github_build_requestOptions(),
        });
        return { ok: true, value: undefined };
      }),
    updateIssue: (issueNumber, body) =>
      quandle_github_call_safely('issues: write', async () => {
        await octokit.request('PATCH /repos/{owner}/{repo}/issues/{issue_number}', {
          owner,
          repo,
          issue_number: issueNumber,
          body,
          request: quandle_github_build_requestOptions(),
        });
        return { ok: true, value: undefined };
      }),
    closeIssue: (issueNumber) =>
      quandle_github_call_safely('issues: write', async () => {
        await octokit.request('PATCH /repos/{owner}/{repo}/issues/{issue_number}', {
          owner,
          repo,
          issue_number: issueNumber,
          state: 'closed',
          request: quandle_github_build_requestOptions(),
        });
        return { ok: true, value: undefined };
      }),
    readDefaultBranchHeadSha: () =>
      quandle_github_call_safely('contents: read', async () => {
        const repository = await octokit.request('GET /repos/{owner}/{repo}', {
          owner,
          repo,
          request: quandle_github_build_requestOptions(),
        });
        const branch = quandle_github_read_textField(repository.data, ['default_branch']);
        if (branch === undefined) return { ok: false, reason: UNEXPECTED_RESPONSE };
        const head = await octokit.request('GET /repos/{owner}/{repo}/branches/{branch}', {
          owner,
          repo,
          branch,
          request: quandle_github_build_requestOptions(),
        });
        const sha = quandle_github_read_textField(head.data, ['commit', 'sha']);
        return sha === undefined ? { ok: false, reason: UNEXPECTED_RESPONSE } : { ok: true, value: sha };
      }),
    readIgnoreFile: () =>
      quandle_github_call_safely<string | undefined>('contents: read', async () => {
        try {
          // No ref: GitHub reads the default branch, never the deploy commit (IGN-9).
          const response = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
            owner,
            repo,
            path: IGNORE_FILE_PATH,
            request: quandle_github_build_requestOptions(),
          });
          return quandle_github_parse_fileText(response.data);
        } catch (error) {
          if (quandle_github_check_isNotFound(error)) return { ok: true, value: undefined };
          throw error;
        }
      }),
  };
}

// Runs one GitHub call and turns anything it throws into our own reason.
// Never throws.
// Returns: the call's result, or { ok: false } with our one-line reason.
// Rules: PRM-3
async function quandle_github_call_safely<T>(
  permission: GitHubPermission,
  call: () => Promise<GitHubResult<T>>,
): Promise<GitHubResult<T>> {
  try {
    return await call();
  } catch (error) {
    return { ok: false, reason: quandle_github_describe_failure(error, permission) };
  }
}

// Our own one-line description of a failed GitHub call: the status code only when GitHub answered,
// with a permission hint (naming the permission this call needs) for 403; else "timed out" for a
// timeout, or "request failed". Never any of the error's message, headers or body.
// Returns: the reason.
// Rules: PRM-3
function quandle_github_describe_failure(error: unknown, permission: GitHubPermission): string {
  // Octokit reports timeouts and network failures as status 500 too; only an error carrying
  // GitHub's response means GitHub actually answered with that status.
  const hasAnswered = quandle_github_read_field(error, 'response') !== undefined;
  const status = hasAnswered ? quandle_github_read_field(error, 'status') : undefined;
  if (status === 403) return `GitHub API returned 403 (does the workflow grant \`${permission}\`?)`;
  if (typeof status === 'number') return `GitHub API returned ${status}`;
  // Octokit wraps a fetch timeout, so the timeout can be the error itself or its cause.
  const isTimedOut = [error, quandle_github_read_field(error, 'cause')].some((candidate) =>
    quandle_github_check_isTimeoutError(candidate),
  );
  return isTimedOut ? 'GitHub API timed out' : 'GitHub API request failed';
}

// True for the error a request's AbortSignal produces when its time limit fires.
function quandle_github_check_isTimeoutError(error: unknown): boolean {
  const name = quandle_github_read_field(error, 'name');
  return name === 'TimeoutError' || name === 'AbortError';
}

// Reads one non-empty text field at a path inside an untrusted GitHub response.
// Returns: the text, or undefined when any step is missing, not an object, or not non-empty text.
// Rules: PRM-3
function quandle_github_read_textField(data: unknown, path: readonly string[]): string | undefined {
  let value: unknown = data;
  for (const key of path) {
    if (typeof value !== 'object' || value === null) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

// True when GitHub answered 404: for the ignore file, that means there is no file (IGN-9).
function quandle_github_check_isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 404;
}

// Validates GitHub's file contents (untrusted) and decodes them.
// Returns: the text; "over 1 MB" when GitHub left the content out; unexpected response for
// anything else (a directory, a symlink, no content, another encoding).
// Rules: IGN-9, PRM-3
function quandle_github_parse_fileText(data: unknown): GitHubResult<string> {
  if (typeof data !== 'object' || data === null) return { ok: false, reason: UNEXPECTED_RESPONSE };
  const file = data as { type?: unknown; encoding?: unknown; content?: unknown };
  if (file.type !== 'file') return { ok: false, reason: UNEXPECTED_RESPONSE };
  // GitHub only returns the content of files up to 1 MB; larger ones come back with encoding "none".
  if (file.encoding === 'none')
    return { ok: false, reason: 'GitHub did not return its contents (over 1 MB)' };
  if (file.encoding !== 'base64' || typeof file.content !== 'string') {
    return { ok: false, reason: UNEXPECTED_RESPONSE };
  }
  return { ok: true, value: Buffer.from(file.content, 'base64').toString('utf8') };
}

// Per-request options: a timeout, so no single request can hang the run.
// Returns: the Octokit `request` option.
// Rules: PRM-3
function quandle_github_build_requestOptions(): { signal: AbortSignal } {
  return { signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS) };
}

// Validates GitHub's PR list (untrusted) into our shape.
// Returns: the PRs, or { ok: false } for anything malformed (never "no PRs").
// Rules: OUT-2, PRM-3
function quandle_github_parse_pullRequests(data: unknown): GitHubResult<readonly PullRequestRef[]> {
  if (!Array.isArray(data)) return { ok: false, reason: UNEXPECTED_RESPONSE };
  const pullRequests: PullRequestRef[] = [];
  for (const item of data) {
    const number = quandle_github_read_field(item, 'number');
    const state = quandle_github_read_field(item, 'state');
    const headSha = quandle_github_read_field(quandle_github_read_field(item, 'head'), 'sha');
    if (typeof number !== 'number' || typeof state !== 'string' || typeof headSha !== 'string') {
      return { ok: false, reason: UNEXPECTED_RESPONSE };
    }
    pullRequests.push({ number, isOpen: state === 'open', headSha });
  }
  return { ok: true, value: pullRequests };
}

// Validates GitHub's comment list (untrusted) into our shape. A missing body or author becomes
// an empty string, so such a comment can never be taken for ours (OUT-7).
// Returns: the comments, or { ok: false } for anything malformed.
// Rules: OUT-7, PRM-3
function quandle_github_parse_comments(
  items: readonly unknown[],
): GitHubResult<readonly PullRequestComment[]> {
  const comments: PullRequestComment[] = [];
  for (const item of items) {
    const id = quandle_github_read_field(item, 'id');
    if (typeof id !== 'number') return { ok: false, reason: UNEXPECTED_RESPONSE };
    const body = quandle_github_read_field(item, 'body');
    const login = quandle_github_read_field(quandle_github_read_field(item, 'user'), 'login');
    comments.push({
      id,
      body: typeof body === 'string' ? body : '',
      authorLogin: typeof login === 'string' ? login : '',
    });
  }
  return { ok: true, value: comments };
}

// Validates GitHub's open-issue list (untrusted) into our shape. Pull requests (which the issues
// API also returns) are skipped. A missing body or author becomes an empty string, so such an issue
// can never be taken for ours (OUT-10).
// Returns: the issues, or { ok: false } for anything malformed.
// Rules: OUT-10, PRM-3
function quandle_github_parse_issues(items: readonly unknown[]): GitHubResult<readonly IssueRef[]> {
  const issues: IssueRef[] = [];
  for (const item of items) {
    const number = quandle_github_read_field(item, 'number');
    if (typeof number !== 'number') return { ok: false, reason: UNEXPECTED_RESPONSE };
    if (quandle_github_read_field(item, 'pull_request') !== undefined) continue;
    const body = quandle_github_read_field(item, 'body');
    const login = quandle_github_read_field(quandle_github_read_field(item, 'user'), 'login');
    issues.push({
      number,
      body: typeof body === 'string' ? body : '',
      authorLogin: typeof login === 'string' ? login : '',
    });
  }
  return { ok: true, value: issues };
}

// Reads one field from an untrusted value.
// Returns: the field, or undefined when the value isn't an object.
function quandle_github_read_field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}
