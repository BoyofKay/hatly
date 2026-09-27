import { BadRequestException, Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

const MAX_DEPTH = 8;

function containsNul(value: unknown, depth = 0): boolean {
  if (typeof value === 'string') return value.includes('\u0000');
  if (depth >= MAX_DEPTH || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((v) => containsNul(v, depth + 1));
  return Object.entries(value as Record<string, unknown>).some(([k, v]) => k.includes('\u0000') || containsNul(v, depth + 1));
}

/**
 * PostgreSQL text cannot contain a NUL (0x00) byte: any string that carries one and reaches a query
 * fails with `invalid byte sequence for encoding "UTF8": 0x00` — an HTTP 500 for what is plainly a
 * malformed request (Group 8 finding: `GET /search?q=a%00b`). Refused once, at the edge, for the
 * query string and the already-parsed body, instead of validating every string field individually.
 */
@Injectable()
export class RejectNulBytesMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    if (containsNul(req.query) || containsNul(req.body) || containsNul(req.params)) {
      throw new BadRequestException({
        message: 'The request contains an invalid character.',
        details: { code: 'INVALID_CHARACTER' },
      });
    }
    next();
  }
}
