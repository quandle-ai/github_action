// ==========================================================================
// Quandle GitHub Action · test/scan/severity/quandle_severity_get_failableFindings.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/scan/severity.ts → quandle_severity_get_failableFindings
// Also covers (private): none
//
// Proves the findings the outputs count are exactly the ones that can fail the job:
// shown new findings and shown findings whose ignore expired, in shown order; never
// an ignored finding, and never an existing, resolved or already-present one otherwise.
// Rules: OUT-6
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_severity_get_failableFindings } from '../../../src/scan/severity';
import { buildFinding, buildIgnoreOutcome } from '../../helpers/builders';

describe('quandle_severity_get_failableFindings', () => {
  it('[OUT-6] counts a shown new finding', () => {
    const finding = buildFinding({ state: 'new' });
    expect(quandle_severity_get_failableFindings(buildIgnoreOutcome({ shown: [finding] }))).toEqual([
      finding,
    ]);
  });

  it.each(['existing', 'resolved', 'already-present'] as const)(
    '[OUT-6] does not count a shown %s finding with no expired ignore',
    (state) => {
      const outcome = buildIgnoreOutcome({ shown: [buildFinding({ state })] });
      expect(quandle_severity_get_failableFindings(outcome)).toEqual([]);
    },
  );

  it('[OUT-6] counts an existing finding whose ignore expired', () => {
    const finding = buildFinding({ state: 'existing' });
    const outcome = buildIgnoreOutcome({ shown: [finding], expired: [{ finding, expires: '2026-11-08' }] });
    expect(quandle_severity_get_failableFindings(outcome)).toEqual([finding]);
  });

  it('[OUT-6] counts a new finding whose ignore expired once, not twice', () => {
    const finding = buildFinding({ state: 'new' });
    const outcome = buildIgnoreOutcome({ shown: [finding], expired: [{ finding, expires: '2026-11-08' }] });
    expect(quandle_severity_get_failableFindings(outcome)).toEqual([finding]);
  });

  it('[OUT-6] never counts an ignored new finding', () => {
    const outcome = buildIgnoreOutcome({
      ignored: [{ finding: buildFinding({ state: 'new' }), reason: 'x' }],
    });
    expect(quandle_severity_get_failableFindings(outcome)).toEqual([]);
  });

  it('[OUT-6] keeps the shown order: new qf_a, existing qf_b with an expired ignore, new qf_c', () => {
    const lapsed = buildFinding({ id: 'qf_b', state: 'existing' });
    const shown = [buildFinding({ id: 'qf_a' }), lapsed, buildFinding({ id: 'qf_c' })];
    const outcome = buildIgnoreOutcome({ shown, expired: [{ finding: lapsed, expires: '2026-11-08' }] });
    expect(quandle_severity_get_failableFindings(outcome).map((finding) => finding.id)).toEqual([
      'qf_a',
      'qf_b',
      'qf_c',
    ]);
  });
});
