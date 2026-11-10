// ==========================================================================
// Quandle GitHub Action · test/main/quandle_main_run_action/ignore-file.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/main.ts → quandle_main_run_action (the ignore file)
// Also covers (private): quandle_main_apply_ignoreFile, quandle_main_set_scanOutputs
//
// Proves a scanned run (mock included) reads .quandle-ignore.yml once and applies
// it with the run's clock: an ignored finding does not fail the job, is not counted,
// opens no issue and is listed in the summary; an expired ignore fails the job with
// the new message; a missing file is silent; an invalid file or a failed read warns
// and ignores nothing; and a run that did not scan never reads the file.
// Rules: IGN-2, IGN-3, IGN-4, IGN-7, IGN-9, IGN-10, OUT-6, SEV-2
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_main_run_action } from '../../../src/main';
import type { FakeRuntimeOptions } from '../../helpers/fake-runtime';
import { buildFakeRuntime } from '../../helpers/fake-runtime';

// The critical mock finding is qf_mock01. The fake clock says 2026-11-09 (UTC).
const NEWLINE = String.fromCharCode(10);

function ignoreFileFor(id: string, expires: string, reason = 'Public by design'): string {
  return ['ignore:', `  - id: ${id}`, `    reason: "${reason}"`, `    expires: ${expires}`, ''].join(NEWLINE);
}

const IGNORES_THE_MOCK_LEAK = ignoreFileFor('qf_mock01', '2027-02-01');
const EXPIRED_YESTERDAY = ignoreFileFor('qf_mock01', '2026-11-08');

function buildCriticalMockRuntime(options: FakeRuntimeOptions = {}): ReturnType<typeof buildFakeRuntime> {
  return buildFakeRuntime({
    ...options,
    inputs: { mock: 'true', 'mock-scenario': 'critical', ...options.inputs },
  });
}

const READ_FAILURE_PREFIX = 'Quandle: could not read .quandle-ignore.yml';

