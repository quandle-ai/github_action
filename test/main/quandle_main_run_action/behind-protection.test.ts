// ==========================================================================
// Quandle GitHub Action · test/main/quandle_main_run_action/behind-protection.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/main.ts → quandle_main_run_action (findings behind protection, through a fake engine)
// Also covers (private): none
//
// Proves the engine is asked for contract 3; a finding the engine marks behindProtection: true
// is shown with the fixed label in the job summary, the PR comment and the production issue;
// and the outputs, the job result and the ignores are exactly what the same scan gives without
// the mark.
// Rules: FND-7, TRU-1
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_main_run_action } from '../../../src/main';
import type { EventContext } from '../../../src/types';
import { engineAnswer } from '../../helpers/fake-engine';
import type { FakeRuntimeOptions } from '../../helpers/fake-runtime';
import { buildFakeRuntime } from '../../helpers/fake-runtime';

const LABEL = 'behind protection on this deployment, public once promoted';
const NEWLINE = String.fromCharCode(10);

const DEPLOYED: EventContext = {
  eventName: 'deployment_status',
  sha: 'deploy-sha',
  payload: {
    deployment_status: { state: 'success', environment_url: 'https://preview.example.com/' },
    deployment: { sha: 'deploy-sha', environment: 'Preview' },
  },
};
const OPEN_PR = { number: 7, isOpen: true, headSha: 'deploy-sha' };

function rawFinding(id: string, severity: string, state: string): Record<string, unknown> {
  return {
    id,
    rule: 'secret/test',
    severity,
    state,
    title: 'Test secret in shipped JavaScript',
    location: 'https://preview.example.com/assets/index.js',
  };
}

// What the engine sends for a scan with findings, with or without the behind-protection mark.
const FINDINGS = [
  rawFinding('qf_critical_new', 'critical', 'new'),
  rawFinding('qf_high_new', 'high', 'new'),
  rawFinding('qf_medium_existing', 'medium', 'existing'),
  rawFinding('qf_low_present', 'low', 'already-present'),
];
const MARKED_FINDINGS = FINDINGS.map((finding) => ({ ...finding, behindProtection: true }));

function buildEngineRuntime(
  findings: readonly unknown[],
  options: FakeRuntimeOptions = {},
): ReturnType<typeof buildFakeRuntime> {
  const respond = engineAnswer({ status: 'scanned', scanId: 'scan_walled01', findings });
  return buildFakeRuntime({ ...options, inputs: { mock: 'false', ...options.inputs }, engine: { respond } });
}

describe('quandle_main_run_action', () => {
  describe('findings behind protection', () => {
    it('[TRU-1] asks the engine for contract 3', async () => {
      const runtime = buildEngineRuntime([]);
      await quandle_main_run_action(runtime);
      expect(runtime.engineRequests[0]).toMatchObject({ contract: 3 });
    });

    it('[FND-7] shows the label in the job summary for a finding marked behindProtection: true', async () => {
      const runtime = buildEngineRuntime(MARKED_FINDINGS);
      await quandle_main_run_action(runtime);
      expect(runtime.outputs.status).toBe('scanned');
      expect(runtime.summaries.join(NEWLINE)).toContain(`\`qf_critical_new\` · ${LABEL}`);
    });

    it('[FND-7] shows the label in the PR comment for a finding marked behindProtection: true', async () => {
      const runtime = buildEngineRuntime(MARKED_FINDINGS, {
        event: DEPLOYED,
        github: { pullRequests: [OPEN_PR] },
      });
      await quandle_main_run_action(runtime);
      expect(runtime.github.written).toEqual([
        { method: 'create', target: 7, body: expect.stringContaining(`\`qf_critical_new\` · ${LABEL}`) },
      ]);
    });

    it('[FND-7] shows the label in the production issue for a finding marked behindProtection: true', async () => {
      const runtime = buildEngineRuntime(MARKED_FINDINGS);
      await quandle_main_run_action(runtime);
      expect(runtime.github.written).toEqual([
        {
          method: 'createIssue',
          target: expect.any(Number),
          body: expect.stringContaining(`\`qf_critical_new\` · ${LABEL}`),
        },
      ]);
    });

    it('[FND-7] shows no label anywhere for the same scan without the mark', async () => {
      const runtime = buildEngineRuntime(FINDINGS, { event: DEPLOYED, github: { pullRequests: [OPEN_PR] } });
      await quandle_main_run_action(runtime);
      const bodies = runtime.github.written.map((write) => write.body);
      expect([...runtime.summaries, ...bodies].join(NEWLINE)).not.toContain('behind protection');
    });

    it.each(['critical', 'high', 'medium', 'never'])(
      '[FND-7] sets the same outputs and job result as the same scan without the mark, with fail-on %s',
      async (failOn) => {
        const plain = buildEngineRuntime(FINDINGS, { inputs: { 'fail-on': failOn } });
        const marked = buildEngineRuntime(MARKED_FINDINGS, { inputs: { 'fail-on': failOn } });
        await quandle_main_run_action(plain);
        await quandle_main_run_action(marked);
        expect(marked.outputs).toEqual(plain.outputs);
        expect(marked.failures).toEqual(plain.failures);
        expect(marked.warnings).toEqual(plain.warnings);
      },
    );

    it('[FND-7] ignores a marked finding exactly as it ignores the same finding without the mark', async () => {
      const ignoreFile = [
        'ignore:',
        '  - id: qf_critical_new',
        '    reason: "Tracked elsewhere"',
        '    expires: 2027-02-01',
        '',
      ].join(NEWLINE);
      const plain = buildEngineRuntime(FINDINGS, { github: { ignoreFile } });
      const marked = buildEngineRuntime(MARKED_FINDINGS, { github: { ignoreFile } });
      await quandle_main_run_action(plain);
      await quandle_main_run_action(marked);
      expect(marked.outputs).toEqual(plain.outputs);
      expect(marked.failures).toEqual(plain.failures);
      expect(marked.summaries.join(NEWLINE)).toContain('`qf_critical_new` · Tracked elsewhere');
    });
  });
});
