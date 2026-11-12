// ==========================================================================
// Quandle GitHub Action · test/report/render/quandle_render_build_jobSummary.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/report/render.ts → quandle_render_build_jobSummary
// Also covers (private): quandle_render_build_activeChecksLines,
//   quandle_render_build_displayUrl, quandle_render_build_findingLines,
//   quandle_render_compare_findingImportance, quandle_render_build_findingLine,
//   quandle_render_build_ignoredLines, quandle_render_build_expiredDates
//
// Proves the summary shows the mock banner only for mocks, "Not scanned" when
// nothing was scanned, the URL without its query, and findings most important
// first (an expired ignore sorts with new), at most 100, with every untrusted field
// escaped; ignored findings are listed apart by id and escaped reason, at most 100,
// and a finding whose ignore expired is marked with the date; and the summary ends with
// how to turn on the exposed-file checks when the site is unverified, says in one line when
// they ran, and says nothing about them otherwise.
// Rules: ERR-4, FND-3, IGN-2, IGN-10, MOCK-2, OUT-1, OUT-13, TGT-10
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { MOCK_BANNER, quandle_render_build_jobSummary } from '../../../src/report/render';
import type { Finding } from '../../../src/types';
import {
  buildFinding,
  buildIgnoreOutcome,
  buildNotScannedResult,
  buildScanResult,
  withNoIgnores,
} from '../../helpers/builders';

// A verification token of the right shape: qv_ and 32 lowercase hex characters. Not a secret.
const TOKEN = `qv_${'0123456789abcdef'.repeat(2)}`;

// OUT-13: the fixed section that ends the summary of an unverified site.
const UNVERIFIED_SECTION = [
  '',
  '**Exposed-file checks did not run.** Quandle only requests files such as `/.env` and `/.git/HEAD` from a site that proves it belongs to this repository. To turn them on, serve a file at `/.well-known/quandle.txt` containing this line:',
  '',
  `\`${TOKEN}\``,
  '',
  'In Next.js, Vite and Astro projects that file is `public/.well-known/quandle.txt`.',
].join('\n');

// OUT-13: the one fixed line for a verified site.
const RAN_LINE = 'Exposed-file checks ran: this site is verified for this repository.';

