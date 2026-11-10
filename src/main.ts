// ==========================================================================
// Quandle GitHub Action · src/main.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Runs the Action end to end: mask secrets, validate inputs, resolve the target,
// scan (or mock), apply the ignore file, set the job result and outputs, publish
// the PR comment or production issue, then write the summary.
// Orchestration only; reaches GitHub through the injected ActionRuntime. Never throws.
// Rules: TGT-3, TGT-6, TGT-9, TGT-11, TRU-1, TRU-5, TRU-6, PRM-2, PRM-3, SEV-1 … SEV-4, OUT-1 … OUT-4, OUT-6,
// Rules: OUT-7, OUT-9, OUT-10, OUT-12, ERR-1 … ERR-4, IGN-3, IGN-4, IGN-7, IGN-9, IGN-10, MOCK-1, MOCK-2,
// Rules: MOCK-4, IO-1, IO-2
// ==========================================================================
import { quandle_api_build_scanRequest, quandle_api_request_postScanToEngine } from './io/api';
import type { EngineFetch } from './io/api';
import { quandle_comment_decide_action, quandle_comment_find_ownComment } from './report/comment';
import { quandle_issue_decide_action, quandle_issue_find_ownIssue } from './report/issue';
import { quandle_ignore_apply_entriesToFindings, quandle_ignore_parse_ignoreFile } from './scan/ignore';
import { quandle_mock_build_scanResult, quandle_mock_parse_scenarioInput } from './scan/mock';
import {
  quandle_render_build_jobSummary,
  quandle_render_build_notScannedSummary,
  quandle_render_build_prComment,
  quandle_render_build_productionIssue,
  quandle_render_escape_logText,
} from './report/render';
import {
  quandle_severity_check_shouldFailJob,
  quandle_severity_get_failableFindings,
  quandle_severity_parse_failOnInput,
} from './scan/severity';
import {
  quandle_target_resolve_productionDeploy,
  quandle_target_resolve_scanTargetFromEvent,
} from './scan/target';
import type { GitHubApi } from './io/github';
import type {
  EventContext,
  FailOn,
  IgnoreOutcome,
  InputName,
  Inputs,
  OutputStatus,
  Parsed,
  ScanResult,
  Target,
} from './types';

// Everything main needs from the Actions runtime. Injected so the flow is testable without GitHub.
// readEvent is a call, not a value: reading the event can fail, so it happens inside the run's try (ERR-3).
export interface ActionRuntime {
  readEvent(): EventContext;
  getInput(name: InputName): string;
  setSecret(secret: string): void;
  setOutput(name: string, value: string | number): void;
  setFailed(message: string): void;
  warning(message: string): void;
  info(message: string): void;
  writeSummary(markdown: string): Promise<void>;
  // Builds the GitHub API client for this repo from the github-token (TRU-6). Not a throw: ok or our reason.
  getGitHubApi(token: string): Parsed<GitHubApi>;
  // The run's current time, for ignore expiry (IGN-7). A call, so pure code never reads the clock itself.
  now(): Date;
  // A GitHub OIDC token for this audience (TRU-3). Rejects when the token cannot be fetched (TRU-8).
  getOidcToken(audience: string): Promise<string>;
  // The network call to the engine; only the api module uses it, and only for ENGINE_URL (TRU-4).
  fetch: EngineFetch;
}

// The two secret inputs, read once and masked before anything else (TRU-5). Empty = not set.
interface SecretInputs {
  bypassSecret: string;
  githubToken: string;
}

// Where users report an internal error (ERR-3).
const ISSUES_URL = 'https://github.com/quandle-ai/github_action/issues';
const INTERNAL_ERROR_MESSAGE = `Quandle: internal error, not scanned. Please report it at ${ISSUES_URL}.`;
const MOCK_MODE_WARNING = 'Quandle: mock mode, these results are not real (mock: true is for testing only).';
// ERR-1: the engine accepts a bypass secret of at most 256 bytes (UTF-8).
const MAX_BYPASS_SECRET_BYTES = 256;
const BYPASS_SECRET_TOO_LONG_MESSAGE =
  'Quandle: `bypass-secret` is too long (the engine accepts at most 256 bytes); ' +
  'check that the secret holds only the bypass value.';
