// ==========================================================================
// Quandle GitHub Action · src/report/render.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Builds everything the developer reads: the job summary, the PR comment and the production issue.
// Owns the ONLY escaping functions (Markdown-safe, code-span-safe, log-safe).
// Everything untrusted must pass through one of them before output.
// Pure: no network, no @actions imports.
// Rules: TGT-3, TGT-10, FND-1, FND-3, OUT-1, OUT-7 … OUT-12, ERR-4, IGN-2, IGN-10, MOCK-2
// ==========================================================================
import { SEVERITY_RANK } from '../scan/severity';
import type { Finding, FindingState, IgnoredFinding, IgnoreOutcome, ScanResult } from '../types';

export const MOCK_BANNER = '> ⚠ **MOCK RESULTS — not a real scan**';
// OUT-7: the hidden marker that identifies our PR comment (together with its author).
export const COMMENT_MARKER = '<!-- quandle:pr-comment -->';
// OUT-10: the hidden marker that identifies our production issue (together with its author).
export const ISSUE_MARKER = '<!-- quandle:production-issue -->';
// OUT-8: findings listed in a PR comment before "…and N more".
export const MAX_COMMENT_FINDINGS = 50;
// OUT-8 / OUT-11: GitHub rejects a comment or issue body over 65,536 characters; this leaves headroom.
export const MAX_BODY_CHARACTERS = 60_000;
// Room kept for the "…and N more, see the job summary." line, so it never takes a body past the limit.
const MORE_LINE_RESERVE = 100;

const SUMMARY_HEADING = '## Quandle';
// OUT-1: GitHub caps a step summary at 1 MiB; 100 findings stays far below it.
export const MAX_SUMMARY_FINDINGS = 100;
const MAX_TEXT_LENGTH = 200;
const ELLIPSIS = '…';
const ZERO_WIDTH_SPACE = '\u200b';
// C0/C1 control characters (incl. newlines and tabs): replaced with a space.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]+/g;
// Invisible characters that can disguise or reorder text: soft hyphen, Arabic letter mark, Mongolian
// vowel separator, zero-width, LRM/RLM, bidi embeddings/overrides/isolates, word joiners, variation
// selectors, BOM and Unicode tag characters. Removed entirely (FND-3).
const INVISIBLE_CHARACTERS =
  /[\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufe00-\ufe0f\ufeff\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/gu;
// `-` and `.` are omitted: they only start lists at the beginning of a line, and escaped text is
// always placed mid-line.
const MARKDOWN_SPECIAL_CHARACTERS = /[\\`*_{}[\]()#+!|~$]/g;
const HTML_ENTITIES: Record<'&' | '<' | '>', string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

// Makes untrusted text safe to place inline in Markdown (summary, comment, issue).
// Blocks HTML, links, auto-links (://, www.), @mentions, code spans, math ($), new blocks, and
// control/bidi/zero-width characters. Caps the visible text at 200 characters (escaped output can be longer).
// Returns: the escaped text, rendering as the original words.
// Rules: FND-3
export function quandle_render_escape_markdownText(text: string): string {
  return quandle_render_clean_plainText(text)
    .replace(/@/g, `@${ZERO_WIDTH_SPACE}`)
    .replace(/:\/\//g, `:${ZERO_WIDTH_SPACE}//`)
    .replace(/(w)(ww\.)/gi, `$1${ZERO_WIDTH_SPACE}$2`)
    .replace(/[&<>]/g, (character) => HTML_ENTITIES[character as keyof typeof HTML_ENTITIES])
    .replace(MARKDOWN_SPECIAL_CHARACTERS, '\\$&');
}

// Puts untrusted text inside one inline code span that cannot be closed early.
// Backticks become apostrophes; newlines collapse; invisible characters are removed; caps the
// visible text at 200.
// Returns: the text wrapped in backticks.
// Rules: FND-3
export function quandle_render_escape_codeSpan(text: string): string {
  return `\`${quandle_render_clean_plainText(text).replace(/`/g, "'")}\``;
}

// Makes untrusted text safe for a single log line.
// No newlines, and "::" is broken so the text can never inject a workflow command.
// Returns: the escaped text; visible text capped at 200 characters.
// Rules: FND-3
export function quandle_render_escape_logText(text: string): string {
  return quandle_render_clean_plainText(text).replace(/::/g, `:${ZERO_WIDTH_SPACE}:`);
}

// Builds the summary for a run that never scanned: the heading and exactly one
// "Not scanned: <reason>" line. Never shows the mock banner (nothing was scanned).
// Returns: the summary Markdown, with the reason escaped.
// Rules: ERR-4, TGT-3, FND-3
export function quandle_render_build_notScannedSummary(reason: string): string {
  return [SUMMARY_HEADING, '', `**Not scanned:** ${quandle_render_escape_markdownText(reason)}`].join('\n');
}

