// ==========================================================================
// Quandle GitHub Action · test/report/comment/quandle_comment_decide_action.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/report/comment.ts → quandle_comment_decide_action
// Also covers (private): quandle_comment_check_hasPostableFinding
//
// Proves when the PR comment is created, updated or left alone: a new comment only
// for a new finding, or one whose ignore expired, at Medium or above (never for an
// ignored one); an existing one rewritten only when its content would change, and
// never deleted.
// Rules: OUT-9
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_comment_decide_action } from '../../../src/report/comment';
import { buildFinding, buildIgnoreOutcome } from '../../helpers/builders';
import { BOT_LOGIN } from '../../helpers/fake-github';

const existing = { id: 77, body: 'old body', authorLogin: BOT_LOGIN };

describe('quandle_comment_decide_action', () => {
  describe('when there is no comment yet', () => {
    it.each(['critical', 'high', 'medium'] as const)(
      '[OUT-9] posts a comment for a new %s finding',
      (severity) => {
        expect(
          quandle_comment_decide_action(
            undefined,
            'body',
            buildIgnoreOutcome({ shown: [buildFinding({ severity })] }),
          ),
        ).toEqual({
          kind: 'create',
          body: 'body',
        });
      },
    );

    it('[OUT-9] posts nothing when the only new finding is low', () => {
      expect(
        quandle_comment_decide_action(
          undefined,
          'body',
          buildIgnoreOutcome({ shown: [buildFinding({ severity: 'low' })] }),
        ),
      ).toEqual({
        kind: 'leave',
      });
    });

    it.each(['resolved', 'existing', 'already-present'] as const)(
      '[OUT-9] posts nothing when the only critical finding is %s',
      (state) => {
        expect(
          quandle_comment_decide_action(
            undefined,
            'body',
            buildIgnoreOutcome({ shown: [buildFinding({ state })] }),
          ),
        ).toEqual({
          kind: 'leave',
        });
      },
    );

    it('[OUT-9] posts nothing for a clean scan', () => {
      expect(quandle_comment_decide_action(undefined, 'body', buildIgnoreOutcome({ shown: [] }))).toEqual({
        kind: 'leave',
      });
    });
  });

  describe('when our comment already exists', () => {
    it('[OUT-9] leaves it untouched when its content would not change', () => {
      expect(
        quandle_comment_decide_action(existing, 'old body', buildIgnoreOutcome({ shown: [buildFinding()] })),
      ).toEqual({
        kind: 'leave',
      });
    });

    it('[OUT-9] rewrites it to the current state when its content would change', () => {
      expect(
        quandle_comment_decide_action(existing, 'new body', buildIgnoreOutcome({ shown: [buildFinding()] })),
      ).toEqual({
        kind: 'update',
        commentId: 77,
        body: 'new body',
      });
    });

    it('[OUT-9] rewrites it (never deletes it) when everything it showed is fixed and nothing is new', () => {
      expect(
        quandle_comment_decide_action(
          existing,
          'all fixed',
          buildIgnoreOutcome({ shown: [buildFinding({ state: 'resolved' })] }),
        ),
      ).toEqual({
        kind: 'update',
        commentId: 77,
        body: 'all fixed',
      });
    });
  });

  describe('with the ignore file', () => {
    it('[OUT-9] posts a comment for an existing medium finding whose ignore expired', () => {
      const finding = buildFinding({ severity: 'medium', state: 'existing' });
      const outcome = buildIgnoreOutcome({ shown: [finding], expired: [{ finding, expires: '2026-11-08' }] });
      expect(quandle_comment_decide_action(undefined, 'body', outcome)).toEqual({
        kind: 'create',
        body: 'body',
      });
    });

    it('[OUT-9] posts nothing for an existing low finding whose ignore expired', () => {
      const finding = buildFinding({ severity: 'low', state: 'existing' });
      const outcome = buildIgnoreOutcome({ shown: [finding], expired: [{ finding, expires: '2026-11-08' }] });
      expect(quandle_comment_decide_action(undefined, 'body', outcome)).toEqual({ kind: 'leave' });
    });

    it('[OUT-9] posts nothing when the only new critical finding is ignored', () => {
      const outcome = buildIgnoreOutcome({ ignored: [{ finding: buildFinding(), reason: 'Test reason' }] });
      expect(quandle_comment_decide_action(undefined, 'body', outcome)).toEqual({ kind: 'leave' });
    });
  });
});
