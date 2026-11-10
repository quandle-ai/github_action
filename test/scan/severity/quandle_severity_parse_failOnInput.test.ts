// ==========================================================================
// Quandle GitHub Action · test/scan/severity/quandle_severity_parse_failOnInput.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/scan/severity.ts → quandle_severity_parse_failOnInput
// Also covers (private): none
//
// Proves only the exact fail-on values critical, high, medium and never are
// accepted, and anything else is a config error naming fail-on.
// Rules: SEV-1
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_severity_parse_failOnInput } from '../../../src/scan/severity';

describe('quandle_severity_parse_failOnInput', () => {
  it.each(['critical', 'high', 'medium', 'never'])('[SEV-1] accepts fail-on %s', (raw) => {
    expect(quandle_severity_parse_failOnInput(raw)).toEqual({ ok: true, value: raw });
  });

  it.each([
    ['Critical', 'critical'],
    ['HIGH', 'high'],
    ['Medium', 'medium'],
    ['NeVeR', 'never'],
  ])('[SEV-1] accepts fail-on "%s" in any letter case as %s', (raw, expected) => {
    expect(quandle_severity_parse_failOnInput(raw)).toEqual({ ok: true, value: expected });
  });

  it.each(['low', 'sometimes', '', ' critical', 'critical '])(
    '[SEV-1] returns a config error for fail-on "%s"',
    (raw) => {
      const parsed = quandle_severity_parse_failOnInput(raw);
      expect(parsed.ok).toBe(false);
      expect(parsed).toHaveProperty('reason', expect.stringContaining('fail-on'));
    },
  );

  it('[SEV-1] lists exactly the allowed fail-on values in the config error', () => {
    expect(quandle_severity_parse_failOnInput('sometimes')).toEqual({
      ok: false,
      reason: 'Quandle: `fail-on` must be one of: critical, high, medium, never.',
    });
  });
});
