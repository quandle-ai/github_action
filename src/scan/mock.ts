// ==========================================================================
// Quandle GitHub Action · src/scan/mock.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Canned scan results for testing the Action without the engine (mock: true).
// Never the default. Every result is marked as a mock; evidence is obviously fake.
// Pure: no network, no @actions imports.
// Rules: MOCK-1 … MOCK-3, FND-1, FND-3, ERR-1, IO-2
// ==========================================================================
import type { Finding, MockScenario, Parsed, ScanResult } from '../types';

// Every mock scenario exactly once: TypeScript errors if one is missing or extra (MOCK-1).
// The list and the error message are both derived from this, so they can never drift.
const MOCK_SCENARIO_SET: Readonly<Record<MockScenario, true>> = {
  clean: true,
  critical: true,
  fixed: true,
  'first-scan': true,
};
// Object.keys returns string[]; the keys are exactly MockScenario by construction above.
const MOCK_SCENARIOS = Object.keys(MOCK_SCENARIO_SET) as MockScenario[];

// Validates the mock-scenario input, in any letter case but with no trimming.
// Returns: ok with the lowercase scenario, or a config-error reason listing the allowed scenarios.
// Rules: MOCK-1, ERR-1, IO-2
export function quandle_mock_parse_scenarioInput(raw: string): Parsed<MockScenario> {
  const normalised = raw.toLowerCase();
  const match = MOCK_SCENARIOS.find((scenario) => scenario === normalised);
  if (match === undefined) {
    return { ok: false, reason: `Quandle: \`mock-scenario\` must be one of: ${MOCK_SCENARIOS.join(', ')}.` };
  }
  return { ok: true, value: match };
}

// Builds the canned scan result for a scenario, always marked as a mock.
// url must already be a validated scan URL (TGT-8): it is only ever called with one.
// Only the critical scenario contains a finding that fails the job at the default fail-on.
// Returns: a scanned result for the given url/environment with scan id "mock-<scenario>".
// Rules: MOCK-1, MOCK-2, MOCK-3
export function quandle_mock_build_scanResult(
  scenario: MockScenario,
  url: string,
  environment?: string,
): ScanResult {
  return {
    status: 'scanned',
    url,
    ...(environment === undefined ? {} : { environment }),
    scanId: `mock-${scenario}`,
    findings: quandle_mock_build_scenarioFindings(scenario, url),
    isMock: true,
  };
}

// The findings for each scenario: none, one new critical, the same one resolved, or already-present.
// Evidence is an obviously fake redacted placeholder, never a realistic key.
// Returns: the scenario's findings.
// Rules: MOCK-1, FND-1, FND-3
function quandle_mock_build_scenarioFindings(scenario: MockScenario, url: string): Finding[] {
  const leakedKey: Finding = {
    id: 'qf_mock01',
    rule: 'secret/mock',
    severity: 'critical',
    state: 'new',
    title: 'Mock secret in shipped JavaScript',
    // Root path, so the location is the same whatever page or query the scan URL has.
    location: new URL('/assets/index-mock.js', url).href,
    evidence: 'FAKE…MOCK',
  };
  switch (scenario) {
    case 'clean':
      return [];
    case 'critical':
      return [leakedKey];
    case 'fixed':
      return [{ ...leakedKey, state: 'resolved' }];
    case 'first-scan':
      return [{ ...leakedKey, state: 'already-present' }];
  }
}
