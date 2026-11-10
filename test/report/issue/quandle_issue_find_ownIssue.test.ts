// ==========================================================================
// Quandle GitHub Action · test/report/issue/quandle_issue_find_ownIssue.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/report/issue.ts → quandle_issue_find_ownIssue
// Also covers (private): none
//
// Proves our production issue is recognised only by our hidden marker AND our own
// author, so an issue someone else opened with our marker in it is never ours.
// Rules: OUT-10
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_issue_find_ownIssue } from '../../../src/report/issue';
import { ISSUE_MARKER } from '../../../src/report/render';
import { BOT_LOGIN } from '../../helpers/fake-github';

const ours = { number: 12, body: `${ISSUE_MARKER}\n### Quandle`, authorLogin: BOT_LOGIN };

describe('quandle_issue_find_ownIssue', () => {
  it('[OUT-10] finds the open issue that has our marker and was opened by github-actions[bot]', () => {
    expect(
      quandle_issue_find_ownIssue([{ number: 3, body: 'bug report', authorLogin: 'octocat' }, ours]),
    ).toEqual(ours);
  });

  it('[OUT-10] ignores an issue with our marker that someone else opened', () => {
    const spoofed = { number: 4, body: `${ISSUE_MARKER} close me`, authorLogin: 'mallory' };
    expect(quandle_issue_find_ownIssue([spoofed])).toBeUndefined();
  });

  it('[OUT-10] ignores an issue by github-actions[bot] that does not have our marker', () => {
    expect(
      quandle_issue_find_ownIssue([{ number: 5, body: 'another action', authorLogin: BOT_LOGIN }]),
    ).toBeUndefined();
  });

  it('[OUT-10] does not take our PR comment marker for our issue marker', () => {
    const prMarker = { number: 6, body: '<!-- quandle:pr-comment -->', authorLogin: BOT_LOGIN };
    expect(quandle_issue_find_ownIssue([prMarker])).toBeUndefined();
  });

  it('[OUT-10] finds nothing when there are no open issues', () => {
    expect(quandle_issue_find_ownIssue([])).toBeUndefined();
  });
});
