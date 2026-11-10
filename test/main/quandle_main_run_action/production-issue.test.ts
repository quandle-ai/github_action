// ==========================================================================
// Quandle GitHub Action · test/main/quandle_main_run_action/production-issue.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/main.ts → quandle_main_run_action (production issue)
// Also covers (private): quandle_main_publish_results, quandle_main_publish_productionIssue
//
// Proves Scan now/schedule runs and production deploys with no open PR keep one
// production issue: opened for a new or baseline exposure, rewritten when it
// changes, never a spoofed one, rewritten and closed once everything is fixed. A
// non-production deploy with no PR, a production deploy that has a PR, issue:
// false and not-scanned runs leave it alone. Any GitHub failure only warns.
// Rules: ERR-4, MOCK-2, OUT-4, OUT-10, OUT-12, PRM-2, PRM-3, TGT-6, TGT-11
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_issue_decide_action } from '../../../src/report/issue';
import { quandle_main_run_action } from '../../../src/main';
import { quandle_mock_build_scanResult } from '../../../src/scan/mock';
import { ISSUE_MARKER, quandle_render_build_productionIssue } from '../../../src/report/render';
import type { EventContext } from '../../../src/types';
import { buildIgnoreOutcome, withNoIgnores } from '../../helpers/builders';
import { BOT_LOGIN } from '../../helpers/fake-github';
import type { FakeRuntimeOptions } from '../../helpers/fake-runtime';
import { buildFakeRuntime } from '../../helpers/fake-runtime';

const CRITICAL_MOCK = { mock: 'true', 'mock-scenario': 'critical' };
const OUR_ISSUE = { number: 12, body: `${ISSUE_MARKER}\nold`, authorLogin: BOT_LOGIN };

function deployEvent(isProduction: boolean): EventContext {
  return {
    eventName: 'deployment_status',
    sha: 'deploy-sha',
    payload: {
      deployment_status: { state: 'success', environment_url: 'https://app.example.com/' },
      deployment: { sha: 'deploy-sha', environment: 'Production', production_environment: isProduction },
    },
  };
}

// Scan now (workflow_dispatch) with the critical mock unless told otherwise.
function buildScanNowRuntime(options: FakeRuntimeOptions = {}): ReturnType<typeof buildFakeRuntime> {
  return buildFakeRuntime({ ...options, inputs: { ...CRITICAL_MOCK, ...options.inputs } });
}

