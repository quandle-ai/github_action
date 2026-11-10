// ==========================================================================
// Quandle GitHub Action · scripts/check-invisible-characters.mjs
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Fails if any file in the repo (including dist/, docs and config; excluding only
// node_modules/, coverage/, .git/ and .vscode/) contains a literal invisible or
// bidirectional character ("Trojan Source"). Such characters must be written
// as \u escapes so reviewers can see them. Run by `npm run check:source`.
// ==========================================================================
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Not ours or not committed: dependencies, test output, git internals, personal editor settings.
const EXCLUDED_DIRECTORIES = new Set(['node_modules', 'coverage', '.git', '.vscode']);
// Soft hyphen, Arabic letter mark, Mongolian vowel separator, zero-width, LRM/RLM, bidi
// embeddings/overrides/isolates, word joiners, variation selectors, BOM, Unicode tag characters.
const INVISIBLE_CHARACTERS =
  /[\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufe00-\ufe0f\ufeff\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/u;

function listFiles(path) {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path)
    .filter((entry) => !EXCLUDED_DIRECTORIES.has(entry))
    .flatMap((entry) => listFiles(join(path, entry)));
}

const problems = [];
const files = listFiles('.');
for (const file of files) {
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      const match = INVISIBLE_CHARACTERS.exec(line);
      if (match)
        problems.push(
          `${file}:${index + 1}: U+${match[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`,
        );
    });
}

if (problems.length > 0) {
  console.error('Literal invisible/bidirectional characters found (write them as \\u escapes):');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`check:source OK: no literal invisible or bidirectional characters in ${files.length} files.`);
