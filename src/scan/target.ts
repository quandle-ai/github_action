// ==========================================================================
// Quandle GitHub Action · src/scan/target.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Decides what to scan for each GitHub event: the URL, environment and commit,
// or why to skip, or which config error to report. Validates every scan URL.
// Pure: no network, no @actions imports. Reads the event payload as untrusted.
// Rules: TGT-1 … TGT-11
// ==========================================================================
import type { EventContext, Parsed, Target } from '../types';

// Longest scan URL we accept (TGT-8).
export const MAX_SCAN_URL_LENGTH = 2048;
// TGT-1: the engine accepts an environment name of at most 100 bytes (UTF-8).
const MAX_ENVIRONMENT_BYTES = 100;
const ALLOWED_SCAN_URL_PROTOCOLS: readonly string[] = ['https:', 'http:'];

// Every field is always present after reading; undefined means missing or the wrong type in the payload.
interface DeploymentStatusFields {
  state: string | undefined;
  environmentUrl: string | undefined;
  deploymentSha: string | undefined;
  environment: string | undefined;
  isProductionEnvironment: boolean;
}

// Checks that a URL is safe to hand to the engine as a scan target.
// Accepts only http/https, no embedded username or password, at most 2048 characters both as
// given and once normalised. Drops the #fragment; keeps the query string (the engine may need it).
// Returns: ok with the normalised URL, or a config-error reason that never echoes the URL back.
// Rules: TGT-8, TGT-10
export function quandle_target_parse_scanUrl(raw: string): Parsed<string> {
  if (raw.length > MAX_SCAN_URL_LENGTH) {
    return { ok: false, reason: `Quandle: the scan URL is longer than ${MAX_SCAN_URL_LENGTH} characters.` };
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: 'Quandle: the scan URL is not a valid URL.' };
  }
  if (!ALLOWED_SCAN_URL_PROTOCOLS.includes(parsed.protocol)) {
    return { ok: false, reason: 'Quandle: the scan URL must start with https:// or http://.' };
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return { ok: false, reason: 'Quandle: the scan URL must not contain a username or password.' };
  }
  parsed.hash = '';
  // TGT-8: normalising (percent-encoding, punycode) can lengthen the URL, so check what we actually send.
  if (parsed.href.length > MAX_SCAN_URL_LENGTH) {
    return {
      ok: false,
      reason: `Quandle: the scan URL is longer than ${MAX_SCAN_URL_LENGTH} characters once encoded.`,
    };
  }
  return { ok: true, value: parsed.href };
}

// Decides what to scan for this GitHub event, or why not to scan.
// The deploy's own URL always wins; the url input is only a fallback.
// Returns: scan (with url, environment, sha), skip (quietly), or error (config problem + fix hint).
// Rules: TGT-1, TGT-2, TGT-3, TGT-4, TGT-5, TGT-6, TGT-7, TGT-9
export function quandle_target_resolve_scanTargetFromEvent(
  event: EventContext,
  urlInput: string | undefined,
): Target {
  switch (event.eventName) {
    case 'deployment_status':
      return quandle_target_resolve_deploymentStatusTarget(event, urlInput);
    case 'workflow_dispatch':
    case 'schedule':
      return quandle_target_resolve_manualTarget(event, urlInput);
    default:
      return { kind: 'skip', reason: 'this event does not trigger a Quandle scan' };
  }
}

// Target for a deployment_status event: only successful deploys are scanned.
// Uses environment_url, then the url input; never target_url.
// Returns: scan, skip (not a success), or error (no URL / bad URL).
// Rules: TGT-1, TGT-2, TGT-3, TGT-4, TGT-5, TGT-8, TGT-9, TGT-11
function quandle_target_resolve_deploymentStatusTarget(
  event: EventContext,
  urlInput: string | undefined,
): Target {
  const fields = quandle_target_read_deploymentStatusFields(event.payload);
  if (fields.state !== 'success') {
    return { kind: 'skip', reason: 'the deployment did not succeed' };
  }
  // TGT-2 / TGT-5: the deploy's own URL wins; the url input is only a fallback; target_url is never used.
  const rawUrl = fields.environmentUrl ?? urlInput;
  if (rawUrl === undefined) {
    return { kind: 'error', reason: 'Quandle: the deployment has no URL. Set the `url` input.' };
  }
  const url = quandle_target_parse_scanUrl(rawUrl);
  if (!url.ok) {
    return { kind: 'error', reason: url.reason };
  }
  return {
    kind: 'scan',
    url: url.value,
    ...(fields.environment === undefined
      ? {}
      : { environment: quandle_target_build_engineEnvironment(fields.environment) }),
    // On deployment_status, GitHub sets the event commit to the deployment's commit.
    sha: fields.deploymentSha ?? event.sha,
    source: 'deployment',
    isProductionEnvironment: fields.isProductionEnvironment,
  };
}

