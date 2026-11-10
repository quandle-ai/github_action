// ==========================================================================
// Quandle GitHub Action · src/scan/severity.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Decides whether a scan fails the job, from the findings (as sorted by the ignore
// file) and the fail-on input. Only new findings, or findings whose ignore expired,
// at or above the threshold count.
// Pure: no network, no @actions imports.
// Rules: SEV-1 … SEV-4, FND-1, IO-2, IGN-2, IGN-10, OUT-6
// ==========================================================================
import type { FailOn, Finding, IgnoreOutcome, Parsed, Severity } from '../types';

// Every fail-on value exactly once: TypeScript errors if one is missing or extra (SEV-1).
// The list and the error message are both derived from this, so they can never drift.
const FAIL_ON_VALUE_SET: Readonly<Record<FailOn, true>> = {
  critical: true,
  high: true,
  medium: true,
  never: true,
};
// Object.keys returns string[]; the keys are exactly FailOn by construction above.
const FAIL_ON_VALUES = Object.keys(FAIL_ON_VALUE_SET) as FailOn[];

// The one ranking of severities (higher = more severe), shared by fail-on and the summary order.
export const SEVERITY_RANK: Readonly<Record<Severity, number>> = { low: 0, medium: 1, high: 2, critical: 3 };

// Validates the fail-on input, in any letter case but with no trimming.
// Returns: ok with the lowercase threshold, or a config-error reason listing the allowed values.
// Rules: SEV-1, IO-2
export function quandle_severity_parse_failOnInput(raw: string): Parsed<FailOn> {
  const normalised = raw.toLowerCase();
  const match = FAIL_ON_VALUES.find((value) => value === normalised);
  if (match === undefined) {
    return { ok: false, reason: `Quandle: \`fail-on\` must be one of: ${FAIL_ON_VALUES.join(', ')}.` };
  }
  return { ok: true, value: match };
}

// Decides whether this scan should fail the job, after the ignore file has sorted the findings.
// Only shown NEW findings and findings whose ignore expired count; ignored findings never do.
// Returns: true when one of those is at or above fail-on; always false for "never".
// Rules: SEV-2, SEV-3, SEV-4, FND-1, IGN-2, IGN-10
export function quandle_severity_check_shouldFailJob(outcome: IgnoreOutcome, failOn: FailOn): boolean {
  if (failOn === 'never') return false;
  return quandle_severity_get_failableFindings(outcome).some((finding) =>
    quandle_severity_check_isAtOrAboveFailOn(finding, failOn),
  );
}

// The findings that can fail the job, and that the new-findings and critical outputs count:
// shown new findings, and shown findings whose ignore expired. Never an ignored finding.
// Returns: those findings, in their shown order.
// Rules: OUT-6, SEV-2, IGN-2, IGN-10
export function quandle_severity_get_failableFindings(outcome: IgnoreOutcome): readonly Finding[] {
  // IGN-2: a lapsed ignore counts as if the finding were new. A Set of the findings themselves,
  // so a new finding whose ignore also expired is counted once.
  const lapsed = new Set(outcome.expired.map((expired) => expired.finding));
  return outcome.shown.filter((finding) => finding.state === 'new' || lapsed.has(finding));
}

// One finding against the threshold, whatever its state.
// Returns: true when its severity ranks at or above fail-on.
// Rules: SEV-2
function quandle_severity_check_isAtOrAboveFailOn(
  finding: Finding,
  failOn: Exclude<FailOn, 'never'>,
): boolean {
  return SEVERITY_RANK[finding.severity] >= SEVERITY_RANK[failOn];
}
