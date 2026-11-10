// ==========================================================================
// Quandle GitHub Action · test/main/quandle_main_run_action/skips.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/main.ts → quandle_main_run_action (skips)
// Also covers (private): quandle_main_finish_withoutScan, quandle_main_set_noScanOutputs
//
// Proves a skipped run is quiet (no warning, no failure), writes one
// "Not scanned" line, and sets status skipped on all four outputs.
// Rules: OUT-6, TGT-3
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_main_run_action } from '../../../src/main';
import { buildFakeRuntime } from '../../helpers/fake-runtime';
import { noScanOutputs, PENDING_DEPLOYMENT } from '../../helpers/run-action-fixtures';

describe('quandle_main_run_action', () => {
  describe('skips', () => {
    it('[TGT-3] skips quietly with no warnings or failures when the deployment did not succeed', async () => {
      const runtime = buildFakeRuntime({ event: PENDING_DEPLOYMENT });
      await quandle_main_run_action(runtime);
      expect(runtime.failures).toEqual([]);
      expect(runtime.warnings).toEqual([]);
    });

    it('[TGT-3] writes exactly one Not scanned line with the reason when skipping', async () => {
      const runtime = buildFakeRuntime({ event: PENDING_DEPLOYMENT });
      await quandle_main_run_action(runtime);
      expect(runtime.summaries).toHaveLength(1);
      expect(runtime.summaries[0]?.match(/\*\*Not scanned:\*\*/g)).toHaveLength(1);
      expect(runtime.summaries[0]).toContain('**Not scanned:** the deployment did not succeed');
    });

    it('[TGT-3] logs exactly one info line with the skip reason, and nothing louder', async () => {
      const runtime = buildFakeRuntime({ event: PENDING_DEPLOYMENT });
      await quandle_main_run_action(runtime);
      expect(runtime.infos).toEqual(['Quandle: skipping, the deployment did not succeed.']);
    });

    it('[OUT-6] sets all four outputs with status skipped when skipping', async () => {
      const runtime = buildFakeRuntime({ event: PENDING_DEPLOYMENT });
      await quandle_main_run_action(runtime);
      expect(runtime.outputs).toEqual(noScanOutputs('skipped'));
    });
  });
});
