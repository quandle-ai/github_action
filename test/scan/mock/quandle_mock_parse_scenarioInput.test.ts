// ==========================================================================
// Quandle GitHub Action · test/scan/mock/quandle_mock_parse_scenarioInput.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/scan/mock.ts → quandle_mock_parse_scenarioInput
// Also covers (private): none
//
// Proves the four mock scenarios are accepted and anything else is a config
// error naming mock-scenario.
// Rules: ERR-1, MOCK-1
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_mock_parse_scenarioInput } from '../../../src/scan/mock';
import { ALL_SCENARIOS } from '../../helpers/mock-scenarios';

describe('quandle_mock_parse_scenarioInput', () => {
  it.each(ALL_SCENARIOS)('[MOCK-1] accepts the %s mock scenario', (raw) => {
    expect(quandle_mock_parse_scenarioInput(raw)).toEqual({ ok: true, value: raw });
  });

  it.each([
    ['Clean', 'clean'],
    ['CRITICAL', 'critical'],
    ['Fixed', 'fixed'],
    ['First-Scan', 'first-scan'],
  ])('[MOCK-1] accepts the mock scenario "%s" in any letter case as %s', (raw, expected) => {
    expect(quandle_mock_parse_scenarioInput(raw)).toEqual({ ok: true, value: expected });
  });

  it.each(['explode', '', ' clean'])(
    '[ERR-1] returns a config error naming mock-scenario for "%s"',
    (raw) => {
      const parsed = quandle_mock_parse_scenarioInput(raw);
      expect(parsed.ok).toBe(false);
      expect(parsed).toHaveProperty('reason', expect.stringContaining('mock-scenario'));
    },
  );

  it('[MOCK-1] lists exactly the allowed mock scenarios in the config error', () => {
    expect(quandle_mock_parse_scenarioInput('explode')).toEqual({
      ok: false,
      reason: 'Quandle: `mock-scenario` must be one of: clean, critical, fixed, first-scan.',
    });
  });
});
