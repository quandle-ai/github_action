// ==========================================================================
// Quandle GitHub Action · test/main/quandle_main_run_action/public-repo.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/main.ts → quandle_main_run_action (public repositories, through a fake engine)
// Also covers (private): quandle_main_upload_withheldDetail, quandle_main_read_repositoryVisibility;
// and src/report/render.ts → quandle_render_build_codeScanningSarif
//
// Proves that on a public repository a secret or exposed-file finding is listed in the job
// summary, the PR comment and the production issue without its location or evidence; that
// the detail is uploaded once as a SARIF file for the scanned commit and the default branch,
// before anything is written, holding exactly the withheld findings still exposed, each located
// by one fixed relative placeholder path and never by an https URL; that every
// output says where the detail is, or how to turn it on when the upload was not accepted; and
// that a failed upload only warns. A repository whose visibility the event does not state
// counts as public.
// Pinning tests (they pass before the rules are implemented, and must be proven with a planted
// bug once they are): the three "private repository" tests, the "header finding" tests, the
// "mock" tests, "no finding is withheld", "the only withheld finding is ignored", "lists no
// withheld finding" and "outputs".
// Rules: PUB-1, PUB-2, PUB-3, PUB-4, PUB-5
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_main_run_action } from '../../../src/main';
import type { EventContext } from '../../../src/types';
import { engineAnswer } from '../../helpers/fake-engine';
import type { FakeRuntime, FakeRuntimeOptions } from '../../helpers/fake-runtime';
import { buildFakeRuntime } from '../../helpers/fake-runtime';

const NEWLINE = String.fromCharCode(10);
// A bidirectional override, written by code so the file holds no invisible character.
const RIGHT_TO_LEFT_OVERRIDE = String.fromCharCode(0x202e);

// PUB-5: the two fixed lines.
const UPLOADED_LINE =
  "Location and evidence for secret and exposed-file findings are in this repository's code scanning alerts (Security tab), visible only to people with write access.";
const WITHHELD_LINE =
  "Location and evidence for secret and exposed-file findings are withheld because this repository is public. To see them in code scanning alerts, add `security-events: write` to the workflow's permissions.";
const MISSING_PERMISSION = 'GitHub API returned 403 (does the workflow grant `security-events: write`?)';

const PUBLIC_REPOSITORY = { private: false, default_branch: 'main' };
const PRIVATE_REPOSITORY = { private: true, default_branch: 'main' };
const OPEN_PR = { number: 7, isOpen: true, headSha: 'deploy-sha' };

// A preview deploy of a repository with this `repository` object in its event (none when undefined).
function deployEvent(repository?: unknown): EventContext {
  return {
    eventName: 'deployment_status',
    sha: 'deploy-sha',
    payload: {
      deployment_status: { state: 'success', environment_url: 'https://preview.example.com/' },
      deployment: { sha: 'deploy-sha', environment: 'Preview' },
      ...(repository === undefined ? {} : { repository }),
    },
  };
}

// Scan now: reported in the production issue.
function scanNowEvent(repository: unknown): EventContext {
  return { eventName: 'workflow_dispatch', sha: 'context-sha', payload: { repository } };
}

const SECRET_PATH = 'assets/index.js';
const SECRET_EVIDENCE = 'FAKE…REDACTED';
const FILE_PATH = 'preview.example.com/.env';
const HEADER_PATH = 'preview.example.com/checkout';

const SECRET = {
  id: 'qf_secret01',
  rule: 'secret/test',
  severity: 'critical',
  state: 'new',
  title: 'Test secret in shipped JavaScript',
  location: `https://preview.example.com/${SECRET_PATH}`,
  evidence: SECRET_EVIDENCE,
};
const EXPOSED_FILE = {
  id: 'qf_file01',
  rule: 'file/env',
  severity: 'high',
  state: 'new',
  title: 'Exposed environment file',
  location: `https://${FILE_PATH}`,
};
const HEADER = {
  id: 'qf_header01',
  rule: 'header/csp-missing',
  severity: 'medium',
  state: 'new',
  title: 'No Content-Security-Policy header',
  location: `https://${HEADER_PATH}`,
};
const FIXED_SECRET = { ...SECRET, id: 'qf_secret02', state: 'resolved' };
const ALL_FINDINGS = [SECRET, EXPOSED_FILE, HEADER, FIXED_SECRET];

