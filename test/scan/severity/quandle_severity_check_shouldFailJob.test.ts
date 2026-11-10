// ==========================================================================
// Quandle GitHub Action · test/scan/severity/quandle_severity_check_shouldFailJob.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/scan/severity.ts → quandle_severity_check_shouldFailJob
// Also covers (private): none
//
// Proves the job fails only for a shown new finding, or a finding whose ignore
// expired, at or above fail-on; ignored findings never fail it; existing, resolved
// and already-present findings otherwise never fail it; and never means never.
// Rules: SEV-2, SEV-3, SEV-4
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_severity_check_shouldFailJob } from '../../../src/scan/severity';
import { buildFinding, buildIgnoreOutcome } from '../../helpers/builders';

describe('quandle_severity_check_shouldFailJob', () => {
  it('[SEV-2] fails the job when a new critical finding exists and fail-on is critical', () => {
    expect(
      quandle_severity_check_shouldFailJob(
        buildIgnoreOutcome({ shown: [buildFinding({ severity: 'critical' })] }),
        'critical',
      ),
    ).toBe(true);
  });

  it('[SEV-2] fails the job when a new high finding exists and fail-on is high', () => {
    expect(
      quandle_severity_check_shouldFailJob(
        buildIgnoreOutcome({ shown: [buildFinding({ severity: 'high' })] }),
        'high',
      ),
    ).toBe(true);
  });

  it('[SEV-2] fails the job for a new critical finding when fail-on is medium', () => {
    expect(
      quandle_severity_check_shouldFailJob(
        buildIgnoreOutcome({ shown: [buildFinding({ severity: 'critical' })] }),
        'medium',
      ),
    ).toBe(true);
  });

  it('[SEV-2] does not fail the job for a new high finding when fail-on is critical', () => {
    expect(
      quandle_severity_check_shouldFailJob(
        buildIgnoreOutcome({ shown: [buildFinding({ severity: 'high' })] }),
        'critical',
      ),
    ).toBe(false);
  });

  it('[SEV-2] does not fail the job for a new low finding even when fail-on is medium', () => {
    expect(
      quandle_severity_check_shouldFailJob(
        buildIgnoreOutcome({ shown: [buildFinding({ severity: 'low' })] }),
        'medium',
      ),
    ).toBe(false);
  });

  it('[SEV-2] does not fail the job when there are no findings', () => {
    expect(quandle_severity_check_shouldFailJob(buildIgnoreOutcome({ shown: [] }), 'medium')).toBe(false);
  });

  it('[SEV-2] fails the job when one of several findings is new and at the threshold', () => {
    const findings = [
      buildFinding({ severity: 'low' }),
      buildFinding({ severity: 'critical', state: 'existing' }),
      buildFinding({ severity: 'high' }),
    ];
    expect(quandle_severity_check_shouldFailJob(buildIgnoreOutcome({ shown: findings }), 'high')).toBe(true);
  });

  it.each(['existing', 'resolved', 'already-present'] as const)(
    '[SEV-3] does not fail the job for a critical finding whose state is %s',
    (state) => {
      expect(
        quandle_severity_check_shouldFailJob(
          buildIgnoreOutcome({ shown: [buildFinding({ severity: 'critical', state })] }),
          'medium',
        ),
      ).toBe(false);
    },
  );

  it('[SEV-4] never fails the job when fail-on is never, even with new critical findings', () => {
    expect(
      quandle_severity_check_shouldFailJob(
        buildIgnoreOutcome({ shown: [buildFinding({ severity: 'critical' })] }),
        'never',
      ),
    ).toBe(false);
  });

  describe('with the ignore file (IGN-2, IGN-10)', () => {
    it('[SEV-2] fails the job for an existing critical finding whose ignore expired, at fail-on critical', () => {
      const finding = buildFinding({ severity: 'critical', state: 'existing' });
      const outcome = buildIgnoreOutcome({ shown: [finding], expired: [{ finding, expires: '2026-11-08' }] });
      expect(quandle_severity_check_shouldFailJob(outcome, 'critical')).toBe(true);
    });

    it('[SEV-2] does not fail the job for an existing high finding whose ignore expired, at fail-on critical', () => {
      const finding = buildFinding({ severity: 'high', state: 'existing' });
      const outcome = buildIgnoreOutcome({ shown: [finding], expired: [{ finding, expires: '2026-11-08' }] });
      expect(quandle_severity_check_shouldFailJob(outcome, 'critical')).toBe(false);
    });

    it('[SEV-2] does not fail the job when the only new critical finding is ignored', () => {
      const finding = buildFinding({ severity: 'critical', state: 'new' });
      const outcome = buildIgnoreOutcome({ ignored: [{ finding, reason: 'Test reason' }] });
      expect(quandle_severity_check_shouldFailJob(outcome, 'critical')).toBe(false);
    });

    it('[SEV-3] does not fail the job for a shown existing critical finding with no expired ignore', () => {
      const outcome = buildIgnoreOutcome({
        shown: [buildFinding({ severity: 'critical', state: 'existing' })],
      });
      expect(quandle_severity_check_shouldFailJob(outcome, 'critical')).toBe(false);
    });

    it('[SEV-4] never fails the job when fail-on is never, even for a critical finding whose ignore expired', () => {
      const finding = buildFinding({ severity: 'critical', state: 'existing' });
      const outcome = buildIgnoreOutcome({ shown: [finding], expired: [{ finding, expires: '2026-11-08' }] });
      expect(quandle_severity_check_shouldFailJob(outcome, 'never')).toBe(false);
    });
  });
});
