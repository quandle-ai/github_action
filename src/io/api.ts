// ==========================================================================
// Quandle GitHub Action · src/io/api.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Talks to the Quandle engine. Guards the trust boundary: only url, environment,
// production and bypassSecret leave GitHub, with a masked GitHub OIDC token in
// X-Quandle-Token, and they only ever go to the one constant engine URL, never
// across a redirect. Reads at most
// 2 MB within 60 seconds and turns the answer into a ScanResult, strictly: anything
// unexpected is engine-error, never "0 findings". Never throws, never logs.
// Rules: TGT-9, TRU-1 … TRU-5, TRU-7, TRU-8, FND-1, FND-2, FND-4, FND-6, ERR-2, ERR-4, MOCK-4
// ==========================================================================
import { createHash } from 'node:crypto';
import { SEVERITY_RANK } from '../scan/severity';
import type { Finding, FindingState, ScanRequest, ScanResult, Severity, Target } from '../types';

// TRU-4: the only place scans and the OIDC token are ever sent.
// A constant on purpose: there is no input that can change it.
export const ENGINE_URL = 'https://api.quandle.ai/v1/scan';

// Builds the scan request from the target: only the fields allowed to leave GitHub (TRU-1).
// production is the target's production decision (TGT-11), never guessed from the environment name.
// Returns: url, environment (when known), production and bypassSecret (when set).
// Rules: TRU-1, TGT-9
export function quandle_api_build_scanRequest(
  target: Extract<Target, { kind: 'scan' }>,
  bypassSecret: string | undefined,
): ScanRequest {
  return {
    url: target.url,
    ...(target.environment === undefined ? {} : { environment: target.environment }),
    production: target.isProductionEnvironment,
    ...(bypassSecret === undefined ? {} : { bypassSecret }),
  };
}

// The fetch the engine call uses: Node's built-in fetch in production, a fake in tests (TRU-4).
export type EngineFetch = (url: string, init: RequestInit) => Promise<Response>;

// What the engine call needs from the runtime, and nothing more: the OIDC token, masking, the network.
export interface EngineAccess {
  getOidcToken(audience: string): Promise<string>;
  setSecret(secret: string): void;
  fetch: EngineFetch;
}

// The engine's HTTP answer, as the network call reads it: the status code and the body text.
export interface EngineHttpResponse {
  readonly httpStatus: number;
  readonly bodyText: string;
}

// TRU-7: the Action's own fixed reason for every outcome that is not a scan. Never engine text.
export const ENGINE_NOT_SCANNED_REASONS: Readonly<
  Record<'protected' | 'rate-limited' | 'engine-error', string>
> = {
  protected: 'the deploy is protected; set `bypass-secret` to scan it',
  'rate-limited': "the Quandle engine's rate limit was reached; the next deploy will be checked",
  'engine-error': 'the Quandle engine could not complete the scan',
};

// Turns the engine's HTTP answer into our ScanResult, validating everything (the body is untrusted).
// Returns: scanned (with findings) or protected for a valid 200; rate-limited for 429; engine-error for
// any other status and for anything malformed. Never "0 findings" for a bad answer. Never throws.
// Rules: TRU-7, FND-4, FND-6, ERR-4
export function quandle_api_parse_engineResponse(
  response: EngineHttpResponse,
  request: ScanRequest,
): ScanResult {
  // TRU-7: every not-scanned outcome carries our own fixed reason, never engine text.
  const notScanned = (status: NotScannedStatus, scanId?: string): ScanResult =>
    quandle_api_build_notScannedResult(request, status, ENGINE_NOT_SCANNED_REASONS[status], scanId);
  if (response.httpStatus === 429) return notScanned('rate-limited');
  if (response.httpStatus !== 200) return notScanned('engine-error');
  const body = quandle_api_parse_responseBody(response.bodyText);
  if (body === undefined) return notScanned('engine-error');
  if (body.status === 'protected') {
    return body.findings.length === 0 ? notScanned('protected', body.scanId) : notScanned('engine-error');
  }
  const findings = quandle_api_parse_findings(body.findings);
  if (findings === undefined) return notScanned('engine-error');
  return {
    url: request.url,
    ...(request.environment === undefined ? {} : { environment: request.environment }),
    ...(body.scanId === undefined ? {} : { scanId: body.scanId }),
    status: 'scanned',
    findings,
    isMock: false,
  };
}

type NotScannedStatus = keyof typeof ENGINE_NOT_SCANNED_REASONS;