const SUMMARY_FAILED_MESSAGE =
  'Quandle: the job summary could not be written. The job result above still stands.';

// Validates a boolean input. Accepts true / false in any letter case, nothing else.
// Returns: ok with the boolean, or a config-error reason naming the input.
// Rules: IO-2, ERR-1
export function quandle_main_parse_booleanInput(name: InputName, raw: string): Parsed<boolean> {
  const normalised = raw.toLowerCase();
  if (normalised === 'true') return { ok: true, value: true };
  if (normalised === 'false') return { ok: true, value: false };
  return { ok: false, reason: `Quandle: \`${name}\` must be true or false.` };
}

// Runs the whole Action. Never throws: an internal bug becomes a warning with a fixed message
// (saying where to report it), status internal-error, and a "Not scanned" summary.
// The original error is never printed.
// Rules: ERR-3, OUT-6
export async function quandle_main_run_action(runtime: ActionRuntime): Promise<void> {
  try {
    await quandle_main_run_steps(runtime);
  } catch {
    // ERR-3: the original error is never printed — it may carry secrets, headers or untrusted text.
    await quandle_main_report_internalError(runtime);
  }
}

// The steps of a run, in order. May throw; quandle_main_run_action catches.
// Every path sets the job result and all four outputs first, then writes the summary.
// Rules: TRU-5, ERR-1, TGT-3, OUT-1, OUT-2, OUT-4, OUT-6, MOCK-2, MOCK-4
async function quandle_main_run_steps(runtime: ActionRuntime): Promise<void> {
  const secrets = quandle_main_mask_secretInputs(runtime);
  const event = runtime.readEvent();
  const inputs = quandle_main_read_actionInputs(runtime, secrets);
  if (!inputs.ok) {
    for (const reason of inputs.reasons) runtime.setFailed(reason);
    return quandle_main_finish_withoutScan(runtime, 'config-error', 'invalid configuration');
  }
  const target = quandle_target_resolve_scanTargetFromEvent(event, inputs.value.url);
  if (target.kind === 'error') {
    runtime.setFailed(target.reason);
    return quandle_main_finish_withoutScan(runtime, 'config-error', 'invalid configuration');
  }
  if (target.kind === 'skip') {
    runtime.info(`Quandle: skipping, ${target.reason}.`);
    return quandle_main_finish_withoutScan(runtime, 'skipped', target.reason);
  }
  const scanTarget = await quandle_main_resolve_productionDeploy(runtime, target, inputs.value.githubToken);
  // MOCK-2 / ERR-4: a mock run must never look like a real clean scan in the log.
  if (inputs.value.isMockEnabled) runtime.warning(MOCK_MODE_WARNING);
  const result = inputs.value.isMockEnabled
    ? quandle_mock_build_scanResult(inputs.value.mockScenario, scanTarget.url, scanTarget.environment)
    : await quandle_api_request_postScanToEngine(
        quandle_api_build_scanRequest(scanTarget, inputs.value.bypassSecret),
        runtime,
      );
  const outcome = await quandle_main_apply_ignoreFile(runtime, result, inputs.value.githubToken);
  quandle_main_set_jobResult(runtime, { result, outcome }, inputs.value.failOn);
  quandle_main_set_scanOutputs(runtime, { result, outcome });
  await quandle_main_publish_results(runtime, { result, outcome }, scanTarget, inputs.value);
  await quandle_main_write_summaryBestEffort(runtime, quandle_render_build_jobSummary(result, outcome));
}

