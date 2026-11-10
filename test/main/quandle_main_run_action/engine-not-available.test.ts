// ==========================================================================
// Quandle GitHub Action · test/main/quandle_main_run_action/engine-not-available.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/main.ts → quandle_main_run_action (engine not available)
// Also covers (private): quandle_main_set_jobResult, quandle_main_set_scanOutputs
//
// Proves that with no engine the job fails open: green, warned, "Not scanned",
// and status engine-error on all four outputs.
// Rules: MOCK-4, OUT-6, TGT-1
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_main_run_action } from '../../../src/main';
import { buildFakeRuntime } from '../../helpers/fake-runtime';
import { noScanOutputs } from '../../helpers/run-action-fixtures';

describe('quandle_main_run_action', () => {
  describe('engine not available', () => {
    it('[MOCK-4] keeps the job green, warns, and says Not scanned when the engine is not available yet', async () => {
      const runtime = buildFakeRuntime();
      await quandle_main_run_action(runtime);
      expect(runtime.failures).toEqual([]);
      expect(runtime.warnings).toEqual([expect.stringContaining('not scanned')]);
      expect(runtime.summaries).toEqual([expect.stringContaining('**Not scanned:**')]);
    });

    it('[OUT-6] sets all four outputs with status engine-error when the engine is not available yet', async () => {
      const runtime = buildFakeRuntime();
      await quandle_main_run_action(runtime);
      expect(runtime.outputs).toEqual(noScanOutputs('engine-error'));
    });

    it('[TGT-1] sends a deployment with no environment name to the engine without guessing one', async () => {
      const runtime = buildFakeRuntime({
        event: {
          eventName: 'deployment_status',
          sha: 'context-sha',
          payload: {
            deployment_status: { state: 'success', environment_url: 'https://preview.example.com/' },
          },
        },
      });
      await quandle_main_run_action(runtime);
      expect(runtime.outputs.status).toBe('engine-error');
      expect(runtime.summaries.join(' ')).not.toContain('environment');
    });
  });
});
