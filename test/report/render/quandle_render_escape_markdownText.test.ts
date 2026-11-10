// ==========================================================================
// Quandle GitHub Action · test/report/render/quandle_render_escape_markdownText.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/report/render.ts → quandle_render_escape_markdownText
// Also covers (private): quandle_render_clean_plainText
//
// Proves untrusted text placed in Markdown cannot create HTML, links, auto-links,
// @mentions, code spans, math or new blocks; invisible and control characters are
// removed; and visible text is capped at 200 characters.
// Rules: FND-3
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_render_escape_markdownText } from '../../../src/report/render';
import { INVISIBLE_CHARACTERS } from '../../helpers/invisible-characters';

describe('quandle_render_escape_markdownText', () => {
  it('[FND-3] escapes HTML tags so they render as text, not markup', () => {
    const escaped = quandle_render_escape_markdownText('<img src=x onerror=alert(1)>');
    expect(escaped).not.toContain('<img');
    expect(escaped).toContain('&lt;img');
  });

  it('[FND-3] escapes ampersands so HTML entities cannot be smuggled in', () => {
    expect(quandle_render_escape_markdownText('&lt;script&gt;')).toContain('&amp;lt;');
  });

  it('[FND-3] escapes Markdown link syntax so no link is created', () => {
    expect(quandle_render_escape_markdownText('[click me](https://evil.example)')).toContain(
      '\\[click me\\]\\(',
    );
  });

  it('[FND-3] breaks @mentions so nobody is notified', () => {
    const escaped = quandle_render_escape_markdownText('ping @octocat');
    expect(escaped).not.toMatch(/@octocat/);
    expect(escaped).toContain('@\u200boctocat');
  });

  it('[FND-3] breaks bare https URLs so they are not auto-linked', () => {
    expect(quandle_render_escape_markdownText('see https://evil.example now')).not.toContain('://');
  });

  it('[FND-3] breaks www. addresses so they are not auto-linked', () => {
    expect(quandle_render_escape_markdownText('visit www.evil.example')).not.toMatch(/www\\?\./i);
  });

  it('[FND-3] escapes every backtick so no code span or fence can be opened', () => {
    expect(quandle_render_escape_markdownText('```js')).not.toMatch(/(^|[^\\])`/);
  });

  it('[FND-3] escapes emphasis, heading and table characters', () => {
    expect(quandle_render_escape_markdownText('*_#|~')).toBe('\\*\\_\\#\\|\\~');
  });

  it('[FND-3] collapses newlines so untrusted text cannot start a new Markdown block', () => {
    expect(quandle_render_escape_markdownText('first line\n# injected heading')).not.toContain('\n');
  });

  it('[FND-3] removes control characters and bidirectional override characters', () => {
    const escaped = quandle_render_escape_markdownText('safe\u0007\u202etext\u2066');
    expect(escaped).toBe('safe text');
  });

  it('[FND-3] truncates text longer than 200 characters to 200 characters ending in an ellipsis', () => {
    const escaped = quandle_render_escape_markdownText('a'.repeat(250));
    expect(escaped).toHaveLength(200);
    expect(escaped.endsWith('…')).toBe(true);
  });

  it('[FND-3] leaves text of exactly 200 plain characters untouched', () => {
    expect(quandle_render_escape_markdownText('a'.repeat(200))).toBe('a'.repeat(200));
  });

  it('[FND-3] escapes dollar signs so no math block can be rendered', () => {
    expect(quandle_render_escape_markdownText('$\\Huge x$ and $$y$$')).not.toMatch(/(^|[^\\])\$/);
  });

  it.each(INVISIBLE_CHARACTERS)(
    '[FND-3] removes the invisible %s character (U+%s) entirely',
    (_name, hex) => {
      const invisible = String.fromCodePoint(parseInt(hex, 16));
      expect(quandle_render_escape_markdownText(`se${invisible}cret`)).toBe('secret');
    },
  );

  it('[FND-3] caps the visible text at 200 characters, so escaped output never exceeds 1000 characters', () => {
    expect(quandle_render_escape_markdownText('&'.repeat(500)).length).toBeLessThanOrEqual(1000);
  });
});
