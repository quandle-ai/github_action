// ==========================================================================
// Quandle GitHub Action · test/scan/mock/quandle_mock_build_scanResult.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/scan/mock.ts → quandle_mock_build_scanResult
// Also covers (private): quandle_mock_build_scenarioFindings
//
// Proves every mock result is marked as a mock, each scenario has the right
// findings, only the critical scenario fails the job, and mock evidence is fake.
// Rules: FND-1, FND-3, MOCK-1, MOCK-2, MOCK-3
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_mock_build_scanResult } from '../../../src/scan/mock';
import { quandle_severity_check_shouldFailJob } from '../../../src/scan/severity';
import { buildIgnoreOutcome } from '../../helpers/builders';
import { ALL_SCENARIOS } from '../../helpers/mock-scenarios';

describe('quandle_mock_build_scanResult', () => {
  it.each(ALL_SCENARIOS)('[MOCK-2] marks the %s scenario result as a mock', (scenario) => {
    expect(quandle_mock_build_scanResult(scenario, 'https://app.example.com/').isMock).toBe(true);
  });

  it.each(ALL_SCENARIOS)(
    '[MOCK-1] reports the %s scenario as scanned for the given url and environment',
    (scenario) => {
      expect(quandle_mock_build_scanResult(scenario, 'https://app.example.com/', 'Preview')).toMatchObject({
        status: 'scanned',
        url: 'https://app.example.com/',
        environment: 'Preview',
        scanId: `mock-${scenario}`,
      });
    },
  );

  it('[MOCK-1] returns no findings for the clean scenario', () => {
    expect(quandle_mock_build_scanResult('clean', 'https://app.example.com/').findings).toEqual([]);
  });

  it('[MOCK-1] returns one new critical finding for the critical scenario', () => {
    expect(quandle_mock_build_scanResult('critical', 'https://app.example.com/').findings).toEqual([
      expect.objectContaining({ severity: 'critical', state: 'new' }),
    ]);
  });

  it('[MOCK-1] marks the critical finding as resolved in the fixed scenario', () => {
    expect(quandle_mock_build_scanResult('fixed', 'https://app.example.com/').findings).toEqual([
      expect.objectContaining({ severity: 'critical', state: 'resolved' }),
    ]);
  });

  it('[MOCK-1] places the mock finding at the site root, whatever the page path or query', () => {
    const [finding] = quandle_mock_build_scanResult(
      'critical',
      'https://app.example.com/preview/page?x=1',
    ).findings;
    expect(finding?.location).toBe('https://app.example.com/assets/index-mock.js');
  });

  it('[FND-1] tags the first-scan scenario finding as already-present', () => {
    expect(quandle_mock_build_scanResult('first-scan', 'https://app.example.com/').findings).toEqual([
      expect.objectContaining({ state: 'already-present' }),
    ]);
  });

  it.each(ALL_SCENARIOS)(
    '[MOCK-3] fails the job at the default fail-on only for the critical scenario (checking %s)',
    (scenario) => {
      const result = quandle_mock_build_scanResult(scenario, 'https://app.example.com/');
      expect(
        quandle_severity_check_shouldFailJob(buildIgnoreOutcome({ shown: result.findings }), 'critical'),
      ).toBe(scenario === 'critical');
    },
  );

  it.each(ALL_SCENARIOS)(
    '[FND-3] uses only an obviously fake redacted placeholder as evidence in the %s scenario',
    (scenario) => {
      for (const finding of quandle_mock_build_scanResult(scenario, 'https://app.example.com/').findings) {
        expect(finding.evidence ?? 'FAKE').toMatch(/FAKE/);
      }
    },
  );
});