describe('quandle_main_run_action', () => {
  describe('production issue', () => {
    it('[OUT-4] keeps exactly one production issue, titled "🚨 Quandle: production exposures"', async () => {
      const runtime = buildScanNowRuntime();
      await quandle_main_run_action(runtime);
      expect(runtime.github.issueTitles).toEqual(['🚨 Quandle: production exposures']);
    });

    it('[TGT-6] opens the production issue for a Scan now run with a new critical finding', async () => {
      const runtime = buildScanNowRuntime();
      await quandle_main_run_action(runtime);
      expect(runtime.github.written).toEqual([
        {
          method: 'createIssue',
          target: expect.any(Number),
          body: expect.stringContaining('1 exposure in production'),
        },
      ]);
      expect(runtime.github.issueTitles).toEqual(['🚨 Quandle: production exposures']);
    });

    it('[OUT-12] opens the production issue for the first-scan baseline (already-present)', async () => {
      const runtime = buildScanNowRuntime({ inputs: { 'mock-scenario': 'first-scan' } });
      await quandle_main_run_action(runtime);
      expect(runtime.github.written.map((write) => write.method)).toEqual(['createIssue']);
    });

    it('[OUT-10] rewrites our open issue instead of opening a second one', async () => {
      const runtime = buildScanNowRuntime({ github: { issues: [OUR_ISSUE] } });
      await quandle_main_run_action(runtime);
      expect(runtime.github.written).toEqual([
        { method: 'updateIssue', target: 12, body: expect.stringContaining(ISSUE_MARKER) },
      ]);
    });

    it('[OUT-10] opens its own issue instead of editing a spoofed one with our marker', async () => {
      const spoofed = { number: 13, body: `${ISSUE_MARKER}\nclose me`, authorLogin: 'mallory' };
      const runtime = buildScanNowRuntime({ github: { issues: [spoofed] } });
      await quandle_main_run_action(runtime);
      expect(runtime.github.written.map((write) => write.method)).toEqual(['createIssue']);
    });

    it('[OUT-12] leaves our issue untouched when its text would not change', async () => {
      const result = quandle_mock_build_scanResult('critical', 'https://app.example.com/', 'production');
      const body = quandle_render_build_productionIssue(...withNoIgnores({ ...result, status: 'scanned' }));
      expect(
        quandle_issue_decide_action(
          { ...OUR_ISSUE, body },
          body,
          buildIgnoreOutcome({ shown: result.findings }),
        ).kind,
      ).toBe('leave');
      const runtime = buildScanNowRuntime({ github: { issues: [{ ...OUR_ISSUE, body }] } });
      await quandle_main_run_action(runtime);
      expect(runtime.github.written).toEqual([]);
    });

    it('[OUT-12] rewrites our issue to say everything is fixed, then closes it', async () => {
      const runtime = buildScanNowRuntime({
        inputs: { 'mock-scenario': 'fixed' },
        github: { issues: [OUR_ISSUE] },
      });
      await quandle_main_run_action(runtime);
      expect(runtime.github.written).toEqual([
        {
          method: 'updateIssue',
          target: 12,
          body: expect.stringContaining('no exposures left in production'),
        },
        { method: 'closeIssue', target: 12, body: '' },
      ]);
    });

    it('[OUT-12] opens nothing for a clean Scan now run when there is no issue', async () => {
      const runtime = buildScanNowRuntime({ inputs: { 'mock-scenario': 'clean' } });
      await quandle_main_run_action(runtime);
      expect(runtime.github.written).toEqual([]);
    });

    it('[MOCK-2] puts the mock banner in a mock production issue', async () => {
      const runtime = buildScanNowRuntime();
      await quandle_main_run_action(runtime);
      expect(runtime.github.written[0]?.body).toContain('MOCK RESULTS');
    });
  });

  describe('which deploys reach the production issue', () => {
    it('[TGT-11] opens the production issue for a production deploy with no open PR', async () => {
      const runtime = buildScanNowRuntime({ event: deployEvent(true) });
      await quandle_main_run_action(runtime);
      expect(runtime.github.written.map((write) => write.method)).toEqual(['createIssue']);
    });

    it('[TGT-11] comments on the PR instead when a production deploy has an open PR on that commit', async () => {
      const runtime = buildScanNowRuntime({
        event: deployEvent(true),
        github: { pullRequests: [{ number: 7, isOpen: true, headSha: 'deploy-sha' }] },
      });
      await quandle_main_run_action(runtime);
      expect(runtime.github.written.map((write) => write.method)).toEqual(['create']);
    });

    it('[TGT-11] keeps a non-production deploy with no open PR out of the production issue', async () => {
      const runtime = buildScanNowRuntime({ event: deployEvent(false) });
      await quandle_main_run_action(runtime);
      expect(runtime.github.calls).not.toContain('listOpenIssues');
      expect(runtime.github.written).toEqual([]);
    });

    it('[TGT-11] still checks for an open PR on a production deploy when comment is false', async () => {
      const runtime = buildScanNowRuntime({ event: deployEvent(true), inputs: { comment: 'false' } });
      await quandle_main_run_action(runtime);
      expect(runtime.github.calls).toContain('listPullRequestsForCommit:deploy-sha');
      expect(runtime.github.written.map((write) => write.method)).toEqual(['createIssue']);
    });
  });

  describe('when no production issue is touched', () => {
    it('[PRM-2] makes no issue call when issue is false', async () => {
      const runtime = buildScanNowRuntime({ inputs: { issue: 'false' } });
      await quandle_main_run_action(runtime);
      expect(runtime.github.calls).toEqual(['readIgnoreFile']);
    });

    it('[ERR-4] leaves the production issue untouched when the scan did not happen', async () => {
      const runtime = buildScanNowRuntime({ inputs: { mock: 'false' }, github: { issues: [OUR_ISSUE] } });
      await quandle_main_run_action(runtime);
      expect(runtime.github.calls).toEqual([]);
    });
  });

  describe('when GitHub fails', () => {
    it.each(['listOpenIssues', 'createIssue'] as const)(
      '[PRM-3] warns and keeps the job result when %s fails',
      async (failingMethod) => {
        const runtime = buildScanNowRuntime({
          github: { failingMethod, failureReason: 'GitHub API returned 503' },
        });
        await quandle_main_run_action(runtime);
        expect(runtime.failures).toEqual([
          expect.stringContaining('new or no longer ignored findings at or above'),
        ]);
        expect(runtime.warnings).toContainEqual(
          'Quandle: could not update the production issue (GitHub API returned 503).',
        );
      },
    );

    it('[PRM-3] warns when closing the fixed issue fails, after rewriting it', async () => {
      const runtime = buildScanNowRuntime({
        inputs: { 'mock-scenario': 'fixed' },
        github: {
          issues: [OUR_ISSUE],
          failingMethod: 'closeIssue',
          failureReason: 'GitHub API returned 502',
        },
      });
      await quandle_main_run_action(runtime);
      expect(runtime.github.written.map((write) => write.method)).toEqual(['updateIssue']);
      expect(runtime.warnings).toContainEqual(
        'Quandle: could not update the production issue (GitHub API returned 502).',
      );
    });

    it('[PRM-3] warns about the production issue when the GitHub API cannot be built for a Scan now run', async () => {
      const runtime = buildScanNowRuntime({
        gitHubUnavailableReason: 'GITHUB_REPOSITORY is not set to owner/repo',
      });
      await quandle_main_run_action(runtime);
      expect(runtime.warnings).toContainEqual(
        'Quandle: could not update the production issue (GITHUB_REPOSITORY is not set to owner/repo).',
      );
      expect(runtime.warnings.join('\n')).not.toContain('PR comment');
    });

    it('[PRM-3] warns about the production issue when the PR lookup fails on a production deploy', async () => {
      const runtime = buildScanNowRuntime({
        event: deployEvent(true),
        inputs: { comment: 'false' },
        github: { failingMethod: 'listPullRequestsForCommit', failureReason: 'GitHub API returned 503' },
      });
      await quandle_main_run_action(runtime);
      expect(runtime.warnings).toContainEqual(
        'Quandle: could not update the production issue (GitHub API returned 503).',
      );
    });
  });
});
