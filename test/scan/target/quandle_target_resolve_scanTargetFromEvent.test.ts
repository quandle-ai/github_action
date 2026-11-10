// ==========================================================================
// Quandle GitHub Action · test/scan/target/quandle_target_resolve_scanTargetFromEvent.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/scan/target.ts → quandle_target_resolve_scanTargetFromEvent
// Also covers (private): quandle_target_resolve_deploymentStatusTarget, quandle_target_resolve_manualTarget,
//   quandle_target_read_deploymentStatusFields, quandle_target_read_objectField, quandle_target_read_stringField,
//   quandle_target_build_engineEnvironment
//
// Proves which URL, commit and environment are scanned for each event; that the
// deploy's own URL wins over the url input and target_url is never used; and when
// a run is skipped or is a config error; and that a long environment name is cut to
// the engine's 100 bytes, never stopping the scan.
// Rules: TGT-1, TGT-2, TGT-3, TGT-4, TGT-5, TGT-6, TGT-7, TGT-8, TGT-9, TGT-11
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_target_resolve_scanTargetFromEvent } from '../../../src/scan/target';
import type { EventContext } from '../../../src/types';

function buildDeploymentStatusEvent(
  deploymentStatus: Record<string, unknown>,
  deployment: Record<string, unknown> = { sha: 'deploy-sha', environment: 'Preview' },
): EventContext {
  return {
    eventName: 'deployment_status',
    sha: 'context-sha',
    payload: { deployment_status: deploymentStatus, deployment },
  };
}

function buildEvent(eventName: string): EventContext {
  return { eventName, sha: 'context-sha', payload: {} };
}

