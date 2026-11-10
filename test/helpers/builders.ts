// ==========================================================================
// Quandle GitHub Action · test/helpers/builders.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Fixture builders for findings, scan results and ignore entries used across the tests.
// All values are obviously fake; never realistic key formats.
// ==========================================================================
import type { Finding, IgnoreEntry, IgnoreOutcome, ScanResult, ScanStatus } from '../../src/types';

export function buildFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'qf_test01',
    rule: 'secret/test',
    severity: 'critical',
    state: 'new',
    title: 'Test secret in shipped JavaScript',
    location: 'https://app.example.com/assets/index.js',
    ...overrides,
  };
}

// A finding whose every text field is at the 200-character cap, with a title that escapes to about
// 1,000 characters (each `&` becomes `&amp;`): one rendered line is about 1,650 characters. The index
// keeps ids distinct. For the comment and issue size limit (OUT-8, OUT-11).
export function buildOversizedFinding(index: number, overrides: Partial<Finding> = {}): Finding {
  return buildFinding({
    id: `qf_${index}_`.padEnd(200, 'x'),
    title: '&'.repeat(200),
    location: `https://app.example.com/${'a'.repeat(200)}`,
    evidence: 'FAKE'.repeat(50),
    ...overrides,
  });
}

type ScanResultFields = Omit<Extract<ScanResult, { status: 'scanned' }>, 'status'>;

export function buildScanResult(overrides: Partial<ScanResultFields> = {}): ScanResult {
  return {
    status: 'scanned',
    url: 'https://app.example.com/',
    scanId: 'scan_test01',
    findings: [],
    isMock: false,
    ...overrides,
  };
}

// A not-scanned result: always has a reason, never findings, never a mock (ERR-4, MOCK-1).
export function buildNotScannedResult(
  status: Exclude<ScanStatus, 'scanned'>,
  reason: string,
  overrides: Partial<Pick<ScanResultFields, 'url' | 'environment' | 'scanId'>> = {},
): ScanResult {
  return {
    url: 'https://app.example.com/',
    ...overrides,
    status,
    reason,
    findings: [],
    isMock: false,
  };
}

// An active ignore entry for buildFinding()'s id, unless overridden.
export function buildIgnoreEntry(overrides: Partial<IgnoreEntry> = {}): IgnoreEntry {
  return {
    match: { kind: 'id', id: 'qf_test01' },
    reason: 'Test reason',
    expires: '2027-02-01',
    ...overrides,
  };
}

// A result with an outcome that ignores nothing: every finding is shown. Spread into a render call.
export function withNoIgnores<Result extends ScanResult>(result: Result): [Result, IgnoreOutcome] {
  return [result, buildIgnoreOutcome({ shown: result.findings })];
}

// Findings sorted by the ignore file; empty unless overridden.
export function buildIgnoreOutcome(overrides: Partial<IgnoreOutcome> = {}): IgnoreOutcome {
  return { shown: [], ignored: [], expired: [], ...overrides };
}
