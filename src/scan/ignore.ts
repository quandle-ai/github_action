// ==========================================================================
// Quandle GitHub Action · src/scan/ignore.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Reads the text of .quandle-ignore.yml into checked ignore entries, and sorts
// findings by those entries (shown, ignored, expired) without changing them.
// One bad entry makes the whole file invalid, so a typo never hides a leak.
// Pure: no network, no file reads, no clock (the run's time is passed in).
// Never echoes the file's contents in a warning.
// Rules: IGN-1, IGN-2, IGN-4, IGN-5, IGN-6, IGN-7, IGN-8, IGN-10
// ==========================================================================
import { parseDocument } from 'yaml';
import type {
  ExpiredIgnore,
  Finding,
  IgnoredFinding,
  IgnoreEntry,
  IgnoreMatch,
  IgnoreOutcome,
  Parsed,
} from '../types';

// IGN-8: limits on an untrusted file.
const MAX_IGNORE_FILE_BYTES = 64 * 1024;
const MAX_IGNORE_ENTRIES = 500;

type IgnoreEntryKey = 'id' | 'rule' | 'reason' | 'expires';

// Every key an entry may have, exactly once (IGN-1); anything else is an unknown key (IGN-4).
const IGNORE_ENTRY_KEY_SET: Readonly<Record<IgnoreEntryKey, true>> = {
  id: true,
  rule: true,
  reason: true,
  expires: true,
};

// IGN-7: a calendar date, YYYY-MM-DD.
const EXPIRES_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

const SHAPE_PROBLEM = 'expected a list of entries under `ignore:`';

// Checks the text of .quandle-ignore.yml and turns it into ignore entries.
// Returns: ok with every entry, or one warning naming the first problem (never the file's text).
// Rules: IGN-1, IGN-4, IGN-7, IGN-8
export function quandle_ignore_parse_ignoreFile(text: string, now: Date): Parsed<readonly IgnoreEntry[]> {
  if (Buffer.byteLength(text, 'utf8') > MAX_IGNORE_FILE_BYTES) {
    return quandle_ignore_build_invalidFile('file is larger than 64 KB');
  }
  const yamlValue = quandle_ignore_parse_yamlText(text);
  if (!yamlValue.ok) return quandle_ignore_build_invalidFile(yamlValue.reason);
  const rawEntries = quandle_ignore_get_rawEntries(yamlValue.value);
  if (rawEntries === undefined) return quandle_ignore_build_invalidFile(SHAPE_PROBLEM);
  if (rawEntries.length > MAX_IGNORE_ENTRIES)
    return quandle_ignore_build_invalidFile('more than 500 entries');
  const entries: IgnoreEntry[] = [];
  for (const [index, rawEntry] of rawEntries.entries()) {
    const entry = quandle_ignore_parse_entry(rawEntry, now);
    if (!entry.ok) return quandle_ignore_build_invalidFile(`entry ${index + 1}: ${entry.reason}`);
    entries.push(entry.value);
  }
  return { ok: true, value: entries };
}

// The one warning for an invalid file: says nothing is ignored, and what is wrong.
// Returns: a failed Parsed carrying that warning.
// Rules: IGN-4
function quandle_ignore_build_invalidFile(problem: string): Parsed<never> {
  return {
    ok: false,
    reason: `Quandle: .quandle-ignore.yml is invalid, so nothing is ignored (${problem}).`,
  };
}

// Parses YAML without ever echoing the parser's message: it quotes the file's text.
// Returns: ok with the plain value, or a problem giving at most the line number.
// Rules: IGN-4
function quandle_ignore_parse_yamlText(text: string): Parsed<unknown> {
  const document = parseDocument(text);
  const firstError = document.errors[0];
  if (firstError !== undefined) {
    // The line where the problem starts, counted from the error's character offset.
    const line = text.slice(0, firstError.pos[0]).split('\n').length;
    return { ok: false, reason: `not valid YAML, line ${line}` };
  }
  try {
    return { ok: true, value: document.toJS() };
  } catch {
    // Too many aliases (a "billion laughs" file): the library refuses to expand it.
    return { ok: false, reason: 'not valid YAML' };
  }
}

// Finds the entry list: a mapping with only `ignore:`, holding a list of mappings.
// Returns: the raw entries, or undefined when the file has any other shape.
// Rules: IGN-4
function quandle_ignore_get_rawEntries(value: unknown): readonly Record<string, unknown>[] | undefined {
  if (!quandle_ignore_check_isRecord(value)) return undefined;
  if (Object.keys(value).length !== 1) return undefined;
  const list: unknown = value['ignore'];
  if (!Array.isArray(list)) return undefined;
  if (!list.every(quandle_ignore_check_isRecord)) return undefined;
  return list;
}