// Builds the job summary Markdown: mock banner (if mock), then either "Not scanned: <reason>"
// or the scanned URL/environment and the findings, most important first, at most 100.
// Returns: the summary Markdown; all untrusted values escaped.
// Rules: OUT-1, ERR-4, MOCK-2, FND-3
export function quandle_render_build_jobSummary(result: ScanResult, outcome: IgnoreOutcome): string {
  const banner = result.isMock ? [MOCK_BANNER, ''] : [];
  if (result.status !== 'scanned') {
    return [...banner, quandle_render_build_notScannedSummary(result.reason)].join('\n');
  }
  const checked = quandle_render_build_checkedLine(result);
  return [
    ...banner,
    SUMMARY_HEADING,
    '',
    checked,
    '',
    ...quandle_render_build_findingLines(outcome),
    ...quandle_render_build_ignoredLines(outcome.ignored),
  ].join('\n');
}

// The findings part of the summary: the shown findings, most important first (new, or with an
// expired ignore, before other states, then critical → low), at most 100 lines, then
// "…and N more findings (not shown)." GitHub caps a step summary at 1 MiB, so the list must stay bounded.
// Returns: the Markdown lines, or a "No findings" line when nothing is shown.
// Rules: OUT-1, IGN-2, IGN-10
function quandle_render_build_findingLines(outcome: IgnoreOutcome): string[] {
  if (outcome.shown.length === 0) {
    return [outcome.ignored.length > 0 ? 'No findings apart from the ignored ones below.' : 'No findings.'];
  }
  const expiredDates = quandle_render_build_expiredDates(outcome);
  const ordered = [...outcome.shown].sort((a, b) =>
    quandle_render_compare_findingImportance(a, b, expiredDates),
  );
  const lines = ordered
    .slice(0, MAX_SUMMARY_FINDINGS)
    .map((finding) => quandle_render_build_findingLine(finding, expiredDates.get(finding)));
  const hiddenCount = outcome.shown.length - lines.length;
  return hiddenCount === 0 ? lines : [...lines, '', `…and ${hiddenCount} more findings (not shown).`];
}

// The ignored part of the summary: "Ignored (N)", then each finding's id and escaped reason,
// at most 100, then "…and N more ignored (not shown)."
// Returns: the Markdown lines, or none when nothing was ignored.
// Rules: OUT-1, IGN-10, FND-3
function quandle_render_build_ignoredLines(ignored: readonly IgnoredFinding[]): string[] {
  if (ignored.length === 0) return [];
  const lines = ignored.slice(0, MAX_SUMMARY_FINDINGS).map((entry) => {
    const id = quandle_render_escape_codeSpan(entry.finding.id);
    const reason = quandle_render_escape_markdownText(entry.reason);
    return `- ${id} · ${reason}`;
  });
  const hiddenCount = ignored.length - lines.length;
  return [
    '',
    `**Ignored (${ignored.length})**`,
    ...lines,
    ...(hiddenCount > 0 ? ['', `…and ${hiddenCount} more ignored (not shown).`] : []),
  ];
}

// Each finding whose ignore expired, with the expiry date to show. Keyed by the finding itself,
// so two findings with the same id can never be confused.
// Returns: the finding → date lookup.
// Rules: IGN-2
function quandle_render_build_expiredDates(outcome: IgnoreOutcome): ReadonlyMap<Finding, string> {
  return new Map(outcome.expired.map((expired) => [expired.finding, expired.expires]));
}

// Sort order: new findings (and those whose ignore expired) first, then by severity, critical first.
// Returns: negative when a is more important than b, positive when less, 0 when equal.
// Rules: OUT-1, IGN-2
function quandle_render_compare_findingImportance(
  a: Finding,
  b: Finding,
  expiredDates: ReadonlyMap<Finding, string>,
): number {
  const isFirst = (finding: Finding): number => Number(finding.state === 'new' || expiredDates.has(finding));
  const stateOrder = isFirst(b) - isFirst(a);
  return stateOrder !== 0 ? stateOrder : SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
}

// The form of a URL that is safe to show: origin + path only. The query string and fragment
// can carry tokens (e.g. Vercel share links) and are never displayed.
// Returns: origin + path, or "(unparseable URL)" when it doesn't parse — never the raw text.
// Rules: TGT-10
function quandle_render_build_displayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.origin + parsed.pathname;
  } catch {
    return '(unparseable URL)';
  }
}

