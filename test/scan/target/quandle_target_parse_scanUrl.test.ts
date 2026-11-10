// ==========================================================================
// Quandle GitHub Action · test/scan/target/quandle_target_parse_scanUrl.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/scan/target.ts → quandle_target_parse_scanUrl
// Also covers (private): none
//
// Proves a scan URL is accepted only when it is http/https, has no embedded
// credentials and is at most 2048 characters before and after encoding; that errors
// never echo the URL; and that the #fragment is dropped while the query is kept.
// Rules: TGT-8, TGT-10
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_target_parse_scanUrl } from '../../../src/scan/target';

describe('quandle_target_parse_scanUrl', () => {
  it('[TGT-8] accepts an https URL and returns it normalised', () => {
    expect(quandle_target_parse_scanUrl('https://app.example.com')).toEqual({
      ok: true,
      value: 'https://app.example.com/',
    });
  });

  it('[TGT-8] accepts an http URL', () => {
    expect(quandle_target_parse_scanUrl('http://app.example.com/path')).toEqual({
      ok: true,
      value: 'http://app.example.com/path',
    });
  });

  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'ftp://example.com/', 'data:text/html,hello'])(
    '[TGT-8] rejects the scan URL %s because its scheme is not http or https',
    (raw) => {
      expect(quandle_target_parse_scanUrl(raw).ok).toBe(false);
    },
  );

  it('[TGT-8] rejects a scan URL with an embedded username and password', () => {
    expect(quandle_target_parse_scanUrl('https://admin:hunter2@app.example.com/').ok).toBe(false);
  });

  it('[TGT-8] rejects a scan URL with only an embedded username', () => {
    expect(quandle_target_parse_scanUrl('https://admin@app.example.com/').ok).toBe(false);
  });

  it('[TGT-8] accepts a scan URL of exactly 2048 characters', () => {
    const prefix = 'https://app.example.com/';
    expect(quandle_target_parse_scanUrl(prefix + 'a'.repeat(2048 - prefix.length)).ok).toBe(true);
  });

  it('[TGT-8] rejects a scan URL of 2049 characters', () => {
    const prefix = 'https://app.example.com/';
    expect(quandle_target_parse_scanUrl(prefix + 'a'.repeat(2049 - prefix.length)).ok).toBe(false);
  });

  it('[TGT-8] rejects a scan URL that is under 2048 characters as given but over 2048 once encoded', () => {
    const raw = 'https://app.example.com/' + 'a b'.repeat(600);
    expect(raw.length).toBeLessThan(2048);
    expect(quandle_target_parse_scanUrl(raw).ok).toBe(false);
  });

  it('[TGT-10] drops the #fragment from the scan URL', () => {
    expect(quandle_target_parse_scanUrl('https://app.example.com/page#section')).toEqual({
      ok: true,
      value: 'https://app.example.com/page',
    });
  });

  it('[TGT-10] keeps the query string in the scan URL sent to the engine', () => {
    expect(quandle_target_parse_scanUrl('https://app.example.com/?_vercel_share=FAKE_SHARE_TOKEN')).toEqual({
      ok: true,
      value: 'https://app.example.com/?_vercel_share=FAKE_SHARE_TOKEN',
    });
  });

  it('[TGT-8] rejects text that is not a URL', () => {
    expect(quandle_target_parse_scanUrl('not a url').ok).toBe(false);
  });

  it('[TGT-8] never echoes the rejected URL or its credentials in the error message', () => {
    const parsed = quandle_target_parse_scanUrl('https://admin:hunter2@app.example.com/');
    expect(parsed).toHaveProperty('reason');
    expect(JSON.stringify(parsed)).not.toContain('hunter2');
    expect(JSON.stringify(parsed)).not.toContain('app.example.com');
  });
});