const SECRET_LINE = '- **critical** · new · Test secret in shipped JavaScript · `qf_secret01`';
const EXPOSED_FILE_LINE = '- **high** · new · Exposed environment file · `qf_file01`';
const HEADER_LINE = `- **medium** · new · No Content-Security-Policy header · \`https://${HEADER_PATH}\` · \`qf_header01\``;

function ignoreFileFor(id: string): string {
  return ['ignore:', `  - id: ${id}`, '    reason: "Test reason"', '    expires: 2027-02-01', ''].join(
    NEWLINE,
  );
}

// A run against a fake engine that answers with these findings. A public preview deploy with an
// open PR unless the options say otherwise. fail-on is never, so only an upload could fail the job.
function buildRuntime(findings: readonly unknown[], options: FakeRuntimeOptions = {}): FakeRuntime {
  const respond = engineAnswer({ status: 'scanned', scanId: 'scan_public01', findings });
  return buildFakeRuntime({
    event: deployEvent(PUBLIC_REPOSITORY),
    ...options,
    inputs: { mock: 'false', 'fail-on': 'never', ...options.inputs },
    github: { pullRequests: [OPEN_PR], ...options.github },
    engine: { respond },
  });
}

async function runWith(findings: readonly unknown[], options: FakeRuntimeOptions = {}): Promise<FakeRuntime> {
  const runtime = buildRuntime(findings, options);
  await quandle_main_run_action(runtime);
  return runtime;
}

function readSummary(runtime: FakeRuntime): string {
  return runtime.summaries.join(NEWLINE);
}

// The body of the one comment or issue the run wrote.
function readWrittenBody(runtime: FakeRuntime): string {
  expect(runtime.github.written).toHaveLength(1);
  return runtime.github.written[0]?.body ?? '';
}

interface SarifResult {
  ruleId?: unknown;
  level?: unknown;
  message?: { text?: unknown };
  partialFingerprints?: { quandleFindingId?: unknown };
  locations?: unknown;
}

interface SarifRun {
  tool?: { driver?: { name?: unknown } };
  results?: SarifResult[];
}

// The one run inside the one SARIF file the run uploaded.
function readUploadedRun(runtime: FakeRuntime): SarifRun {
  expect(runtime.github.sarifUploads).toHaveLength(1);
  const file = JSON.parse(runtime.github.sarifUploads[0]?.sarif ?? '{}') as { runs?: SarifRun[] };
  expect(file.runs).toHaveLength(1);
  return file.runs?.[0] ?? {};
}

function readUploadedResults(runtime: FakeRuntime): SarifResult[] {
  return readUploadedRun(runtime).results ?? [];
}