// The top level of a 200 answer, checked but with its findings not yet validated.
interface EngineResponseBody {
  readonly status: 'scanned' | 'protected';
  readonly scanId?: string;
  readonly findings: readonly unknown[];
}

// Every field a 200 answer may have (TRU-7).
const RESPONSE_FIELDS: ReadonlySet<string> = new Set(['status', 'scanId', 'findings']);

// FND-6: 1 to 64 ASCII letters, digits, `_` or `-`. Users put scan-id into later workflow steps.
const SCAN_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// Every field a finding may have, exactly once (FND-6): TypeScript errors if Finding gains or loses one.
const FINDING_FIELD_SET: Readonly<Record<keyof Finding, true>> = {
  id: true,
  rule: true,
  severity: true,
  state: true,
  title: true,
  location: true,
  evidence: true,
};
const FINDING_FIELDS: ReadonlySet<string> = new Set(Object.keys(FINDING_FIELD_SET));

// Every finding state exactly once: TypeScript errors if one is missing or extra (FND-1).
const FINDING_STATE_SET: Readonly<Record<FindingState, true>> = {
  new: true,
  existing: true,
  resolved: true,
  'already-present': true,
};

// Parses and checks the top level of a 200 answer. JSON.parse runs in a try: the body is untrusted.
// Returns: the body, or undefined when it is not JSON, not an object, has a field besides status,
// scanId and findings, a status other than scanned or protected, a bad scanId, or no findings list.
// Rules: TRU-7, FND-4, FND-6
function quandle_api_parse_responseBody(bodyText: string): EngineResponseBody | undefined {
  let value: unknown;
  try {
    value = JSON.parse(bodyText);
  } catch {
    return undefined;
  }
  if (!quandle_api_check_isRecordWithOnly(value, RESPONSE_FIELDS)) return undefined;
  const { status, scanId, findings } = value;
  if (status !== 'scanned' && status !== 'protected') return undefined;
  if (scanId !== undefined && !quandle_api_check_isScanId(scanId)) return undefined;
  if (!Array.isArray(findings)) return undefined;
  return { status, ...(scanId === undefined ? {} : { scanId }), findings };
}

// Checks every finding (FND-6). One bad finding makes the whole answer malformed (FND-4).
// Returns: the findings, or undefined when any of them is malformed.
// Rules: FND-4, FND-6
function quandle_api_parse_findings(items: readonly unknown[]): Finding[] | undefined {
  const findings: Finding[] = [];
  for (const item of items) {
    const finding = quandle_api_parse_finding(item);
    if (finding === undefined) return undefined;
    findings.push(finding);
  }
  return findings;
}

// One finding: exactly the known fields, non-empty text where required, a known severity and state.
// Returns: the finding, or undefined when anything about it is wrong.
// Rules: FND-1, FND-2, FND-4, FND-6
function quandle_api_parse_finding(item: unknown): Finding | undefined {
  if (!quandle_api_check_isRecordWithOnly(item, FINDING_FIELDS)) return undefined;
  const { id, rule, title, location, severity, state, evidence } = item;
  const isText = quandle_api_check_isNonEmptyText;
  if (!isText(id) || !isText(rule) || !isText(title) || !isText(location)) return undefined;
  // FND-4: an unknown severity or state is an error, never a quiet "low".
  if (!quandle_api_check_isSeverity(severity) || !quandle_api_check_isFindingState(state)) return undefined;
  if (evidence !== undefined && typeof evidence !== 'string') return undefined;
  return { id, rule, severity, state, title, location, ...(evidence === undefined ? {} : { evidence }) };
}

// True for one of the four severities (FND-2), from the one severity ranking.
function quandle_api_check_isSeverity(value: unknown): value is Severity {
  return typeof value === 'string' && Object.hasOwn(SEVERITY_RANK, value);
}

// True for one of the four finding states (FND-1).
function quandle_api_check_isFindingState(value: unknown): value is FindingState {
  return typeof value === 'string' && Object.hasOwn(FINDING_STATE_SET, value);
}

// True for a JSON object (not a list or null) whose own fields are all in the allowed set.
function quandle_api_check_isRecordWithOnly(
  value: unknown,
  allowed: ReadonlySet<string>,
): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.keys(value).every((field) => allowed.has(field));
}

// True for a scan id we can safely put in the scan-id output (FND-6): an allowlist, looser than the
// engine's own format so the engine can change its ids without breaking every scan.
function quandle_api_check_isScanId(value: unknown): value is string {
  return typeof value === 'string' && SCAN_ID_PATTERN.test(value);
}

// True for a string with at least one character.
function quandle_api_check_isNonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