// Decides whether a deploy is a production deploy (TGT-11): one whose payload already says so is, and
// otherwise one whose commit is the default branch's head. Scan now and schedule are always production.
// A failed check warns once and treats the deploy as a preview: that can never move the baseline.
// Returns: the target, marked as production when it is one.
// Side effects: GitHub API calls (deploys only); a warning when the check fails.
// Rules: TGT-9, TGT-11, TRU-1, PRM-3
async function quandle_main_resolve_productionDeploy(
  runtime: ActionRuntime,
  target: Extract<Target, { kind: 'scan' }>,
  githubToken: string,
): Promise<Extract<Target, { kind: 'scan' }>> {
  if (target.source !== 'deployment' || target.isProductionEnvironment) return target;
  const github = runtime.getGitHubApi(githubToken);
  const head = github.ok ? await github.value.readDefaultBranchHeadSha() : github;
  if (!head.ok) {
    const reason = quandle_render_escape_logText(head.reason);
    runtime.warning(
      `Quandle: could not check the default branch (${reason}), so this deploy is treated as a preview.`,
    );
    return target;
  }
  return quandle_target_resolve_productionDeploy(target, head.value);
}

// Reads .quandle-ignore.yml from the default branch and sorts the findings by it, with the run's clock.
// Only for a scanned result (mock included). No file: nothing ignored, silently. A failed read or an
// invalid file: nothing ignored, and one warning that says why (never the file's contents).
// Returns: the findings as sorted by the ignore file (all shown when nothing applies).
// Side effects: GitHub API call; warnings.
// Rules: IGN-3, IGN-4, IGN-7, IGN-9, PRM-3
async function quandle_main_apply_ignoreFile(
  runtime: ActionRuntime,
  result: ScanResult,
  githubToken: string,
): Promise<IgnoreOutcome> {
  const nothingIgnored: IgnoreOutcome = { shown: result.findings, ignored: [], expired: [] };
  if (result.status !== 'scanned') return nothingIgnored;
  const github = runtime.getGitHubApi(githubToken);
  const file = github.ok ? await github.value.readIgnoreFile() : github;
  if (!file.ok) {
    const reason = quandle_render_escape_logText(file.reason);
    runtime.warning(`Quandle: could not read .quandle-ignore.yml (${reason}), so nothing is ignored.`);
    return nothingIgnored;
  }
  if (file.value === undefined) return nothingIgnored;
  const now = runtime.now();
  const entries = quandle_ignore_parse_ignoreFile(file.value, now);
  if (!entries.ok) {
    runtime.warning(entries.reason);
    return nothingIgnored;
  }
  return quandle_ignore_apply_entriesToFindings(result.findings, entries.value, now);
}

// Ends a run that never scanned: sets all four outputs for that outcome, then writes the
// one-line "Not scanned" summary (best effort).
// Rules: OUT-1, OUT-6, ERR-4, TGT-3
async function quandle_main_finish_withoutScan(
  runtime: ActionRuntime,
  status: OutputStatus,
  reason: string,
): Promise<void> {
  quandle_main_set_noScanOutputs(runtime, status);
  await quandle_main_write_summaryBestEffort(runtime, quandle_render_build_notScannedSummary(reason));
}

// Reports an internal bug without ever throwing: fixed warning, status internal-error,
// "Not scanned" summary. If reporting itself fails, there is nothing safe left to do.
// Never throws.
// Rules: ERR-3, OUT-6
async function quandle_main_report_internalError(runtime: ActionRuntime): Promise<void> {
  try {
    runtime.warning(INTERNAL_ERROR_MESSAGE);
    await quandle_main_finish_withoutScan(runtime, 'internal-error', 'internal error');
  } catch {
    // Nothing safe left to report.
  }
}

