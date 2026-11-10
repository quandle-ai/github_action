// ==========================================================================
// Quandle GitHub Action · src/report/comment.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Decides the PR comment: finds our own comment (marker and author, never one
// someone else wrote), and whether to create, update or leave it.
// Pure: no network, no @actions imports.
// Rules: OUT-7, OUT-9, IGN-2, IGN-10
// ==========================================================================
import { GITHUB_ACTIONS_BOT_LOGIN } from '../io/github';
import type { PullRequestComment } from '../io/github';
import { COMMENT_MARKER } from './render';
import { SEVERITY_RANK } from '../scan/severity';
import type { Finding, IgnoreOutcome } from '../types';

export type CommentAction =
  | { readonly kind: 'create'; readonly body: string }
  | { readonly kind: 'update'; readonly commentId: number; readonly body: string }
  | { readonly kind: 'leave' };

// Finds our own PR comment: it must have our hidden marker AND be written by github-actions[bot].
// A comment anyone else wrote is never ours, even with our marker in it.
// Returns: the first such comment, or undefined.
// Rules: OUT-7
export function quandle_comment_find_ownComment(
  comments: readonly PullRequestComment[],
): PullRequestComment | undefined {
  return comments.find(
    (comment) => comment.authorLogin === GITHUB_ACTIONS_BOT_LOGIN && comment.body.includes(COMMENT_MARKER),
  );
}

// Decides what to do with the PR comment, given our existing comment (if any) and the body it
// should have now. With none: create only for a new finding at Medium or above. With one: update
// it when its body would change, otherwise leave it. Never deletes.
// Returns: create, update or leave.
// Rules: OUT-9
export function quandle_comment_decide_action(
  existing: PullRequestComment | undefined,
  body: string,
  outcome: IgnoreOutcome,
): CommentAction {
  if (existing !== undefined) {
    return existing.body === body ? { kind: 'leave' } : { kind: 'update', commentId: existing.id, body };
  }
  return quandle_comment_check_hasPostableFinding(outcome) ? { kind: 'create', body } : { kind: 'leave' };
}

// True when a finding is worth starting a PR comment for, at Medium or above: a shown new finding,
// or one whose ignore expired. Ignored findings are not shown, so they never qualify.
// Returns: whether any finding qualifies.
// Rules: OUT-9, IGN-2, IGN-10
function quandle_comment_check_hasPostableFinding(outcome: IgnoreOutcome): boolean {
  const isMediumOrAbove = (finding: Finding): boolean =>
    SEVERITY_RANK[finding.severity] >= SEVERITY_RANK.medium;
  return (
    outcome.shown.some((finding) => finding.state === 'new' && isMediumOrAbove(finding)) ||
    outcome.expired.some((expired) => isMediumOrAbove(expired.finding))
  );
}
