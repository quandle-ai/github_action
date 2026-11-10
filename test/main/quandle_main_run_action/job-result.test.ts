// ==========================================================================
// Quandle GitHub Action · test/main/quandle_main_run_action/job-result.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/main.ts → quandle_main_run_action (job result)
// Also covers (private): quandle_main_set_jobResult
//
// Proves the job's own pass/fail is the status check: a new finding at fail-on
// fails the job exactly once, and every other outcome leaves it passing.
// Rules: OUT-5
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_main_run_action } from '../../../src/main';
import { buildFakeRuntime } from '../../helpers/fake-runtime';

describe('quandle_main_run_action', () => {
  describe('job result', () => {
    it('[OUT-5] fails the job exactly once when the deploy has a new critical finding', async () => {
      const runtime = buildFakeRuntime({ inputs: { mock: 'true', 'mock-scenario': 'critical' } });
      await quandle_main_run_action(runtime);
      expect(runtime.calls.filter((call) => call === 'setFailed')).toHaveLength(1);
    });

    it.each(['clean', 'fixed', 'first-scan'])(
      '[OUT-5] leaves the job passing when the %s scan has no new finding at fail-on',
      async (scenario) => {
        const runtime = buildFakeRuntime({ inputs: { mock: 'true', 'mock-scenario': scenario } });
        await quandle_main_run_action(runtime);
        expect(runtime.failures).toEqual([]);
      },
    );
  });
});
