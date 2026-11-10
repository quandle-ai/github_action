// ==========================================================================
// Quandle GitHub Action · test/helpers/run-action-fixtures.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Shared fixtures for the quandle_main_run_action scenario tests: the issues URL,
// a pending deployment event, and the outputs every no-scan outcome must set.
// ==========================================================================
import type { EventContext, OutputStatus } from '../../src/types';

export const ISSUES_URL = 'https://github.com/quandle-ai/github_action/issues';

export const PENDING_DEPLOYMENT: EventContext = {
  eventName: 'deployment_status',
  sha: 'context-sha',
  payload: {
    deployment_status: { state: 'pending' },
    deployment: { sha: 'deploy-sha', environment: 'Preview' },
  },
};

export function noScanOutputs(status: OutputStatus): Record<string, string | number> {
  return { 'new-findings': 0, critical: 0, 'scan-id': '', status };
}
