// ==========================================================================
// Quandle GitHub Action · test/report/render/quandle_render_build_productionIssue.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/report/render.ts → quandle_render_build_productionIssue
// Also covers (private): quandle_render_select_findingsByState, quandle_render_build_checkedLine,
//   quandle_render_build_findingSections, quandle_render_build_ignoredCountLines,
//   quandle_render_get_sectionBudget
//
// Proves the production issue starts with our marker, shows the mock banner for
// mocks, lists everything still exposed at Medium or above (new, existing and the
// first-scan baseline, marked when an ignore expired) and what was fixed, never
// Low, caps the list at 50 findings and 60,000 characters (counting every finding
// left out), escapes untrusted text and never shows the URL's
// query; ignored findings are left out and only counted.
// Rules: FND-1, FND-3, IGN-2, IGN-10, MOCK-2, OUT-10, OUT-11, OUT-12, OUT-13, TGT-10
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { ISSUE_MARKER, MOCK_BANNER, quandle_render_build_productionIssue } from '../../../src/report/render';
import type { Finding, ScanResult } from '../../../src/types';
import {
  buildFinding,
  buildIgnoreOutcome,
  buildOversizedFinding,
  withNoIgnores,
} from '../../helpers/builders';

type ScannedResult = Extract<ScanResult, { status: 'scanned' }>;

const NEWLINE = String.fromCharCode(10);

function buildScanned(findings: readonly Finding[], overrides: Partial<ScannedResult> = {}): ScannedResult {
  return { status: 'scanned', url: 'https://app.example.com/', findings, isMock: false, ...overrides };
}

