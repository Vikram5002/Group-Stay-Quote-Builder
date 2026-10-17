import { describe, expect, it } from 'vitest';
import { CONTRACT_VERSION, NAMED_SCHEMAS, ROUTES, buildOpenApiDocument } from '../src/index.js';
import { readJson } from './helpers.js';

type Doc = {
  info: { version: string };
  paths: Record<
    string,
    Record<string, { responses: Record<string, unknown>; security?: unknown[] }>
  >;
  components: { schemas: Record<string, Record<string, unknown>> };
};

const doc = buildOpenApiDocument() as Doc;

describe('OpenAPI document generated from Zod', () => {
  it('matches the committed docs/openapi.json (run `npm run openapi` after contract changes)', () => {
    expect(JSON.parse(JSON.stringify(doc))).toEqual(readJson('docs/openapi.json'));
  });

  it('is deterministic', () => {
    expect(JSON.stringify(buildOpenApiDocument())).toBe(JSON.stringify(doc));
  });

  it('carries the contract version', () => {
    expect(doc.info.version).toBe(CONTRACT_VERSION);
  });

  it('has one component per named schema, with refs instead of $id', () => {
    expect(Object.keys(doc.components.schemas).sort()).toEqual(Object.keys(NAMED_SCHEMAS).sort());
    expect(JSON.stringify(doc.components.schemas)).not.toContain('"$id"');
    expect(doc.components.schemas['QuoteRequest']).toMatchObject({ additionalProperties: false });
  });

  it('documents every route, with a 500 and auth errors on protected routes', () => {
    for (const r of ROUTES) {
      const op = doc.paths[r.path]?.[r.method];
      expect(op, `${r.method} ${r.path}`).toBeDefined();
      expect(op!.responses).toHaveProperty('500');
      if (r.roles === 'public') expect(op!.security).toEqual([]);
      else expect(op!.responses).toHaveProperty('401');
    }
  });

  it('has unique operation ids', () => {
    const ids = ROUTES.map((r) => r.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
