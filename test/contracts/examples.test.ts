// ==========================================================================
// Quandle GitHub Action · test/contracts/examples.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: examples/*.yml
// Also covers (private): none
//
// Proves every example workflow users copy is safe and correct: only declared
// inputs, only documented permissions (and none it turned off), only supported
// triggers, a job timeout, a success-only job for deploys, no api-url, and the
// bypass secret only ever from a GitHub secret.
// Rules: IO-3, PRM-1, PRM-2, TRU-4, TRU-5
// ==========================================================================
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALL_INPUT_NAMES } from '../helpers/input-names';

const EXPECTED_EXAMPLES = [
  'quandle-daily.yml',
  'quandle-hardened.yml',
  'quandle-install.yml',
  'quandle-vercel-protected.yml',
  'quandle.yml',
];
const DOCUMENTED_PERMISSIONS: Record<string, string> = {
  'id-token': 'write',
  'pull-requests': 'write',
  issues: 'write',
  contents: 'read',
};
const SUPPORTED_TRIGGERS = ['deployment_status', 'workflow_dispatch', 'schedule'];

interface Entry {
  key: string;
  value: string;
}

// Direct children (key: value) of the first block whose header line matches, ignoring comments.
function readChildEntries(text: string, header: RegExp): Entry[] {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => header.test(line));
  if (start < 0) return [];
  const headerIndent = (lines[start] ?? '').search(/\S/);
  const entries: Entry[] = [];
  let childIndent: number | undefined;
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const indent = line.search(/\S/);
    if (indent <= headerIndent) break;
    childIndent ??= indent;
    if (indent !== childIndent) continue;
    const match = /^\s*([A-Za-z0-9_-]+):\s*(.*?)\s*(#.*)?$/.exec(line);
    if (match) entries.push({ key: match[1] ?? '', value: match[2] ?? '' });
  }
  return entries;
}

// The text of the job-level `if:` (folded or single-line), joined into one line.
function readJobCondition(text: string): string {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^ {4}if:/.test(line));
  if (start < 0) return '';
  const first = (lines[start] ?? '').replace(/^ {4}if:\s*(>-)?/, '');
  const continued = lines.slice(start + 1).filter((_line, index, all) => {
    const before = all.slice(0, index + 1);
    return before.every((l) => /^ {6,}\S/.test(l));
  });
  return [first, ...continued].join(' ').replace(/\s+/g, ' ').trim();
}

const exampleFiles = readdirSync('examples').filter((name) => name.endsWith('.yml'));
const examples = exampleFiles.map((name) => [name, readFileSync(`examples/${name}`, 'utf8')] as const);

describe('examples/*.yml', () => {
  it('[IO-3] contains exactly the five documented example workflows', () => {
    expect([...exampleFiles].sort()).toEqual(EXPECTED_EXAMPLES);
  });

  describe.each(examples)('%s', (name, text) => {
    const triggers = readChildEntries(text, /^on:\s*$/).map((entry) => entry.key);
    const permissions = readChildEntries(text, /^permissions:\s*$/);
    const withInputs = readChildEntries(text, /^\s+with:\s*$/);
    const inputValue = (input: string): string | undefined =>
      withInputs.find((entry) => entry.key === input)?.value;

    it(`[IO-3] ${name} uses only supported triggers`, () => {
      expect(triggers.length).toBeGreaterThan(0);
      for (const trigger of triggers) expect(SUPPORTED_TRIGGERS).toContain(trigger);
    });

    it(`[IO-3] ${name} uses only inputs declared in action.yml`, () => {
      for (const entry of withInputs) expect(ALL_INPUT_NAMES as string[]).toContain(entry.key);
    });

    it(`[PRM-1] ${name} asks only for the four documented permissions, with their documented access`, () => {
      expect(permissions.length).toBeGreaterThan(0);
      for (const entry of permissions) expect(entry.value).toBe(DOCUMENTED_PERMISSIONS[entry.key]);
    });

    it(`[IO-3] ${name} sets a job timeout`, () => {
      expect(text).toMatch(/^ {4}timeout-minutes: \d+$/m);
    });

    it(`[IO-3] ${name} starts its job only for successful deploys when it triggers on deployment_status`, () => {
      if (!triggers.includes('deployment_status')) return;
      const condition = readJobCondition(text);
      expect(condition).toContain("github.event_name != 'deployment_status'");
      expect(condition).toContain("github.event.deployment_status.state == 'success'");
    });

    it(`[PRM-2] ${name} does not ask for a permission whose output it turns off`, () => {
      const permissionNames = permissions.map((entry) => entry.key);
      if (inputValue('comment') === 'false') expect(permissionNames).not.toContain('pull-requests');
      if (inputValue('issue') === 'false') expect(permissionNames).not.toContain('issues');
    });

    it(`[TRU-4] ${name} never passes api-url`, () => {
      expect(text).not.toMatch(/api-url/);
    });

    it(`[TRU-5] ${name} passes bypass-secret only from a GitHub secret, never as plain text`, () => {
      const bypass = inputValue('bypass-secret');
      if (bypass === undefined) return;
      expect(bypass).toMatch(/^\$\{\{ secrets\.[A-Z0-9_]+ \}\}$/);
    });
  });
});
