// ==========================================================================
// Quandle GitHub Action · test/report/render/quandle_render_escape_logText.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/report/render.ts → quandle_render_escape_logText
// Also covers (private): quandle_render_clean_plainText
//
// Proves untrusted text in a log line can never start a new line or inject a
// "::" workflow command, has every invisible character removed, and is capped at
// 200 characters.
// Rules: FND-3
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_render_escape_logText } from '../../../src/report/render';
import { INVISIBLE_CHARACTERS } from '../../helpers/invisible-characters';

describe('quandle_render_escape_logText', () => {
  it('[FND-3] neutralises a workflow command so untrusted text cannot inject one', () => {
    expect(quandle_render_escape_logText('::add-mask::value')).not.toContain('::');
  });

  it('[FND-3] collapses newlines so untrusted text cannot start a new log line with a workflow command', () => {
    const escaped = quandle_render_escape_logText('fine\n::error::injected');
    expect(escaped).not.toContain('\n');
    expect(escaped).not.toContain('::');
  });

  it('[FND-3] truncates log text longer than 200 characters', () => {
    expect(quandle_render_escape_logText('a'.repeat(250))).toHaveLength(200);
  });

  it.each(INVISIBLE_CHARACTERS)(
    '[FND-3] removes the invisible %s character (U+%s) from a log line',
    (_name, hex) => {
      const invisible = String.fromCodePoint(parseInt(hex, 16));
      expect(quandle_render_escape_logText(`se${invisible}cret`)).toBe('secret');
    },
  );
});