// Reads the two secret inputs once and registers them with the runner so they are masked in
// every log line. Runs before any other input is read. Empty inputs are not registered.
// Returns: both secrets (empty string when not set).
// Side effects: setSecret for each non-empty secret.
// Rules: TRU-5
function quandle_main_mask_secretInputs(runtime: ActionRuntime): SecretInputs {
  const secrets: SecretInputs = {
    bypassSecret: runtime.getInput('bypass-secret'),
    githubToken: runtime.getInput('github-token'),
  };
  for (const secret of [secrets.bypassSecret, secrets.githubToken]) {
    if (secret !== '') runtime.setSecret(secret);
  }
  return secrets;
}

// Checks the bypass-secret fits the engine's limit of 256 bytes (UTF-8). Anything longer is a pasting
// mistake. The reason never contains the secret (TRU-5).
// Returns: ok with the secret (empty when not set), or the config-error reason.
// Rules: ERR-1, TRU-5
function quandle_main_parse_bypassSecret(secret: string): Parsed<string> {
  if (Buffer.byteLength(secret, 'utf8') <= MAX_BYPASS_SECRET_BYTES) return { ok: true, value: secret };
  return { ok: false, reason: BYPASS_SECRET_TOO_LONG_MESSAGE };
}

// Reads and validates every non-secret input, and combines them with the already-masked secrets.
// Returns: ok with the typed Inputs, or every config-error reason (one per invalid input).
// Rules: IO-1, IO-2, SEV-1, MOCK-1, ERR-1
function quandle_main_read_actionInputs(
  runtime: ActionRuntime,
  secrets: SecretInputs,
): { ok: true; value: Inputs } | { ok: false; reasons: string[] } {
  const failOn = quandle_severity_parse_failOnInput(runtime.getInput('fail-on'));
  const isCommentEnabled = quandle_main_parse_booleanInput('comment', runtime.getInput('comment'));
  const isIssueEnabled = quandle_main_parse_booleanInput('issue', runtime.getInput('issue'));
  const isMockEnabled = quandle_main_parse_booleanInput('mock', runtime.getInput('mock'));
  const mockScenario = quandle_mock_parse_scenarioInput(runtime.getInput('mock-scenario'));
  const bypassSecret = quandle_main_parse_bypassSecret(secrets.bypassSecret);
  const parsedInputs = [failOn, isCommentEnabled, isIssueEnabled, isMockEnabled, mockScenario, bypassSecret];
  if (
    !failOn.ok ||
    !isCommentEnabled.ok ||
    !isIssueEnabled.ok ||
    !isMockEnabled.ok ||
    !mockScenario.ok ||
    !bypassSecret.ok
  ) {
    return { ok: false, reasons: parsedInputs.flatMap((parsed) => (parsed.ok ? [] : [parsed.reason])) };
  }
  const url = runtime.getInput('url');
  return {
    ok: true,
    value: {
      ...(url === '' ? {} : { url }),
      failOn: failOn.value,
      isCommentEnabled: isCommentEnabled.value,
      isIssueEnabled: isIssueEnabled.value,
      ...(bypassSecret.value === '' ? {} : { bypassSecret: bypassSecret.value }),
      isMockEnabled: isMockEnabled.value,
      mockScenario: mockScenario.value,
      githubToken: secrets.githubToken,
    },
  };
}

// A scan result together with its findings as sorted by the ignore file.
interface ScanReport<Result extends ScanResult = ScanResult> {
  readonly result: Result;
  readonly outcome: IgnoreOutcome;
}

// Sets the job result: fail open with a warning when not scanned; otherwise fail only on
// new findings (or findings whose ignore expired) at or above fail-on.
// Side effects: warning (not scanned) or setFailed (findings at threshold).
// Rules: ERR-2, SEV-2, SEV-3, SEV-4
function quandle_main_set_jobResult(runtime: ActionRuntime, report: ScanReport, failOn: FailOn): void {
  const { result, outcome } = report;
  if (result.status !== 'scanned') {
    runtime.warning(`Quandle: not scanned, ${quandle_render_escape_logText(result.reason)}.`);
    return;
  }
  if (quandle_severity_check_shouldFailJob(outcome, failOn)) {
    runtime.setFailed(
      `Quandle: this deploy has new or no longer ignored findings at or above fail-on "${failOn}".`,
    );
  }
}

