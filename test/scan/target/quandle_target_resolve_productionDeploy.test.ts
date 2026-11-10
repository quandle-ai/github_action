// ==========================================================================
// Quandle GitHub Action · test/scan/target/quandle_target_resolve_productionDeploy.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/scan/target.ts → quandle_target_resolve_productionDeploy
// Also covers (private): none
//
// Proves a deploy whose commit is exactly the default branch's head becomes a
// production deploy; any other commit leaves the target unchanged; and the
// environment name never decides it.
// Rules: TGT-9, TGT-11
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_target_resolve_productionDeploy } from '../../../src/scan/target';
import type { Target } from '../../../src/types';

type ScanTarget = Extract<Target, { kind: 'scan' }>;

function buildDeployTarget(overrides: Partial<ScanTarget> = {}): ScanTarget {
  return {
    kind: 'scan',
    url: 'https://app.example.com/',
    environment: 'Preview',
    sha: 'deploy-sha',
    source: 'deployment',
    isProductionEnvironment: false,
    ...overrides,
  };
}

describe('quandle_target_resolve_productionDeploy', () => {
  it('[TGT-11] makes a deploy of the default branch head commit a production deploy', () => {
    expect(quandle_target_resolve_productionDeploy(buildDeployTarget(), 'deploy-sha')).toEqual(
      buildDeployTarget({ isProductionEnvironment: true }),
    );
  });

  it('[TGT-11] leaves a deploy of any other commit as it is (not production)', () => {
    expect(quandle_target_resolve_productionDeploy(buildDeployTarget(), 'other-sha')).toEqual(
      buildDeployTarget(),
    );
  });

  it('[TGT-11] keeps a deploy that is already production (payload flag) production, whatever the head is', () => {
    const target = buildDeployTarget({ isProductionEnvironment: true });
    expect(quandle_target_resolve_productionDeploy(target, 'other-sha')).toEqual(target);
  });

  it('[TGT-9] does not make a deploy named "Production" a production deploy when its commit is not the head', () => {
    const target = buildDeployTarget({ environment: 'Production' });
    expect(quandle_target_resolve_productionDeploy(target, 'other-sha').isProductionEnvironment).toBe(false);
  });
});
