// ==========================================================================
// Quandle GitHub Action · test/helpers/mock-scenarios.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Every mock scenario exactly once, checked against MockScenario at compile time,
// so "for every scenario" tests can never silently skip a new one. Written out
// here rather than imported from src/scan/mock.ts, so the tests don't trust the code
// they are testing.
// ==========================================================================
import type { MockScenario } from '../../src/types';

const MOCK_SCENARIO_SET: Readonly<Record<MockScenario, true>> = {
  clean: true,
  critical: true,
  fixed: true,
  'first-scan': true,
};

// Object.keys returns string[]; the keys are exactly MockScenario by construction above.
export const ALL_SCENARIOS = Object.keys(MOCK_SCENARIO_SET) as MockScenario[];
