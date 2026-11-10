// ==========================================================================
// Quandle GitHub Action · test/helpers/input-names.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Every input name exactly once, checked against InputName at compile time: a
// renamed, added or removed input breaks the typecheck until the tests follow.
// Used by the action.yml contract test.
// ==========================================================================
import type { InputName } from '../../src/types';

const INPUT_NAME_SET: Readonly<Record<InputName, true>> = {
  url: true,
  'fail-on': true,
  comment: true,
  issue: true,
  'bypass-secret': true,
  mock: true,
  'mock-scenario': true,
  'github-token': true,
};

// Object.keys returns string[]; the keys are exactly InputName by construction above.
export const ALL_INPUT_NAMES = Object.keys(INPUT_NAME_SET) as InputName[];
