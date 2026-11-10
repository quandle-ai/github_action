// ==========================================================================
// Quandle GitHub Action · test/main/quandle_main_run_action/config-errors.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/main.ts → quandle_main_run_action (config errors)
// Also covers (private): quandle_main_read_actionInputs, quandle_main_parse_bypassSecret,
//   quandle_main_finish_withoutScan, quandle_main_set_noScanOutputs
//
// Proves invalid inputs and invalid scan targets fail the job with one fix hint
// each, set status config-error on all four outputs, and write "Not scanned"; a
// bypass-secret over the engine's 256 bytes is one, and its message never holds the secret.
// Rules: ERR-1, OUT-1, OUT-6, TGT-6, TRU-5
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_main_run_action } from '../../../src/main';
import { buildFakeRuntime } from '../../helpers/fake-runtime';
import { noScanOutputs } from '../../helpers/run-action-fixtures';

describe('quandle_main_run_action', () => {
  describe('config errors', () => {
    it('[ERR-1] fails the job with one fix hint per invalid input and does not scan', async () => {
      const runtime = buildFakeRuntime({ inputs: { 'fail-on': 'sometimes', comment: 'yes', mock: 'maybe' } });
      await quandle_main_run_action(runtime);
      expect(runtime.failures).toHaveLength(3);
      expect(runtime.failures.join('\n')).toContain('fail-on');
      expect(runtime.failures.join('\n')).toContain('`comment`');
      expect(runtime.failures.join('\n')).toContain('`mock`');
    });

    it('[ERR-1] rejects an unknown mock-scenario as a config error', async () => {
      const runtime = buildFakeRuntime({ inputs: { 'mock-scenario': 'explode' } });
      await quandle_main_run_action(runtime);
      expect(runtime.failures).toEqual([expect.stringContaining('mock-scenario')]);
    });

    it('[TGT-6] fails the job with the url hint when workflow_dispatch has no url input', async () => {
      const runtime = buildFakeRuntime({ inputs: { url: '' } });
      await quandle_main_run_action(runtime);
      expect(runtime.failures).toEqual([expect.stringContaining('`url`')]);
    });

    describe('bypass-secret length (engine limit: 256 bytes)', () => {
      const TOO_LONG_MESSAGE =
        'Quandle: `bypass-secret` is too long (the engine accepts at most 256 bytes); ' +
        'check that the secret holds only the bypass value.';
      // Built from a code point so the source holds no literal non-ASCII character.
      const TWO_BYTE_E_ACUTE = String.fromCodePoint(0xe9);

      it('[ERR-1] fails the job with the bypass-secret length hint for a 257-byte bypass-secret', async () => {
        const runtime = buildFakeRuntime({ inputs: { 'bypass-secret': 'x'.repeat(257) } });
        await quandle_main_run_action(runtime);
        expect(runtime.failures).toEqual([TOO_LONG_MESSAGE]);
      });

      it('[ERR-1] sets status config-error and does not scan when the bypass-secret is 257 bytes', async () => {
        const runtime = buildFakeRuntime({ inputs: { 'bypass-secret': 'x'.repeat(257) } });
        await quandle_main_run_action(runtime);
        expect(runtime.outputs).toEqual(noScanOutputs('config-error'));
      });

      it('[ERR-1] counts bytes, not characters: 129 two-byte characters (258 bytes) is too long', async () => {
        const runtime = buildFakeRuntime({ inputs: { 'bypass-secret': TWO_BYTE_E_ACUTE.repeat(129) } });
        await quandle_main_run_action(runtime);
        expect(runtime.failures).toEqual([TOO_LONG_MESSAGE]);
      });

      it('[ERR-1] accepts a bypass-secret of exactly 256 bytes', async () => {
        const runtime = buildFakeRuntime({ inputs: { 'bypass-secret': 'x'.repeat(256) } });
        await quandle_main_run_action(runtime);
        expect(runtime.failures).toEqual([]);
      });

      it('[TRU-5] never puts a too-long bypass-secret into the failure message or summary', async () => {
        const secret = `FAKE_BYPASS_${'x'.repeat(300)}`;
        const runtime = buildFakeRuntime({ inputs: { 'bypass-secret': secret } });
        await quandle_main_run_action(runtime);
        const written = [...runtime.failures, ...runtime.warnings, ...runtime.summaries].join('\n');
        expect(written).not.toContain('FAKE_BYPASS_');
      });
    });

    it('[OUT-6] sets all four outputs with status config-error when an input is invalid', async () => {
      const runtime = buildFakeRuntime({ inputs: { 'fail-on': 'sometimes' } });
      await quandle_main_run_action(runtime);
      expect(runtime.outputs).toEqual(noScanOutputs('config-error'));
    });

    it('[OUT-6] sets all four outputs with status config-error when the scan target is invalid', async () => {
      const runtime = buildFakeRuntime({ inputs: { url: '' } });
      await quandle_main_run_action(runtime);
      expect(runtime.outputs).toEqual(noScanOutputs('config-error'));
    });

    it('[OUT-1] writes a Not scanned job summary when the configuration is invalid', async () => {
      const runtime = buildFakeRuntime({ inputs: { 'fail-on': 'sometimes' } });
      await quandle_main_run_action(runtime);
      expect(runtime.summaries).toEqual([expect.stringContaining('**Not scanned:** invalid configuration')]);
    });
  });
});
