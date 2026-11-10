// ==========================================================================
// Quandle GitHub Action · test/main/quandle_main_run_action/summary-best-effort.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/main.ts → quandle_main_run_action (job summary is best effort)
// Also covers (private): quandle_main_write_summaryBestEffort, quandle_main_set_jobResult, quandle_main_set_scanOutputs
//
// Proves the job result and all outputs are set before the summary is written,
// and that a failed summary write never hides a finding, never becomes an
// internal error, and never prints the error.
// Rules: OUT-1
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_main_run_action } from '../../../src/main';
import { buildFakeRuntime, LEAKY_ERROR_TEXT } from '../../helpers/fake-runtime';

describe('quandle_main_run_action', () => {
  describe('job summary is best effort', () => {
    it('[OUT-1] sets the job result and all outputs before writing the summary', async () => {
      const runtime = buildFakeRuntime({ inputs: { mock: 'true', 'mock-scenario': 'critical' } });
      await quandle_main_run_action(runtime);
      const summaryAt = runtime.calls.indexOf('writeSummary');
      expect(runtime.calls.indexOf('setFailed')).toBeLessThan(summaryAt);
      for (const name of ['new-findings', 'critical', 'scan-id', 'status']) {
        expect(runtime.calls.indexOf(`setOutput:${name}`)).toBeLessThan(summaryAt);
      }
    });

    it('[OUT-1] keeps the job failed for a new critical finding even when writing the summary throws', async () => {
      const runtime = buildFakeRuntime({
        inputs: { mock: 'true', 'mock-scenario': 'critical' },
        failingMethod: 'writeSummary',
      });
      await quandle_main_run_action(runtime);
      expect(runtime.failures).toEqual([expect.stringContaining('critical')]);
      expect(runtime.outputs).toEqual({
        'new-findings': 1,
        critical: 1,
        'scan-id': 'mock-critical',
        status: 'mock',
      });
    });

    it('[OUT-1] warns that the summary could not be written instead of reporting an internal error', async () => {
      const runtime = buildFakeRuntime({
        inputs: { mock: 'true', 'mock-scenario': 'critical' },
        failingMethod: 'writeSummary',
      });
      await quandle_main_run_action(runtime);
      expect(runtime.warnings).toEqual([
        expect.stringContaining('mock mode'),
        expect.stringContaining('summary could not be written'),
      ]);
      expect(runtime.warnings.join('\n')).not.toContain('internal error');
    });

    it('[OUT-1] never prints the error when writing the summary fails', async () => {
      const runtime = buildFakeRuntime({ inputs: { mock: 'true' }, failingMethod: 'writeSummary' });
      await quandle_main_run_action(runtime);
      expect(JSON.stringify(runtime)).not.toContain(LEAKY_ERROR_TEXT);
    });

    it('[OUT-1] keeps a not-scanned run green with its warning even when writing the summary throws', async () => {
      const runtime = buildFakeRuntime({ failingMethod: 'writeSummary' });
      await quandle_main_run_action(runtime);
      expect(runtime.failures).toEqual([]);
      expect(runtime.outputs.status).toBe('engine-error');
      expect(runtime.warnings).toEqual([
        expect.stringContaining('not scanned'),
        expect.stringContaining('summary could not be written'),
      ]);
    });
  });
});
