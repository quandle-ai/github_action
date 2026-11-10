// ==========================================================================
// Quandle GitHub Action · test/report/render/quandle_render_build_notScannedSummary.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/report/render.ts → quandle_render_build_notScannedSummary
// Also covers (private): none
//
// Proves a run that never scanned gets exactly one escaped "Not scanned" line
// and no mock banner.
// Rules: ERR-4, FND-3
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_render_build_notScannedSummary } from '../../../src/report/render';

describe('quandle_render_build_notScannedSummary', () => {
  it('[ERR-4] builds a summary with exactly one Not scanned line and the reason', () => {
    const summary = quandle_render_build_notScannedSummary('the deployment did not succeed');
    expect(summary).toContain('**Not scanned:** the deployment did not succeed');
    expect(summary.match(/\*\*Not scanned:\*\*/g)).toHaveLength(1);
  });

  it('[ERR-4] never shows the mock banner, because nothing was scanned', () => {
    expect(quandle_render_build_notScannedSummary('invalid configuration')).not.toContain('MOCK RESULTS');
  });

  it('[FND-3] escapes the reason in a Not scanned summary', () => {
    expect(quandle_render_build_notScannedSummary('<b>@octocat</b>')).not.toMatch(/<b>|@octocat/);
  });
});