describe('quandle_main_run_action', () => {
  describe('on a public repository', () => {
    it('[PUB-2] lists a secret finding in the job summary with severity, state, title and id only', async () => {
      const runtime = await runWith(ALL_FINDINGS);
      expect(readSummary(runtime).split(NEWLINE)).toContain(SECRET_LINE);
    });

    it('[PUB-2] lists an exposed-file finding in the job summary with severity, state, title and id only', async () => {
      const runtime = await runWith(ALL_FINDINGS);
      expect(readSummary(runtime).split(NEWLINE)).toContain(EXPOSED_FILE_LINE);
    });

    it('[PUB-2] never puts the location of a secret or exposed-file finding in the job summary', async () => {
      const summary = readSummary(await runWith(ALL_FINDINGS));
      expect(summary).toContain('qf_secret01');
      expect(summary).not.toContain(SECRET_PATH);
      expect(summary).not.toContain(FILE_PATH);
    });

    it('[PUB-2] never puts the evidence of a secret finding in the job summary', async () => {
      const summary = readSummary(await runWith(ALL_FINDINGS));
      expect(summary).toContain('qf_secret01');
      expect(summary).not.toContain(SECRET_EVIDENCE);
    });

    it('[PUB-2] never puts the location of a resolved secret finding in the job summary', async () => {
      const summary = readSummary(await runWith([FIXED_SECRET]));
      expect(summary).toContain('qf_secret02');
      expect(summary).not.toContain(SECRET_PATH);
    });

    it('[PUB-2] lists secret and exposed-file findings in the PR comment with severity, state, title and id only', async () => {
      const lines = readWrittenBody(await runWith(ALL_FINDINGS)).split(NEWLINE);
      expect(lines).toContain(SECRET_LINE);
      expect(lines).toContain(EXPOSED_FILE_LINE);
    });

    it('[PUB-2] never puts the location or evidence of a secret or exposed-file finding in the PR comment', async () => {
      const comment = readWrittenBody(await runWith(ALL_FINDINGS));
      expect(comment).toContain('qf_secret01');
      expect(comment).not.toContain(SECRET_PATH);
      expect(comment).not.toContain(SECRET_EVIDENCE);
      expect(comment).not.toContain(FILE_PATH);
    });

    it('[PUB-2] never puts the location or evidence of a secret or exposed-file finding in the production issue', async () => {
      const issue = readWrittenBody(await runWith(ALL_FINDINGS, { event: scanNowEvent(PUBLIC_REPOSITORY) }));
      expect(issue).toContain('qf_secret01');
      expect(issue).not.toContain(SECRET_PATH);
      expect(issue).not.toContain(SECRET_EVIDENCE);
      expect(issue).not.toContain(FILE_PATH);
    });

    it('[PUB-2] keeps the fixed behind-protection label on a withheld finding', async () => {
      const summary = readSummary(await runWith([{ ...EXPOSED_FILE, behindProtection: true }]));
      expect(summary.split(NEWLINE)).toContain(
        `${EXPOSED_FILE_LINE} · behind protection on this deployment, public once promoted`,
      );
    });

    it('[PUB-2] still shows a header finding in full in the job summary', async () => {
      const runtime = await runWith(ALL_FINDINGS);
      expect(readSummary(runtime).split(NEWLINE)).toContain(HEADER_LINE);
    });

    it('[PUB-2] still shows a header finding in full in the PR comment', async () => {
      expect(readWrittenBody(await runWith(ALL_FINDINGS)).split(NEWLINE)).toContain(HEADER_LINE);
    });

    it('[PUB-2] shows a mock secret finding in full, since mock findings are not real', async () => {
      const runtime = await runWith([], { inputs: { mock: 'true', 'mock-scenario': 'critical' } });
      expect(readSummary(runtime)).toContain('assets/index-mock.js');
    });

    it('[PUB-2] sets the same outputs as a private repository for the same findings', async () => {
      const runtime = await runWith(ALL_FINDINGS);
      expect(runtime.outputs).toEqual({
        'new-findings': 3,
        critical: 1,
        'scan-id': 'scan_public01',
        status: 'scanned',
      });
    });
  });

  describe('deciding whether the repository is public', () => {
    it('[PUB-1] shows a secret finding in full when repository.private is true', async () => {
      const summary = readSummary(await runWith([SECRET], { event: deployEvent(PRIVATE_REPOSITORY) }));
      expect(summary).toContain(SECRET_PATH);
      expect(summary).toContain(SECRET_EVIDENCE);
    });

    it('[PUB-1] shows a secret finding in full in the PR comment when repository.private is true', async () => {
      const runtime = await runWith([SECRET], { event: deployEvent(PRIVATE_REPOSITORY) });
      expect(readWrittenBody(runtime)).toContain(SECRET_PATH);
    });

    it('[PUB-1] uploads nothing when repository.private is true', async () => {
      const runtime = await runWith(ALL_FINDINGS, { event: deployEvent(PRIVATE_REPOSITORY) });
      expect(runtime.github.calls).not.toContain('uploadSarif');
    });

    it.each([
      ['has no repository', undefined],
      ['has a repository with no private field', { default_branch: 'main' }],
      ['says private: "true" as text', { private: 'true', default_branch: 'main' }],
      ['says private: null', { private: null, default_branch: 'main' }],
    ])('[PUB-1] withholds the location of a secret finding when the event %s', async (_label, repository) => {
      const summary = readSummary(await runWith([SECRET], { event: deployEvent(repository) }));
      expect(summary).toContain('qf_secret01');
      expect(summary).not.toContain(SECRET_PATH);
    });
  });

  describe('uploading the withheld detail', () => {
    it('[PUB-3] uploads one SARIF file for the scanned commit and the default branch', async () => {
      const runtime = await runWith(ALL_FINDINGS);
      expect(runtime.github.sarifUploads).toEqual([
        { commitSha: 'deploy-sha', ref: 'refs/heads/main', sarif: expect.any(String) },
      ]);
    });

    it('[PUB-3] uploads for the event commit and the default branch on a Scan now run', async () => {
      const repository = { private: false, default_branch: 'trunk' };
      const runtime = await runWith([SECRET], { event: scanNowEvent(repository) });
      expect(runtime.github.sarifUploads).toEqual([
        { commitSha: 'context-sha', ref: 'refs/heads/trunk', sarif: expect.any(String) },
      ]);
    });

    it('[PUB-3] uploads with the github-token', async () => {
      const runtime = await runWith([SECRET]);
      expect(runtime.github.calls).toContain('uploadSarif');
      expect(new Set(runtime.gitHubTokens)).toEqual(new Set(['FAKE_GITHUB_TOKEN']));
    });

    it('[PUB-3] uploads before the PR comment is written', async () => {
      const { calls } = (await runWith([SECRET])).github;
      expect(calls).toContain('uploadSarif');
      expect(calls.indexOf('uploadSarif')).toBeLessThan(calls.indexOf('createPullRequestComment:7'));
    });

    it('[PUB-3] uploads even when the PR comment and the production issue are turned off', async () => {
      const runtime = await runWith([SECRET], { inputs: { comment: 'false', issue: 'false' } });
      expect(runtime.github.sarifUploads).toHaveLength(1);
    });

    it('[PUB-3] uploads nothing when no finding is withheld', async () => {
      const runtime = await runWith([HEADER]);
      expect(runtime.github.calls).not.toContain('uploadSarif');
    });

    it('[PUB-3] uploads nothing when the only withheld finding is ignored', async () => {
      const runtime = await runWith([SECRET, HEADER], {
        github: { ignoreFile: ignoreFileFor('qf_secret01') },
      });
      expect(readSummary(runtime)).toContain('**Ignored (1)**');
      expect(runtime.github.calls).not.toContain('uploadSarif');
    });

    it('[PUB-3] uploads nothing for a mock result', async () => {
      const runtime = await runWith([], { inputs: { mock: 'true', 'mock-scenario': 'critical' } });
      expect(runtime.github.calls).not.toContain('uploadSarif');
    });
  });

  describe('the uploaded file', () => {
    it('[PUB-4] has one run from the tool Quandle', async () => {
      expect(readUploadedRun(await runWith(ALL_FINDINGS)).tool?.driver?.name).toBe('Quandle');
    });

    it('[PUB-4] has one result for each withheld finding still exposed, and none for a header or resolved finding', async () => {
      const results = readUploadedResults(await runWith(ALL_FINDINGS));
      expect(results.map((result) => result.partialFingerprints?.quandleFindingId)).toEqual([
        'qf_secret01',
        'qf_file01',
      ]);
    });

    it('[PUB-4] gives each result the rule of its finding as ruleId', async () => {
      const results = readUploadedResults(await runWith(ALL_FINDINGS));
      expect(results.map((result) => result.ruleId)).toEqual(['secret/test', 'file/env']);
    });

    it.each([
      ['critical', 'error'],
      ['high', 'error'],
      ['medium', 'warning'],
      ['low', 'note'],
    ])('[PUB-4] gives a %s finding the level %s', async (severity, level) => {
      const results = readUploadedResults(await runWith([{ ...SECRET, severity }]));
      expect(results.map((result) => result.level)).toEqual([level]);
    });

    it('[PUB-4] gives the title, the location and the redacted evidence in the message of a result', async () => {
      const [result] = readUploadedResults(await runWith([SECRET]));
      const text = String(result?.message?.text);
      expect(text).toContain('Test secret in shipped JavaScript');
      expect(text).toContain(`https://preview.example.com/${SECRET_PATH}`);
      expect(text).toContain(SECRET_EVIDENCE);
    });

    it('[PUB-4] gives each result exactly one location, the fixed relative path quandle/deployed-site', async () => {
      const results = readUploadedResults(await runWith(ALL_FINDINGS));
      expect(results).toHaveLength(2);
      for (const result of results) {
        expect(result.locations).toEqual([
          { physicalLocation: { artifactLocation: { uri: 'quandle/deployed-site' } } },
        ]);
      }
    });

    it('[PUB-4] never uses the https location of a finding as the location of its result', async () => {
      const [result] = readUploadedResults(await runWith([SECRET]));
      expect(result).toBeDefined();
      expect(JSON.stringify(result?.locations ?? [])).not.toContain('https:');
    });

    it('[PUB-4] leaves an ignored finding out of the file', async () => {
      const runtime = await runWith([SECRET, EXPOSED_FILE], {
        github: { ignoreFile: ignoreFileFor('qf_file01') },
      });
      const results = readUploadedResults(runtime);
      expect(results.map((result) => result.partialFingerprints?.quandleFindingId)).toEqual(['qf_secret01']);
    });

    it('[PUB-4] uploads a file with no results when every withheld finding is resolved', async () => {
      const runtime = await runWith([FIXED_SECRET, HEADER]);
      expect(readUploadedRun(runtime).results).toEqual([]);
    });

    it('[PUB-4] removes new lines and invisible characters from engine text in the file', async () => {
      const evidence = `FAKE${RIGHT_TO_LEFT_OVERRIDE}…RE${NEWLINE}DACTED`;
      const [result] = readUploadedResults(await runWith([{ ...SECRET, evidence }]));
      const text = String(result?.message?.text);
      expect(text).toContain('FAKE…RE DACTED');
      expect(text).not.toContain(NEWLINE);
      expect(text).not.toContain(RIGHT_TO_LEFT_OVERRIDE);
    });

    it('[PUB-4] caps engine text in the file at 200 characters', async () => {
      const title = 'T'.repeat(300);
      const [result] = readUploadedResults(await runWith([{ ...SECRET, title }]));
      const text = String(result?.message?.text);
      expect(text).toContain('T'.repeat(199));
      expect(text).not.toContain('T'.repeat(201));
    });
  });

  describe('saying where the detail is', () => {
    it('[PUB-5] says in the job summary that the detail is in code scanning alerts when the upload is accepted', async () => {
      expect(readSummary(await runWith(ALL_FINDINGS)).split(NEWLINE)).toContain(UPLOADED_LINE);
    });

    it('[PUB-5] says in the PR comment that the detail is in code scanning alerts when the upload is accepted', async () => {
      expect(readWrittenBody(await runWith(ALL_FINDINGS)).split(NEWLINE)).toContain(UPLOADED_LINE);
    });

    it('[PUB-5] says in the production issue that the detail is in code scanning alerts when the upload is accepted', async () => {
      const runtime = await runWith(ALL_FINDINGS, { event: scanNowEvent(PUBLIC_REPOSITORY) });
      expect(readWrittenBody(runtime).split(NEWLINE)).toContain(UPLOADED_LINE);
    });

    it('[PUB-5] says nothing about withheld detail in an output that lists no withheld finding', async () => {
      const summary = readSummary(await runWith([HEADER]));
      expect(summary).toContain('qf_header01');
      expect(summary).not.toContain('code scanning');
    });

    describe('when the workflow lacks security-events: write', () => {
      const WITHOUT_PERMISSION: FakeRuntimeOptions = {
        github: { failingMethod: 'uploadSarif', failureReason: MISSING_PERMISSION },
      };

      it('[PUB-5] says in the job summary that the detail is withheld and how to turn it on', async () => {
        const summary = readSummary(await runWith(ALL_FINDINGS, WITHOUT_PERMISSION));
        expect(summary.split(NEWLINE)).toContain(WITHHELD_LINE);
      });

      it('[PUB-5] says in the PR comment that the detail is withheld and how to turn it on', async () => {
        const comment = readWrittenBody(await runWith(ALL_FINDINGS, WITHOUT_PERMISSION));
        expect(comment.split(NEWLINE)).toContain(WITHHELD_LINE);
      });

      it('[PUB-5] says in the production issue that the detail is withheld and how to turn it on', async () => {
        const runtime = await runWith(ALL_FINDINGS, {
          ...WITHOUT_PERMISSION,
          event: scanNowEvent(PUBLIC_REPOSITORY),
        });
        expect(readWrittenBody(runtime).split(NEWLINE)).toContain(WITHHELD_LINE);
      });

      it('[PUB-5] still withholds the location and evidence from the job summary', async () => {
        const summary = readSummary(await runWith(ALL_FINDINGS, WITHOUT_PERMISSION));
        expect(summary.split(NEWLINE)).toContain(SECRET_LINE);
        expect(summary).not.toContain(SECRET_PATH);
      });

      it('[PUB-5] warns once with our own reason', async () => {
        const runtime = await runWith(ALL_FINDINGS, WITHOUT_PERMISSION);
        expect(runtime.warnings).toEqual([
          `Quandle: could not upload finding detail to code scanning (${MISSING_PERMISSION}).`,
        ]);
      });

      it('[PUB-5] does not fail the job, and still reports the scan as scanned', async () => {
        const runtime = await runWith(ALL_FINDINGS, WITHOUT_PERMISSION);
        expect(runtime.github.calls).toContain('uploadSarif');
        expect(runtime.failures).toEqual([]);
        expect(runtime.outputs.status).toBe('scanned');
      });
    });

    it('[PUB-5] says the detail is withheld when GitHub answers the upload with a 500', async () => {
      const runtime = await runWith(ALL_FINDINGS, { github: { failingMethod: 'uploadSarif' } });
      expect(readSummary(runtime).split(NEWLINE)).toContain(WITHHELD_LINE);
    });

    it('[PUB-5] says the detail is withheld, and warns with our reason, when the GitHub API cannot be set up', async () => {
      const runtime = await runWith(ALL_FINDINGS, { gitHubUnavailableReason: 'FAKE_UNAVAILABLE_REASON' });
      expect(readSummary(runtime).split(NEWLINE)).toContain(WITHHELD_LINE);
      expect(runtime.warnings).toContain(
        'Quandle: could not upload finding detail to code scanning (FAKE_UNAVAILABLE_REASON).',
      );
    });

    it('[PUB-5] says the detail is withheld, without calling GitHub, when the event names no default branch', async () => {
      const runtime = await runWith(ALL_FINDINGS, { event: deployEvent({ private: false }) });
      expect(readSummary(runtime).split(NEWLINE)).toContain(WITHHELD_LINE);
      expect(runtime.github.calls).not.toContain('uploadSarif');
    });
  });
});