// Sets all four outputs for a scan result (or engine outcome). Counts only the findings that can
// fail the job: shown new ones and those whose ignore expired, never ignored ones.
// Side effects: setOutput new-findings, critical, scan-id, status ("mock" in mock mode).
// Rules: OUT-6, IGN-10
function quandle_main_set_scanOutputs(runtime: ActionRuntime, report: ScanReport): void {
  const { result, outcome } = report;
  const counted = quandle_severity_get_failableFindings(outcome);
  quandle_main_set_allOutputs(runtime, {
    newFindings: counted.length,
    critical: counted.filter((finding) => finding.severity === 'critical').length,
    scanId: result.scanId ?? '',
    status: result.isMock ? 'mock' : result.status,
  });
}

// Sets all four outputs for a run that never scanned: zero counts, empty scan id.
// Side effects: setOutput new-findings, critical, scan-id, status.
// Rules: OUT-6
function quandle_main_set_noScanOutputs(runtime: ActionRuntime, status: OutputStatus): void {
  quandle_main_set_allOutputs(runtime, { newFindings: 0, critical: 0, scanId: '', status });
}

// The one place the four output names are written, so every outcome sets all of them.
// Side effects: setOutput new-findings, critical, scan-id, status.
// Rules: OUT-6
function quandle_main_set_allOutputs(
  runtime: ActionRuntime,
  outputs: { newFindings: number; critical: number; scanId: string; status: OutputStatus },
): void {
  runtime.setOutput('new-findings', outputs.newFindings);
  runtime.setOutput('critical', outputs.critical);
  runtime.setOutput('scan-id', outputs.scanId);
  runtime.setOutput('status', outputs.status);
}

// Writes the job summary. Best effort: if writing fails, warns (without the error) and the
// job result and outputs, already set, still stand.
// Never throws.
// Rules: OUT-1
async function quandle_main_write_summaryBestEffort(runtime: ActionRuntime, markdown: string): Promise<void> {
  try {
    await runtime.writeSummary(markdown);
  } catch {
    runtime.warning(SUMMARY_FAILED_MESSAGE);
  }
}

// The places a scanned result is reported on GitHub (besides the job summary).
type PublishChannel = 'comment' | 'issue';

const CHANNEL_LABELS: Readonly<Record<PublishChannel, string>> = {
  comment: 'the PR comment',
  issue: 'the production issue',
};

