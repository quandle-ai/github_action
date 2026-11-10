// ==========================================================================
// Quandle GitHub Action · test/scan/ignore/quandle_ignore_parse_ignoreFile.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/scan/ignore.ts → quandle_ignore_parse_ignoreFile
// Also covers (private): none
//
// Proves an ignore file is accepted only when every entry has exactly one of id
// or rule, a reason and a real expiry date at most 1 year out (UTC), with no
// unknown keys; that one bad entry, bad YAML, a wrong shape or an oversized file
// makes the whole file invalid; and that the warning never repeats the file's text.
// Rules: IGN-1, IGN-4, IGN-7, IGN-8
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_ignore_parse_ignoreFile } from '../../../src/scan/ignore';

// The run's time: 2026-11-09 in UTC, so "1 year out" is 2027-11-09.
const NOW = new Date('2026-11-09T12:00:00Z');

function invalid(problem: string): { ok: false; reason: string } {
  return {
    ok: false,
    reason: `Quandle: .quandle-ignore.yml is invalid, so nothing is ignored (${problem}).`,
  };
}

// One entry as YAML list lines, so a test only spells out what it is about.
function entryLines(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([key, value], index) => `${index === 0 ? '  - ' : '    '}${key}: ${value}`)
    .join('\n');
}

function fileWith(...entries: Record<string, string>[]): string {
  return `ignore:\n${entries.map(entryLines).join('\n')}\n`;
}

const ID_ENTRY = { id: 'qf_test01', reason: '"Public by design"', expires: '2027-02-01' };
const RULE_ENTRY = { rule: 'header/csp-missing', reason: '"Tracked elsewhere"', expires: '2027-05-01' };

