// ==========================================================================
// Quandle GitHub Action · test/scan/ignore/quandle_ignore_apply_entriesToFindings.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/scan/ignore.ts → quandle_ignore_apply_entriesToFindings
// Also covers (private): none
//
// Proves an entry hides only findings whose id or rule matches it exactly; an
// active entry wins over an expired one and the first active one gives the reason;
// an entry is active through its expiry day in UTC; a new or existing finding
// matched only by expired entries stays shown and is listed as expired; a resolved
// finding is never hidden; and the findings themselves are never changed.
// Rules: IGN-2, IGN-5, IGN-6, IGN-7, IGN-10
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_ignore_apply_entriesToFindings } from '../../../src/scan/ignore';
import type { IgnoreEntry } from '../../../src/types';
import { buildFinding, buildIgnoreEntry, buildIgnoreOutcome } from '../../helpers/builders';

// The run's day in UTC is 2026-11-09.
const NOW = new Date('2026-11-09T12:00:00Z');
const YESTERDAY = '2026-11-08';

function ruleEntry(rule: string, overrides: Partial<IgnoreEntry> = {}): IgnoreEntry {
  return buildIgnoreEntry({ match: { kind: 'rule', rule }, ...overrides });
}

describe('quandle_ignore_apply_entriesToFindings', () => {
  describe('matching (IGN-5)', () => {
    it('[IGN-5] hides the finding whose id is exactly qf_test01, with the entry reason', () => {
      const finding = buildFinding({ id: 'qf_test01' });
      const entry = buildIgnoreEntry({ reason: 'Public by design' });
      expect(quandle_ignore_apply_entriesToFindings([finding], [entry], NOW)).toEqual(
        buildIgnoreOutcome({ ignored: [{ finding, reason: 'Public by design' }] }),
      );
    });

    it('[IGN-5] does not hide finding qf_test02 with an entry for id qf_test01', () => {
      const finding = buildFinding({ id: 'qf_test02' });
      expect(quandle_ignore_apply_entriesToFindings([finding], [buildIgnoreEntry()], NOW)).toEqual(
        buildIgnoreOutcome({ shown: [finding] }),
      );
    });

    it('[IGN-5] does not hide finding qf_test01 with an entry for id QF_TEST01 (case-sensitive)', () => {
      const finding = buildFinding({ id: 'qf_test01' });
      const entry = buildIgnoreEntry({ match: { kind: 'id', id: 'QF_TEST01' } });
      expect(quandle_ignore_apply_entriesToFindings([finding], [entry], NOW).shown).toEqual([finding]);
    });

    it('[IGN-5] does not hide a finding whose rule is secret/test with an id entry secret/test', () => {
      const finding = buildFinding({ id: 'qf_test01', rule: 'secret/test' });
      const entry = buildIgnoreEntry({ match: { kind: 'id', id: 'secret/test' } });
      expect(quandle_ignore_apply_entriesToFindings([finding], [entry], NOW).shown).toEqual([finding]);
    });

    it('[IGN-5] hides every finding whose rule is exactly header/csp-missing', () => {
      const first = buildFinding({ id: 'qf_test01', rule: 'header/csp-missing' });
      const second = buildFinding({ id: 'qf_test02', rule: 'header/csp-missing' });
      const outcome = quandle_ignore_apply_entriesToFindings(
        [first, second],
        [ruleEntry('header/csp-missing')],
        NOW,
      );
      expect(outcome.ignored.map((ignored) => ignored.finding)).toEqual([first, second]);
      expect(outcome.shown).toEqual([]);
    });

    it('[IGN-5] does not hide rule secret/test with a rule entry secret (no prefix match)', () => {
      const finding = buildFinding({ rule: 'secret/test' });
      expect(quandle_ignore_apply_entriesToFindings([finding], [ruleEntry('secret')], NOW).shown).toEqual([
        finding,
      ]);
    });

    it('[IGN-5] does not hide rule secret/test with a rule entry Secret/Test (case-sensitive)', () => {
      const finding = buildFinding({ rule: 'secret/test' });
      expect(
        quandle_ignore_apply_entriesToFindings([finding], [ruleEntry('Secret/Test')], NOW).shown,
      ).toEqual([finding]);
    });

    it('[IGN-5] takes the reason from the first active matching entry in file order', () => {
      const finding = buildFinding();
      const entries = [ruleEntry('secret/test', { reason: 'First' }), buildIgnoreEntry({ reason: 'Second' })];
      expect(quandle_ignore_apply_entriesToFindings([finding], entries, NOW).ignored).toEqual([
        { finding, reason: 'First' },
      ]);
    });

    it('[IGN-5] lets a later active entry win over an earlier expired one, so the finding is ignored', () => {
      const finding = buildFinding();
      const entries = [
        buildIgnoreEntry({ reason: 'Old', expires: YESTERDAY }),
        ruleEntry('secret/test', { reason: 'Renewed' }),
      ];
      expect(quandle_ignore_apply_entriesToFindings([finding], entries, NOW)).toEqual(
        buildIgnoreOutcome({ ignored: [{ finding, reason: 'Renewed' }] }),
      );
    });

    it('[IGN-5] shows every finding, in order, when there are no entries', () => {
      const findings = [buildFinding({ id: 'qf_test01' }), buildFinding({ id: 'qf_test02' })];
      expect(quandle_ignore_apply_entriesToFindings(findings, [], NOW)).toEqual(
        buildIgnoreOutcome({ shown: findings }),
      );
    });

    it('[IGN-5] keeps the shown findings in their original order and as the same objects', () => {
      const findings = [
        buildFinding({ id: 'qf_a' }),
        buildFinding({ id: 'qf_test01' }),
        buildFinding({ id: 'qf_b' }),
      ];
      const outcome = quandle_ignore_apply_entriesToFindings(findings, [buildIgnoreEntry()], NOW);
      expect(outcome.shown).toHaveLength(2);
      expect(outcome.shown[0]).toBe(findings[0]);
      expect(outcome.shown[1]).toBe(findings[2]);
    });
  });

  describe('expiry day (IGN-7)', () => {
    it('[IGN-7] still ignores on the expiry day itself, 2026-11-09', () => {
      const finding = buildFinding();
      const outcome = quandle_ignore_apply_entriesToFindings(
        [finding],
        [buildIgnoreEntry({ expires: '2026-11-09' })],
        NOW,
      );
      expect(outcome.ignored).toHaveLength(1);
    });

    it('[IGN-7] no longer ignores the day after expiry: expires 2026-11-08 on a run on 2026-11-09', () => {
      const finding = buildFinding();
      const outcome = quandle_ignore_apply_entriesToFindings(
        [finding],
        [buildIgnoreEntry({ expires: YESTERDAY })],
        NOW,
      );
      expect(outcome.ignored).toEqual([]);
    });

    it('[IGN-7] uses the UTC day: expires 2026-11-09 has expired at 23:30 New York time on 2026-11-09', () => {
      const lateEvening = new Date('2026-11-09T23:30:00-05:00');
      const outcome = quandle_ignore_apply_entriesToFindings(
        [buildFinding()],
        [buildIgnoreEntry({ expires: '2026-11-09' })],
        lateEvening,
      );
      expect(outcome.ignored).toEqual([]);
    });
  });

  describe('expired entries (IGN-2)', () => {
    it.each(['new', 'existing'] as const)(
      '[IGN-2] shows a %s finding matched only by an expired entry and lists it as expired on that date',
      (state) => {
        const finding = buildFinding({ state });
        const outcome = quandle_ignore_apply_entriesToFindings(
          [finding],
          [buildIgnoreEntry({ expires: YESTERDAY })],
          NOW,
        );
        expect(outcome).toEqual(
          buildIgnoreOutcome({ shown: [finding], expired: [{ finding, expires: YESTERDAY }] }),
        );
      },
    );

    it('[IGN-2] shows an already-present finding matched only by an expired entry, without listing it as expired', () => {
      const finding = buildFinding({ state: 'already-present' });
      const outcome = quandle_ignore_apply_entriesToFindings(
        [finding],
        [buildIgnoreEntry({ expires: YESTERDAY })],
        NOW,
      );
      expect(outcome).toEqual(buildIgnoreOutcome({ shown: [finding] }));
    });

    it('[IGN-2] gives the date of the first expired matching entry in file order', () => {
      const finding = buildFinding();
      const entries = [
        ruleEntry('secret/test', { expires: '2026-10-01' }),
        buildIgnoreEntry({ expires: '2026-11-01' }),
      ];
      expect(quandle_ignore_apply_entriesToFindings([finding], entries, NOW).expired).toEqual([
        { finding, expires: '2026-10-01' },
      ]);
    });
  });

  describe('resolved findings (IGN-6)', () => {
    it('[IGN-6] shows a resolved finding even when an active entry matches it', () => {
      const finding = buildFinding({ state: 'resolved' });
      expect(quandle_ignore_apply_entriesToFindings([finding], [buildIgnoreEntry()], NOW)).toEqual(
        buildIgnoreOutcome({ shown: [finding] }),
      );
    });

    it('[IGN-6] does not list a resolved finding as expired when only an expired entry matches it', () => {
      const finding = buildFinding({ state: 'resolved' });
      const outcome = quandle_ignore_apply_entriesToFindings(
        [finding],
        [buildIgnoreEntry({ expires: YESTERDAY })],
        NOW,
      );
      expect(outcome).toEqual(buildIgnoreOutcome({ shown: [finding] }));
    });
  });

  describe('ignored findings (IGN-10)', () => {
    it('[IGN-10] lists each ignored finding once with its reason, keeping the other findings shown', () => {
      const ignoredFinding = buildFinding({ id: 'qf_test01' });
      const shownFinding = buildFinding({ id: 'qf_test02' });
      const outcome = quandle_ignore_apply_entriesToFindings(
        [ignoredFinding, shownFinding],
        [buildIgnoreEntry()],
        NOW,
      );
      expect(outcome).toEqual(
        buildIgnoreOutcome({
          shown: [shownFinding],
          ignored: [{ finding: ignoredFinding, reason: 'Test reason' }],
        }),
      );
    });
  });
});