// Reports a scanned result on GitHub: our comment on every open PR whose head is the deployed commit
// (OUT-2), or the production issue for Scan now/schedule and for a production deploy with no such PR
// (TGT-6, TGT-11). Never when nothing was scanned (ERR-4) or for a channel turned off (PRM-2). Any
// GitHub failure only warns, once per channel the run wanted; the job result and outputs stand.
// Side effects: GitHub API calls; warnings.
// Rules: OUT-2, OUT-3, OUT-4, TGT-6, TGT-11, PRM-2, PRM-3, ERR-4, TRU-6
async function quandle_main_publish_results(
  runtime: ActionRuntime,
  report: ScanReport,
  target: Extract<Target, { kind: 'scan' }>,
  inputs: Inputs,
): Promise<void> {
  const { result, outcome } = report;
  if (result.status !== 'scanned') return;
  const scanned: ScanReport<typeof result> = { result, outcome };
  const channels: PublishChannel[] = [
    ...(inputs.isCommentEnabled && target.source === 'deployment' ? (['comment'] as const) : []),
    ...(inputs.isIssueEnabled && target.isProductionEnvironment ? (['issue'] as const) : []),
  ];
  if (channels.length === 0) return;
  const github = runtime.getGitHubApi(inputs.githubToken);
  if (!github.ok) return quandle_main_warn_publishFailures(runtime, channels, github.reason);
  if (target.source === 'manual') return quandle_main_publish_productionIssue(runtime, github.value, scanned);
  const pullRequests = await github.value.listPullRequestsForCommit(target.sha);
  if (!pullRequests.ok) return quandle_main_warn_publishFailures(runtime, channels, pullRequests.reason);
  // OUT-2 / OUT-3: only open PRs whose head is still this commit; a moved-on PR gets nothing.
  const matching = pullRequests.value.filter((pr) => pr.isOpen && pr.headSha === target.sha);
  if (channels.includes('comment')) {
    const body = quandle_render_build_prComment(result, outcome);
    for (const pullRequest of matching) {
      const failure = await quandle_main_publish_prComment(github.value, pullRequest.number, body, outcome);
      if (failure !== undefined) quandle_main_warn_publishFailures(runtime, ['comment'], failure);
    }
  }
  // TGT-11: a production deploy that has a matching open PR is reported there, not in the issue.
  if (channels.includes('issue') && matching.length === 0) {
    await quandle_main_publish_productionIssue(runtime, github.value, scanned);
  }
}

// Opens, rewrites, closes or leaves the production issue, as quandle_issue_decide_action says.
// Closing first rewrites the issue to say everything is fixed (OUT-12).
// Side effects: GitHub API calls; a warning on failure.
// Rules: OUT-10, OUT-12, PRM-3
async function quandle_main_publish_productionIssue(
  runtime: ActionRuntime,
  github: GitHubApi,
  report: ScanReport<Extract<ScanResult, { status: 'scanned' }>>,
): Promise<void> {
  const issues = await github.listOpenIssues();
  if (!issues.ok) return quandle_main_warn_publishFailures(runtime, ['issue'], issues.reason);
  const body = quandle_render_build_productionIssue(report.result, report.outcome);
  const action = quandle_issue_decide_action(quandle_issue_find_ownIssue(issues.value), body, report.outcome);
  if (action.kind === 'leave') return;
  const written =
    action.kind === 'create'
      ? await github.createIssue(action.title, action.body)
      : await github.updateIssue(action.issueNumber, action.body);
  const closed =
    written.ok && action.kind === 'close' ? await github.closeIssue(action.issueNumber) : written;
  if (!closed.ok) quandle_main_warn_publishFailures(runtime, ['issue'], closed.reason);
}

// Creates, updates or leaves our comment on one PR, as quandle_comment_decide_action says.
// Returns: undefined on success (or nothing to do), else our reason the GitHub call failed.
// Rules: OUT-7, OUT-9, PRM-3
async function quandle_main_publish_prComment(
  github: GitHubApi,
  pullRequestNumber: number,
  body: string,
  outcome: IgnoreOutcome,
): Promise<string | undefined> {
  const comments = await github.listPullRequestComments(pullRequestNumber);
  if (!comments.ok) return comments.reason;
  const action = quandle_comment_decide_action(
    quandle_comment_find_ownComment(comments.value),
    body,
    outcome,
  );
  if (action.kind === 'leave') return undefined;
  const written =
    action.kind === 'create'
      ? await github.createPullRequestComment(pullRequestNumber, action.body)
      : await github.updatePullRequestComment(action.commentId, action.body);
  return written.ok ? undefined : written.reason;
}

// One warning per channel that could not be updated, with our own (escaped) reason.
// Side effects: warnings.
// Rules: PRM-3
function quandle_main_warn_publishFailures(
  runtime: ActionRuntime,
  channels: readonly PublishChannel[],
  reason: string,
): void {
  for (const channel of channels) {
    runtime.warning(
      `Quandle: could not update ${CHANNEL_LABELS[channel]} (${quandle_render_escape_logText(reason)}).`,
    );
  }
}