describe('quandle_render_build_productionIssue', () => {
  it('[OUT-10] starts with our hidden issue marker', () => {
    expect(
      quandle_render_build_productionIssue(...withNoIgnores(buildScanned([]))).startsWith(ISSUE_MARKER),
    ).toBe(true);
  });

  it('[MOCK-2] shows the mock banner right after the marker in a mock issue', () => {
    const issue = quandle_render_build_productionIssue(...withNoIgnores(buildScanned([], { isMock: true })));
    expect(issue.startsWith(`${ISSUE_MARKER}\n${MOCK_BANNER}`)).toBe(true);
  });

  it.each(['new', 'existing'] as const)(
    '[OUT-11] lists a %s finding at Medium or above under Exposed',
    (state) => {
      const issue = quandle_render_build_productionIssue(
        ...withNoIgnores(buildScanned([buildFinding({ id: 'qf_exposed', state })])),
      );
      expect(issue).toContain('**Exposed**');
      expect(issue).toContain('`qf_exposed`');
    },
  );

  it('[FND-1] lists the first-scan baseline (already-present) loudly in the production issue', () => {
    const issue = quandle_render_build_productionIssue(
      ...withNoIgnores(buildScanned([buildFinding({ id: 'qf_baseline', state: 'already-present' })])),
    );
    expect(issue).toContain('`qf_baseline`');
  });

  it('[OUT-11] counts everything still exposed in the heading', () => {
    const one = quandle_render_build_productionIssue(...withNoIgnores(buildScanned([buildFinding()])));
    const two = quandle_render_build_productionIssue(
      ...withNoIgnores(buildScanned([buildFinding(), buildFinding({ id: 'qf_b', state: 'existing' })])),
    );
    expect(one).toContain('### Quandle: 1 exposure in production');
    expect(two).toContain('### Quandle: 2 exposures in production');
  });

  it('[OUT-11] lists what was fixed since the last scan under Fixed', () => {
    const issue = quandle_render_build_productionIssue(
      ...withNoIgnores(buildScanned([buildFinding({ id: 'qf_fixed', state: 'resolved' })])),
    );
    expect(issue).toContain('**Fixed**');
    expect(issue).toContain('`qf_fixed`');
  });

  it('[OUT-12] says nothing is left exposed once everything is fixed', () => {
    const issue = quandle_render_build_productionIssue(
      ...withNoIgnores(buildScanned([buildFinding({ state: 'resolved' })])),
    );
    expect(issue).toContain('### Quandle: no exposures left in production');
  });

  it('[OUT-11] never lists a low finding, exposed or fixed', () => {
    const issue = quandle_render_build_productionIssue(
      ...withNoIgnores(
        buildScanned([
          buildFinding({ id: 'qf_low', severity: 'low' }),
          buildFinding({ id: 'qf_low_fixed', severity: 'low', state: 'resolved' }),
        ]),
      ),
    );
    expect(issue).not.toContain('qf_low');
  });

  it('[OUT-11] lists at most 50 findings, then points to the job summary for the rest', () => {
    const findings = Array.from({ length: 55 }, (_, index) => buildFinding({ id: `qf_${index}` }));
    const issue = quandle_render_build_productionIssue(...withNoIgnores(buildScanned(findings)));
    expect(issue.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(50);
    expect(issue).toContain('…and 5 more, see the job summary.');
  });

  it('[OUT-11] keeps an issue of 50 findings whose titles escape to 1,000 characters at or under 60,000 characters', () => {
    const findings = Array.from({ length: 50 }, (_, index) => buildOversizedFinding(index));
    const issue = quandle_render_build_productionIssue(...withNoIgnores(buildScanned(findings)));
    expect(issue.length).toBeLessThanOrEqual(60_000);
  });

  it('[OUT-11] counts every finding the 60,000-character limit left out in "…and N more"', () => {
    const findings = Array.from({ length: 60 }, (_, index) => buildOversizedFinding(index));
    const issue = quandle_render_build_productionIssue(...withNoIgnores(buildScanned(findings)));
    const listed = issue.split('\n').filter((line) => line.startsWith('- ')).length;
    expect(issue).toContain(`…and ${60 - listed} more, see the job summary.`);
  });

  it('[FND-3] escapes an untrusted finding title', () => {
    const issue = quandle_render_build_productionIssue(
      ...withNoIgnores(buildScanned([buildFinding({ title: '<img src=x>@octocat' })])),
    );
    expect(issue).not.toContain('<img');
    expect(issue).not.toMatch(/@octocat/);
  });

  it('[TGT-10] shows only the origin and path of the scanned URL, never its query string', () => {
    const issue = quandle_render_build_productionIssue(
      ...withNoIgnores(buildScanned([], { url: 'https://app.example.com/?token=FAKE_SHARE_TOKEN' })),
    );
    expect(issue).not.toContain('FAKE_SHARE_TOKEN');
  });

  it('[OUT-12] renders exactly the same text for the same result, so an unchanged issue is left alone', () => {
    const result = buildScanned([buildFinding(), buildFinding({ id: 'qf_b', state: 'resolved' })]);
    expect(quandle_render_build_productionIssue(...withNoIgnores(result))).toBe(
      quandle_render_build_productionIssue(...withNoIgnores(result)),
    );
  });

  describe('with the ignore file', () => {
    const EXPIRED_ON = '2026-11-08';
    const ignoredFinding = buildFinding({ id: 'qf_ignored', state: 'existing', title: 'Ignored test title' });

    it('[IGN-10] leaves an ignored existing critical finding out of the issue', () => {
      const outcome = buildIgnoreOutcome({ ignored: [{ finding: ignoredFinding, reason: 'Test reason' }] });
      const issue = quandle_render_build_productionIssue(buildScanned([ignoredFinding]), outcome);
      expect(issue).not.toContain('Ignored test title');
      expect(issue).not.toContain('qf');
    });

    it('[IGN-10] says "no exposures left" and "1 finding ignored by `.quandle-ignore.yml`" when the only exposure is ignored', () => {
      const outcome = buildIgnoreOutcome({ ignored: [{ finding: ignoredFinding, reason: 'Test reason' }] });
      const issue = quandle_render_build_productionIssue(buildScanned([ignoredFinding]), outcome);
      expect(issue).toContain('### Quandle: no exposures left in production');
      expect(issue.endsWith('1 finding ignored by `.quandle-ignore.yml`, see the job summary.')).toBe(true);
    });

    it('[IGN-10] says "2 findings ignored by `.quandle-ignore.yml`" for two ignored findings', () => {
      const ignored = ['qf_a', 'qf_b'].map((id) => ({
        finding: buildFinding({ id }),
        reason: 'Test reason',
      }));
      const issue = quandle_render_build_productionIssue(buildScanned([]), buildIgnoreOutcome({ ignored }));
      expect(issue).toContain('2 findings ignored by `.quandle-ignore.yml`, see the job summary.');
    });

    it('[IGN-10] has no "ignored by" line when nothing is ignored', () => {
      const issue = quandle_render_build_productionIssue(...withNoIgnores(buildScanned([buildFinding()])));
      expect(issue).not.toContain('ignored by');
    });

    it('[IGN-2] marks an exposed existing finding whose ignore expired with "· ignore expired 2026-11-08"', () => {
      const finding = buildFinding({ id: 'qf_lapsed', state: 'existing' });
      const outcome = buildIgnoreOutcome({ shown: [finding], expired: [{ finding, expires: EXPIRED_ON }] });
      const issue = quandle_render_build_productionIssue(buildScanned([finding]), outcome);
      const line = issue.split(NEWLINE).find((text) => text.includes('`qf_lapsed`'));
      expect(line?.endsWith(' · ignore expired 2026-11-08')).toBe(true);
    });
  });

  it.each([
    ['unverified', { kind: 'unverified', verificationToken: `qv_${'0123456789abcdef'.repeat(2)}` }],
    ['ran', { kind: 'ran' }],
  ] as const)(
    '[OUT-13] never mentions the exposed-file checks or the token in the issue when active checks are %s',
    (_name, activeChecks) => {
      const issue = quandle_render_build_productionIssue(
        ...withNoIgnores(buildScanned([buildFinding()], { activeChecks })),
      );
      expect(issue).not.toContain('Exposed-file checks');
      expect(issue).not.toContain('qv_');
      expect(issue).not.toContain('quandle.txt');
    },
  );
});
