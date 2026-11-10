// ==========================================================================
// Quandle GitHub Action · test/main/quandle_main_run_action/mock-mode.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/main.ts → quandle_main_run_action (mock mode)
// Also covers (private): quandle_main_set_jobResult, quandle_main_set_scanOutputs, quandle_main_set_allOutputs
//
// Proves mock runs show the banner, always warn that results are not real, report status mock, fail only for the
// critical scenario (unless fail-on is never), and count only new findings.
// Rules: MOCK-2, MOCK-3, OUT-6, SEV-4
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_main_run_action } from '../../../src/main';
import { buildFakeRuntime } from '../../helpers/fake-runtime';
import { ALL_SCENARIOS } from '../../helpers/mock-scenarios';

describe('quandle_main_run_action', () => {
  describe('mock mode', () => {
    it('[MOCK-2] writes the mock banner and reports status mock', async () => {
      const runtime = buildFakeRuntime({ inputs: { mock: 'true' } });
      await quandle_main_run_action(runtime);
      expect(runtime.summaries[0]).toContain('MOCK RESULTS');
      expect(runtime.outputs.status).toBe('mock');
    });

    it('[MOCK-3] keeps the job green for the clean mock scenario, with only the mock warning', async () => {
      const runtime = buildFakeRuntime({ inputs: { mock: 'true', 'mock-scenario': 'clean' } });
      await quandle_main_run_action(runtime);
      expect(runtime.failures).toEqual([]);
      expect(runtime.warnings).toEqual([expect.stringContaining('mock mode')]);
    });

    it.each(ALL_SCENARIOS)(
      '[MOCK-2] warns that the results are not real on a %s mock run',
      async (scenario) => {
        const runtime = buildFakeRuntime({ inputs: { mock: 'true', 'mock-scenario': scenario } });
        await quandle_main_run_action(runtime);
        expect(runtime.warnings).toContainEqual(
          expect.stringContaining('mock mode, these results are not real'),
        );
      },
    );

    it('[MOCK-2] does not show the mock warning on a run that is not a mock', async () => {
      const runtime = buildFakeRuntime();
      await quandle_main_run_action(runtime);
      expect(runtime.warnings.join('\n')).not.toContain('mock mode');
    });

    it('[MOCK-3] fails the job for the critical mock scenario at the default fail-on', async () => {
      const runtime = buildFakeRuntime({ inputs: { mock: 'true', 'mock-scenario': 'critical' } });
      await quandle_main_run_action(runtime);
      expect(runtime.failures).toEqual([expect.stringContaining('critical')]);
    });

    it('[SEV-4] does not fail the job for the critical mock scenario when fail-on is never', async () => {
      const runtime = buildFakeRuntime({
        inputs: { mock: 'true', 'mock-scenario': 'critical', 'fail-on': 'never' },
      });
      await quandle_main_run_action(runtime);
      expect(runtime.failures).toEqual([]);
    });

    it('[OUT-6] sets all four outputs from the new findings only for the critical mock scenario', async () => {
      const runtime = buildFakeRuntime({ inputs: { mock: 'true', 'mock-scenario': 'critical' } });
      await quandle_main_run_action(runtime);
      expect(runtime.outputs).toEqual({
        'new-findings': 1,
        critical: 1,
        'scan-id': 'mock-critical',
        status: 'mock',
      });
    });

    it('[OUT-6] counts zero new findings when the only finding is resolved', async () => {
      const runtime = buildFakeRuntime({ inputs: { mock: 'true', 'mock-scenario': 'fixed' } });
      await quandle_main_run_action(runtime);
      expect(runtime.outputs).toEqual({
        'new-findings': 0,
        critical: 0,
        'scan-id': 'mock-fixed',
        status: 'mock',
      });
    });
  });
});