// One bullet: severity · state · title · location · id (· evidence) (· ignore expired <date>).
// Returns: the Markdown line, with every field escaped (severity and state too: FND-3).
// Rules: OUT-1, FND-3, IGN-2
function quandle_render_build_findingLine(finding: Finding, expiredDate?: string): string {
  const parts = [
    `**${quandle_render_escape_markdownText(finding.severity)}**`,
    quandle_render_escape_markdownText(finding.state),
    quandle_render_escape_markdownText(finding.title),
    quandle_render_escape_codeSpan(finding.location),
    quandle_render_escape_codeSpan(finding.id),
  ];
  if (finding.evidence !== undefined)
    parts.push(`evidence ${quandle_render_escape_codeSpan(finding.evidence)}`);
  if (expiredDate !== undefined)
    parts.push(`ignore expired ${quandle_render_escape_markdownText(expiredDate)}`);
  return `- ${parts.join(' · ')}`;
}

// Shared first step of every escaper: removes invisible characters, turns control characters into
// spaces, collapses whitespace to single spaces, and caps the length with an ellipsis.
// Returns: the cleaned single-line text, at most 200 characters.
function quandle_render_clean_plainText(text: string): string {
  const cleaned = text
    .replace(INVISIBLE_CHARACTERS, '')
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= MAX_TEXT_LENGTH) return cleaned;
  return cleaned.slice(0, MAX_TEXT_LENGTH - ELLIPSIS.length) + ELLIPSIS;
}

// Builds the PR comment: our marker, the mock banner (if mock), a heading, the checked URL, then the
// new findings, the existing ones whose ignore expired and the ones fixed since the last deploy, at
// Medium or above only, most important first, at most 50 in all and at most 60,000 characters in all.
// Never lists low, ignored, other existing or already-present findings (those are in the job summary);
// only says how many were ignored. Same result, same text.
// Returns: the comment Markdown; every untrusted value escaped.
// Rules: OUT-7, OUT-8, OUT-9, MOCK-2, FND-1, FND-3, TGT-10, IGN-2, IGN-10
export function quandle_render_build_prComment(
  result: Extract<ScanResult, { status: 'scanned' }>,
  outcome: IgnoreOutcome,
): string {
  const expiredDates = quandle_render_build_expiredDates(outcome);
  const newFindings = quandle_render_select_findingsByState(outcome.shown, ['new']);
  const lapsedFindings = quandle_render_select_findingsByState([...expiredDates.keys()], ['existing']);
  const fixedFindings = quandle_render_select_findingsByState(outcome.shown, ['resolved']);
  const head = [
    COMMENT_MARKER,
    ...(result.isMock ? [MOCK_BANNER] : []),
    quandle_render_build_prCommentHeading(newFindings.length, lapsedFindings.length),
    '',
    quandle_render_build_checkedLine(result),
  ];
  const tail = quandle_render_build_ignoredCountLines(outcome.ignored.length);
  const sections = quandle_render_build_findingSections(
    [
      { title: '**New**', findings: newFindings },
      { title: '**Ignore expired**', findings: lapsedFindings },
      { title: '**Fixed**', findings: fixedFindings },
    ],
    expiredDates,
    quandle_render_get_sectionBudget(head, tail),
  );
  return [...head, ...sections, ...tail].join('\n');
}

// The PR comment heading: the number of new findings; with none, the number no longer ignored.
// Returns: the Markdown heading line.
// Rules: OUT-8, IGN-2
function quandle_render_build_prCommentHeading(newCount: number, lapsedCount: number): string {
  if (newCount > 0)
    return `### Quandle: this deploy exposed ${newCount} new finding${newCount === 1 ? '' : 's'}`;
  if (lapsedCount > 0) {
    return `### Quandle: ${lapsedCount} finding${lapsedCount === 1 ? '' : 's'} no longer ignored`;
  }
  return '### Quandle: no new exposures in this deploy';
}

// One titled list in a PR comment or production issue.
interface FindingSection {
  readonly title: string;
  readonly findings: readonly Finding[];
}

