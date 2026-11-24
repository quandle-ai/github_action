// ==========================================================================
// Quandle GitHub Action · test/contracts/README.md.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: README.md
// Also covers (private): none
//
// Proves the README names the optional permission and says what it is for: the detail
// of secret and exposed-file findings on a public repository, in code scanning alerts.
// Rules: PRM-4
// ==========================================================================
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const README = readFileSync('README.md', 'utf8');
const BLANK_LINE = String.fromCharCode(10, 10);

describe('README.md', () => {
  it('[PRM-4] names the optional security-events: write permission', () => {
    expect(README).toContain('`security-events: write`');
  });

  it('[PRM-4] says the permission is for code scanning alerts on a public repository', () => {
    const paragraph = README.split(BLANK_LINE).find((part) => part.includes('security-events: write')) ?? '';
    expect(paragraph).toContain('code scanning');
    expect(paragraph).toContain('public');
  });
});
