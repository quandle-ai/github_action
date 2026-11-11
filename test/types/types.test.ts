// ==========================================================================
// Quandle GitHub Action · test/types/types.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/types.ts
// Also covers (private): none
//
// Proves at compile time that the shared types make illegal states impossible.
// Every `@ts-expect-error` line MUST fail to compile: if a type is ever loosened,
// that line starts compiling, the directive becomes unused, and `npm run typecheck`
// fails. The runtime assertions only confirm the legal counterparts.
// Rules: ERR-4, FND-2, FND-5, IGN-1, IO-1, MOCK-1, OUT-6, SEV-1, TRU-1, TRU-7
// ==========================================================================
import { describe, expect, it } from 'vitest';
import type { ActionRuntime } from '../../src/main';
import type {
  ActiveChecks,
  FailOn,
  Finding,
  IgnoreEntry,
  IgnoreMatch,
  OutputStatus,
  ScanRequest,
  ScanResult,
  ScanStatus,
  Severity,
} from '../../src/types';
import { buildFakeRuntime } from '../helpers/fake-runtime';
import { buildFinding } from '../helpers/builders';

describe('src/types.ts', () => {
  it('[SEV-1] does not allow fail-on low, and derives the other values from the severities', () => {
    // @ts-expect-error SEV-1: fail-on has no "low" threshold.
    const low: FailOn = 'low';
    const thresholds: FailOn[] = ['critical', 'high', 'medium', 'never'];
    expect([low, ...thresholds]).toHaveLength(5);
  });

  it('[ERR-4] does not allow a not-scanned result to carry findings', () => {
    // @ts-expect-error ERR-4: a not-scanned result carries no findings.
    const notScanned: ScanResult = {
      status: 'engine-error',
      reason: 'engine down',
      url: 'https://app.example.com/',
      findings: [buildFinding()],
      isMock: false,
    };
    expect(notScanned.status).toBe('engine-error');
  });

  it('[ERR-4] does not allow a not-scanned result without a reason', () => {
    // @ts-expect-error ERR-4: every not-scanned result says why.
    const withoutReason: ScanResult = {
      status: 'rate-limited',
      url: 'https://app.example.com/',
      findings: [],
      isMock: false,
    };
    expect(withoutReason.status).toBe('rate-limited');
  });

  it('[MOCK-1] does not allow a mock result that was not scanned', () => {
    // @ts-expect-error MOCK-1: mock results are always scanned.
    const notScannedMock: ScanResult = {
      status: 'engine-error',
      reason: 'engine down',
      url: 'https://app.example.com/',
      findings: [],
      isMock: true,
    };
    expect(notScannedMock.isMock).toBe(true);
  });

  it('[OUT-6] treats skipped as an output status, not something a scan can return', () => {
    // @ts-expect-error OUT-6: a skip never produces a scan result.
    const scanSkipped: ScanStatus = 'skipped';
    const outputSkipped: OutputStatus = 'skipped';
    expect([scanSkipped, outputSkipped]).toEqual(['skipped', 'skipped']);
  });

  it('[FND-5] does not allow a finding to be changed after it is produced', () => {
    const finding: Finding = buildFinding();
    // @ts-expect-error FND-5: findings are read-only.
    finding.title = 'changed';
    expect(finding.title).toBe('changed');
  });

  it('[FND-5] does not allow the findings of a scan result to be changed', () => {
    const result: ScanResult = {
      status: 'scanned',
      url: 'https://app.example.com/',
      findings: [buildFinding()],
      isMock: false,
    };
    // @ts-expect-error FND-5: the findings list is read-only.
    result.findings.push(buildFinding());
    expect(result.findings).toHaveLength(2);
  });

  it('[IO-1] does not allow reading an input that action.yml does not declare', () => {
    const runtime: ActionRuntime = buildFakeRuntime();
    // @ts-expect-error IO-1: api-url is not an input; only the declared input names can be read.
    const removed = runtime.getInput('api-url');
    expect(runtime.getInput('fail-on')).toBe('critical');
    expect(removed).toBe('');
  });

  it('[TRU-1] lets only url, environment, production, bypassSecret and contract leave GitHub in a scan request', () => {
    // Exhaustive: adding any field to ScanRequest (repo, commit, source code, …) breaks this line.
    const fields: Record<keyof ScanRequest, true> = {
      url: true,
      environment: true,
      production: true,
      bypassSecret: true,
      contract: true,
    };
    const url = 'https://app.example.com/';
    // @ts-expect-error TRU-1: no source code (or anything else) can be put in a scan request.
    const withSource: ScanRequest = { url, production: false, contract: 2, sourceCode: 'FAKE' };
    expect(Object.keys(fields)).toEqual(['url', 'environment', 'production', 'bypassSecret', 'contract']);
    expect(withSource.url).toBe('https://app.example.com/');
  });

  it('[TRU-1] does not allow a scan request for any contract but 2', () => {
    const url = 'https://app.example.com/';
    // @ts-expect-error TRU-1: this Action understands contract 2 and asks for nothing else.
    const older: ScanRequest = { url, production: false, contract: 1 };
    // @ts-expect-error TRU-1: a scan request always names its contract.
    const unnamed: ScanRequest = { url, production: false };
    expect([older.url, unnamed.url]).toEqual([url, url]);
  });

  it('[TRU-7] gives a verification token only to unverified active checks, and active checks only to a scan', () => {
    // @ts-expect-error TRU-7: active checks that ran have no verification token.
    const ranWithToken: ActiveChecks = { kind: 'ran', verificationToken: 'qv_test' };
    // @ts-expect-error TRU-7: unverified active checks always carry the token.
    const unverifiedWithoutToken: ActiveChecks = { kind: 'unverified' };
    const notScanned: ScanResult = {
      status: 'protected',
      url: 'https://app.example.com/',
      reason: 'test reason',
      findings: [],
      isMock: false,
      // @ts-expect-error TRU-7: only a scan that happened can say whether active checks ran.
      activeChecks: { kind: 'ran' },
    };
    const kinds = [ranWithToken.kind, unverifiedWithoutToken.kind, notScanned.status];
    expect(kinds).toEqual(['ran', 'unverified', 'protected']);
  });

  it('[FND-2] has exactly the four severities critical, high, medium and low', () => {
    // Exhaustive: adding or removing a severity breaks this line.
    const severities: Record<Severity, true> = { critical: true, high: true, medium: true, low: true };
    // @ts-expect-error FND-2: there is no "info" severity.
    const info: Severity = 'info';
    expect([...Object.keys(severities), info]).toHaveLength(5);
  });

  it('[IGN-1] does not allow an ignore match with both id and rule, or with neither', () => {
    // @ts-expect-error IGN-1: an entry matches by id or by rule, never both.
    const both: IgnoreMatch = { kind: 'id', id: 'qf_test01', rule: 'secret/test' };
    // @ts-expect-error IGN-1: an entry must match something.
    const neither: IgnoreMatch = { kind: 'id' };
    expect([both.kind, neither.kind]).toEqual(['id', 'id']);
  });

  it('[IGN-1] does not allow an ignore entry to be changed after it is checked', () => {
    const entry: IgnoreEntry = {
      match: { kind: 'rule', rule: 'secret/test' },
      reason: 'x',
      expires: '2027-02-01',
    };
    // @ts-expect-error IGN-1: checked entries are read-only, like every shared value.
    entry.expires = '2099-01-01';
    expect(entry.expires).toBe('2099-01-01');
  });
});
