// ==========================================================================
// Quandle GitHub Action · test/main/quandle_main_run_action/secrets.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/main.ts → quandle_main_run_action (secrets)
// Also covers (private): quandle_main_mask_secretInputs
//
// Proves the secret inputs are read once and masked before any other input is
// read, and empty secrets are not registered.
// Rules: TRU-5
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_main_run_action } from '../../../src/main';
import { buildFakeRuntime } from '../../helpers/fake-runtime';
import { FAKE_OIDC_TOKEN } from '../../helpers/fake-engine';

// How many secrets were masked before the call at this position.
function masksBefore(calls: readonly string[], position: number): number {
  return calls.slice(0, position).filter((call) => call === 'setSecret').length;
}

describe('quandle_main_run_action', () => {
  describe('secrets', () => {
    it('[TRU-5] masks bypass-secret and github-token before reading any other input', async () => {
      const runtime = buildFakeRuntime({ inputs: { 'bypass-secret': 'FAKE_BYPASS' } });
      await quandle_main_run_action(runtime);
      // The two input secrets first; the OIDC token later, the moment it is fetched.
      expect(runtime.secrets).toEqual(['FAKE_BYPASS', 'FAKE_GITHUB_TOKEN', FAKE_OIDC_TOKEN]);
      const firstOtherInput = runtime.calls.findIndex(
        (call) =>
          call.startsWith('getInput:') && !['getInput:bypass-secret', 'getInput:github-token'].includes(call),
      );
      expect(masksBefore(runtime.calls, firstOtherInput)).toBe(2);
    });

    it('[TRU-5] does not register empty secret inputs as secrets', async () => {
      const runtime = buildFakeRuntime({ inputs: { 'github-token': '' } });
      await quandle_main_run_action(runtime);
      // Only the OIDC token: no empty bypass-secret or github-token is registered.
      expect(runtime.secrets).toEqual([FAKE_OIDC_TOKEN]);
    });

    it('[TRU-5] masks the secrets before reading the GitHub event', async () => {
      const runtime = buildFakeRuntime({ inputs: { 'bypass-secret': 'FAKE_BYPASS' } });
      await quandle_main_run_action(runtime);
      expect(masksBefore(runtime.calls, runtime.calls.indexOf('readEvent'))).toBe(2);
    });

    it('[TRU-5] reads each secret input exactly once', async () => {
      const runtime = buildFakeRuntime({ inputs: { 'bypass-secret': 'FAKE_BYPASS' } });
      await quandle_main_run_action(runtime);
      expect(runtime.calls.filter((call) => call === 'getInput:bypass-secret')).toHaveLength(1);
      expect(runtime.calls.filter((call) => call === 'getInput:github-token')).toHaveLength(1);
    });
  });
});