// Cuts an environment name to the engine's limit: its first 100 bytes (UTF-8), whole characters only.
// The host chooses the name, so a long one is cut, never a reason not to scan.
// Returns: the name, unchanged when it already fits.
// Rules: TGT-1
function quandle_target_build_engineEnvironment(environment: string): string {
  let byteCount = 0;
  let kept = '';
  // for…of walks whole code points, so a character outside the BMP is never split in two.
  for (const character of environment) {
    byteCount += Buffer.byteLength(character, 'utf8');
    if (byteCount > MAX_ENVIRONMENT_BYTES) return kept;
    kept += character;
  }
  return kept;
}

// Decides whether a deploy is a production deploy from the default branch's head commit (TGT-11):
// a deploy of exactly that commit is one. Pure: the head commit is read by main through GitHub.
// Returns: the target, marked as production when its commit is the default branch's head; else unchanged.
// Rules: TGT-9, TGT-11
export function quandle_target_resolve_productionDeploy(
  target: Extract<Target, { kind: 'scan' }>,
  defaultBranchHeadSha: string,
): Extract<Target, { kind: 'scan' }> {
  if (target.sha !== defaultBranchHeadSha) return target;
  return { ...target, isProductionEnvironment: true };
}

// Target for workflow_dispatch ("Scan now") and schedule runs: always the url input, as production.
// Returns: scan, or error when the url input is missing or not allowed.
// Rules: TGT-6, TGT-8, TGT-11
function quandle_target_resolve_manualTarget(event: EventContext, urlInput: string | undefined): Target {
  if (urlInput === undefined) {
    return { kind: 'error', reason: `Quandle: the \`url\` input is required for ${event.eventName} runs.` };
  }
  const url = quandle_target_parse_scanUrl(urlInput);
  if (!url.ok) {
    return { kind: 'error', reason: url.reason };
  }
  return {
    kind: 'scan',
    url: url.value,
    environment: 'production',
    sha: event.sha,
    source: 'manual',
    isProductionEnvironment: true,
  };
}

// Pulls the few deployment_status fields we use out of the untrusted event payload.
// Returns: each field as a non-empty string, or undefined when missing or the wrong type.
function quandle_target_read_deploymentStatusFields(payload: unknown): DeploymentStatusFields {
  const deploymentStatus = quandle_target_read_objectField(payload, 'deployment_status');
  const deployment = quandle_target_read_objectField(payload, 'deployment');
  return {
    state: quandle_target_read_stringField(deploymentStatus, 'state'),
    environmentUrl: quandle_target_read_stringField(deploymentStatus, 'environment_url'),
    deploymentSha: quandle_target_read_stringField(deployment, 'sha'),
    environment: quandle_target_read_stringField(deployment, 'environment'),
    // TGT-11: only an explicit boolean true counts; a missing flag or the string "true" does not.
    isProductionEnvironment: deployment?.production_environment === true,
  };
}

// Reads a nested object field from an untrusted value.
// Returns: the field when it is a non-null object, otherwise undefined.
function quandle_target_read_objectField(value: unknown, key: string): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const field: unknown = (value as Record<string, unknown>)[key];
  return typeof field === 'object' && field !== null ? (field as Record<string, unknown>) : undefined;
}

// Reads a string field from an untrusted object. Empty strings count as missing.
// Returns: the non-empty string, otherwise undefined.
function quandle_target_read_stringField(
  value: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const field = value?.[key];
  return typeof field === 'string' && field !== '' ? field : undefined;
}
