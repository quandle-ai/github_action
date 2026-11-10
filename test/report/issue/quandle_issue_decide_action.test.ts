// ==========================================================================
// Quandle GitHub Action · test/report/issue/quandle_issue_decide_action.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/report/issue.ts → quandle_issue_decide_action
// Also covers (private): quandle_issue_check_hasOpenableFinding, quandle_issue_check_hasExposure
//
// Proves when the production issue is opened, updated, closed or left alone:
// opened only for a new or already-present exposure, or one whose ignore expired,
// at Medium or above (never for an ignored one); rewritten only when its text
// would change; and rewritten then closed once nothing at Medium or above is still
// exposed (ignored findings do not keep it open).
// Rules: OUT-12
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { ISSUE_TITLE, quandle_issue_decide_action } from '../../../src/report/issue';
import { buildFinding, buildIgnoreOutcome } from '../../helpers/builders';
import { BOT_LOGIN } from '../../helpers/fake-github';

const existing = { number: 12, body: 'old body', authorLogin: BOT_LOGIN };

describe('quandle_issue_decide_action', () => {
  describe('when there is no open issue', () => {
    it.each(['new', 'already-present'] as const)(
      '[OUT-12] opens the issue for a %s finding at Medium or above',
      (state) => {
        expect(
          quandle_issue_decide_action(
            undefined,
            'body',
            buildIgnoreOutcome({ shown: [buildFinding({ state, severity: 'medium' })] }),
          ),
        ).toEqual({
          kind: 'create',
          title: ISSUE_TITLE,
          body: 'body',
        });
      },
    );

    it('[OUT-12] opens nothing for an existing finding (it was already reported before)', () => {
      expect(
        quandle_issue_decide_action(
          undefined,
          'body',
          buildIgnoreOutcome({ shown: [buildFinding({ state: 'existing' })] }),
        ),
      ).toEqual({
        kind: 'leave',
      });
    });

    it('[OUT-12] opens nothing when the only new finding is low', () => {
      expect(
        quandle_issue_decide_action(
          undefined,
          'body',
          buildIgnoreOutcome({ shown: [buildFinding({ severity: 'low' })] }),
        ),
      ).toEqual({
        kind: 'leave',
      });
    });

    it('[OUT-12] opens nothing for a clean scan', () => {
      expect(quandle_issue_decide_action(undefined, 'body', buildIgnoreOutcome({ shown: [] }))).toEqual({
        kind: 'leave',
      });
    });
  });

  describe('when our issue is open', () => {
    it('[OUT-12] leaves it untouched when its text would not change and something is still exposed', () => {
      expect(
        quandle_issue_decide_action(
          existing,
          'old body',
          buildIgnoreOutcome({ shown: [buildFinding({ state: 'existing' })] }),
        ),
      ).toEqual({
        kind: 'leave',
      });
    });

    it('[OUT-12] rewrites it when its text would change and something is still exposed', () => {
      expect(
        quandle_issue_decide_action(
          existing,
          'new body',
          buildIgnoreOutcome({ shown: [buildFinding({ state: 'existing' })] }),
        ),
      ).toEqual({
        kind: 'update',
        issueNumber: 12,
        body: 'new body',
      });
    });

    it('[OUT-12] rewrites and closes it when nothing at Medium or above is still exposed', () => {
      expect(
        quandle_issue_decide_action(
          existing,
          'all fixed',
          buildIgnoreOutcome({
            shown: [
              buildFinding({ state: 'resolved' }),
              buildFinding({ state: 'existing', severity: 'low' }),
            ],
          }),
        ),
      ).toEqual({ kind: 'close', issueNumber: 12, body: 'all fixed' });
    });

    it('[OUT-12] closes it for a clean scan', () => {
      expect(quandle_issue_decide_action(existing, 'all fixed', buildIgnoreOutcome({ shown: [] }))).toEqual({
        kind: 'close',
        issueNumber: 12,
        body: 'all fixed',
      });
    });
  });

  describe('with the ignore file', () => {
    it('[OUT-12] opens the issue for an existing medium finding whose ignore expired', () => {
      const finding = buildFinding({ severity: 'medium', state: 'existing' });
      const outcome = buildIgnoreOutcome({ shown: [finding], expired: [{ finding, expires: '2026-11-08' }] });
      expect(quandle_issue_decide_action(undefined, 'body', outcome)).toEqual({
        kind: 'create',
        title: ISSUE_TITLE,
        body: 'body',
      });
    });

    it('[OUT-12] opens nothing for an existing low finding whose ignore expired', () => {
      const finding = buildFinding({ severity: 'low', state: 'existing' });
      const outcome = buildIgnoreOutcome({ shown: [finding], expired: [{ finding, expires: '2026-11-08' }] });
      expect(quandle_issue_decide_action(undefined, 'body', outcome)).toEqual({ kind: 'leave' });
    });

    it('[OUT-12] opens nothing when the only new critical finding is ignored', () => {
      const outcome = buildIgnoreOutcome({ ignored: [{ finding: buildFinding(), reason: 'Test reason' }] });
      expect(quandle_issue_decide_action(undefined, 'body', outcome)).toEqual({ kind: 'leave' });
    });

    it('[OUT-12] rewrites then closes our open issue when every exposed finding is ignored', () => {
      const finding = buildFinding({ state: 'existing' });
      const outcome = buildIgnoreOutcome({ ignored: [{ finding, reason: 'Test reason' }] });
      expect(quandle_issue_decide_action(existing, 'all ignored', outcome)).toEqual({
        kind: 'close',
        issueNumber: 12,
        body: 'all ignored',
      });
    });
  });
});
