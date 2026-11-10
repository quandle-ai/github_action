// ==========================================================================
// Quandle GitHub Action · src/report/issue.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Decides the production issue: finds our own open issue (marker and author,
// never one someone else opened), and whether to create, update, close or leave it.
// Pure: no network, no @actions imports.
// Rules: OUT-10, OUT-12, IGN-2, IGN-10
// ==========================================================================
import { GITHUB_ACTIONS_BOT_LOGIN } from '../io/github';
import type { IssueRef } from '../io/github';
import { ISSUE_MARKER } from './render';
import { SEVERITY_RANK } from '../scan/severity';
import type { Finding, FindingState, IgnoreOutcome } from '../types';

// OUT-4: the production issue's title.
export const ISSUE_TITLE = '🚨 Quandle: production exposures';

export type IssueAction =
  | { readonly kind: 'create'; readonly title: string; readonly body: string }
  | { readonly kind: 'update'; readonly issueNumber: number; readonly body: string }
  | { readonly kind: 'close'; readonly issueNumber: number; readonly body: string }
  | { readonly kind: 'leave' };

// Finds our own production issue among the open issues: it must have our hidden marker AND be
// opened by github-actions[bot]. An issue anyone else opened is never ours, even with our marker.
// Returns: the first such issue, or undefined.
// Rules: OUT-10
export function quandle_issue_find_ownIssue(issues: readonly IssueRef[]): IssueRef | undefined {
  return issues.find(
    (issue) => issue.authorLogin === GITHUB_ACTIONS_BOT_LOGIN && issue.body.includes(ISSUE_MARKER),
  );
}

// Decides what to do with the production issue, given our open issue (if any) and the body it should
// have now. None open: create only for a new or already-present exposure at Medium or above. Open:
// close (after rewriting) when nothing at Medium or above is still exposed; otherwise update only
// when its body would change. Never reopens: a closed issue is not in the open list at all.
// Returns: create, update, close or leave.
// Rules: OUT-12
export function quandle_issue_decide_action(
  existing: IssueRef | undefined,
  body: string,
  outcome: IgnoreOutcome,
): IssueAction {
  if (existing === undefined) {
    return quandle_issue_check_hasOpenableFinding(outcome)
      ? { kind: 'create', title: ISSUE_TITLE, body }
      : { kind: 'leave' };
  }
  if (!quandle_issue_check_hasExposure(outcome.shown))
    return { kind: 'close', issueNumber: existing.number, body };
  return existing.body === body ? { kind: 'leave' } : { kind: 'update', issueNumber: existing.number, body };
}

// True when something worth opening an issue for is exposed at Medium or above: a shown new or
// already-present finding, or one whose ignore expired. Ignored findings are not shown, so never qualify.
// Returns: whether any finding qualifies.
// Rules: OUT-12, IGN-2, IGN-10
function quandle_issue_check_hasOpenableFinding(outcome: IgnoreOutcome): boolean {
  const lapsed = outcome.expired.map((expired) => expired.finding);
  return (
    quandle_issue_check_hasFindingInStates(outcome.shown, ['new', 'already-present']) ||
    quandle_issue_check_hasFindingInStates(lapsed, ['new', 'existing'])
  );
}

// True when anything at Medium or above is still exposed (new, existing or already-present).
// Returns: whether the issue should stay open.
// Rules: OUT-12
function quandle_issue_check_hasExposure(findings: readonly Finding[]): boolean {
  return quandle_issue_check_hasFindingInStates(findings, ['new', 'existing', 'already-present']);
}

// True when a finding at Medium or above is in one of the given states.
// Returns: whether any finding qualifies.
function quandle_issue_check_hasFindingInStates(
  findings: readonly Finding[],
  states: readonly FindingState[],
): boolean {
  return findings.some(
    (finding) => states.includes(finding.state) && SEVERITY_RANK[finding.severity] >= SEVERITY_RANK.medium,
  );
}
