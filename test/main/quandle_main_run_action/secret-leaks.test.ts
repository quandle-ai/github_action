// ==========================================================================
// Quandle GitHub Action · test/main/quandle_main_run_action/secret-leaks.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/main.ts → quandle_main_run_action (secret leaks)
// Also covers (private): every output path in main.ts
//
// Proves, across every kind of run, that neither the bypass secret nor the GitHub
// token ever appears in any output: log line, warning, failure, job summary,
// PR comment, production issue or Action output. The fake runtime records a leak whenever one does.
// Rules: TRU-5
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_main_run_action } from '../../../src/main';
import type { FakeRuntimeOptions } from '../../helpers/fake-runtime';
import { buildFakeRuntime } from '../../helpers/fake-runtime';
import { PENDING_DEPLOYMENT } from '../../helpers/run-action-fixtures';

const SECRETS = { 'bypass-secret': 'FAKE_BYPASS_SECRET_VALUE', 'github-token': 'FAKE_GITHUB_TOKEN_VALUE' };

const RUNS: [string, FakeRuntimeOptions][] = [
  ['a clean mock scan', { inputs: { mock: 'true', 'mock-scenario': 'clean' } }],
  ['a critical mock scan that fails the job', { inputs: { mock: 'true', 'mock-scenario': 'critical' } }],
  ['an engine-error run', {}],
  ['a config error', { inputs: { 'fail-on': 'sometimes' } }],
  ['a missing url on Scan now', { inputs: { url: '' } }],
  ['a skipped deployment', { event: PENDING_DEPLOYMENT }],
  [
    'a Scan now run that opens the production issue',
    { inputs: { mock: 'true', 'mock-scenario': 'critical' } },
  ],
  [
    'a critical deploy that comments on a PR',
    {
      event: {
        eventName: 'deployment_status',
        sha: 'deploy-sha',
        payload: {
          deployment_status: { state: 'success', environment_url: 'https://preview.example.com/' },
          deployment: { sha: 'deploy-sha' },
        },
      },
      inputs: { mock: 'true', 'mock-scenario': 'critical' },
      github: { pullRequests: [{ number: 7, isOpen: true, headSha: 'deploy-sha' }] },
    },
  ],
  ['an internal error', { failingInput: 'fail-on' }],
  [
    'a failed summary write',
    { inputs: { mock: 'true', 'mock-scenario': 'critical' }, failingMethod: 'writeSummary' },
  ],
];

describe('quandle_main_run_action', () => {
  describe('secret leaks', () => {
    it.each(RUNS)('[TRU-5] never puts a secret in any output on %s', async (_name, options) => {
      const runtime = buildFakeRuntime({ ...options, inputs: { ...SECRETS, ...options.inputs } });
      await quandle_main_run_action(runtime);
      expect(runtime.leaks).toEqual([]);
      for (const write of runtime.github.written) {
        for (const secret of Object.values(SECRETS)) expect(write.body).not.toContain(secret);
      }
    });

    it('[TRU-5] the leak detector itself catches a secret in a warning', () => {
      const runtime = buildFakeRuntime({ inputs: SECRETS });
      runtime.warning(`oops ${SECRETS['github-token']}`);
      expect(runtime.leaks).toEqual([`warning: oops ${SECRETS['github-token']}`]);
    });
  });
});
