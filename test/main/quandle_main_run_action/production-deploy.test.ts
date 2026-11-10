// ==========================================================================
// Quandle GitHub Action · test/main/quandle_main_run_action/production-deploy.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/main.ts → quandle_main_run_action (which deploys are production deploys)
// Also covers (private): quandle_main_resolve_productionDeploy
//
// Proves a deploy whose payload does not say production_environment: true is a
// production deploy exactly when its commit is the default branch's head: it then
// reaches the production issue and is sent to the engine as production. Any other
// commit is a preview. A failed check warns once and treats the deploy as a preview.
// The payload flag, Scan now and schedule never need the check.
// Rules: TGT-6, TGT-11, TRU-1
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_main_run_action } from '../../../src/main';
import type { EventContext } from '../../../src/types';
import { engineAnswer } from '../../helpers/fake-engine';
import type { FakeRuntimeOptions } from '../../helpers/fake-runtime';
import { buildFakeRuntime } from '../../helpers/fake-runtime';

const CRITICAL_MOCK = { mock: 'true', 'mock-scenario': 'critical' };

// A Vercel-style deploy: production_environment false, whatever the environment is called.
function deployEvent(productionEnvironment: boolean): EventContext {
  return {
    eventName: 'deployment_status',
    sha: 'deploy-sha',
    payload: {
      deployment_status: { state: 'success', environment_url: 'https://app.example.com/' },
      deployment: {
        sha: 'deploy-sha',
        environment: 'Production',
        production_environment: productionEnvironment,
      },
    },
  };
}

function buildDeployRuntime(options: FakeRuntimeOptions = {}): ReturnType<typeof buildFakeRuntime> {
  return buildFakeRuntime({
    event: deployEvent(false),
    ...options,
    inputs: { ...CRITICAL_MOCK, ...options.inputs },
  });
}

describe('quandle_main_run_action', () => {
  describe('production deploys', () => {
    it('[TGT-11] opens the production issue for a deploy of the default branch head with no open PR', async () => {
      const runtime = buildDeployRuntime({ github: { defaultBranchHeadSha: 'deploy-sha' } });
      await quandle_main_run_action(runtime);
      expect(runtime.github.written.map((write) => write.method)).toEqual(['createIssue']);
    });

    it('[TGT-11] keeps a deploy of any other commit out of the production issue (a preview)', async () => {
      const runtime = buildDeployRuntime({ github: { defaultBranchHeadSha: 'newer-sha' } });
      await quandle_main_run_action(runtime);
      expect(runtime.github.written).toEqual([]);
      expect(runtime.github.calls).not.toContain('listOpenIssues');
    });

    it('[TRU-1] sends production: true to the engine for a deploy of the default branch head', async () => {
      const respond = engineAnswer({ status: 'scanned', scanId: 'scan_x', findings: [] });
      const runtime = buildDeployRuntime({
        inputs: { mock: 'false' },
        github: { defaultBranchHeadSha: 'deploy-sha' },
        engine: { respond },
      });
      await quandle_main_run_action(runtime);
      expect(runtime.engineRequests[0]).toMatchObject({ production: true });
    });

    it('[TRU-1] sends production: false to the engine for a deploy of any other commit', async () => {
      const respond = engineAnswer({ status: 'scanned', scanId: 'scan_x', findings: [] });
      const runtime = buildDeployRuntime({ inputs: { mock: 'false' }, engine: { respond } });
      await quandle_main_run_action(runtime);
      expect(runtime.engineRequests[0]).toMatchObject({ production: false });
    });

    it('[TGT-11] warns "could not check the default branch (…), so this deploy is treated as a preview." when the check fails', async () => {
      const runtime = buildDeployRuntime({
        github: { failingMethod: 'readDefaultBranchHeadSha', failureReason: 'GitHub API returned 500' },
      });
      await quandle_main_run_action(runtime);
      expect(runtime.warnings).toContain(
        'Quandle: could not check the default branch (GitHub API returned 500), so this deploy is treated as a preview.',
      );
      expect(runtime.github.written).toEqual([]);
    });

    it('[TGT-11] warns that it could not check the default branch when the GitHub API cannot be built', async () => {
      const runtime = buildDeployRuntime({ gitHubUnavailableReason: 'GITHUB_REPOSITORY is not set' });
      await quandle_main_run_action(runtime);
      expect(runtime.warnings).toContain(
        'Quandle: could not check the default branch (GITHUB_REPOSITORY is not set), so this deploy is treated as a preview.',
      );
    });

    it('[TGT-11] does not check the default branch when the payload already says production_environment: true', async () => {
      const runtime = buildDeployRuntime({ event: deployEvent(true) });
      await quandle_main_run_action(runtime);
      expect(runtime.github.calls).not.toContain('readDefaultBranchHeadSha');
      expect(runtime.github.written.map((write) => write.method)).toEqual(['createIssue']);
    });

    it('[TGT-6] does not check the default branch for a Scan now run', async () => {
      const runtime = buildFakeRuntime({ inputs: CRITICAL_MOCK });
      await quandle_main_run_action(runtime);
      expect(runtime.github.calls).not.toContain('readDefaultBranchHeadSha');
    });
  });
});
