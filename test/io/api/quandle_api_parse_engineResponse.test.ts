// ==========================================================================
// Quandle GitHub Action · test/io/api/quandle_api_parse_engineResponse.test.ts
// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
//
// Tests: src/io/api.ts → quandle_api_parse_engineResponse
// Also covers (private): every response and finding check behind it
//
// Proves only a valid 200 becomes a scan (scanned with findings, or protected with
// none); 429 is rate-limited; every other status, a body that is not JSON, an extra
// or missing field, an unknown status, state or severity, a scanId outside 1 to 64
// letters, digits, `_` or `-`, or any malformed finding is engine-error, never
// "0 findings"; every not-scanned outcome shows our own fixed
// reason, never engine text; and url and environment come from our request.
// Rules: FND-4, FND-6, TRU-7
// ==========================================================================
import { describe, expect, it } from 'vitest';
import { quandle_api_parse_engineResponse } from '../../../src/io/api';
import type { ScanRequest } from '../../../src/types';

const REQUEST: ScanRequest = {
  url: 'https://preview.example.com/',
  environment: 'Preview',
  production: false,
};
const ENGINE_TEXT = 'FAKE_ENGINE_TEXT';

const PROTECTED_REASON = 'the deploy is protected; set `bypass-secret` to scan it';
const RATE_LIMITED_REASON = "the Quandle engine's rate limit was reached; the next deploy will be checked";
const ENGINE_ERROR_REASON = 'the Quandle engine could not complete the scan';

const ENGINE_ERROR = {
  status: 'engine-error',
  url: 'https://preview.example.com/',
  environment: 'Preview',
  reason: ENGINE_ERROR_REASON,
  findings: [],
  isMock: false,
};

function rawFinding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'qf_test01',
    rule: 'secret/test',
    severity: 'critical',
    state: 'new',
    title: 'Test secret in shipped JavaScript',
    location: 'https://preview.example.com/assets/index.js',
    ...overrides,
  };
}

function answer(body: unknown, httpStatus = 200): { httpStatus: number; bodyText: string } {
  return { httpStatus, bodyText: typeof body === 'string' ? body : JSON.stringify(body) };
}

function parse(body: unknown, httpStatus = 200): ReturnType<typeof quandle_api_parse_engineResponse> {
  return quandle_api_parse_engineResponse(answer(body, httpStatus), REQUEST);
}

