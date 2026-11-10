// ==========================================================================
// Quandle GitHub Action · test/contracts/action.yml.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: action.yml
// Also covers (private): none
//
// Proves action.yml declares exactly the inputs and outputs the spec defines,
// no more and no fewer, so an input like api-url cannot quietly come back.
// Rules: IO-1, OUT-6, TRU-4
// ==========================================================================
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALL_INPUT_NAMES } from '../helpers/input-names';

const ACTION_YML = readFileSync('action.yml', 'utf8');

// Names of the 2-space-indented keys under a top-level section (e.g. "inputs:").
function readSectionKeys(section: string): string[] {
  const start = ACTION_YML.indexOf(`\n${section}:\n`);
  const rest = ACTION_YML.slice(start + section.length + 3);
  const end = rest.search(/\n[a-z]/);
  return [...rest.slice(0, end).matchAll(/^ {2}([a-z-]+):/gm)].map((match) => match[1] ?? '');
}

describe('action.yml', () => {
  it('[IO-1] declares exactly the inputs in InputName, no more and no fewer', () => {
    expect(readSectionKeys('inputs').sort()).toEqual([...ALL_INPUT_NAMES].sort());
  });

  it('[OUT-6] declares exactly the four documented outputs', () => {
    expect(readSectionKeys('outputs').sort()).toEqual(
      ['critical', 'new-findings', 'scan-id', 'status'].sort(),
    );
  });

  it('[TRU-4] has no api-url input, so the engine URL cannot be changed from a workflow', () => {
    expect(readSectionKeys('inputs')).not.toContain('api-url');
  });
});
