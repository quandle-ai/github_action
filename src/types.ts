// ==========================================================================
// Quandle GitHub Action · src/types.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Shared types for the whole Action: findings, scan results, inputs and targets.
// Mirrors the Quandle engine request/response contract. Built so illegal states
// cannot be written down (proved in test/types/types.test.ts). Everything shared
// is read-only (FND-5). No runtime code, imports nothing.
// Rules: FND-1, FND-2, FND-5, OUT-6, SEV-1, MOCK-1, IO-1, ERR-4, IGN-1, IGN-2, IGN-10
// ==========================================================================

// FND-2. The one list of severities; FailOn is derived from it.
export type Severity = 'critical' | 'high' | 'medium' | 'low';

// FND-1. Compared with the repo's production baseline; `already-present` = found before that baseline exists.
export type FindingState = 'new' | 'existing' | 'resolved' | 'already-present';

// FND-5: read-only once the engine (or the mock) has produced it.
export interface Finding {
  // Engine fingerprint. Shown in every summary/comment so it can be ignored by id.
  readonly id: string;
  // Category, e.g. `secret/openai`, `header/csp-missing`.
  readonly rule: string;
  readonly severity: Severity;
  readonly state: FindingState;
  readonly title: string;
  // Page or file where it was found. Never contains the secret.
  readonly location: string;
  // Engine-redacted evidence (FND-3). Never shown in any other form.
  readonly evidence?: string;
}

// What a scan request can come back as (from the engine, or the mock). Everything except
// `scanned` is a fail-open "Not scanned" outcome. Skips are not here: a skip never reaches
// a scan, so it exists only as an output status (OUT-6).
export type ScanStatus = 'scanned' | 'protected' | 'engine-error' | 'rate-limited';

interface ScanResultBase {
  readonly url: string;
  readonly environment?: string;
  readonly scanId?: string;
}

// A scan that happened (findings, maybe a mock), or one that didn't: that one always says
// why, has no findings (ERR-4), and is never a mock (MOCK-1).
export type ScanResult =
  | (ScanResultBase & {
      readonly status: 'scanned';
      readonly findings: readonly Finding[];
      readonly isMock: boolean;
    })
  | (ScanResultBase & {
      readonly status: Exclude<ScanStatus, 'scanned'>;
      readonly reason: string;
      readonly findings: readonly [];
      readonly isMock: false;
    });

// TRU-1: the only fields that leave GitHub in a scan request. Repo and commit come from the OIDC
// token (TRU-2). Never source code. Adding a field here is a trust-boundary change.
export interface ScanRequest {
  readonly url: string;
  readonly environment?: string;
  // TRU-1: the same production decision as TGT-11, never from the environment name (TGT-9).
  readonly production: boolean;
  readonly bypassSecret?: string;
}

// OUT-6: every value the `status` output can take.
export type OutputStatus = ScanStatus | 'skipped' | 'mock' | 'config-error' | 'internal-error';

// SEV-1. Derived from Severity, so a renamed severity can never leave fail-on behind.
export type FailOn = Exclude<Severity, 'low'> | 'never';

// MOCK-1.
export type MockScenario = 'clean' | 'critical' | 'fixed' | 'first-scan';

// IO-1: the only input names that exist. action.yml declares exactly these (contract test), and
// ActionRuntime.getInput accepts only these, so a typo or a removed input is a type error.
export type InputName =
  'url' | 'fail-on' | 'comment' | 'issue' | 'bypass-secret' | 'mock' | 'mock-scenario' | 'github-token';

// IO-1, after validation.
export interface Inputs {
  readonly url?: string;
  readonly failOn: FailOn;
  readonly isCommentEnabled: boolean;
  readonly isIssueEnabled: boolean;
  readonly bypassSecret?: string;
  readonly isMockEnabled: boolean;
  readonly mockScenario: MockScenario;
  readonly githubToken: string;
}

// IGN-1: an ignore entry matches by finding id or by rule, never both and never neither.
export type IgnoreMatch =
  { readonly kind: 'id'; readonly id: string } | { readonly kind: 'rule'; readonly rule: string };

// IGN-1, after validation (IGN-4). Read-only like every other shared value.
export interface IgnoreEntry {
  readonly match: IgnoreMatch;
  readonly reason: string;
  // YYYY-MM-DD, already checked to be a real calendar date (IGN-7).
  readonly expires: string;
}

// IGN-10: a finding an active entry hides, with that entry's reason (IGN-5).
export interface IgnoredFinding {
  readonly finding: Finding;
  readonly reason: string;
}

// IGN-2: a shown finding whose only matching entries have expired, with the first one's date (file order).
export interface ExpiredIgnore {
  readonly finding: Finding;
  readonly expires: string;
}

// The findings sorted by the ignore file. The findings themselves are never changed (FND-5).
export interface IgnoreOutcome {
  // Every finding not ignored, in the original order.
  readonly shown: readonly Finding[];
  readonly ignored: readonly IgnoredFinding[];
  // A subset of `shown`: new or existing findings matched only by expired entries.
  readonly expired: readonly ExpiredIgnore[];
}

// A validated value, or the one-line reason it was rejected.
export type Parsed<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

// TGT-*: what to scan, or why not.
export type Target =
  | {
      readonly kind: 'scan';
      readonly url: string;
      readonly environment?: string;
      readonly sha: string;
      // Deploy vs "Scan now"/schedule. Chooses PR comment vs production issue (TGT-6, OUT-4).
      readonly source: 'deployment' | 'manual';
      // TGT-11: true for Scan now/schedule, for a deploy whose payload says production_environment: true,
      // and (set by main) for a deploy whose commit is the default branch's head.
      readonly isProductionEnvironment: boolean;
    }
  | { readonly kind: 'skip'; readonly reason: string }
  | { readonly kind: 'error'; readonly reason: string };

// The parts of the GitHub event the Action reads. `payload` is untrusted until validated.
export interface EventContext {
  readonly eventName: string;
  readonly sha: string;
  readonly payload: unknown;
}