describe('quandle_render_build_jobSummary', () => {
  it('[OUT-1] lists at most 100 findings and says how many more there are', () => {
    const findings = Array.from({ length: 150 }, (_, index) => buildFinding({ id: `qf_${index}` }));
    const summary = quandle_render_build_jobSummary(...withNoIgnores(buildScanResult({ findings })));
    expect(summary.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(100);
    expect(summary).toContain('…and 50 more findings (not shown).');
  });

  it('[OUT-1] lists all 100 findings with no "more" line when there are exactly 100', () => {
    const findings = Array.from({ length: 100 }, (_, index) => buildFinding({ id: `qf_${index}` }));
    const summary = quandle_render_build_jobSummary(...withNoIgnores(buildScanResult({ findings })));
    expect(summary.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(100);
    expect(summary).not.toContain('more findings');
  });

  it('[OUT-1] lists new findings before other states, then critical before low', () => {
    const summary = quandle_render_build_jobSummary(
      ...withNoIgnores(
        buildScanResult({
          findings: [
            buildFinding({ id: 'qf_existing_critical', state: 'existing', severity: 'critical' }),
            buildFinding({ id: 'qf_new_low', state: 'new', severity: 'low' }),
            buildFinding({ id: 'qf_new_critical', state: 'new', severity: 'critical' }),
          ],
        }),
      ),
    );
    const order = ['qf_new_critical', 'qf_new_low', 'qf_existing_critical'].map((id) => summary.indexOf(id));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('[OUT-1] keeps a new critical finding visible even when it arrives after 150 existing low ones', () => {
    const findings = [
      ...Array.from({ length: 150 }, (_, index) =>
        buildFinding({ id: `qf_low_${index}`, state: 'existing', severity: 'low' }),
      ),
      buildFinding({ id: 'qf_the_leak', state: 'new', severity: 'critical' }),
    ];
    expect(quandle_render_build_jobSummary(...withNoIgnores(buildScanResult({ findings })))).toContain(
      'qf_the_leak',
    );
  });

  it('[MOCK-2] starts a mock summary with the mock banner', () => {
    expect(
      quandle_render_build_jobSummary(...withNoIgnores(buildScanResult({ isMock: true }))).startsWith(
        MOCK_BANNER,
      ),
    ).toBe(true);
  });

  it('[MOCK-2] does not show the mock banner on a real scan', () => {
    expect(quandle_render_build_jobSummary(...withNoIgnores(buildScanResult()))).not.toContain(
      'MOCK RESULTS',
    );
  });

  it('[ERR-4] says Not scanned with the reason when the scan did not happen', () => {
    const summary = quandle_render_build_jobSummary(
      ...withNoIgnores(buildNotScannedResult('engine-error', 'the Quandle engine is not available yet')),
    );
    expect(summary).toContain('**Not scanned:**');
    expect(summary).toContain('the Quandle engine is not available yet');
  });

  it('[OUT-1] says there are no findings when a scan is clean', () => {
    expect(quandle_render_build_jobSummary(...withNoIgnores(buildScanResult()))).toContain('No findings.');
  });

  it('[OUT-1] lists every finding including low severity with its severity, state, title, location and id', () => {
    const summary = quandle_render_build_jobSummary(
      ...withNoIgnores(
        buildScanResult({
          findings: [
            buildFinding({ id: 'qf_aaa', severity: 'critical', state: 'new', title: 'Leaked key' }),
            buildFinding({ id: 'qf_bbb', severity: 'low', state: 'existing', title: 'Missing header' }),
          ],
        }),
      ),
    );
    expect(summary).toContain(
      '**critical** · new · Leaked key · `https://app.example.com/assets/index.js` · `qf_aaa`',
    );
    expect(summary).toContain('**low** · existing · Missing header');
    expect(summary).toContain('`qf_bbb`');
  });

  it('[OUT-1] shows the scanned URL and environment in code spans', () => {
    expect(
      quandle_render_build_jobSummary(...withNoIgnores(buildScanResult({ environment: 'Preview' }))),
    ).toContain('`https://app.example.com/` (environment `Preview`)');
  });

  it('[TGT-10] shows only the origin and path of the scanned URL, never its query string', () => {
    const summary = quandle_render_build_jobSummary(
      ...withNoIgnores(
        buildScanResult({ url: 'https://app.example.com/preview?_vercel_share=FAKE_SHARE_TOKEN' }),
      ),
    );
    expect(summary).toContain('`https://app.example.com/preview`');
    expect(summary).not.toContain('FAKE_SHARE_TOKEN');
    expect(summary).not.toContain('_vercel_share');
  });

  it('[TGT-10] shows a placeholder instead of the scanned URL when it cannot be parsed', () => {
    const summary = quandle_render_build_jobSummary(
      ...withNoIgnores(buildScanResult({ url: 'not a url?token=FAKE_SHARE_TOKEN' })),
    );
    expect(summary).toContain('`(unparseable URL)`');
    expect(summary).not.toContain('FAKE_SHARE_TOKEN');
  });

  it('[OUT-1] omits the environment when it is unknown', () => {
    expect(quandle_render_build_jobSummary(...withNoIgnores(buildScanResult()))).not.toContain('environment');
  });

  it('[FND-3] shows redacted evidence in a code span, exactly as the engine gave it', () => {
    const summary = quandle_render_build_jobSummary(
      ...withNoIgnores(buildScanResult({ findings: [buildFinding({ evidence: 'FAKE…1234' })] })),
    );
    expect(summary).toContain('evidence `FAKE…1234`');
  });

  it('[FND-3] escapes an untrusted finding title in the summary', () => {
    const summary = quandle_render_build_jobSummary(
      ...withNoIgnores(buildScanResult({ findings: [buildFinding({ title: '<script>@octocat' })] })),
    );
    expect(summary).not.toContain('<script>');
    expect(summary).not.toMatch(/@octocat/);
  });

  it('[FND-3] escapes an untrusted not-scanned reason in the summary', () => {
    const summary = quandle_render_build_jobSummary(
      ...withNoIgnores(buildNotScannedResult('engine-error', '[x](https://evil.example)')),
    );
    expect(summary).not.toContain('[x](');
  });

  it('[FND-3] escapes severity and state too, in case an unvalidated engine value ever reaches the summary', () => {
    const finding = buildFinding({
      severity: '<img src=x>' as Finding['severity'],
      state: '[x](https://evil.example)' as Finding['state'],
    });
    const summary = quandle_render_build_jobSummary(
      ...withNoIgnores(buildScanResult({ findings: [finding] })),
    );
    expect(summary).not.toContain('<img');
    expect(summary).not.toContain('[x](');
  });

  describe('with the ignore file', () => {
    const ignoredFinding = buildFinding({ id: 'qf_test01', title: 'Ignored test title' });

    it('[IGN-10] leaves an ignored finding out of the findings list', () => {
      const result = buildScanResult({ findings: [ignoredFinding] });
      const outcome = buildIgnoreOutcome({
        ignored: [{ finding: ignoredFinding, reason: 'Public by design' }],
      });
      expect(quandle_render_build_jobSummary(result, outcome)).not.toContain('Ignored test title');
    });

    it('[IGN-10] lists an ignored finding by id with its reason under "Ignored (1)"', () => {
      const result = buildScanResult({ findings: [ignoredFinding] });
      const outcome = buildIgnoreOutcome({
        ignored: [{ finding: ignoredFinding, reason: 'Public by design' }],
      });
      expect(quandle_render_build_jobSummary(result, outcome)).toContain(
        '**Ignored (1)**\n- `qf_test01` · Public by design',
      );
    });

    it('[IGN-10] escapes the ignore reason, so it cannot add HTML, @mentions or links', () => {
      const reason = '<img src=x> @FAKE_USER [click](https://evil.example)';
      const outcome = buildIgnoreOutcome({ ignored: [{ finding: ignoredFinding, reason }] });
      const summary = quandle_render_build_jobSummary(
        buildScanResult({ findings: [ignoredFinding] }),
        outcome,
      );
      expect(summary).not.toContain('<img');
      expect(summary).not.toContain('@FAKE_USER');
      expect(summary).not.toContain('](https');
    });

    it('[OUT-1] lists the ignored findings after the other findings', () => {
      const shownFinding = buildFinding({ id: 'qf_test02' });
      const result = buildScanResult({ findings: [ignoredFinding, shownFinding] });
      const outcome = buildIgnoreOutcome({
        shown: [shownFinding],
        ignored: [{ finding: ignoredFinding, reason: 'Public by design' }],
      });
      const summary = quandle_render_build_jobSummary(result, outcome);
      expect(summary.indexOf('**Ignored (1)**')).toBeGreaterThan(summary.indexOf('`qf_test02`'));
    });

    it('[OUT-1] lists at most 100 ignored findings, then "…and 20 more ignored (not shown)." for 120', () => {
      const ignored = Array.from({ length: 120 }, (_, index) => ({
        finding: buildFinding({ id: `qf_${index}` }),
        reason: 'Test reason',
      }));
      const summary = quandle_render_build_jobSummary(buildScanResult(), buildIgnoreOutcome({ ignored }));
      expect(summary.split('\n').filter((line) => line.endsWith(' · Test reason'))).toHaveLength(100);
      expect(summary).toContain('**Ignored (120)**');
      expect(summary).toContain('…and 20 more ignored (not shown).');
    });

    it('[OUT-1] lists all 100 ignored findings with no "more ignored" line when exactly 100 are ignored', () => {
      const ignored = Array.from({ length: 100 }, (_, index) => ({
        finding: buildFinding({ id: `qf_${index}` }),
        reason: 'Test reason',
      }));
      const summary = quandle_render_build_jobSummary(buildScanResult(), buildIgnoreOutcome({ ignored }));
      expect(summary.split('\n').filter((line) => line.endsWith(' · Test reason'))).toHaveLength(100);
      expect(summary).not.toContain('more ignored');
    });

    it('[OUT-1] says "No findings apart from the ignored ones below." when every finding is ignored', () => {
      const result = buildScanResult({ findings: [ignoredFinding] });
      const outcome = buildIgnoreOutcome({
        ignored: [{ finding: ignoredFinding, reason: 'Public by design' }],
      });
      const summary = quandle_render_build_jobSummary(result, outcome);
      expect(summary).toContain('No findings apart from the ignored ones below.');
      expect(summary).not.toContain('No findings.');
    });

    it('[OUT-1] has no Ignored section when nothing is ignored', () => {
      const summary = quandle_render_build_jobSummary(
        ...withNoIgnores(buildScanResult({ findings: [buildFinding()] })),
      );
      expect(summary).not.toContain('Ignored');
    });

    it('[IGN-2] marks a finding whose ignore expired with "· ignore expired 2026-11-08" at the end of its line', () => {
      const finding = buildFinding({ id: 'qf_test02', state: 'existing' });
      const outcome = buildIgnoreOutcome({ shown: [finding], expired: [{ finding, expires: '2026-11-08' }] });
      const summary = quandle_render_build_jobSummary(buildScanResult({ findings: [finding] }), outcome);
      const line = summary.split('\n').find((text) => text.includes('`qf_test02`'));
      expect(line?.endsWith(' · ignore expired 2026-11-08')).toBe(true);
    });

    it('[OUT-1] sorts an existing high finding whose ignore expired before a new low and an existing critical', () => {
      const expiredHigh = buildFinding({ id: 'qf_expired_high', severity: 'high', state: 'existing' });
      const newLow = buildFinding({ id: 'qf_new_low', severity: 'low', state: 'new' });
      const existingCritical = buildFinding({
        id: 'qf_existing_critical',
        severity: 'critical',
        state: 'existing',
      });
      const shown = [existingCritical, newLow, expiredHigh];
      const outcome = buildIgnoreOutcome({
        shown,
        expired: [{ finding: expiredHigh, expires: '2026-11-08' }],
      });
      const summary = quandle_render_build_jobSummary(buildScanResult({ findings: shown }), outcome);
      const order = ['qf_expired_high', 'qf_new_low', 'qf_existing_critical'].map((id) =>
        summary.indexOf(id),
      );
      expect(order).toEqual([...order].sort((a, b) => a - b));
    });
  });

  describe('active checks (OUT-13)', () => {
    it('[OUT-13] ends the summary with the fixed section, the proof path and the token on its own line when active checks are unverified', () => {
      const result = buildScanResult({
        findings: [buildFinding()],
        activeChecks: { kind: 'unverified', verificationToken: TOKEN },
      });
      const summary = quandle_render_build_jobSummary(...withNoIgnores(result));
      expect(summary.endsWith(UNVERIFIED_SECTION)).toBe(true);
      expect(summary.split('\n')).toContain(`\`${TOKEN}\``);
    });

    it('[OUT-13] puts the unverified section after the findings and the ignored findings', () => {
      const shown = buildFinding({ id: 'qf_shown' });
      const ignored = buildFinding({ id: 'qf_ignored' });
      const result = buildScanResult({
        findings: [shown, ignored],
        activeChecks: { kind: 'unverified', verificationToken: TOKEN },
      });
      const outcome = buildIgnoreOutcome({
        shown: [shown],
        ignored: [{ finding: ignored, reason: 'Test reason' }],
      });
      const summary = quandle_render_build_jobSummary(result, outcome);
      const section = summary.indexOf('**Exposed-file checks did not run.**');
      expect(section).toBeGreaterThan(summary.indexOf('qf_shown'));
      expect(section).toBeGreaterThan(summary.indexOf('qf_ignored'));
    });

    it('[OUT-13] carries exactly one line saying the exposed-file checks ran when active checks ran', () => {
      const result = buildScanResult({ activeChecks: { kind: 'ran' } });
      const summary = quandle_render_build_jobSummary(...withNoIgnores(result));
      expect(summary.split('\n').filter((line) => line === RAN_LINE)).toHaveLength(1);
      expect(summary.endsWith(`\n\n${RAN_LINE}`)).toBe(true);
      expect(summary).not.toContain('did not run');
    });

    it('[OUT-13] says nothing about exposed-file checks when the engine sent no activeChecks', () => {
      const summary = quandle_render_build_jobSummary(...withNoIgnores(buildScanResult()));
      expect(summary).not.toContain('Exposed-file checks');
      expect(summary).not.toContain('quandle.txt');
    });

    it('[OUT-13] says nothing about exposed-file checks in a mock summary', () => {
      const summary = quandle_render_build_jobSummary(...withNoIgnores(buildScanResult({ isMock: true })));
      expect(summary).not.toContain('Exposed-file checks');
    });

    it('[OUT-13] says nothing about exposed-file checks when nothing was scanned', () => {
      const result = buildNotScannedResult('protected', 'the deploy is protected');
      const summary = quandle_render_build_jobSummary(...withNoIgnores(result));
      expect(summary).not.toContain('Exposed-file checks');
    });

    it('[FND-3] shows the token inside one code span that a backtick in it cannot close early', () => {
      const result = buildScanResult({
        activeChecks: { kind: 'unverified', verificationToken: 'qv_`[x](https://evil.example.com)' },
      });
      const summary = quandle_render_build_jobSummary(...withNoIgnores(result));
      expect(summary.split('\n')).toContain("`qv_'[x](https://evil.example.com)`");
    });
  });
});
