// ==========================================================================
// Quandle GitHub Action · test/report/comment/quandle_comment_find_ownComment.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/report/comment.ts → quandle_comment_find_ownComment
// Also covers (private): none
//
// Proves our comment is recognised only by our hidden marker AND our own author,
// so a comment someone else wrote with our marker in it is never taken for ours.
// Rules: OUT-7
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_comment_find_ownComment } from '../../../src/report/comment';
import { COMMENT_MARKER } from '../../../src/report/render';
import { BOT_LOGIN } from '../../helpers/fake-github';

const ours = { id: 1, body: `${COMMENT_MARKER}\n### Quandle`, authorLogin: BOT_LOGIN };

describe('quandle_comment_find_ownComment', () => {
  it('[OUT-7] finds the comment that has our marker and was written by github-actions[bot]', () => {
    expect(quandle_comment_find_ownComment([{ id: 9, body: 'lgtm', authorLogin: 'octocat' }, ours])).toEqual(
      ours,
    );
  });

  it('[OUT-7] ignores a comment with our marker that someone else wrote', () => {
    const spoofed = { id: 2, body: `${COMMENT_MARKER} please edit me`, authorLogin: 'mallory' };
    expect(quandle_comment_find_ownComment([spoofed])).toBeUndefined();
  });

  it('[OUT-7] ignores a comment by github-actions[bot] that does not have our marker', () => {
    expect(
      quandle_comment_find_ownComment([{ id: 3, body: 'another action', authorLogin: BOT_LOGIN }]),
    ).toBeUndefined();
  });

  it('[OUT-7] ignores a lookalike author such as github-actions without [bot]', () => {
    const lookalike = { id: 4, body: COMMENT_MARKER, authorLogin: 'github-actions' };
    expect(quandle_comment_find_ownComment([lookalike])).toBeUndefined();
  });

  it('[OUT-7] picks the first of our comments when there are several', () => {
    expect(quandle_comment_find_ownComment([ours, { ...ours, id: 5 }])).toEqual(ours);
  });

  it('[OUT-7] finds nothing when there are no comments', () => {
    expect(quandle_comment_find_ownComment([])).toBeUndefined();
  });
});
