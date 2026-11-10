// ==========================================================================
// Quandle GitHub Action · test/main/quandle_main_run_action/pr-comment.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/main.ts → quandle_main_run_action (PR comment)
// Also covers (private): quandle_main_publish_prComments, quandle_main_publish_prComment
//
// Proves a deploy comments on every open PR whose head is the deployed commit (and
// on no other), updates our own comment instead of adding a second one, never edits
// a spoofed one, stays silent when it should, and that comment: false, Scan now and
// not-scanned runs make no comment. Any GitHub failure warns and the job result stands.
// Rules: ERR-4, MOCK-2, OUT-2, OUT-3, OUT-7, OUT-9, PRM-2, PRM-3, TGT-6, TRU-6
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_main_run_action } from '../../../src/main';
import { COMMENT_MARKER, quandle_render_build_prComment } from '../../../src/report/render';
import type { EventContext } from '../../../src/types';
import { quandle_mock_build_scanResult } from '../../../src/scan/mock';
import { withNoIgnores } from '../../helpers/builders';
import { BOT_LOGIN } from '../../helpers/fake-github';
import type { FakeRuntimeOptions } from '../../helpers/fake-runtime';
import { buildFakeRuntime, LEAKY_ERROR_TEXT } from '../../helpers/fake-runtime';

const DEPLOYED: EventContext = {
  eventName: 'deployment_status',
  sha: 'deploy-sha',
  payload: {
    deployment_status: { state: 'success', environment_url: 'https://preview.example.com/' },
    deployment: { sha: 'deploy-sha', environment: 'Preview' },
  },
};
const OPEN_PR = { number: 7, isOpen: true, headSha: 'deploy-sha' };
const CRITICAL_MOCK = { mock: 'true', 'mock-scenario': 'critical' };

function buildDeployRuntime(options: FakeRuntimeOptions = {}): ReturnType<typeof buildFakeRuntime> {
  return buildFakeRuntime({ event: DEPLOYED, ...options, inputs: { ...CRITICAL_MOCK, ...options.inputs } });
}

