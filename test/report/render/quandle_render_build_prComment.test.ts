// ==========================================================================
// Quandle GitHub Action · test/report/render/quandle_render_build_prComment.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/report/render.ts → quandle_render_build_prComment
// Also covers (private): quandle_render_build_findingLine, quandle_render_build_displayUrl,
//   quandle_render_build_prCommentHeading, quandle_render_build_findingSections,
//   quandle_render_build_ignoredCountLines, quandle_render_get_sectionBudget
//
// Proves the PR comment starts with our marker, shows the mock banner for mocks,
// lists only new and fixed findings at Medium or above (never Low, existing or
// already-present ones), plus existing ones whose ignore expired in their own
// section, caps the list at 50 findings and 60,000 characters (counting every
// finding left out), escapes untrusted text, never shows the URL's
// query, and is the same text for the same result; ignored findings are left out
// and only counted.
// Rules: FND-1, FND-3, IGN-10, MOCK-2, OUT-7, OUT-8, OUT-9, OUT-13, TGT-10
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { COMMENT_MARKER, MOCK_BANNER, quandle_render_build_prComment } from '../../../src/report/render';
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
  return { status: 'scanned', url: 'https://preview.example.com/', findings, isMock: false, ...overrides };
}

describe('quandle_render_build_prComment', () => {
  it('[OUT-7] starts with our hidden marker', () => {
    expect(
      quandle_render_build_prComment(...withNoIgnores(buildScanned([]))).startsWith(COMMENT_MARKER),
    ).toBe(true);
  });

  it('[MOCK-2] shows the mock banner right after the marker in a mock comment', () => {
    const comment = quandle_render_build_prComment(...withNoIgnores(buildScanned([], { isMock: true })));
    expect(comment.startsWith(`${COMMENT_MARKER}\n${MOCK_BANNER}`)).toBe(true);
  });

  it('[MOCK-2] does not show the mock banner in a real comment', () => {
    expect(quandle_render_build_prComment(...withNoIgnores(buildScanned([])))).not.toContain('MOCK RESULTS');
  });

  it('[OUT-8] lists new critical, high and medium findings with their id', () => {
    const comment = quandle_render_build_prComment(
      ...withNoIgnores(
        buildScanned([
          buildFinding({ id: 'qf_crit', severity: 'critical' }),
          buildFinding({ id: 'qf_high', severity: 'high' }),
          buildFinding({ id: 'qf_med', severity: 'medium' }),
        ]),
      ),
    );
    for (const id of ['qf_crit', 'qf_high', 'qf_med']) expect(comment).toContain(`\`${id}\``);
  });

  it('[OUT-8] counts the new findings in the heading', () => {
    const one = quandle_render_build_prComment(...withNoIgnores(buildScanned([buildFinding()])));
    const two = quandle_render_build_prComment(
      ...withNoIgnores(buildScanned([buildFinding(), buildFinding({ id: 'qf_b' })])),
    );
    expect(one).toContain('### Quandle: this deploy exposed 1 new finding');
    expect(two).toContain('### Quandle: this deploy exposed 2 new findings');
  });

  it('[OUT-8] never lists a low finding, new or fixed', () => {
    const comment = quandle_render_build_prComment(
      ...withNoIgnores(
        buildScanned([
          buildFinding({ id: 'qf_low_new', severity: 'low' }),
          buildFinding({ id: 'qf_low_fixed', severity: 'low', state: 'resolved' }),
        ]),
      ),
    );
    expect(comment).not.toContain('qf_low_new');
    expect(comment).not.toContain('qf_low_fixed');
  });

  it('[OUT-8] lists findings fixed since the last deploy under Fixed', () => {
    const comment = quandle_render_build_prComment(
      ...withNoIgnores(buildScanned([buildFinding({ id: 'qf_fixed', state: 'resolved' })])),
    );
    expect(comment).toContain('**Fixed**');
    expect(comment).toContain('`qf_fixed`');
  });

  it('[OUT-9] says there are no new exposures when nothing is new, so a fixed comment says so', () => {
    const comment = quandle_render_build_prComment(
      ...withNoIgnores(buildScanned([buildFinding({ state: 'resolved' })])),
    );
    expect(comment).toContain('### Quandle: no new exposures in this deploy');
  });

  it.each(['existing', 'already-present'] as const)(
    '[FND-1] never lists an %s finding in the PR comment',
    (state) => {
      const comment = quandle_render_build_prComment(
        ...withNoIgnores(buildScanned([buildFinding({ id: 'qf_not_this_pr', state })])),
      );
      expect(comment).not.toContain('qf_not_this_pr');
    },
  );

  it('[OUT-8] lists at most 50 findings, then points to the job summary for the rest', () => {
    const findings = Array.from({ length: 60 }, (_, index) => buildFinding({ id: `qf_${index}` }));
    const comment = quandle_render_build_prComment(...withNoIgnores(buildScanned(findings)));
    expect(comment.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(50);
    expect(comment).toContain('…and 10 more, see the job summary.');
  });

  it('[OUT-8] keeps a comment of 50 findings whose titles escape to 1,000 characters at or under 60,000 characters', () => {
    const findings = Array.from({ length: 50 }, (_, index) => buildOversizedFinding(index));
    const comment = quandle_render_build_prComment(...withNoIgnores(buildScanned(findings)));
    expect(comment.length).toBeLessThanOrEqual(60_000);
  });

  it('[OUT-8] counts every finding the 60,000-character limit left out in "…and N more"', () => {
    const findings = Array.from({ length: 60 }, (_, index) => buildOversizedFinding(index));
    const comment = quandle_render_build_prComment(...withNoIgnores(buildScanned(findings)));
    const listed = comment.split('\n').filter((line) => line.startsWith('- ')).length;
    expect(comment).toContain(`…and ${60 - listed} more, see the job summary.`);
  });

  it('[OUT-8] lists new findings before fixed ones when the cap is reached', () => {
    const findings = [
      ...Array.from({ length: 50 }, (_, index) =>
        buildFinding({ id: `qf_fixed_${index}`, state: 'resolved' }),
      ),
      buildFinding({ id: 'qf_the_leak' }),
    ];
    expect(quandle_render_build_prComment(...withNoIgnores(buildScanned(findings)))).toContain('qf_the_leak');
  });

  it('[FND-3] escapes an untrusted finding title', () => {
    const comment = quandle_render_build_prComment(
      ...withNoIgnores(buildScanned([buildFinding({ title: '<img src=x>@octocat' })])),
    );
    expect(comment).not.toContain('<img');
    expect(comment).not.toMatch(/@octocat/);
  });

  it('[TGT-10] shows only the origin and path of the scanned URL, never its query string', () => {
    const comment = quandle_render_build_prComment(
      ...withNoIgnores(
        buildScanned([], { url: 'https://preview.example.com/app?_vercel_share=FAKE_SHARE_TOKEN' }),
      ),
    );
    expect(comment).toContain('`https://preview.example.com/app`');
    expect(comment).not.toContain('FAKE_SHARE_TOKEN');
  });

  it('[OUT-9] renders exactly the same text for the same result, so an unchanged comment is left alone', () => {
    const result = buildScanned([buildFinding(), buildFinding({ id: 'qf_b', state: 'resolved' })]);
    expect(quandle_render_build_prComment(...withNoIgnores(result))).toBe(
      quandle_render_build_prComment(...withNoIgnores(result)),
    );
  });

  describe('with the ignore file', () => {
    const EXPIRED_ON = '2026-11-08';
    const ignoredFinding = buildFinding({ id: 'qf_ignored', title: 'Ignored test title' });

    function lineWith(text: string, id: string): string | undefined {
      return text.split(NEWLINE).find((line) => line.includes(`\`${id}\``));
    }

    it('[IGN-10] leaves an ignored new critical finding out of the comment', () => {
      const outcome = buildIgnoreOutcome({ ignored: [{ finding: ignoredFinding, reason: 'Test reason' }] });
      const comment = quandle_render_build_prComment(buildScanned([ignoredFinding]), outcome);
      expect(comment).not.toContain('Ignored test title');
      expect(comment).not.toContain('qf');
    });

    it('[IGN-10] ends with "1 finding ignored by `.quandle-ignore.yml`, see the job summary." for one ignored finding', () => {
      const outcome = buildIgnoreOutcome({ ignored: [{ finding: ignoredFinding, reason: 'Test reason' }] });
      const comment = quandle_render_build_prComment(buildScanned([ignoredFinding]), outcome);
      expect(comment.endsWith('1 finding ignored by `.quandle-ignore.yml`, see the job summary.')).toBe(true);
    });

    it('[IGN-10] says "3 findings ignored by `.quandle-ignore.yml`" for three ignored findings', () => {
      const ignored = ['qf_a', 'qf_b', 'qf_c'].map((id) => ({
        finding: buildFinding({ id }),
        reason: 'Test reason',
      }));
      const comment = quandle_render_build_prComment(buildScanned([]), buildIgnoreOutcome({ ignored }));
      expect(comment).toContain('3 findings ignored by `.quandle-ignore.yml`, see the job summary.');
    });

    it('[IGN-10] has no "ignored by" line when nothing is ignored', () => {
      const comment = quandle_render_build_prComment(...withNoIgnores(buildScanned([buildFinding()])));
      expect(comment).not.toContain('ignored by');
    });

    it('[OUT-8] lists an existing finding whose ignore expired under "Ignore expired", marked with the date', () => {
      const finding = buildFinding({ id: 'qf_lapsed', state: 'existing' });
      const outcome = buildIgnoreOutcome({ shown: [finding], expired: [{ finding, expires: EXPIRED_ON }] });
      const comment = quandle_render_build_prComment(buildScanned([finding]), outcome);
      expect(comment).toContain('**Ignore expired**');
      expect(lineWith(comment, 'qf_lapsed')?.endsWith(' · ignore expired 2026-11-08')).toBe(true);
    });

    it('[OUT-8] places the Ignore expired section between New and Fixed', () => {
      const lapsed = buildFinding({ id: 'qf_lapsed', state: 'existing' });
      const shown = [
        buildFinding({ id: 'qf_new' }),
        lapsed,
        buildFinding({ id: 'qf_fixed', state: 'resolved' }),
      ];
      const outcome = buildIgnoreOutcome({ shown, expired: [{ finding: lapsed, expires: EXPIRED_ON }] });
      const comment = quandle_render_build_prComment(buildScanned(shown), outcome);
      const order = ['**New**', '**Ignore expired**', '**Fixed**'].map((heading) => comment.indexOf(heading));
      expect(order.every((index) => index >= 0)).toBe(true);
      expect(order).toEqual([...order].sort((a, b) => a - b));
    });

    it('[OUT-8] keeps a new finding whose ignore expired under New, marked with the date, with no Ignore expired section', () => {
      const finding = buildFinding({ id: 'qf_new_lapsed', state: 'new' });
      const outcome = buildIgnoreOutcome({ shown: [finding], expired: [{ finding, expires: EXPIRED_ON }] });
      const comment = quandle_render_build_prComment(buildScanned([finding]), outcome);
      expect(comment).toContain('**New**');
      expect(comment).not.toContain('**Ignore expired**');
      expect(lineWith(comment, 'qf_new_lapsed')?.endsWith(' · ignore expired 2026-11-08')).toBe(true);
    });

    it('[OUT-8] leaves a low existing finding whose ignore expired out of the comment', () => {
      const finding = buildFinding({ id: 'qf_low_lapsed', severity: 'low', state: 'existing' });
      const outcome = buildIgnoreOutcome({ shown: [finding], expired: [{ finding, expires: EXPIRED_ON }] });
      expect(quandle_render_build_prComment(buildScanned([finding]), outcome)).not.toContain('qf');
    });

    it('[OUT-8] uses the heading "### Quandle: 2 findings no longer ignored" when there is nothing new and 2 ignores expired', () => {
      const lapsed = ['qf_a', 'qf_b'].map((id) => buildFinding({ id, state: 'existing' }));
      const expired = lapsed.map((finding) => ({ finding, expires: EXPIRED_ON }));
      const comment = quandle_render_build_prComment(
        buildScanned(lapsed),
        buildIgnoreOutcome({ shown: lapsed, expired }),
      );
      expect(comment).toContain('### Quandle: 2 findings no longer ignored');
    });

    it('[OUT-8] uses the heading "### Quandle: 1 finding no longer ignored" for one expired ignore', () => {
      const finding = buildFinding({ state: 'existing' });
      const outcome = buildIgnoreOutcome({ shown: [finding], expired: [{ finding, expires: EXPIRED_ON }] });
      expect(quandle_render_build_prComment(buildScanned([finding]), outcome)).toContain(
        '### Quandle: 1 finding no longer ignored',
      );
    });

    it('[OUT-8] keeps the "exposed 1 new finding" heading when there is a new finding as well as an expired ignore', () => {
      const lapsed = buildFinding({ id: 'qf_lapsed', state: 'existing' });
      const shown = [buildFinding({ id: 'qf_new' }), lapsed];
      const outcome = buildIgnoreOutcome({ shown, expired: [{ finding: lapsed, expires: EXPIRED_ON }] });
      expect(quandle_render_build_prComment(buildScanned(shown), outcome)).toContain(
        '### Quandle: this deploy exposed 1 new finding',
      );
    });

    it('[OUT-8] lists at most 50 findings across New and Ignore expired: 40 new and 20 expired show 10 expired, then "…and 10 more"', () => {
      const newFindings = Array.from({ length: 40 }, (_, index) => buildFinding({ id: `qf_new_${index}` }));
      const lapsed = Array.from({ length: 20 }, (_, index) =>
        buildFinding({ id: `qf_lapsed_${index}`, state: 'existing' }),
      );
      const expired = lapsed.map((finding) => ({ finding, expires: EXPIRED_ON }));
      const shown = [...newFindings, ...lapsed];
      const comment = quandle_render_build_prComment(
        buildScanned(shown),
        buildIgnoreOutcome({ shown, expired }),
      );
      expect(comment.split(NEWLINE).filter((line) => line.includes('`qf_lapsed_'))).toHaveLength(10);
      expect(comment).toContain('…and 10 more, see the job summary.');
    });
  });

  it.each([
    ['unverified', { kind: 'unverified', verificationToken: `qv_${'0123456789abcdef'.repeat(2)}` }],
    ['ran', { kind: 'ran' }],
  ] as const)(
    '[OUT-13] never mentions the exposed-file checks or the token in the comment when active checks are %s',
    (_name, activeChecks) => {
      const comment = quandle_render_build_prComment(
        ...withNoIgnores(buildScanned([buildFinding()], { activeChecks })),
      );
      expect(comment).not.toContain('Exposed-file checks');
      expect(comment).not.toContain('qv_');
      expect(comment).not.toContain('quandle.txt');
    },
  );
});