// The titled lists of a comment or issue, in order, sharing one budget of 50 findings and one budget of
// characters. The list stops at the first finding that does not fit either; every finding after it is
// left out too. Each finding is marked when its ignore expired; an empty list is left out; then
// "…and N more, see the job summary."
// Returns: the Markdown lines, within characterBudget (counting the new line before each line).
// Rules: OUT-8, OUT-11, IGN-2
function quandle_render_build_findingSections(
  sections: readonly FindingSection[],
  expiredDates: ReadonlyMap<Finding, string>,
  characterBudget: number,
): string[] {
  const lines: string[] = [];
  let room = MAX_COMMENT_FINDINGS;
  let charactersLeft = characterBudget - MORE_LINE_RESERVE;
  let hiddenCount = 0;
  for (const section of sections) {
    // A section's first finding also pays for the blank line and the title above it.
    const sectionCost = section.title.length + 2;
    const kept: string[] = [];
    for (const finding of section.findings) {
      const line = quandle_render_build_findingLine(finding, expiredDates.get(finding));
      const cost = line.length + 1 + (kept.length === 0 ? sectionCost : 0);
      if (room === 0 || cost > charactersLeft) {
        room = 0;
        hiddenCount += 1;
        continue;
      }
      kept.push(line);
      room -= 1;
      charactersLeft -= cost;
    }
    if (kept.length > 0) lines.push('', section.title, ...kept);
  }
  return hiddenCount > 0 ? [...lines, '', `…and ${hiddenCount} more, see the job summary.`] : lines;
}

// What is left of the 60,000-character body for the finding lists, once the lines before and after
// them are counted, each with the new line that joins it.
// Returns: the number of characters the finding lists may use.
// Rules: OUT-8, OUT-11
function quandle_render_get_sectionBudget(head: readonly string[], tail: readonly string[]): number {
  const fixedLength = [...head, ...tail].reduce((total, line) => total + line.length + 1, 0);
  return MAX_BODY_CHARACTERS - fixedLength;
}

// How many findings the ignore file hid, without listing them (they are in the job summary).
// Returns: the line (after a blank line), or nothing when nothing was ignored.
// Rules: IGN-10
function quandle_render_build_ignoredCountLines(count: number): string[] {
  if (count === 0) return [];
  return [
    '',
    `${count} finding${count === 1 ? '' : 's'} ignored by \`.quandle-ignore.yml\`, see the job summary.`,
  ];
}

// The findings a PR comment or production issue shows for the given states: Medium or above,
// most important first.
// Returns: the selected findings.
// Rules: OUT-8, OUT-11
function quandle_render_select_findingsByState(
  findings: readonly Finding[],
  states: readonly FindingState[],
): Finding[] {
  return (
    findings
      .filter(
        (finding) =>
          states.includes(finding.state) && SEVERITY_RANK[finding.severity] >= SEVERITY_RANK.medium,
      )
      // OUT-8 / OUT-11 order by state and severity only; an expired ignore is shown as a mark, not a move.
      .sort((a, b) => quandle_render_compare_findingImportance(a, b, new Map()))
  );
}

// The "Checked <url> (environment <name>)." line shared by the job summary and the PR comment.
// Shows only the URL's origin and path.
// Returns: the Markdown line, with every value escaped.
// Rules: OUT-1, OUT-8, TGT-10
function quandle_render_build_checkedLine(result: ScanResult): string {
  const environment =
    result.environment === undefined
      ? ''
      : ` (environment ${quandle_render_escape_codeSpan(result.environment)})`;
  const url = quandle_render_escape_codeSpan(quandle_render_build_displayUrl(result.url));
  return `Checked ${url}${environment}.`;
}

// Builds the production issue body: our marker, the mock banner (if mock), a heading with the number
// of exposures, the checked URL, then everything still exposed (new, existing, already-present; marked
// when an ignore expired) and what was fixed since the last scan, at Medium or above only, most
// important first, at most 50 and at most 60,000 characters. Leaves ignored findings out and only says
// how many. Same result, same text.
// Returns: the issue Markdown; every untrusted value escaped.
// Rules: OUT-10, OUT-11, OUT-12, MOCK-2, FND-1, FND-3, TGT-10, IGN-2, IGN-10
export function quandle_render_build_productionIssue(
  result: Extract<ScanResult, { status: 'scanned' }>,
  outcome: IgnoreOutcome,
): string {
  const expiredDates = quandle_render_build_expiredDates(outcome);
  const exposed = quandle_render_select_findingsByState(outcome.shown, [
    'new',
    'existing',
    'already-present',
  ]);
  const fixed = quandle_render_select_findingsByState(outcome.shown, ['resolved']);
  const count = exposed.length;
  const heading =
    count > 0
      ? `### Quandle: ${count} exposure${count === 1 ? '' : 's'} in production`
      : '### Quandle: no exposures left in production';
  const head = [
    ISSUE_MARKER,
    ...(result.isMock ? [MOCK_BANNER] : []),
    heading,
    '',
    quandle_render_build_checkedLine(result),
  ];
  const tail = quandle_render_build_ignoredCountLines(outcome.ignored.length);
  const sections = quandle_render_build_findingSections(
    [
      { title: '**Exposed**', findings: exposed },
      { title: '**Fixed**', findings: fixed },
    ],
    expiredDates,
    quandle_render_get_sectionBudget(head, tail),
  );
  return [...head, ...sections, ...tail].join('\n');
}