describe('quandle_main_run_action', () => {
  describe('PR comment', () => {
    it('[OUT-2] posts one comment on the open PR whose head is the deployed commit', async () => {
      const runtime = buildDeployRuntime({ github: { pullRequests: [OPEN_PR] } });
      await quandle_main_run_action(runtime);
      expect(runtime.github.written).toEqual([
        { method: 'create', target: 7, body: expect.stringContaining('this deploy exposed 1 new finding') },
      ]);
    });

    it('[OUT-2] posts its own comment on each open PR whose head is the deployed commit', async () => {
      const runtime = buildDeployRuntime({ github: { pullRequests: [OPEN_PR, { ...OPEN_PR, number: 8 }] } });
      await quandle_main_run_action(runtime);
      expect(runtime.github.written.map((write) => write.target)).toEqual([7, 8]);
    });

    it('[OUT-3] does not comment on a PR whose head has moved on to a newer commit', async () => {
      const runtime = buildDeployRuntime({
        github: { pullRequests: [{ ...OPEN_PR, headSha: 'newer-sha' }] },
      });
      await quandle_main_run_action(runtime);
      expect(runtime.github.written).toEqual([]);
    });

    it('[OUT-2] does not comment on a closed PR', async () => {
      const runtime = buildDeployRuntime({ github: { pullRequests: [{ ...OPEN_PR, isOpen: false }] } });
      await quandle_main_run_action(runtime);
      expect(runtime.github.written).toEqual([]);
    });

    it('[OUT-2] looks up the PRs for the deployed commit', async () => {
      const runtime = buildDeployRuntime({ github: { pullRequests: [OPEN_PR] } });
      await quandle_main_run_action(runtime);
      expect(runtime.github.calls).toContain('listPullRequestsForCommit:deploy-sha');
    });

    it('[OUT-9] updates our existing comment instead of posting a second one', async () => {
      const ours = { id: 55, body: `${COMMENT_MARKER}\nold`, authorLogin: BOT_LOGIN };
      const runtime = buildDeployRuntime({ github: { pullRequests: [OPEN_PR], comments: { 7: [ours] } } });
      await quandle_main_run_action(runtime);
      expect(runtime.github.written).toEqual([
        { method: 'update', target: 55, body: expect.stringContaining(COMMENT_MARKER) },
      ]);
    });

    it('[OUT-7] posts its own comment instead of editing a spoofed one with our marker', async () => {
      const spoofed = { id: 66, body: `${COMMENT_MARKER}\nedit me`, authorLogin: 'mallory' };
      const runtime = buildDeployRuntime({ github: { pullRequests: [OPEN_PR], comments: { 7: [spoofed] } } });
      await quandle_main_run_action(runtime);
      expect(runtime.github.written).toEqual([{ method: 'create', target: 7, body: expect.any(String) }]);
    });

    it('[OUT-9] leaves our comment untouched when nothing it shows has changed', async () => {
      const current = quandle_render_build_prComment(
        ...withNoIgnores({
          ...quandle_mock_build_scanResult('critical', 'https://preview.example.com/', 'Preview'),
          status: 'scanned',
        }),
      );
      const ours = { id: 55, body: current, authorLogin: BOT_LOGIN };
      const runtime = buildDeployRuntime({ github: { pullRequests: [OPEN_PR], comments: { 7: [ours] } } });
      await quandle_main_run_action(runtime);
      expect(runtime.github.written).toEqual([]);
    });

    it('[OUT-9] posts nothing for a clean scan when there is no comment yet', async () => {
      const runtime = buildDeployRuntime({
        inputs: { 'mock-scenario': 'clean' },
        github: { pullRequests: [OPEN_PR] },
      });
      await quandle_main_run_action(runtime);
      expect(runtime.github.written).toEqual([]);
    });

    it('[MOCK-2] puts the mock banner in a mock PR comment', async () => {
      const runtime = buildDeployRuntime({ github: { pullRequests: [OPEN_PR] } });
      await quandle_main_run_action(runtime);
      expect(runtime.github.written[0]?.body).toContain('MOCK RESULTS');
    });

    it('[TRU-6] builds the GitHub API with the github-token input', async () => {
      const runtime = buildDeployRuntime({ github: { pullRequests: [OPEN_PR] } });
      await quandle_main_run_action(runtime);
      expect(runtime.gitHubTokens.length).toBeGreaterThan(0);
      expect(new Set(runtime.gitHubTokens)).toEqual(new Set(['FAKE_GITHUB_TOKEN']));
    });
  });

  describe('when no PR comment is made', () => {
    it('[PRM-2] makes no PR or comment call when comment is false (only the default-branch check and the ignore-file read)', async () => {
      const runtime = buildDeployRuntime({
        inputs: { comment: 'false' },
        github: { pullRequests: [OPEN_PR] },
      });
      await quandle_main_run_action(runtime);
      expect(runtime.github.calls).toEqual(['readDefaultBranchHeadSha', 'readIgnoreFile']);
    });

    it('[TGT-6] posts no PR comment for a Scan now run (its results go to the production issue)', async () => {
      const runtime = buildFakeRuntime({ inputs: CRITICAL_MOCK, github: { pullRequests: [OPEN_PR] } });
      await quandle_main_run_action(runtime);
      expect(runtime.github.calls.filter((call) => /PullRequest/.test(call))).toEqual([]);
    });

    it('[ERR-4] leaves the PR comment untouched when the scan did not happen', async () => {
      const ours = { id: 55, body: `${COMMENT_MARKER}\nold`, authorLogin: BOT_LOGIN };
      const runtime = buildDeployRuntime({
        inputs: { mock: 'false' },
        github: { pullRequests: [OPEN_PR], comments: { 7: [ours] } },
      });
      await quandle_main_run_action(runtime);
      // Only the production check before the scan (TGT-11); nothing touches the comment.
      expect(runtime.github.calls).toEqual(['readDefaultBranchHeadSha']);
    });
  });

  describe('when GitHub fails', () => {
    it.each(['listPullRequestsForCommit', 'listPullRequestComments', 'createPullRequestComment'] as const)(
      '[PRM-3] warns and keeps the job result when %s fails',
      async (failingMethod) => {
        const runtime = buildDeployRuntime({
          github: { pullRequests: [OPEN_PR], failingMethod, failureReason: 'GitHub API returned 503' },
        });
        await quandle_main_run_action(runtime);
        expect(runtime.failures).toEqual([
          expect.stringContaining('new or no longer ignored findings at or above'),
        ]);
        expect(runtime.warnings).toContainEqual(
          'Quandle: could not update the PR comment (GitHub API returned 503).',
        );
        expect(runtime.outputs).toMatchObject({ status: 'mock', 'new-findings': 1 });
      },
    );

    it('[PRM-3] warns and keeps the job result when the GitHub API cannot be built', async () => {
      const runtime = buildDeployRuntime({
        gitHubUnavailableReason: 'GITHUB_REPOSITORY is not set to owner/repo',
      });
      await quandle_main_run_action(runtime);
      expect(runtime.failures).toEqual([
        expect.stringContaining('new or no longer ignored findings at or above'),
      ]);
      expect(runtime.warnings).toContainEqual(
        'Quandle: could not update the PR comment (GITHUB_REPOSITORY is not set to owner/repo).',
      );
    });

    it('[PRM-3] still writes the job summary after a GitHub failure', async () => {
      const runtime = buildDeployRuntime({
        github: { pullRequests: [OPEN_PR], failingMethod: 'createPullRequestComment' },
      });
      await quandle_main_run_action(runtime);
      expect(runtime.summaries).toEqual([expect.stringContaining('Checked')]);
    });

    it('[PRM-3] escapes a GitHub failure reason before logging it', async () => {
      const runtime = buildDeployRuntime({
        github: {
          pullRequests: [OPEN_PR],
          failingMethod: 'listPullRequestsForCommit',
          failureReason: `x\n::error::${LEAKY_ERROR_TEXT}`,
        },
      });
      await quandle_main_run_action(runtime);
      for (const warning of runtime.warnings) {
        expect(warning).not.toContain('\n');
        expect(warning).not.toContain('::error::');
      }
    });
  });
});