describe('quandle_target_resolve_scanTargetFromEvent', () => {
  describe('on deployment_status', () => {
    it('[TGT-1] scans the environment_url of a successful deployment, using the deployment sha and environment', () => {
      const event = buildDeploymentStatusEvent({
        state: 'success',
        environment_url: 'https://preview.example.com/',
      });
      expect(quandle_target_resolve_scanTargetFromEvent(event, undefined)).toEqual({
        kind: 'scan',
        url: 'https://preview.example.com/',
        environment: 'Preview',
        sha: 'deploy-sha',
        source: 'deployment',
        isProductionEnvironment: false,
      });
    });

    it('[TGT-1] uses the event commit when the deployment payload has no sha', () => {
      const event = buildDeploymentStatusEvent(
        { state: 'success', environment_url: 'https://preview.example.com/' },
        {},
      );
      expect(quandle_target_resolve_scanTargetFromEvent(event, undefined)).toMatchObject({
        kind: 'scan',
        sha: 'context-sha',
      });
    });

    it('[TGT-1] leaves the environment unset when the deployment payload has no environment', () => {
      const event = buildDeploymentStatusEvent(
        { state: 'success', environment_url: 'https://preview.example.com/' },
        {},
      );
      const target = quandle_target_resolve_scanTargetFromEvent(event, undefined);
      expect(target).toMatchObject({ kind: 'scan' });
      expect(target).not.toHaveProperty('environment', expect.anything());
    });

    describe('environment length (engine limit: 100 bytes)', () => {
      const scanEnvironment = (environment: string): unknown =>
        quandle_target_resolve_scanTargetFromEvent(
          buildDeploymentStatusEvent(
            { state: 'success', environment_url: 'https://preview.example.com/' },
            { sha: 'deploy-sha', environment },
          ),
          undefined,
        );
      // Built from code points so the source holds no literal non-ASCII characters.
      const TWO_BYTE_E_ACUTE = String.fromCodePoint(0xe9);
      const THREE_BYTE_EURO = String.fromCodePoint(0x20ac);

      it('[TGT-1] cuts a 101-character ASCII environment name to its first 100 characters', () => {
        expect(scanEnvironment('a'.repeat(101))).toMatchObject({ environment: 'a'.repeat(100) });
      });

      it('[TGT-1] cuts by bytes, not characters: 51 two-byte characters (102 bytes) become the first 50 (100 bytes)', () => {
        expect(scanEnvironment(TWO_BYTE_E_ACUTE.repeat(51))).toMatchObject({
          environment: TWO_BYTE_E_ACUTE.repeat(50),
        });
      });

      it('[TGT-1] never splits a character: 34 three-byte characters (102 bytes) become the first 33 (99 bytes)', () => {
        expect(scanEnvironment(THREE_BYTE_EURO.repeat(34))).toMatchObject({
          environment: THREE_BYTE_EURO.repeat(33),
        });
      });

      it('[TGT-1] keeps an environment name of exactly 100 bytes unchanged', () => {
        const name = `${TWO_BYTE_E_ACUTE.repeat(10)}${'a'.repeat(80)}`;
        expect(scanEnvironment(name)).toMatchObject({ kind: 'scan', environment: name });
      });

      it('[TGT-1] still scans, and does not report an error, when the environment name is 500 characters long', () => {
        expect(scanEnvironment('a'.repeat(500))).toMatchObject({ kind: 'scan' });
      });
    });

    it('[TGT-2] scans the deployment environment_url, not the url input, when both are present', () => {
      const event = buildDeploymentStatusEvent({
        state: 'success',
        environment_url: 'https://preview.example.com/',
      });
      expect(quandle_target_resolve_scanTargetFromEvent(event, 'https://prod.example.com/')).toMatchObject({
        url: 'https://preview.example.com/',
      });
    });

    it('[TGT-2] falls back to the url input when the successful deployment has no environment_url', () => {
      const event = buildDeploymentStatusEvent({ state: 'success' });
      expect(quandle_target_resolve_scanTargetFromEvent(event, 'https://prod.example.com/')).toMatchObject({
        kind: 'scan',
        url: 'https://prod.example.com/',
      });
    });

    it('[TGT-2] falls back to the url input when the environment_url is an empty string', () => {
      const event = buildDeploymentStatusEvent({ state: 'success', environment_url: '' });
      expect(quandle_target_resolve_scanTargetFromEvent(event, 'https://prod.example.com/')).toMatchObject({
        url: 'https://prod.example.com/',
      });
    });

    it.each(['pending', 'queued', 'in_progress', 'failure', 'error', 'inactive'])(
      '[TGT-3] skips a deployment whose state is %s',
      (state) => {
        const event = buildDeploymentStatusEvent({ state, environment_url: 'https://preview.example.com/' });
        expect(quandle_target_resolve_scanTargetFromEvent(event, undefined).kind).toBe('skip');
      },
    );

    it('[TGT-3] skips a deployment_status event whose payload is not an object', () => {
      const event: EventContext = {
        eventName: 'deployment_status',
        sha: 'context-sha',
        payload: 'not-an-object',
      };
      expect(quandle_target_resolve_scanTargetFromEvent(event, undefined).kind).toBe('skip');
    });

    it('[TGT-3] skips a deployment_status event whose deployment_status field is not an object', () => {
      const event: EventContext = {
        eventName: 'deployment_status',
        sha: 'context-sha',
        payload: { deployment_status: 'success' },
      };
      expect(quandle_target_resolve_scanTargetFromEvent(event, undefined).kind).toBe('skip');
    });

    it('[TGT-4] returns a config error telling the user to set url when a successful deployment has no URL at all', () => {
      const target = quandle_target_resolve_scanTargetFromEvent(
        buildDeploymentStatusEvent({ state: 'success' }),
        undefined,
      );
      expect(target.kind).toBe('error');
      expect(target).toHaveProperty('reason', expect.stringContaining('`url`'));
    });

    it('[TGT-5] never scans target_url, even when it is the only URL on a successful deployment', () => {
      const event = buildDeploymentStatusEvent({
        state: 'success',
        target_url: 'https://vercel.com/team/app/inspect',
      });
      expect(quandle_target_resolve_scanTargetFromEvent(event, undefined).kind).toBe('error');
    });

    it('[TGT-5] scans the url input instead of target_url when environment_url is missing', () => {
      const event = buildDeploymentStatusEvent({
        state: 'success',
        target_url: 'https://vercel.com/team/app/inspect',
      });
      expect(quandle_target_resolve_scanTargetFromEvent(event, 'https://prod.example.com/')).toMatchObject({
        url: 'https://prod.example.com/',
      });
    });

    it('[TGT-8] returns a config error when the deployment environment_url is a file: URL', () => {
      const event = buildDeploymentStatusEvent({ state: 'success', environment_url: 'file:///etc/passwd' });
      expect(quandle_target_resolve_scanTargetFromEvent(event, undefined).kind).toBe('error');
    });

    it('[TGT-11] marks a deploy as production when the payload says production_environment: true', () => {
      const event = buildDeploymentStatusEvent(
        { state: 'success', environment_url: 'https://app.example.com/' },
        { sha: 'deploy-sha', environment: 'Live', production_environment: true },
      );
      expect(quandle_target_resolve_scanTargetFromEvent(event, undefined)).toMatchObject({
        isProductionEnvironment: true,
      });
    });

    it.each([
      ['false', false],
      ['missing', undefined],
      ['the string "true"', 'true'],
    ])('[TGT-11] does not mark a deploy as production when production_environment is %s', (_name, value) => {
      const event = buildDeploymentStatusEvent(
        { state: 'success', environment_url: 'https://app.example.com/' },
        {
          sha: 'deploy-sha',
          environment: 'Production',
          ...(value === undefined ? {} : { production_environment: value }),
        },
      );
      expect(quandle_target_resolve_scanTargetFromEvent(event, undefined)).toMatchObject({
        isProductionEnvironment: false,
      });
    });

    it('[TGT-9] skips a pending deployment even when its environment is named Production', () => {
      const event = buildDeploymentStatusEvent(
        { state: 'pending', environment_url: 'https://app.example.com/' },
        { sha: 'deploy-sha', environment: 'Production' },
      );
      expect(quandle_target_resolve_scanTargetFromEvent(event, undefined).kind).toBe('skip');
    });
  });

  describe.each(['workflow_dispatch', 'schedule'])('on %s', (eventName) => {
    it(`[TGT-6] scans the url input as the production environment on ${eventName}`, () => {
      expect(
        quandle_target_resolve_scanTargetFromEvent(buildEvent(eventName), 'https://app.example.com/'),
      ).toEqual({
        kind: 'scan',
        url: 'https://app.example.com/',
        environment: 'production',
        sha: 'context-sha',
        source: 'manual',
        isProductionEnvironment: true,
      });
    });

    it(`[TGT-6] returns a config error naming the url input when it is missing on ${eventName}`, () => {
      const target = quandle_target_resolve_scanTargetFromEvent(buildEvent(eventName), undefined);
      expect(target.kind).toBe('error');
      expect(target).toHaveProperty('reason', expect.stringContaining('`url`'));
    });

    it(`[TGT-8] returns a config error when the url input is a javascript: URL on ${eventName}`, () => {
      expect(
        quandle_target_resolve_scanTargetFromEvent(buildEvent(eventName), 'javascript:alert(1)').kind,
      ).toBe('error');
    });
  });

  it.each(['push', 'pull_request', 'pull_request_target', 'issue_comment'])(
    '[TGT-7] skips the %s event',
    (eventName) => {
      expect(
        quandle_target_resolve_scanTargetFromEvent(buildEvent(eventName), 'https://app.example.com/').kind,
      ).toBe('skip');
    },
  );
});
