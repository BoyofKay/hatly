import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Caps how many image-upload requests are processed at once (M5 Batch 4).
 *
 * Measured against the real app: one 5 MB image upload costs on the order of 20-45 MB of process memory while it is being
 * parsed (JSON/multipart buffer, base64 string, decoded bytes, storage request body), and eight at once cost ~400 MB. The
 * per-user rate limit does not bound this — many accounts can upload simultaneously — so on a small container a handful of
 * simultaneous uploads could exhaust memory and take the whole API down with them.
 *
 * Registered BEFORE the body parsers, so a request waiting for its turn has had no body read or buffered. Excess requests QUEUE
 * (they are slower, not failed: the connection stays open and nothing is reset). Only if the wait exceeds `maxWaitMs`, or the queue
 * itself is full, is a 503 + Retry-After returned. The slot is released when the response ends OR the client disconnects mid-upload,
 * and a client that gives up while still queued simply leaves the queue.
 *
 * Only AUTHENTICATED uploads are metered. A request without a valid token is passed straight through, exactly as before, to be
 * answered 401 by the auth guard: answering it early would reset the connection for large bodies (the client is still writing),
 * and a client with an expired token must still receive that 401 so it can refresh. Unauthenticated bodies are therefore bounded
 * only by the body-size limit — a reverse proxy / CDN in front of the API is the place to cap those (see docs/security).
 */
export interface UploadConcurrencyOptions {
  max: number;
  /** Decides which requests are uploads. */
  matches: (req: Pick<Request, 'method' | 'path'>) => boolean;
  /** True when the request carries a valid access token (same rules as the real JWT strategy). */
  isAuthenticated: (req: Request) => boolean;
  /** How long a request may wait for a slot before being answered 503. */
  maxWaitMs?: number;
  /** How many requests may wait at once; more are answered 503 immediately. */
  maxQueue?: number;
}

export type UploadConcurrencyMiddleware = RequestHandler & { inFlight(): number; queued(): number };

export function limitConcurrentUploads(options: UploadConcurrencyOptions): UploadConcurrencyMiddleware {
  const maxWaitMs = options.maxWaitMs ?? 15_000;
  const maxQueue = options.maxQueue ?? 50;
  let inFlight = 0;
  const waiting: Array<{ start: () => void }> = [];

  const busy = (req: Request, res: Response) => {
    req.resume(); // discard the unread body rather than buffering it
    res.setHeader('Retry-After', '2');
    res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'The server is busy with other uploads. Please try again in a moment.' } });
  };

  const run = (res: Response, next: NextFunction) => {
    inFlight += 1;
    let released = false;
    res.once('close', () => {
      if (released) return;
      released = true;
      inFlight -= 1;
      const nextWaiter = waiting.shift();
      if (nextWaiter) nextWaiter.start();
    });
    next();
  };

  const handler = ((req: Request, res: Response, next: NextFunction) => {
    if (!options.matches(req) || !options.isAuthenticated(req)) return next();
    if (inFlight < options.max) return run(res, next);
    if (waiting.length >= maxQueue) return busy(req, res);

    const entry = {
      start: () => {
        clearTimeout(timer);
        run(res, next);
      },
    };
    const timer = setTimeout(() => {
      const i = waiting.indexOf(entry);
      if (i >= 0) {
        waiting.splice(i, 1);
        res.removeListener('close', onGiveUp);
        busy(req, res);
      }
    }, maxWaitMs);
    const onGiveUp = () => {
      const i = waiting.indexOf(entry);
      if (i >= 0) waiting.splice(i, 1);
      clearTimeout(timer);
    };
    res.once('close', onGiveUp); // the client left while queued
    waiting.push(entry);
  }) as UploadConcurrencyMiddleware;
  handler.inFlight = () => inFlight;
  handler.queued = () => waiting.length;
  return handler;
}

/** POST to the base64 upload endpoint, or a vendor product-image upload. */
export const isImageUploadRequest = (apiPrefix: string) => {
  const base = new RegExp(`^/${apiPrefix}/uploads/?$`);
  const productImage = new RegExp(`^/${apiPrefix}/vendor/products/[^/]+/image/?$`);
  return (req: Pick<Request, 'method' | 'path'>): boolean => req.method === 'POST' && (base.test(req.path) || productImage.test(req.path));
};
