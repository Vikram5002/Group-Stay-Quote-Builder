import { z } from 'zod';
import { QuoteEvent, QuoteEventList } from './audit.js';
import {
  CONTRACT_VERSION,
  Decision,
  ErrorCode,
  QuoteStatus,
  ReasonCode,
  ValidationIssueCode,
} from './codes.js';
import { HealthResponse } from './health.js';
import {
  ExportLink,
  ImportReport,
  ImportRowIssue,
  ImportUploadRequest,
  ImportUploadResponse,
  InventoryImportRow,
  RateImportRow,
} from './imports.js';
import { AvailabilityResponse, InventoryNight, RatePlanNight } from './inventory.js';
import { Policy, PolicyUpdateRequest } from './policy.js';
import { ProblemDetails, ValidationIssue } from './problem.js';
import {
  Actor,
  AmendmentRequest,
  Approval,
  ApproveRequest,
  OwnerDiscountRequest,
  CancelRequest,
  CounterOffer,
  EmailRequest,
  Evaluation,
  ExtendRequest,
  InclusionInput,
  Organiser,
  Payment,
  Quote,
  RecordPaymentRequest,
  SentEmail,
  QuoteList,
  QuotePreviewResponse,
  QuoteRequest,
  QuoteTotals,
  RejectRequest,
  Stay,
} from './quote.js';
import { ROUTES, type RouteSpec } from './routes.js';

/** Every named schema in the contract. The name becomes components.schemas.<name>. */
export const NAMED_SCHEMAS = {
  Actor,
  AmendmentRequest,
  Approval,
  ApproveRequest,
  OwnerDiscountRequest,
  AvailabilityResponse,
  CancelRequest,
  CounterOffer,
  Decision,
  EmailRequest,
  ErrorCode,
  Evaluation,
  ExportLink,
  ExtendRequest,
  HealthResponse,
  ImportReport,
  ImportRowIssue,
  ImportUploadRequest,
  ImportUploadResponse,
  InclusionInput,
  InventoryImportRow,
  InventoryNight,
  Organiser,
  Payment,
  Policy,
  PolicyUpdateRequest,
  ProblemDetails,
  Quote,
  QuoteEvent,
  QuoteEventList,
  QuoteList,
  QuotePreviewResponse,
  QuoteRequest,
  QuoteStatus,
  QuoteTotals,
  RatePlanNight,
  RateImportRow,
  ReasonCode,
  RecordPaymentRequest,
  RejectRequest,
  SentEmail,
  Stay,
  ValidationIssue,
  ValidationIssueCode,
} as const satisfies Record<string, z.ZodType>;

type JsonObject = Record<string, unknown>;

function buildRegistry() {
  const registry = z.registry<{ id: string }>();
  for (const [id, schema] of Object.entries(NAMED_SCHEMAS)) registry.add(schema, { id });
  return registry;
}

function stripSchemaKeyword(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSchemaKeyword);
  if (value && typeof value === 'object') {
    const out: JsonObject = {};
    for (const [k, v] of Object.entries(value)) {
      // Zod emits a fragment-only $id per component, which 2020-12 forbids; refs carry the name.
      if (k === '$schema' || k === '$id') continue;
      out[k] = stripSchemaKeyword(v);
    }
    return out;
  }
  return value;
}

function schemaName(schema: z.ZodType): string {
  for (const [id, s] of Object.entries(NAMED_SCHEMAS)) if (s === schema) return id;
  throw new Error('Route uses a schema that is not in NAMED_SCHEMAS');
}

const ref = (schema: z.ZodType) => ({ $ref: `#/components/schemas/${schemaName(schema)}` });

const problemResponse = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: ref(ProblemDetails) } },
});

function pathParams(path: string) {
  const names = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string);
  return names.map((name) => ({
    name,
    in: 'path',
    required: true,
    schema:
      name === 'kind'
        ? { type: 'string', enum: ['inventory', 'rates'] }
        : { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
  }));
}

function operation(route: RouteSpec): JsonObject {
  const parameters: JsonObject[] = [...pathParams(route.path)];
  for (const q of route.query ?? []) {
    parameters.push({
      name: q.name,
      in: 'query',
      required: q.required,
      description: q.description,
      schema: q.schema,
    });
  }
  if (route.idempotent) {
    parameters.push({
      name: 'Idempotency-Key',
      in: 'header',
      required: false,
      description: 'Repeat-safe key (BR-17). Same key and same body returns the same result.',
      schema: { type: 'string', minLength: 8, maxLength: 128 },
    });
  }

  const responses: JsonObject = {};
  for (const [status, res] of Object.entries(route.responses)) {
    const isError = Number(status) >= 400;
    if (isError) responses[status] = problemResponse(res.description);
    else if (res.schema)
      responses[status] = {
        description: res.description,
        content: { 'application/json': { schema: ref(res.schema) } },
      };
    else responses[status] = { description: res.description };
  }
  if (route.request || route.query) responses['422'] ??= problemResponse('VALIDATION_FAILED.');
  if (route.roles !== 'public') {
    responses['401'] ??= problemResponse('UNAUTHENTICATED.');
    responses['403'] ??= problemResponse('FORBIDDEN.');
    responses['429'] ??= problemResponse('THROTTLED.');
  }
  responses['500'] ??= problemResponse('INTERNAL.');

  const op: JsonObject = {
    operationId: route.operationId,
    summary: route.summary,
    'x-roles': route.roles,
    responses,
  };
  if (parameters.length > 0) op['parameters'] = parameters;
  if (route.request) {
    op['requestBody'] = {
      required: true,
      content: { 'application/json': { schema: ref(route.request) } },
    };
  }
  if (route.roles === 'public') op['security'] = [];
  return op;
}

/** Build the OpenAPI 3.1 document from the Zod contract. Pure and deterministic. */
export function buildOpenApiDocument(): JsonObject {
  const { schemas } = z.toJSONSchema(buildRegistry(), {
    target: 'draft-2020-12',
    io: 'input',
    unrepresentable: 'any',
    uri: (id) => `#/components/schemas/${id}`,
  }) as { schemas: Record<string, unknown> };

  const sortedSchemas: JsonObject = {};
  for (const name of Object.keys(schemas).sort())
    sortedSchemas[name] = stripSchemaKeyword(schemas[name]);

  const paths: Record<string, JsonObject> = {};
  for (const route of ROUTES) {
    paths[route.path] ??= {};
    (paths[route.path] as JsonObject)[route.method] = operation(route);
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Group Stay Quote Builder API',
      version: CONTRACT_VERSION,
      description:
        'Case C32. All money is integer INR; null means unknown, never zero. Synthetic data only.',
    },
    servers: [{ url: '/' }],
    security: [{ cognito: [] }],
    paths,
    components: {
      securitySchemes: {
        cognito: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Cognito access token.',
        },
      },
      schemas: sortedSchemas,
    },
  };
}
