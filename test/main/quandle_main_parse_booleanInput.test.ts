// ==========================================================================
// Quandle GitHub Action · test/main/quandle_main_parse_booleanInput.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/main.ts → quandle_main_parse_booleanInput
// Also covers (private): none
//
// Proves boolean inputs accept only true/false in any letter case, and anything
// else is a config error naming the input.
// Rules: IO-2
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_main_parse_booleanInput } from '../../src/main';

describe('quandle_main_parse_booleanInput', () => {
  it.each(['true', 'TRUE', 'True'])('[IO-2] reads "%s" as true', (raw) => {
    expect(quandle_main_parse_booleanInput('comment', raw)).toEqual({ ok: true, value: true });
  });

  it.each(['false', 'FALSE', 'False'])('[IO-2] reads "%s" as false', (raw) => {
    expect(quandle_main_parse_booleanInput('comment', raw)).toEqual({ ok: true, value: false });
  });

  it.each(['yes', '1', 'on', ''])('[IO-2] returns a config error naming the input for "%s"', (raw) => {
    const parsed = quandle_main_parse_booleanInput('comment', raw);
    expect(parsed.ok).toBe(false);
    expect(parsed).toHaveProperty('reason', expect.stringContaining('`comment`'));
  });
});