describe('quandle_api_parse_engineResponse', () => {
  describe('valid answers (TRU-7)', () => {
    it('[TRU-7] turns a 200 scanned answer into a scanned result with its findings, scan id, our url and environment', () => {
      expect(parse({ status: 'scanned', scanId: 'scan_test01', findings: [rawFinding()] })).toEqual({
        status: 'scanned',
        url: 'https://preview.example.com/',
        environment: 'Preview',
        scanId: 'scan_test01',
        findings: [rawFinding()],
        isMock: false,
      });
    });

    it('[TRU-7] keeps evidence when a finding has it', () => {
      const result = parse({ status: 'scanned', findings: [rawFinding({ evidence: 'sk-…REDACTED' })] });
      expect(result.findings[0]?.evidence).toBe('sk-…REDACTED');
    });

    it('[TRU-7] leaves scanId out when the engine sends none', () => {
      expect(parse({ status: 'scanned', findings: [] })).not.toHaveProperty('scanId');
    });

    it('[TRU-7] leaves environment out when our request had none', () => {
      const result = quandle_api_parse_engineResponse(answer({ status: 'scanned', findings: [] }), {
        url: 'https://app.example.com/',
        production: true,
      });
      expect(result).not.toHaveProperty('environment');
    });

    it('[FND-4] treats a 200 scanned answer with an empty findings list as a real clean scan', () => {
      expect(parse({ status: 'scanned', findings: [] })).toMatchObject({ status: 'scanned', findings: [] });
    });

    it('[TRU-7] turns a 200 protected answer with no findings into protected with our fixed reason, keeping the scan id', () => {
      expect(parse({ status: 'protected', scanId: 'scan_test02', findings: [] })).toEqual({
        status: 'protected',
        url: 'https://preview.example.com/',
        environment: 'Preview',
        scanId: 'scan_test02',
        reason: PROTECTED_REASON,
        findings: [],
        isMock: false,
      });
    });

    it('[TRU-7] turns a 429 into rate-limited with our fixed reason, without reading the body', () => {
      expect(parse({ status: 'scanned', scanId: 'scan_x', findings: [rawFinding()] }, 429)).toEqual({
        status: 'rate-limited',
        url: 'https://preview.example.com/',
        environment: 'Preview',
        reason: RATE_LIMITED_REASON,
        findings: [],
        isMock: false,
      });
    });
  });

  describe('every other answer is engine-error (TRU-7)', () => {
    it.each([401, 403, 404, 500, 502, 503, 201, 204, 302])(
      '[TRU-7] turns HTTP %i into engine-error with our fixed reason',
      (httpStatus) => {
        expect(parse({ status: 'scanned', findings: [] }, httpStatus)).toEqual(ENGINE_ERROR);
      },
    );

    it.each(['rate-limited', 'engine-error', 'skipped', 'mock', 'SCANNED', ''])(
      '[TRU-7] turns a 200 whose status is "%s" into engine-error',
      (status) => {
        expect(parse({ status, findings: [] })).toEqual(ENGINE_ERROR);
      },
    );

    it('[TRU-7] turns a response with an extra field reason into engine-error', () => {
      expect(parse({ status: 'scanned', findings: [], reason: ENGINE_TEXT })).toEqual(ENGINE_ERROR);
    });

    it('[TRU-7] turns a protected answer that carries findings into engine-error', () => {
      expect(parse({ status: 'protected', findings: [rawFinding()] })).toEqual(ENGINE_ERROR);
    });

    it('[TRU-7] never shows engine text in the reason, whatever the engine sent', () => {
      const results = [
        parse(ENGINE_TEXT, 500),
        parse({ status: ENGINE_TEXT, findings: [] }),
        parse({ status: 'protected', findings: [], message: ENGINE_TEXT }),
        parse({ status: 'scanned', findings: [rawFinding({ title: 7, note: ENGINE_TEXT })] }),
      ];
      expect(JSON.stringify(results)).not.toContain(ENGINE_TEXT);
    });
  });

  describe('malformed bodies (FND-4)', () => {
    it.each([
      ['not JSON', '{ "status": "scanned", '],
      ['empty', ''],
      ['JSON null', 'null'],
      ['a JSON list', '[]'],
      ['a JSON string', '"scanned"'],
    ])('[FND-4] turns a 200 body that is %s into engine-error, never "0 findings"', (_label, bodyText) => {
      expect(quandle_api_parse_engineResponse({ httpStatus: 200, bodyText }, REQUEST)).toEqual(ENGINE_ERROR);
    });

    it('[FND-4] turns an answer with no findings field into engine-error', () => {
      expect(parse({ status: 'scanned' })).toEqual(ENGINE_ERROR);
    });

    it('[FND-4] turns an answer whose findings is not a list into engine-error', () => {
      expect(parse({ status: 'scanned', findings: {} })).toEqual(ENGINE_ERROR);
    });

    it('[FND-4] turns an answer with no status into engine-error', () => {
      expect(parse({ findings: [] })).toEqual(ENGINE_ERROR);
    });

    it.each(['info', 'Critical', 'none', ''])(
      '[FND-4] turns a finding with the unknown severity "%s" into engine-error, never low',
      (severity) => {
        expect(parse({ status: 'scanned', findings: [rawFinding({ severity })] })).toEqual(ENGINE_ERROR);
      },
    );

    it.each(['fixed', 'New', 'ignored', ''])(
      '[FND-4] turns a finding with the unknown state "%s" into engine-error',
      (state) => {
        expect(parse({ status: 'scanned', findings: [rawFinding({ state })] })).toEqual(ENGINE_ERROR);
      },
    );

    it('[FND-4] turns the whole answer into engine-error when only finding 2 of 3 is malformed', () => {
      const findings = [rawFinding(), rawFinding({ severity: 'info' }), rawFinding()];
      expect(parse({ status: 'scanned', findings })).toEqual(ENGINE_ERROR);
    });
  });

  describe('each finding (FND-6)', () => {
    it.each(['id', 'rule', 'severity', 'state', 'title', 'location'])(
      '[FND-6] turns a finding missing %s into engine-error',
      (field) => {
        const finding = rawFinding();
        delete finding[field];
        expect(parse({ status: 'scanned', findings: [finding] })).toEqual(ENGINE_ERROR);
      },
    );

    it.each(['id', 'rule', 'title', 'location'])(
      '[FND-6] turns a finding whose %s is empty text into engine-error',
      (field) => {
        expect(parse({ status: 'scanned', findings: [rawFinding({ [field]: '' })] })).toEqual(ENGINE_ERROR);
      },
    );

    it.each(['id', 'rule', 'title', 'location', 'evidence'])(
      '[FND-6] turns a finding whose %s is the number 42 instead of text into engine-error',
      (field) => {
        expect(parse({ status: 'scanned', findings: [rawFinding({ [field]: 42 })] })).toEqual(ENGINE_ERROR);
      },
    );

    it('[FND-6] turns a finding with an extra field into engine-error', () => {
      expect(parse({ status: 'scanned', findings: [rawFinding({ cvss: 9.8 })] })).toEqual(ENGINE_ERROR);
    });

    it('[FND-6] turns a finding that is not an object into engine-error', () => {
      expect(parse({ status: 'scanned', findings: ['qf_test01'] })).toEqual(ENGINE_ERROR);
    });

    it.each([
      ['empty text', ''],
      ['a number', 7],
      ['null', null],
    ])('[FND-6] turns an answer whose scanId is %s into engine-error', (_label, scanId) => {
      expect(parse({ status: 'scanned', scanId, findings: [] })).toEqual(ENGINE_ERROR);
    });

    it.each([
      ['a space', 'scan 01'],
      ['a backtick', 'scan_`01`'],
      ['a newline', 'scan_01\n::add-mask::x'],
      ['a workflow command', '::error::scan_01'],
      ['a shell substitution', '$(id)'],
      ['a dot', 'scan.01'],
      ['a slash', 'scan/01'],
      ['a non-ASCII letter', 'scan_\u00e901'],
      ['a zero-width space', 'scan_\u200b01'],
      ['65 characters', 'a'.repeat(65)],
    ])('[FND-6] turns an answer whose scanId contains %s into engine-error', (_label, scanId) => {
      expect(parse({ status: 'scanned', scanId, findings: [] })).toEqual(ENGINE_ERROR);
    });

    it('[FND-6] turns a protected answer whose scanId contains a space into engine-error', () => {
      expect(parse({ status: 'protected', scanId: 'scan 01', findings: [] })).toEqual(ENGINE_ERROR);
    });

    it.each([
      ["the engine's own format", 'scan_0123456789abcdef'],
      ['a mock id with a dash', 'mock-first-scan'],
      ['exactly 64 characters', 'A'.repeat(64)],
      ['a single character', 'x'],
    ])('[FND-6] keeps a scanId that is %s', (_label, scanId) => {
      expect(parse({ status: 'scanned', scanId, findings: [] })).toMatchObject({ status: 'scanned', scanId });
    });
  });
});
