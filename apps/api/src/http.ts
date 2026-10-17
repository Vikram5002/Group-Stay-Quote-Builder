import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import { problem, type ErrorCode, type ProblemOptions, type ValidationIssue } from '@c32/core';
import { knownError } from './errors.js';
import { log } from './log.js';

const REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** Reuse a well-formed incoming x-request-id, otherwise mint one. Echoed on every response. */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get('x-request-id');
  const id = incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.locals['requestId'] = id;
  res.set('x-request-id', id);
  next();
};

export function sendProblem(res: Response, code: ErrorCode, opts: ProblemOptions = {}): void {
  const body = problem(code, { requestId: res.locals['requestId'] as string, ...opts });
  res.status(body.status).type('application/problem+json').json(body);
}

export const notFound: RequestHandler = (req, res) => {
  sendProblem(res, 'NOT_FOUND', {
    detail: `No route for ${req.method} ${req.path}`,
    instance: req.path,
  });
};

interface BodyParserError {
  type?: string;
  status?: number;
}

/** Last middleware: everything becomes problem+json; internals are logged, never returned. */
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  const type = (err as BodyParserError | null)?.type;
  if (type === 'entity.parse.failed') {
    const errors: ValidationIssue[] = [
      { path: '', code: 'INVALID_JSON', message: 'Body is not valid JSON' },
    ];
    sendProblem(res, 'VALIDATION_FAILED', { errors, instance: req.path });
    return;
  }
  if (type === 'entity.too.large') {
    sendProblem(res, 'PAYLOAD_TOO_LARGE', { instance: req.path });
    return;
  }
  if (type === 'encoding.unsupported' || type === 'charset.unsupported') {
    sendProblem(res, 'UNSUPPORTED_MEDIA_TYPE', { instance: req.path });
    return;
  }
  const known = knownError(err);
  if (known) {
    sendProblem(res, known.code, { detail: known.detail, instance: req.path });
    return;
  }
  log('error', 'unhandled_error', {
    request_id: res.locals['requestId'],
    path: req.path,
    error:
      err instanceof Error
        ? { name: err.name, message: err.message, stack: err.stack }
        : String(err),
  });
  sendProblem(res, 'INTERNAL', { instance: req.path });
};