describe('quandle_main_run_action', () => {
  describe('the ignore file', () => {
    it('[IGN-9] reads the ignore file once after a scan', async () => {
      const runtime = buildCriticalMockRuntime();
      await quandle_main_run_action(runtime);
      expect(runtime.github.calls.filter((call) => call === 'readIgnoreFile')).toHaveLength(1);
    });

    it('[IGN-9] does not read the ignore file when the run is skipped (a push event)', async () => {
      const runtime = buildFakeRuntime({ event: { eventName: 'push', sha: 'push-sha', payload: {} } });
      await quandle_main_run_action(runtime);
      expect(runtime.github.calls).not.toContain('readIgnoreFile');
    });

    it('[IGN-9] does not read the ignore file when the engine did not scan', async () => {
      const runtime = buildFakeRuntime({ github: { ignoreFile: IGNORES_THE_MOCK_LEAK } });
      await quandle_main_run_action(runtime);
      expect(runtime.outputs.status).not.toBe('scanned');
      expect(runtime.github.calls).not.toContain('readIgnoreFile');
    });

    it('[IGN-3] applies the ignore file to mock results: the ignored critical mock finding keeps the job green', async () => {
      const runtime = buildCriticalMockRuntime({ github: { ignoreFile: IGNORES_THE_MOCK_LEAK } });
      await quandle_main_run_action(runtime);
      expect(runtime.failures).toEqual([]);
    });

    it('[OUT-6] sets new-findings 0 and critical 0 when the only new critical finding is ignored', async () => {
      const runtime = buildCriticalMockRuntime({ github: { ignoreFile: IGNORES_THE_MOCK_LEAK } });
      await quandle_main_run_action(runtime);
      expect(runtime.outputs['new-findings']).toBe(0);
      expect(runtime.outputs.critical).toBe(0);
    });

    it('[IGN-10] lists the ignored finding by id with its reason in the job summary', async () => {
      const runtime = buildCriticalMockRuntime({ github: { ignoreFile: IGNORES_THE_MOCK_LEAK } });
      await quandle_main_run_action(runtime);
      expect(runtime.summaries[0]).toContain('**Ignored (1)**');
      expect(runtime.summaries[0]).toContain('- `qf_mock01` · Public by design');
    });

    it('[IGN-10] opens no production issue when the only finding is ignored', async () => {
      const runtime = buildCriticalMockRuntime({ github: { ignoreFile: IGNORES_THE_MOCK_LEAK } });
      await quandle_main_run_action(runtime);
      expect(runtime.github.written).toEqual([]);
    });

    it('[SEV-2] fails the job with "new or no longer ignored findings" when the ignore expired yesterday', async () => {
      const runtime = buildCriticalMockRuntime({ github: { ignoreFile: EXPIRED_YESTERDAY } });
      await quandle_main_run_action(runtime);
      expect(runtime.failures).toEqual([
        'Quandle: this deploy has new or no longer ignored findings at or above fail-on "critical".',
      ]);
    });

    it('[IGN-2] marks the finding "ignore expired 2026-11-08" in the summary when its ignore expired', async () => {
      const runtime = buildCriticalMockRuntime({ github: { ignoreFile: EXPIRED_YESTERDAY } });
      await quandle_main_run_action(runtime);
      expect(runtime.summaries[0]).toContain(' · ignore expired 2026-11-08');
    });

    it('[OUT-6] counts a new critical finding whose ignore expired once: new-findings 1, critical 1', async () => {
      const runtime = buildCriticalMockRuntime({ github: { ignoreFile: EXPIRED_YESTERDAY } });
      await quandle_main_run_action(runtime);
      expect(runtime.outputs['new-findings']).toBe(1);
      expect(runtime.outputs.critical).toBe(1);
    });

    it('[IGN-7] uses the run clock: an ignore that expires 2026-11-08 still applies on a run at 23:00 UTC that day', async () => {
      const runtime = buildCriticalMockRuntime({
        github: { ignoreFile: EXPIRED_YESTERDAY },
        now: new Date('2026-11-08T23:00:00Z'),
      });
      await quandle_main_run_action(runtime);
      expect(runtime.failures).toEqual([]);
    });

    it('[IGN-9] warns nothing about the ignore file when there is none (404)', async () => {
      const runtime = buildCriticalMockRuntime();
      await quandle_main_run_action(runtime);
      expect(runtime.warnings.join(NEWLINE)).not.toContain('.quandle-ignore.yml');
    });

    it('[IGN-4] warns that the file is invalid, naming the entry and problem, and ignores nothing', async () => {
      const invalid = ['ignore:', '  - id: qf_mock01', '    expires: 2027-02-01', ''].join(NEWLINE);
      const runtime = buildCriticalMockRuntime({ github: { ignoreFile: invalid } });
      await quandle_main_run_action(runtime);
      expect(runtime.warnings).toContain(
        'Quandle: .quandle-ignore.yml is invalid, so nothing is ignored (entry 1: `reason` is required).',
      );
      expect(runtime.failures).toHaveLength(1);
    });

    it('[IGN-9] warns "could not read .quandle-ignore.yml (GitHub API returned 500), so nothing is ignored." when the read fails', async () => {
      const runtime = buildCriticalMockRuntime({
        github: { failingMethod: 'readIgnoreFile', failureReason: 'GitHub API returned 500' },
      });
      await quandle_main_run_action(runtime);
      expect(runtime.warnings).toContain(
        'Quandle: could not read .quandle-ignore.yml (GitHub API returned 500), so nothing is ignored.',
      );
      expect(runtime.failures).toHaveLength(1);
    });

    it('[IGN-9] warns that it could not read the ignore file when the GitHub API is unavailable, and ignores nothing', async () => {
      const runtime = buildCriticalMockRuntime({ gitHubUnavailableReason: 'GITHUB_REPOSITORY is not set' });
      await quandle_main_run_action(runtime);
      expect(runtime.warnings).toContain(
        'Quandle: could not read .quandle-ignore.yml (GITHUB_REPOSITORY is not set), so nothing is ignored.',
      );
      expect(runtime.failures).toHaveLength(1);
    });

    it('[IGN-9] warns only once about the ignore file when its read fails', async () => {
      const runtime = buildCriticalMockRuntime({
        github: { failingMethod: 'readIgnoreFile', failureReason: 'GitHub API returned 500' },
      });
      await quandle_main_run_action(runtime);
      expect(runtime.warnings.filter((warning) => warning.startsWith(READ_FAILURE_PREFIX))).toHaveLength(1);
    });
  });
});
