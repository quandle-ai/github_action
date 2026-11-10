// ==========================================================================
// Quandle GitHub Action · scripts/check-rule-traceability.mjs
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Keeps spec rule IDs traceable. Fails when:
//   - a test file's "// Rules:" header doesn't list exactly the IDs in its test names;
//   - any rule ID in test/ or src/ isn't defined in .claude/quandle_knowledge.md.
// Also lists spec rules that have no tests yet (a to-do list, not a failure).
// Run by `npm run check:rules`.
// ==========================================================================
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SPEC_FILE = '.claude/quandle_knowledge.md';
const RULE_ID = /\b[A-Z]{2,5}-\d+\b/g;
const BRACKETED_RULE_ID = /\[([A-Z]{2,5}-\d+)\]/g;

function listFiles(path, suffix) {
  if (!statSync(path).isDirectory()) return path.endsWith(suffix) ? [path] : [];
  return readdirSync(path).flatMap((entry) => listFiles(join(path, entry), suffix));
}

function sortRuleIds(ids) {
  const prefix = (id) => id.split('-')[0];
  const number = (id) => Number(id.split('-')[1]);
  return [...new Set(ids)].sort((a, b) => prefix(a).localeCompare(prefix(b)) || number(a) - number(b));
}

// Expands "TGT-1 … TGT-10" (or "...") into every ID in between.
function expandRuleIds(text) {
  const expanded = text.replace(/\b([A-Z]{2,5})-(\d+)\s*(?:…|\.\.\.)\s*\1-(\d+)\b/g, (_m, prefix, from, to) =>
    Array.from({ length: Number(to) - Number(from) + 1 }, (_, i) => `${prefix}-${Number(from) + i}`).join(
      ', ',
    ),
  );
  return expanded.match(RULE_ID) ?? [];
}

// The "// Rules:" line between the file header's two "// ====" bars, or undefined.
function readHeaderRules(text) {
  const lines = text.split('\n');
  const isBar = (line) => line.startsWith('// ====');
  const first = lines.findIndex(isBar);
  const last = lines.findIndex((line, index) => index > first && isBar(line));
  if (first < 0 || last < 0) return undefined;
  const line = lines.slice(first + 1, last).find((l) => l.startsWith('// Rules:'));
  return line === undefined ? undefined : line.replace('// Rules:', '');
}

const specIds = new Set(
  readFileSync(SPEC_FILE, 'utf8')
    .match(/\*\*([A-Z]{2,5}-\d+)\*\*/g)
    ?.map((m) => m.slice(2, -2)),
);
const problems = [];
const testedIds = new Set();

for (const file of listFiles('test', '.test.ts')) {
  const text = readFileSync(file, 'utf8');
  const usedInTests = sortRuleIds([...text.matchAll(BRACKETED_RULE_ID)].map((m) => m[1]));
  usedInTests.forEach((id) => testedIds.add(id));
  const headerText = readHeaderRules(text);
  if (headerText === undefined) {
    problems.push(`${file}: header has no "// Rules:" line`);
    continue;
  }
  if (/…|\.\.\./.test(headerText)) problems.push(`${file}: "// Rules:" must list every ID, not a range`);
  const inHeader = sortRuleIds(expandRuleIds(headerText));
  const missing = usedInTests.filter((id) => !inHeader.includes(id));
  const extra = inHeader.filter((id) => !usedInTests.includes(id));
  if (missing.length > 0)
    problems.push(`${file}: "// Rules:" is missing ${missing.join(', ')} (used in test names)`);
  if (extra.length > 0)
    problems.push(`${file}: "// Rules:" lists ${extra.join(', ')}, but no test name uses it`);
}

for (const file of [...listFiles('src', '.ts'), ...listFiles('test', '.ts')]) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    const ids = line.includes('Rules:') || /\[[A-Z]{2,5}-\d+\]/.test(line) ? expandRuleIds(line) : [];
    for (const id of ids) {
      if (!specIds.has(id)) problems.push(`${file}:${index + 1}: ${id} is not defined in ${SPEC_FILE}`);
    }
  });
}

const untested = sortRuleIds([...specIds].filter((id) => !testedIds.has(id)));

if (problems.length > 0) {
  console.error('Rule traceability problems:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(
  `check:rules OK: every test header matches its test names; every rule ID is defined in the spec.`,
);
console.log(`Spec rules with no tests yet (${untested.length}): ${untested.join(', ') || 'none'}`);
