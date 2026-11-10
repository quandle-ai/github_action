// ==========================================================================
// Quandle GitHub Action · test/main/quandle_main_run_action/engine.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/main.ts → quandle_main_run_action (a real engine scan, through a fake engine)
// Also covers (private): none
//
// Proves a run that is not a mock scans through the engine: a clean answer is
// status scanned with the engine's scan id; a new critical finding fails the job;
// a protected answer and a missing OIDC token keep the job green with our own
// fixed reason; and the OIDC token never appears in any output.
// Rules: SEV-2, TRU-5, TRU-7, TRU-8
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_main_run_action } from '../../../src/main';
import { engineAnswer } from '../../helpers/fake-engine';
import { buildFakeRuntime } from '../../helpers/fake-runtime';

const CRITICAL_FINDING = {
  id: 'qf_engine01',
  rule: 'secret/test',
  severity: 'critical',
  state: 'new',
  title: 'Test secret in shipped JavaScript',
  location: 'https://app.example.com/assets/index.js',
  evidence: 'FAKE…REDACTED',
};

describe('quandle_main_run_action', () => {
  describe('a real engine scan', () => {
    it('[TRU-7] reports status scanned and the engine scan id for a clean engine answer', async () => {
      const respond = engineAnswer({ status: 'scanned', scanId: 'scan_engine01', findings: [] });
      const runtime = buildFakeRuntime({ engine: { respond } });
      await quandle_main_run_action(runtime);
      expect(runtime.outputs).toEqual({
        'new-findings': 0,
        critical: 0,
        'scan-id': 'scan_engine01',
        status: 'scanned',
      });
      expect(runtime.failures).toEqual([]);
    });

    it('[SEV-2] fails the job when the engine reports a new critical finding', async () => {
      const respond = engineAnswer({
        status: 'scanned',
        scanId: 'scan_engine02',
        findings: [CRITICAL_FINDING],
      });
      const runtime = buildFakeRuntime({ engine: { respond } });
      await quandle_main_run_action(runtime);
      expect(runtime.failures).toHaveLength(1);
      expect(runtime.outputs).toMatchObject({ 'new-findings': 1, critical: 1, status: 'scanned' });
    });

    it('[TRU-7] keeps the job green with our fixed reason when the engine answers protected', async () => {
      const respond = engineAnswer({ status: 'protected', scanId: 'scan_engine03', findings: [] });
      const runtime = buildFakeRuntime({ engine: { respond } });
      await quandle_main_run_action(runtime);
      expect(runtime.failures).toEqual([]);
      expect(runtime.warnings).toContain(
        'Quandle: not scanned, the deploy is protected; set `bypass-secret` to scan it.',
      );
      expect(runtime.outputs).toMatchObject({ status: 'protected', 'scan-id': 'scan_engine03' });
    });

    it('[TRU-8] keeps the job green and names id-token: write when no OIDC token can be had', async () => {
      const runtime = buildFakeRuntime({ engine: { isTokenUnavailable: true } });
      await quandle_main_run_action(runtime);
      expect(runtime.failures).toEqual([]);
      expect(runtime.warnings).toContain(
        'Quandle: not scanned, could not get a GitHub OIDC token; the workflow needs `id-token: write`.',
      );
      expect(runtime.calls).not.toContain('fetch');
    });

    it('[TRU-5] never shows the OIDC token in any output, on a run with a finding', async () => {
      const respond = engineAnswer({
        status: 'scanned',
        scanId: 'scan_engine04',
        findings: [CRITICAL_FINDING],
      });
      const runtime = buildFakeRuntime({ engine: { respond } });
      await quandle_main_run_action(runtime);
      expect(runtime.leaks).toEqual([]);
    });
  });
});
