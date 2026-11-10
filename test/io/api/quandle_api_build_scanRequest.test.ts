// ==========================================================================
// Quandle GitHub Action · test/io/api/quandle_api_build_scanRequest.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/io/api.ts → quandle_api_build_scanRequest
// Also covers (private): none
//
// Proves the scan request carries only url, environment (when known), production
// and bypassSecret (when set), and that production is the target's production
// decision (true for Scan now and production deploys), never the environment name.
// Rules: TGT-9, TRU-1
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_api_build_scanRequest } from '../../../src/io/api';
import type { Target } from '../../../src/types';

type ScanTarget = Extract<Target, { kind: 'scan' }>;

function buildTarget(overrides: Partial<ScanTarget> = {}): ScanTarget {
  return {
    kind: 'scan',
    url: 'https://preview.example.com/',
    environment: 'Preview',
    sha: 'deploy-sha',
    source: 'deployment',
    isProductionEnvironment: false,
    ...overrides,
  };
}

describe('quandle_api_build_scanRequest', () => {
  it('[TRU-1] sends only url, environment, production and bypassSecret', () => {
    expect(quandle_api_build_scanRequest(buildTarget(), 'FAKE_BYPASS')).toEqual({
      url: 'https://preview.example.com/',
      environment: 'Preview',
      production: false,
      bypassSecret: 'FAKE_BYPASS',
    });
  });

  it('[TRU-1] leaves environment out when the deploy has none', () => {
    const { environment: _unused, ...withoutEnvironment } = buildTarget();
    expect(quandle_api_build_scanRequest(withoutEnvironment, undefined)).not.toHaveProperty('environment');
  });

  it('[TRU-1] leaves bypassSecret out when it is not set', () => {
    expect(quandle_api_build_scanRequest(buildTarget(), undefined)).not.toHaveProperty('bypassSecret');
  });

  it('[TRU-1] sends production true for a deploy whose payload says production_environment: true', () => {
    const target = buildTarget({ isProductionEnvironment: true });
    expect(quandle_api_build_scanRequest(target, undefined).production).toBe(true);
  });

  it('[TRU-1] sends production true for a Scan now or scheduled run', () => {
    const target = buildTarget({
      source: 'manual',
      environment: 'production',
      isProductionEnvironment: true,
    });
    expect(quandle_api_build_scanRequest(target, undefined).production).toBe(true);
  });

  it('[TGT-9] sends production false for a deploy named "Production" whose payload does not say production_environment: true', () => {
    const target = buildTarget({ environment: 'Production', isProductionEnvironment: false });
    expect(quandle_api_build_scanRequest(target, undefined).production).toBe(false);
  });

  it('[TRU-1] never sends the deploy commit or source (they come from the OIDC token, TRU-2)', () => {
    expect(Object.keys(quandle_api_build_scanRequest(buildTarget(), 'FAKE_BYPASS')).sort()).toEqual(
      ['bypassSecret', 'environment', 'production', 'url'].sort(),
    );
  });
});