// True for a YAML mapping (a plain object), false for lists, text, numbers and null.
function quandle_ignore_check_isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Checks one entry: known keys only, one match, a reason and an expiry date.
// Returns: ok with the entry, or the problem (without the entry number).
// Rules: IGN-1, IGN-4, IGN-7
function quandle_ignore_parse_entry(raw: Record<string, unknown>, now: Date): Parsed<IgnoreEntry> {
  if (!Object.keys(raw).every((key) => Object.hasOwn(IGNORE_ENTRY_KEY_SET, key))) {
    return { ok: false, reason: 'has an unknown key' };
  }
  const match = quandle_ignore_parse_match(raw);
  if (!match.ok) return match;
  const reason = raw['reason'];
  if (typeof reason !== 'string' || reason.length === 0) return { ok: false, reason: '`reason` is required' };
  const expires = quandle_ignore_parse_expires(raw['expires'], now);
  if (!expires.ok) return expires;
  return { ok: true, value: { match: match.value, reason, expires: expires.value } };
}

// Exactly one of id or rule, and it must be text.
// Returns: ok with the match, or the problem.
// Rules: IGN-1
function quandle_ignore_parse_match(raw: Record<string, unknown>): Parsed<IgnoreMatch> {
  const hasId = Object.hasOwn(raw, 'id');
  if (hasId === Object.hasOwn(raw, 'rule'))
    return { ok: false, reason: 'needs exactly one of `id` or `rule`' };
  const value = hasId ? raw['id'] : raw['rule'];
  if (typeof value !== 'string') return { ok: false, reason: `\`${hasId ? 'id' : 'rule'}\` must be text` };
  return { ok: true, value: hasId ? { kind: 'id', id: value } : { kind: 'rule', rule: value } };
}

// A real calendar date, YYYY-MM-DD, at most 1 year after the run's UTC day. Past dates are valid.
// Returns: ok with the date as written, or the problem.
// Rules: IGN-1, IGN-7
function quandle_ignore_parse_expires(value: unknown, now: Date): Parsed<string> {
  if (typeof value !== 'string' || !quandle_ignore_check_isCalendarDate(value)) {
    return { ok: false, reason: '`expires` must be a date like 2027-01-31' };
  }
  // Same month and day one year later; YYYY-MM-DD strings compare in date order.
  const today = quandle_ignore_get_utcDay(now);
  const latestAllowed = `${now.getUTCFullYear() + 1}${today.slice(4)}`;
  if (value > latestAllowed) return { ok: false, reason: '`expires` is more than 1 year away' };
  return { ok: true, value };
}

// True when the text is YYYY-MM-DD and that day exists (2027-02-30 does not).
function quandle_ignore_check_isCalendarDate(value: string): boolean {
  if (!EXPIRES_FORMAT.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Sorts findings by the ignore entries, without changing any finding (FND-5).
// Returns: shown (not ignored), ignored (with the reason) and expired (shown, matched only by
// expired entries).
// Rules: IGN-2, IGN-5, IGN-6, IGN-7, IGN-10
export function quandle_ignore_apply_entriesToFindings(
  findings: readonly Finding[],
  entries: readonly IgnoreEntry[],
  now: Date,
): IgnoreOutcome {
  const today = quandle_ignore_get_utcDay(now);
  const shown: Finding[] = [];
  const ignored: IgnoredFinding[] = [];
  const expired: ExpiredIgnore[] = [];
  for (const finding of findings) {
    // IGN-6: a fix is always shown, whatever the ignore file says.
    const matching =
      finding.state === 'resolved'
        ? []
        : entries.filter((entry) => quandle_ignore_check_isMatch(entry, finding));
    const active = matching.find((entry) => entry.expires >= today);
    if (active !== undefined) {
      ignored.push({ finding, reason: active.reason });
      continue;
    }
    shown.push(finding);
    // No active entry matched, so every matching entry has expired; the first one's date is shown.
    const firstExpired = matching[0];
    // FND-1: the first-scan baseline never fails the job, so an expired ignore does not flag it.
    if (firstExpired !== undefined && finding.state !== 'already-present') {
      expired.push({ finding, expires: firstExpired.expires });
    }
  }
  return { shown, ignored, expired };
}

// Whether one entry matches one finding: the exact id, or the exact rule.
// Rules: IGN-5
function quandle_ignore_check_isMatch(entry: IgnoreEntry, finding: Finding): boolean {
  switch (entry.match.kind) {
    case 'id':
      return entry.match.id === finding.id;
    case 'rule':
      return entry.match.rule === finding.rule;
  }
}

// The run's calendar day in UTC, as YYYY-MM-DD (these strings compare in date order).
// Rules: IGN-7
function quandle_ignore_get_utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}