describe('quandle_ignore_parse_ignoreFile', () => {
  describe('entries (IGN-1)', () => {
    it('[IGN-1] accepts an entry with id, reason and expires as an id match', () => {
      expect(quandle_ignore_parse_ignoreFile(fileWith(ID_ENTRY), NOW)).toEqual({
        ok: true,
        value: [
          { match: { kind: 'id', id: 'qf_test01' }, reason: 'Public by design', expires: '2027-02-01' },
        ],
      });
    });

    it('[IGN-1] accepts an entry with rule, reason and expires as a rule match', () => {
      expect(quandle_ignore_parse_ignoreFile(fileWith(RULE_ENTRY), NOW)).toEqual({
        ok: true,
        value: [
          {
            match: { kind: 'rule', rule: 'header/csp-missing' },
            reason: 'Tracked elsewhere',
            expires: '2027-05-01',
          },
        ],
      });
    });

    it('[IGN-1] keeps every entry in file order', () => {
      const parsed = quandle_ignore_parse_ignoreFile(fileWith(RULE_ENTRY, ID_ENTRY), NOW);
      expect(parsed.ok && parsed.value.map((entry) => entry.match.kind)).toEqual(['rule', 'id']);
    });

    it('[IGN-1] accepts an empty list under ignore: as no entries', () => {
      expect(quandle_ignore_parse_ignoreFile('ignore: []\n', NOW)).toEqual({ ok: true, value: [] });
    });

    it('[IGN-1] rejects an entry with both id and rule', () => {
      const text = fileWith({ id: 'qf_test01', rule: 'secret/test', reason: 'x', expires: '2027-02-01' });
      expect(quandle_ignore_parse_ignoreFile(text, NOW)).toEqual(
        invalid('entry 1: needs exactly one of `id` or `rule`'),
      );
    });

    it('[IGN-1] rejects an entry with neither id nor rule', () => {
      const text = fileWith({ reason: 'x', expires: '2027-02-01' });
      expect(quandle_ignore_parse_ignoreFile(text, NOW)).toEqual(
        invalid('entry 1: needs exactly one of `id` or `rule`'),
      );
    });

    it('[IGN-1] rejects an entry whose id is the number 123 instead of text', () => {
      const text = fileWith({ ...ID_ENTRY, id: '123' });
      expect(quandle_ignore_parse_ignoreFile(text, NOW)).toEqual(invalid('entry 1: `id` must be text'));
    });

    it('[IGN-1] rejects an entry whose rule is a list instead of text', () => {
      const text = fileWith({ ...RULE_ENTRY, rule: '[a, b]' });
      expect(quandle_ignore_parse_ignoreFile(text, NOW)).toEqual(invalid('entry 1: `rule` must be text'));
    });

    it('[IGN-1] rejects an entry with no reason', () => {
      const text = fileWith({ id: 'qf_test01', expires: '2027-02-01' });
      expect(quandle_ignore_parse_ignoreFile(text, NOW)).toEqual(invalid('entry 1: `reason` is required'));
    });

    it('[IGN-1] rejects an entry with an empty reason ""', () => {
      const text = fileWith({ ...ID_ENTRY, reason: '""' });
      expect(quandle_ignore_parse_ignoreFile(text, NOW)).toEqual(invalid('entry 1: `reason` is required'));
    });

    it('[IGN-1] rejects an entry whose reason is the number 42 instead of text', () => {
      const text = fileWith({ ...ID_ENTRY, reason: '42' });
      expect(quandle_ignore_parse_ignoreFile(text, NOW)).toEqual(invalid('entry 1: `reason` is required'));
    });

    it('[IGN-1] rejects an entry with no expires', () => {
      const text = fileWith({ id: 'qf_test01', reason: 'x' });
      expect(quandle_ignore_parse_ignoreFile(text, NOW)).toEqual(
        invalid('entry 1: `expires` must be a date like 2027-01-31'),
      );
    });
  });

  describe('the whole file (IGN-4)', () => {
    it('[IGN-4] rejects the whole file when only entry 2 of 3 is bad, naming entry 2', () => {
      const text = fileWith(ID_ENTRY, { id: 'qf_test02', expires: '2027-02-01' }, RULE_ENTRY);
      expect(quandle_ignore_parse_ignoreFile(text, NOW)).toEqual(invalid('entry 2: `reason` is required'));
    });

    it('[IGN-4] names only the first bad entry when entries 2 and 3 are both bad', () => {
      const text = fileWith(
        ID_ENTRY,
        { id: 'qf_test02', expires: '2027-02-01' },
        { reason: 'x', expires: '2027-02-01' },
      );
      expect(quandle_ignore_parse_ignoreFile(text, NOW)).toEqual(invalid('entry 2: `reason` is required'));
    });

    it('[IGN-4] rejects an entry with an unknown key notes', () => {
      const text = fileWith({ ...ID_ENTRY, notes: 'x' });
      expect(quandle_ignore_parse_ignoreFile(text, NOW)).toEqual(invalid('entry 1: has an unknown key'));
    });

    it('[IGN-4] does not repeat the unknown key FAKE_KEY_NAME from the file in the warning', () => {
      const parsed = quandle_ignore_parse_ignoreFile(fileWith({ ...ID_ENTRY, FAKE_KEY_NAME: 'x' }), NOW);
      expect(parsed.ok).toBe(false);
      expect(JSON.stringify(parsed)).not.toContain('FAKE_KEY_NAME');
    });

    it('[IGN-4] rejects an entry with a __proto__ key as an unknown key instead of letting it slip past', () => {
      // Written out literally: in a JS object literal, __proto__ would not become a key.
      const text =
        'ignore:\n  - id: qf_test01\n    reason: x\n    expires: 2027-02-01\n    __proto__: { a: 1 }\n';
      expect(quandle_ignore_parse_ignoreFile(text, NOW)).toEqual(invalid('entry 1: has an unknown key'));
    });

    it('[IGN-4] rejects a file that is not valid YAML, giving only the line number 3', () => {
      // Line 3 has a second `key:` inside a plain value, which YAML forbids.
      const text = 'ignore:\n  - id: qf_test01\n    reason: FAKE_LINE_TEXT: x\n    expires: 2027-02-01\n';
      expect(quandle_ignore_parse_ignoreFile(text, NOW)).toEqual(invalid('not valid YAML, line 3'));
    });

    it('[IGN-4] rejects a file with the same key twice in one entry as not valid YAML', () => {
      const text = 'ignore:\n  - id: qf_test01\n    id: qf_test02\n    reason: x\n    expires: 2027-02-01\n';
      expect(quandle_ignore_parse_ignoreFile(text, NOW)).toEqual(invalid('not valid YAML, line 3'));
    });

    it('[IGN-4] rejects a YAML alias bomb as not valid YAML instead of expanding it', () => {
      const levels = ['a: &a [x, x, x, x, x, x, x, x, x, x]'];
      for (let level = 1; level < 9; level++) {
        const previous = String.fromCharCode(96 + level);
        const current = String.fromCharCode(97 + level);
        levels.push(`${current}: &${current} [${Array(10).fill(`*${previous}`).join(', ')}]`);
      }
      const parsed = quandle_ignore_parse_ignoreFile(`${levels.join('\n')}\nignore: *i\n`, NOW);
      expect(parsed).toEqual(invalid('not valid YAML'));
    });

    it.each([
      ['an empty file', ''],
      ['a top-level list', '- id: qf_test01\n'],
      ['a top-level string', 'just some text\n'],
      ['no ignore: key', 'ignores:\n  - id: qf_test01\n'],
      ['ignore: holding a string', 'ignore: qf_test01\n'],
      ['an extra top-level key next to ignore:', 'ignore: []\nextra: true\n'],
      ['an entry that is a string', 'ignore:\n  - qf_test01\n'],
      ['an entry that is a list', 'ignore:\n  - [qf_test01]\n'],
    ])('[IGN-4] rejects %s as not a list of entries under ignore:', (_label, text) => {
      expect(quandle_ignore_parse_ignoreFile(text, NOW)).toEqual(
        invalid('expected a list of entries under `ignore:`'),
      );
    });
  });

  describe('expiry dates (IGN-7)', () => {
    it('[IGN-7] accepts expires written in quotes, "2027-02-01", the same as unquoted', () => {
      const parsed = quandle_ignore_parse_ignoreFile(fileWith({ ...ID_ENTRY, expires: '"2027-02-01"' }), NOW);
      expect(parsed.ok && parsed.value[0]?.expires).toBe('2027-02-01');
    });

    it.each(['2027-02-30', '2027-13-01', '2027-2-1', '2027-02-01T00:00:00Z', '20270201', 'soon'])(
      '[IGN-7] rejects expires %s as not a calendar date',
      (expires) => {
        expect(quandle_ignore_parse_ignoreFile(fileWith({ ...ID_ENTRY, expires }), NOW)).toEqual(
          invalid('entry 1: `expires` must be a date like 2027-01-31'),
        );
      },
    );

    it('[IGN-7] accepts expires 2027-11-09, exactly 1 year after a run on 2026-11-09', () => {
      expect(quandle_ignore_parse_ignoreFile(fileWith({ ...ID_ENTRY, expires: '2027-11-09' }), NOW).ok).toBe(
        true,
      );
    });

    it('[IGN-7] rejects expires 2027-11-10, 1 year and 1 day after a run on 2026-11-09', () => {
      expect(quandle_ignore_parse_ignoreFile(fileWith({ ...ID_ENTRY, expires: '2027-11-10' }), NOW)).toEqual(
        invalid('entry 1: `expires` is more than 1 year away'),
      );
    });

    it('[IGN-7] accepts an expires date in the past, 2026-01-01, as a valid (expired) entry', () => {
      expect(quandle_ignore_parse_ignoreFile(fileWith({ ...ID_ENTRY, expires: '2026-01-01' }), NOW).ok).toBe(
        true,
      );
    });

    it('[IGN-7] measures 1 year from the UTC day: a run at 23:30 New York time on 2026-11-09 allows 2027-11-10', () => {
      const lateEvening = new Date('2026-11-09T23:30:00-05:00');
      const parsed = quandle_ignore_parse_ignoreFile(
        fileWith({ ...ID_ENTRY, expires: '2027-11-10' }),
        lateEvening,
      );
      expect(parsed.ok).toBe(true);
    });

    it('[IGN-7] allows up to 2029-02-28, and not 2029-03-01, for a run on the leap day 2028-02-29', () => {
      const leapDay = new Date('2028-02-29T12:00:00Z');
      expect(
        quandle_ignore_parse_ignoreFile(fileWith({ ...ID_ENTRY, expires: '2029-02-28' }), leapDay).ok,
      ).toBe(true);
      expect(
        quandle_ignore_parse_ignoreFile(fileWith({ ...ID_ENTRY, expires: '2029-03-01' }), leapDay).ok,
      ).toBe(false);
    });
  });

  describe('size limits (IGN-8)', () => {
    // A valid one-entry file padded with a YAML comment to exactly `totalBytes` bytes.
    function paddedFile(totalBytes: number): string {
      const base = fileWith(ID_ENTRY);
      return `${base}#${'x'.repeat(totalBytes - base.length - 2)}\n`;
    }

    it('[IGN-8] accepts a file of exactly 64 KB (65536 bytes)', () => {
      expect(quandle_ignore_parse_ignoreFile(paddedFile(65536), NOW).ok).toBe(true);
    });

    it('[IGN-8] rejects a file of 65537 bytes as larger than 64 KB', () => {
      expect(quandle_ignore_parse_ignoreFile(paddedFile(65537), NOW)).toEqual(
        invalid('file is larger than 64 KB'),
      );
    });

    it('[IGN-8] counts bytes, not characters: 32769 two-byte characters (65538 bytes) are too large', () => {
      const text = `ignore: []\n#${'é'.repeat(32769)}\n`;
      expect(quandle_ignore_parse_ignoreFile(text, NOW)).toEqual(invalid('file is larger than 64 KB'));
    });

    it('[IGN-8] accepts a file with exactly 500 entries', () => {
      const parsed = quandle_ignore_parse_ignoreFile(fileWith(...Array(500).fill(ID_ENTRY)), NOW);
      expect(parsed.ok && parsed.value.length).toBe(500);
    });

    it('[IGN-8] rejects a file with 501 entries', () => {
      expect(quandle_ignore_parse_ignoreFile(fileWith(...Array(501).fill(ID_ENTRY)), NOW)).toEqual(
        invalid('more than 500 entries'),
      );
    });
  });
});
