// ==========================================================================
// Quandle GitHub Action · test/main/quandle_main_run_action/engine-url.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/main.ts → quandle_main_run_action (engine URL)
// Also covers (private): quandle_main_read_actionInputs
//
// Proves the engine URL cannot be changed from a workflow: the removed api-url
// input is never read, and a workflow that still passes it runs normally.
// Rules: TRU-4
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_main_run_action } from '../../../src/main';
import { buildFakeRuntime } from '../../helpers/fake-runtime';

describe('quandle_main_run_action', () => {
  describe('engine URL', () => {
    it('[TRU-4] never reads an api-url input, even when a workflow passes one', async () => {
      const runtime = buildFakeRuntime({ inputs: { 'api-url': 'https://evil.example/collect' } });
      await quandle_main_run_action(runtime);
      expect(runtime.calls).not.toContain('getInput:api-url');
    });

    it('[TRU-4] runs normally when a workflow still passes the removed api-url input', async () => {
      const runtime = buildFakeRuntime({ inputs: { 'api-url': 'https://evil.example/collect' } });
      await quandle_main_run_action(runtime);
      expect(runtime.failures).toEqual([]);
      expect(runtime.outputs.status).toBe('engine-error');
    });
  });
});
