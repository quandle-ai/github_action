// ==========================================================================
// Quandle GitHub Action · test/helpers/invisible-characters.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Every invisible character class FND-3 requires the escapers to remove, by name
// and code point (built at runtime, so this file holds no literal invisibles).
// ==========================================================================
export const INVISIBLE_CHARACTERS: [string, string][] = [
  ['zero-width space', '200B'],
  ['zero-width non-joiner', '200C'],
  ['zero-width joiner', '200D'],
  ['left-to-right mark', '200E'],
  ['right-to-left mark', '200F'],
  ['right-to-left override', '202E'],
  ['first strong isolate', '2068'],
  ['word joiner', '2060'],
  ['invisible separator', '2063'],
  ['byte order mark', 'FEFF'],
  ['Arabic letter mark', '061C'],
  ['Mongolian vowel separator', '180E'],
  ['soft hyphen', '00AD'],
  ['tag block start', 'E0000'],
  ['language tag', 'E0001'],
  ['tag letter A', 'E0041'],
  ['cancel tag', 'E007F'],
  ['first variation selector', 'FE00'],
  ['emoji variation selector', 'FE0F'],
  ['first supplementary variation selector', 'E0100'],
  ['last supplementary variation selector', 'E01EF'],
];
