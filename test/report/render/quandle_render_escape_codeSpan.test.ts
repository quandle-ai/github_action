// ==========================================================================
// Quandle GitHub Action · test/report/render/quandle_render_escape_codeSpan.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/report/render.ts → quandle_render_escape_codeSpan
// Also covers (private): quandle_render_clean_plainText
//
// Proves untrusted text inside a code span can never close it early, and that
// newlines and invisible characters are removed and length is capped.
// Rules: FND-3
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_render_escape_codeSpan } from '../../../src/report/render';
import { INVISIBLE_CHARACTERS } from '../../helpers/invisible-characters';

describe('quandle_render_escape_codeSpan', () => {
  it('[FND-3] wraps text in a single code span', () => {
    expect(quandle_render_escape_codeSpan('assets/index.js')).toBe('`assets/index.js`');
  });

  it('[FND-3] replaces backticks inside the text so the code span cannot be closed early', () => {
    expect(quandle_render_escape_codeSpan('a`b')).toBe("`a'b`");
  });

  it('[FND-3] collapses newlines inside a code span', () => {
    expect(quandle_render_escape_codeSpan('a\nb')).toBe('`a b`');
  });

  it('[FND-3] truncates a code span longer than 200 characters', () => {
    expect(quandle_render_escape_codeSpan('a'.repeat(250))).toHaveLength(202);
  });

  it.each(INVISIBLE_CHARACTERS)(
    '[FND-3] removes the invisible %s character (U+%s) inside a code span',
    (_name, hex) => {
      const invisible = String.fromCodePoint(parseInt(hex, 16));
      expect(quandle_render_escape_codeSpan(`qf_${invisible}id`)).toBe('`qf_id`');
    },
  );
});