// TRU-3: the audience every OIDC token for the engine is issued for.
export const OIDC_AUDIENCE = 'https://api.quandle.ai';
// TRU-7: the engine's whole answer, body included, must arrive within this time and size.
const ENGINE_TIMEOUT_MS = 60_000;
const MAX_ENGINE_RESPONSE_BYTES = 2 * 1024 * 1024;
// TRU-8: our own reason when there is no OIDC token; it names the permission that fixes it.
const OIDC_UNAVAILABLE_REASON = 'could not get a GitHub OIDC token; the workflow needs `id-token: write`';

// Asks the Quandle engine to scan the target: gets an OIDC token, masks it, POSTs the request to
// ENGINE_URL only, reads at most 2 MB within 60 seconds and hands the answer to the strict parser.
// Never throws, and never logs or returns the request, the token, the response or any error.
// Returns: the parsed result; engine-error with our own reason when there is no token (the engine is
// then not called), and for a network failure, a redirect, the timeout or a body over 2 MB.
// Rules: TRU-1, TRU-2, TRU-3, TRU-4, TRU-5, TRU-7, TRU-8, MOCK-4, ERR-2
export async function quandle_api_request_postScanToEngine(
  request: ScanRequest,
  engine: EngineAccess,
): Promise<ScanResult> {
  let token: string;
  try {
    token = await engine.getOidcToken(OIDC_AUDIENCE);
  } catch {
    return quandle_api_build_notScannedResult(request, 'engine-error', OIDC_UNAVAILABLE_REASON);
  }
  // TRU-5: masked the moment it exists, before it goes anywhere.
  engine.setSecret(token);
  const response = await quandle_api_send_scanRequest(request, token, engine.fetch);
  if (response === undefined) {
    return quandle_api_build_notScannedResult(
      request,
      'engine-error',
      ENGINE_NOT_SCANNED_REASONS['engine-error'],
    );
  }
  return quandle_api_parse_engineResponse(response, request);
}

// The one HTTP exchange with the engine: POST to ENGINE_URL with the body and its SHA-256, no redirects,
// one 60-second limit for the whole exchange, body capped at 2 MB. The timer is always cleared.
// Returns: the status and body text, or undefined for any failure (never the error: it may carry
// headers, URLs or engine text).
// Rules: TRU-2, TRU-4, TRU-7
async function quandle_api_send_scanRequest(
  request: ScanRequest,
  token: string,
  fetch: EngineFetch,
): Promise<EngineHttpResponse | undefined> {
  // TRU-2: serialised once; the same bytes are hashed and sent, so the hash always matches the body.
  const body = new TextEncoder().encode(JSON.stringify(request));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENGINE_TIMEOUT_MS);
  try {
    const response = await fetch(ENGINE_URL, {
      method: 'POST',
      headers: {
        // TRU-2: the bare token in our own header. Authorization is left alone: the hosting signs there.
        'X-Quandle-Token': token,
        'Content-Type': 'application/json',
        // The engine's hosting refuses a POST without it.
        'x-amz-content-sha256': createHash('sha256').update(body).digest('hex'),
      },
      body,
      redirect: 'error',
      signal: controller.signal,
    });
    const bodyText = await quandle_api_read_cappedBody(response);
    return bodyText === undefined ? undefined : { httpStatus: response.status, bodyText };
  } catch {
    // Network down, DNS, a redirect, the timeout: all the same engine-error, never the error itself.
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

// Reads the response body as text, stopping as soon as it is known to be over 2 MB: from the
// Content-Length header (without reading), or from the bytes actually received.
// Returns: the text; '' when there is no body; undefined when it is over 2 MB.
// Rules: TRU-7
async function quandle_api_read_cappedBody(response: Response): Promise<string | undefined> {
  if (response.body === null) return '';
  if (Number(response.headers.get('content-length')) > MAX_ENGINE_RESPONSE_BYTES) {
    await response.body.cancel();
    return undefined;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > MAX_ENGINE_RESPONSE_BYTES) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

// A result for a scan that did not happen: always our own reason, never findings (ERR-4, TRU-7).
// Returns: the result, with our url and environment, and the scan id when the engine gave one.
// Rules: ERR-4, TRU-7
function quandle_api_build_notScannedResult(
  request: ScanRequest,
  status: NotScannedStatus,
  reason: string,
  scanId?: string,
): ScanResult {
  return {
    url: request.url,
    ...(request.environment === undefined ? {} : { environment: request.environment }),
    ...(scanId === undefined ? {} : { scanId }),
    status,
    reason,
    findings: [],
    isMock: false,
  };
}
