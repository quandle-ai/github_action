// ==========================================================================
// Quandle GitHub Action · test/io/runtime/quandle_runtime_read_eventContext.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/io/runtime.ts → quandle_runtime_read_eventContext
// Also covers (private): none
//
// Proves the GitHub event is read from the environment and the event file, and
// that a missing variable, an unreadable file or invalid JSON throws our own
// fixed error (which main turns into a fail-open internal error) and never
// carries the file's contents.
// Rules: ERR-3
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_runtime_read_eventContext } from '../../../src/io/runtime';
import type { RuntimeEnvironment } from '../../../src/io/runtime';
import { LEAKY_ERROR_TEXT } from '../../helpers/fake-runtime';
import { UNUSED_FETCH } from '../../helpers/fake-engine';

const EVENT_PATH = '/fake/event.json';

function buildEnvironment(
  overrides: { env?: Record<string, string | undefined>; files?: Record<string, string> } = {},
): RuntimeEnvironment {
  const env = {
    GITHUB_EVENT_NAME: 'deployment_status',
    GITHUB_SHA: 'env-sha',
    GITHUB_EVENT_PATH: EVENT_PATH,
    ...overrides.env,
  };
  const files = overrides.files ?? { [EVENT_PATH]: '{"deployment_status":{"state":"success"}}' };
  return {
    env,
    fetch: UNUSED_FETCH,
    readFile(path) {
      const content = files[path];
      if (content === undefined) throw new Error(`ENOENT ${LEAKY_ERROR_TEXT}`);
      return content;
    },
  };
}

describe('quandle_runtime_read_eventContext', () => {
  it('[ERR-3] reads the event name, commit and parsed payload from the GitHub environment', () => {
    expect(quandle_runtime_read_eventContext(buildEnvironment())).toEqual({
      eventName: 'deployment_status',
      sha: 'env-sha',
      payload: { deployment_status: { state: 'success' } },
    });
  });

  it.each(['GITHUB_EVENT_NAME', 'GITHUB_SHA', 'GITHUB_EVENT_PATH'])(
    '[ERR-3] throws our own error when %s is not set',
    (name) => {
      expect(() =>
        quandle_runtime_read_eventContext(buildEnvironment({ env: { [name]: undefined } })),
      ).toThrow(/^Quandle: /);
    },
  );

  it.each(['GITHUB_EVENT_NAME', 'GITHUB_SHA', 'GITHUB_EVENT_PATH'])(
    '[ERR-3] throws our own error when %s is an empty string',
    (name) => {
      expect(() => quandle_runtime_read_eventContext(buildEnvironment({ env: { [name]: '' } }))).toThrow(
        /^Quandle: /,
      );
    },
  );

  it('[ERR-3] throws our own error when the event file cannot be read', () => {
    expect(() => quandle_runtime_read_eventContext(buildEnvironment({ files: {} }))).toThrow(
      'Quandle: the GitHub event file could not be read.',
    );
  });

  it('[ERR-3] throws our own error when the event file is not valid JSON', () => {
    expect(() =>
      quandle_runtime_read_eventContext(buildEnvironment({ files: { [EVENT_PATH]: '{ not json' } })),
    ).toThrow('Quandle: the GitHub event file is not valid JSON.');
  });

  it('[ERR-3] never puts the event file contents or the read error into its error message', () => {
    const attempts = [
      buildEnvironment({ files: { [EVENT_PATH]: `{ ${LEAKY_ERROR_TEXT}` } }),
      buildEnvironment({ files: {} }),
    ];
    for (const environment of attempts) {
      expect(() => quandle_runtime_read_eventContext(environment)).toThrow(
        expect.objectContaining({ message: expect.not.stringContaining(LEAKY_ERROR_TEXT) }),
      );
    }
  });
});
