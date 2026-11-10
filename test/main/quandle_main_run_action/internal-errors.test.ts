// ==========================================================================
// Quandle GitHub Action · test/main/quandle_main_run_action/internal-errors.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/main.ts → quandle_main_run_action (internal errors)
// Also covers (private): quandle_main_report_internalError, quandle_main_finish_withoutScan
//
// Proves an internal bug fails open with a fixed message that says where to
// report it, sets status internal-error, never prints the original error, and
// that reporting it can never throw.
// Rules: ERR-3, OUT-6
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_main_run_action } from '../../../src/main';
import { buildFakeRuntime, LEAKY_ERROR_TEXT } from '../../helpers/fake-runtime';
import { ISSUES_URL, noScanOutputs } from '../../helpers/run-action-fixtures';

describe('quandle_main_run_action', () => {
  describe('internal errors', () => {
    it('[ERR-3] fails open as an internal error when the GitHub event cannot be read', async () => {
      const runtime = buildFakeRuntime({ failingMethod: 'readEvent' });
      await quandle_main_run_action(runtime);
      expect(runtime.failures).toEqual([]);
      expect(runtime.warnings).toEqual([expect.stringContaining('internal error')]);
      expect(runtime.outputs.status).toBe('internal-error');
      expect(runtime.summaries).toEqual([expect.stringContaining('**Not scanned:** internal error')]);
      expect(JSON.stringify(runtime)).not.toContain(LEAKY_ERROR_TEXT);
    });

    it('[ERR-3] fails open with a fixed message and never prints the original error', async () => {
      const runtime = buildFakeRuntime({ failingInput: 'fail-on' });
      await quandle_main_run_action(runtime);
      expect(runtime.failures).toEqual([]);
      expect(runtime.warnings).toEqual([expect.stringContaining('internal error')]);
      expect(JSON.stringify(runtime)).not.toContain(LEAKY_ERROR_TEXT);
    });

    it('[ERR-3] tells the user where to report an internal error', async () => {
      const runtime = buildFakeRuntime({ failingInput: 'fail-on' });
      await quandle_main_run_action(runtime);
      expect(runtime.warnings[0]).toContain(ISSUES_URL);
    });

    it('[OUT-6] sets all four outputs with status internal-error after an internal error', async () => {
      const runtime = buildFakeRuntime({ failingInput: 'fail-on' });
      await quandle_main_run_action(runtime);
      expect(runtime.outputs).toEqual(noScanOutputs('internal-error'));
    });

    it('[ERR-3] writes a Not scanned summary after an internal error', async () => {
      const runtime = buildFakeRuntime({ failingInput: 'fail-on' });
      await quandle_main_run_action(runtime);
      expect(runtime.summaries).toEqual([expect.stringContaining('**Not scanned:** internal error')]);
    });

    it('[ERR-3] fails open when something other than an Error is thrown', async () => {
      const runtime = buildFakeRuntime({ failingInput: 'fail-on', thrownValue: LEAKY_ERROR_TEXT });
      await quandle_main_run_action(runtime);
      expect(runtime.failures).toEqual([]);
      expect(JSON.stringify(runtime)).not.toContain(LEAKY_ERROR_TEXT);
    });

    it.each(['warning', 'setOutput'] as const)(
      '[ERR-3] never throws, even when %s fails while reporting an internal error',
      async (failingMethod) => {
        const runtime = buildFakeRuntime({ failingInput: 'fail-on', failingMethod });
        await expect(quandle_main_run_action(runtime)).resolves.toBeUndefined();
        expect(JSON.stringify(runtime)).not.toContain(LEAKY_ERROR_TEXT);
      },
    );
  });
});
